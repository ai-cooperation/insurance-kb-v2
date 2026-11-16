"""ops-inbox sender contract; GitHub API is mocked, no network."""
import io
import json
import urllib.error
from pathlib import Path
from unittest.mock import patch

import pytest
import yaml

from src import ops_inbox


class _Resp:
    def __init__(self, payload):
        self._raw = json.dumps(payload).encode("utf-8")

    def read(self):
        return self._raw

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _fake_api(open_issues, calls):
    def urlopen(req, timeout=0):
        body = json.loads(req.data.decode("utf-8")) if req.data else None
        calls.append((req.get_method(), req.full_url, body, req.headers.get("Authorization")))
        if req.get_method() == "GET":
            return _Resp(open_issues)
        return _Resp({"number": 42})
    return urlopen


def test_missing_token_is_reported_not_silent(monkeypatch, caplog):
    monkeypatch.delenv("OPS_INBOX_TOKEN", raising=False)
    with caplog.at_level("WARNING"):
        assert ops_inbox.send_event("資訊源健康告警", "body") is False
    assert "OPS_INBOX_TOKEN not set" in caplog.text


def test_new_event_opens_labelled_issue(monkeypatch):
    monkeypatch.setenv("OPS_INBOX_TOKEN", "t")
    calls = []
    with patch("urllib.request.urlopen", _fake_api([], calls)):
        assert ops_inbox.send_event("資訊源健康告警", "detail", "warn") is True
    method, url, body, auth = calls[-1]
    assert (method, url) == ("POST", "https://api.github.com/repos/ai-cooperation/ops-inbox/issues")
    assert body["title"] == "資訊源健康告警"
    assert body["labels"] == ["sev:warn", "src:insurance-kb-v2"]
    assert "@" not in body["body"]  # only critical mentions the owner
    assert auth == "Bearer t"


def test_repeat_of_open_event_comments_instead_of_reopening(monkeypatch):
    monkeypatch.setenv("OPS_INBOX_TOKEN", "t")
    calls = []
    open_issues = [
        {"number": 7, "title": "別的事件"},
        {"number": 9, "title": "資訊源健康告警"},
        {"number": 11, "title": "資訊源健康告警", "pull_request": {}},
    ]
    with patch("urllib.request.urlopen", _fake_api(open_issues, calls)):
        assert ops_inbox.send_event("資訊源健康告警", "again") is True
    assert calls[-1][1].endswith("/issues/9/comments")
    assert len([c for c in calls if c[0] == "POST"]) == 1


def test_critical_mentions_owner_so_github_emails(monkeypatch):
    monkeypatch.setenv("OPS_INBOX_TOKEN", "t")
    calls = []
    with patch("urllib.request.urlopen", _fake_api([], calls)):
        ops_inbox.send_event("x", "y", "critical")
    assert calls[-1][2]["body"].startswith("@AlanChen75 ")
    assert "sev:critical" in calls[-1][2]["labels"]


@pytest.mark.parametrize("severity,title", [("page", "x"), ("warn", "  ")])
def test_invalid_event_rejected_without_network(monkeypatch, severity, title):
    monkeypatch.setenv("OPS_INBOX_TOKEN", "t")
    with patch("urllib.request.urlopen", side_effect=AssertionError("no network expected")):
        assert ops_inbox.send_event(title, "b", severity) is False


def test_http_error_returns_false_and_never_raises(monkeypatch, caplog):
    monkeypatch.setenv("OPS_INBOX_TOKEN", "t")
    err = urllib.error.HTTPError("u", 401, "Bad credentials", {}, io.BytesIO(b'{"message":"Bad credentials"}'))
    with patch("urllib.request.urlopen", side_effect=err), caplog.at_level("WARNING"):
        assert ops_inbox.send_event("x", "y") is False
    assert "NOT delivered" in caplog.text


def test_no_telegram_left_in_pipeline_or_workflows():
    """Registry-style invariant: every notifier must go through ops_inbox."""
    root = Path(__file__).resolve().parents[1]
    offenders = [
        str(p.relative_to(root))
        for pattern in ("src/*.py", ".github/workflows/*.yml", "*.py")
        for p in root.glob(pattern)
        if p.name != "ops_inbox.py" and "api.telegram.org" in p.read_text(encoding="utf-8")
    ]
    assert offenders == []


def test_every_workflow_failure_alert_uses_ops_inbox_token():
    root = Path(__file__).resolve().parents[1] / ".github/workflows"
    for name in ("crawl.yml", "distill.yml", "reclassify.yml", "release.yml"):
        flow = yaml.load((root / name).read_text(), Loader=yaml.BaseLoader)
        steps = [s for job in flow["jobs"].values() for s in job["steps"]]
        alerts = [s for s in steps if s.get("name") == "Report failure to ops-inbox"]
        assert len(alerts) == 1, name
        assert alerts[0]["if"] == "failure()"
        assert "OPS_INBOX_TOKEN" in alerts[0]["env"]
        assert "TITLE=" in alerts[0]["run"] and "連續第" not in alerts[0]["run"].split("TITLE=")[1].split("\n")[0]
