import json
import pytest
import requests

from src.agent_search_sync import sync


def test_sync_retries_and_verifies_destination(tmp_path, monkeypatch):
    plan = {"to_snapshot_id": "a" * 64, "total_records": 2}
    path = tmp_path / "plan.json"
    path.write_text(json.dumps(plan))
    calls = []

    class Response:
        def raise_for_status(self):
            if len(calls) == 1:
                raise __import__("requests").RequestException("temporary")

        def json(self):
            return {"snapshot_id": "a" * 64, "total_records": 2}

    def post(*args, **kwargs):
        calls.append((args, kwargs))
        return Response()

    monkeypatch.setattr("src.agent_search_sync.requests.post", post)
    monkeypatch.setattr("src.agent_search_sync.time.sleep", lambda _: None)
    result = sync(path, "https://example.test/sync", "secret")
    assert result["total_records"] == 2
    assert len(calls) == 2
    assert calls[0][1]["headers"]["Authorization"] == "Bearer secret"


@pytest.mark.parametrize("status,body", [
    (500, "D1_ERROR: Your account has exceeded D1's free tier daily row write limit."),
    (503, '{"error":"D1_QUOTA_EXCEEDED"}'),
    (401, '{"error":"Unauthorized"}'),
    (409, '{"error":"Snapshot precondition failed"}'),
])
def test_permanent_failures_stop_after_one_attempt(tmp_path, monkeypatch, status, body):
    path = tmp_path / "plan.json"
    path.write_text(json.dumps({"to_snapshot_id": "a" * 64, "total_records": 2}))
    calls = []
    response = requests.Response()
    response.status_code = status
    response._content = body.encode()
    response.url = "https://example.test/sync"
    monkeypatch.setattr("src.agent_search_sync.requests.post", lambda *a, **k: calls.append(1) or response)
    monkeypatch.setattr("src.agent_search_sync.time.sleep", lambda _: None)
    with pytest.raises(RuntimeError):
        sync(path, response.url, "secret")
    assert len(calls) == 1


def test_destination_mismatch_is_not_retried(tmp_path, monkeypatch):
    path = tmp_path / "plan.json"
    path.write_text(json.dumps({"to_snapshot_id": "a" * 64, "total_records": 2}))
    calls = []
    response = requests.Response()
    response.status_code = 200
    response._content = json.dumps({"snapshot_id": "b" * 64, "total_records": 2}).encode()
    monkeypatch.setattr("src.agent_search_sync.requests.post", lambda *a, **k: calls.append(1) or response)
    monkeypatch.setattr("src.agent_search_sync.time.sleep", lambda _: None)
    with pytest.raises(RuntimeError):
        sync(path, "https://example.test/sync", "secret")
    assert len(calls) == 1


@pytest.mark.parametrize("retry_after,expected", [("7", 7), ("garbage", 1), ("-1", 0)])
def test_rate_limit_respects_retry_after(monkeypatch, retry_after, expected):
    from src.agent_search_sync import retry_delay
    response = requests.Response()
    response.headers["Retry-After"] = retry_after
    assert retry_delay(response, 0) == expected


def test_long_retry_after_stops_instead_of_retrying_early():
    from src.agent_search_sync import retry_delay
    response = requests.Response()
    response.headers["Retry-After"] = "3600"
    with pytest.raises(RuntimeError, match="cooldown"):
        retry_delay(response, 0)


def test_transient_failures_have_a_three_attempt_ceiling(tmp_path, monkeypatch):
    path = tmp_path / "plan.json"
    path.write_text(json.dumps({"to_snapshot_id": "a" * 64, "total_records": 2}))
    calls = []
    def fail(*args, **kwargs):
        calls.append(1)
        raise requests.Timeout("synthetic timeout")
    monkeypatch.setattr("src.agent_search_sync.requests.post", fail)
    monkeypatch.setattr("src.agent_search_sync.time.sleep", lambda _: None)
    with pytest.raises(RuntimeError, match="after 3 attempts"):
        sync(path, "https://example.test/sync", "secret")
    assert len(calls) == 3


def test_cli_requires_configuration_and_reports_verified_result(monkeypatch, capsys):
    from src import agent_search_sync
    monkeypatch.delenv("AGENT_INDEX_SYNC_PLAN", raising=False)
    monkeypatch.delenv("AGENT_INDEX_SYNC_TOKEN", raising=False)
    with pytest.raises(RuntimeError, match="required"):
        agent_search_sync.main()
    monkeypatch.setenv("AGENT_INDEX_SYNC_PLAN", "/synthetic/plan.json")
    monkeypatch.setenv("AGENT_INDEX_SYNC_TOKEN", "synthetic-test-token")
    monkeypatch.setattr(agent_search_sync, "sync", lambda *args: {"snapshot_id": "a" * 64, "total_records": 2})
    agent_search_sync.main()
    output = capsys.readouterr().out
    assert json.loads(output)["total_records"] == 2
    assert "synthetic-test-token" not in output
