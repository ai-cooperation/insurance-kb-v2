"""Synthetic crawl inputs; no network or production data writes."""
import logging

import pytest

import run
from src import classifier


@pytest.mark.parametrize("disabled", [False, True])
def test_crawl_without_keys_records_pending_unless_explicitly_disabled(monkeypatch, disabled):
    monkeypatch.setattr("sys.argv", ["run.py", *(["--no-ai"] if disabled else [])])
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setattr(run, "setup_logging", lambda: logging.getLogger("test"))
    monkeypatch.setattr(run, "Deduplicator", lambda: None)
    monkeypatch.setattr(run, "crawl_all", lambda *a, **kw: [])
    monkeypatch.setattr(run, "resolve_gnews_urls", lambda *a, **kw: [])
    monkeypatch.setattr(run, "_results_to_dicts", lambda *a: [{"uid": "test", "title": "An insurer"}])
    monkeypatch.setattr(run, "classify_rule", lambda a: a)
    monkeypatch.setattr(classifier, "_build_cascade", lambda: [])
    alerts = []
    monkeypatch.setattr(classifier, "_send_phase3_alarm", alerts.append)
    monkeypatch.setattr(run, "run_quality_gate", lambda a: dict(total=1, irrelevant=0, duplicates=0, noise_pct=0, passed=True))
    monkeypatch.setattr(run, "generate_all", lambda a: a)
    saved = []
    monkeypatch.setattr(run, "update_index", lambda a: saved.extend(a) or a)
    monkeypatch.setattr(run, "get_stats", lambda a: dict(total=1, categories={}, regions={}))
    monkeypatch.setattr(run, "build_card_view", lambda a: None)
    monkeypatch.setattr("build_frontend_data.build", lambda: None)
    monkeypatch.setattr("src.name_consistency.check_articles", lambda a: [])
    run.main()
    if disabled:
        assert "_translation_state" not in saved[0]
        assert alerts == []
    else:
        assert saved[0]["_translation_state"] == {"title": "pending", "summary": "pending"}
        assert len(alerts) == 1
