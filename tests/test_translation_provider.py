"""Synthetic providers and usage; no external requests or real keys."""
import json
import logging
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from src import classifier


@pytest.mark.parametrize("cloud", [True, False])
def test_cloud_fallback_keeps_legacy_and_uses_independent_project(monkeypatch, cloud):
    for name in ("VERTEX_PROJECT_ID", "GEMINI_API_KEY", "GROQ_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    if cloud:
        monkeypatch.setenv("VERTEX_PROJECT_ID", "test-project")
    monkeypatch.setenv("GEMINI_API_KEY", "synthetic-old")
    monkeypatch.setenv("GROQ_API_KEY", "synthetic-groq")
    clients = []
    def client(**kwargs):
        clients.append(kwargs)
        return object()
    monkeypatch.setattr("openai.OpenAI", client)
    monkeypatch.setattr(classifier, "_filter_available", lambda c, models, name: models[:1])
    slots = classifier._build_cascade()
    assert [s[0].split("/")[0] for s in slots] == (
        ["groq", "gemini", "vertex"] if cloud else ["groq", "gemini"])
    if cloud:
        assert slots[-1][1].project == "test-project"
        assert len(clients) == 2


def test_crawl_logs_usage_even_when_model_output_is_invalid(monkeypatch, caplog):
    response = SimpleNamespace(model="actual-model", usage=SimpleNamespace(
        prompt_tokens=123, completion_tokens=45, total_tokens=168),
        choices=[SimpleNamespace(message=SimpleNamespace(content="invalid JSON"))])
    client = Mock()
    client.chat.completions.create.return_value = response
    monkeypatch.setattr(classifier, "_build_cascade", lambda: [("gemini-cloud/model", client, "model")])
    monkeypatch.setattr(classifier, "_send_phase3_alarm", lambda m: None)
    with caplog.at_level(logging.INFO):
        classifier.classify_llm_batch([{"uid": "test", "title": "Insurer"}])
    events = [json.loads(r.message.split("translation_usage ", 1)[1]) for r in caplog.records
              if r.message.startswith("translation_usage ")]
    assert len(events) == 1
    assert events[0]["provider"] == "gemini-cloud"
    assert events[0]["model"] == "actual-model"
    assert events[0]["prompt_tokens"] == 123
    assert events[0]["completion_tokens"] == 45
    assert events[0]["total_tokens"] == 168
    assert events[0]["article_count"] == 1
    assert "Insurer" not in json.dumps(events)


def test_missing_usage_remains_unknown(caplog):
    from src.translation_usage import log_usage
    with caplog.at_level(logging.INFO):
        log_usage("gemini-cloud/model", "model", SimpleNamespace(), 2)
    event = json.loads(caplog.records[-1].message.split("translation_usage ")[1])
    assert event["total_tokens"] is None


def test_reclassify_records_usage_and_applies_response(monkeypatch, caplog):
    import reclassify
    from src import index_manager
    row = {"uid": "test", "date": "2026-11-27", "title": "Insurer",
           "title_en": "Insurer", "summary": "", "source": "air_news",
           "category": "市場趨勢", "filter": ""}
    monkeypatch.setattr(index_manager, "load_index", lambda: [row])
    saved = []
    monkeypatch.setattr(index_manager, "save_index", lambda rows, **kw: saved.extend(rows))
    response = SimpleNamespace(model="actual-model", usage=None, choices=[SimpleNamespace(
        message=SimpleNamespace(content=json.dumps([{"title_zh": "保險公司", "summary_zh": "保險公司消息"}])) )])
    client = Mock()
    client.chat.completions.create.return_value = response
    monkeypatch.setattr(reclassify, "_build_cascade", lambda: [("gemini-cloud/model", client, "model")])
    with caplog.at_level(logging.INFO):
        reclassify.reclassify(api_key="", untranslated_since="2026-11-01", delay=0)
    assert saved[0]["title"] == "保險公司"
    assert any(r.message.startswith("translation_usage ") for r in caplog.records)
