"""Synthetic API responses; never calls Google or reads local credentials."""
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import requests

from src.vertex_translation import VertexTranslationClient


def payload(finish="STOP"):
    return {"modelVersion": "gemini-3.5-flash-lite", "candidates": [{
        "finishReason": finish, "content": {"parts": [
            {"text": "private reasoning", "thought": True}, {"text": '[{"title_zh":"保險消息"}]'}]}}],
        "usageMetadata": {"promptTokenCount": 40, "candidatesTokenCount": 8, "totalTokenCount": 48}}


def client(data=None):
    session = Mock()
    session.post.return_value = Mock(status_code=200, json=lambda: payload() if data is None else data)
    return VertexTranslationClient(project="test-project", session=session), session


def complete(c):
    return c.chat.completions.create(model=c.model, messages=[
        {"role": "system", "content": "Translate only"}, {"role": "user", "content": "Insurer"}],
        temperature=0.3, max_tokens=1500, extra_body=None)


def test_native_cloud_endpoint_schema_and_usage():
    c, session = client()
    result = complete(c)
    args, kw = session.post.call_args
    assert args[0] == "https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google/models/gemini-3.5-flash-lite:generateContent"
    assert kw["json"]["systemInstruction"]["parts"][0]["text"] == "Translate only"
    assert kw["json"]["generationConfig"]["thinkingConfig"] == {"thinkingLevel": "MINIMAL"}
    assert kw["timeout"] == 90
    assert result.usage.total_tokens == 48
    assert result.choices[0].message.content == '[{"title_zh":"保險消息"}]'
    session.post.assert_called_once()


@pytest.mark.parametrize("data", [{}, [], {"candidates": []}, payload("MAX_TOKENS"), payload("SAFETY"),
    {**payload(), "usageMetadata": []}, {"candidates": [None]}])
def test_malformed_blocked_or_truncated_is_rejected(data):
    c, _ = client(data)
    with pytest.raises(ValueError):
        complete(c)


def test_http_failure_does_not_retry_or_hide_error():
    c, session = client()
    session.post.return_value.raise_for_status.side_effect = requests.HTTPError("429")
    with pytest.raises(requests.HTTPError):
        complete(c)
    session.post.assert_called_once()


@pytest.mark.parametrize("kwargs", [{"project": "../evil"}, {"project": ""},
    {"project": "test-project", "location": "../bad"}, {"project": "test-project", "model": "bad/path"}])
def test_invalid_configuration_fails_before_auth(kwargs):
    with pytest.raises(ValueError):
        VertexTranslationClient(**kwargs)


def test_explicit_short_lived_token_avoids_adc(monkeypatch):
    monkeypatch.setenv("VERTEX_ACCESS_TOKEN", "synthetic-token")
    monkeypatch.delenv("GOOGLE_APPLICATION_CREDENTIALS", raising=False)
    mock = Mock()
    monkeypatch.setattr("google.auth.transport.requests.AuthorizedSession", mock)
    c = VertexTranslationClient(project="test-project")
    c.session()
    assert mock.call_args.args[0].token == "synthetic-token"
    assert c.session() is mock.return_value


def test_refreshable_workflow_credentials(monkeypatch):
    monkeypatch.delenv("VERTEX_ACCESS_TOKEN", raising=False)
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", "/synthetic/gha-creds.json")
    default = Mock(return_value=(SimpleNamespace(), "test-project"))
    monkeypatch.setattr("google.auth.default", default)
    monkeypatch.setattr("google.auth.transport.requests.AuthorizedSession", Mock())
    VertexTranslationClient(project="test-project").session()
    default.assert_called_once_with(scopes=["https://www.googleapis.com/auth/cloud-platform"], quota_project_id="test-project")


def test_missing_credentials_never_uses_local_adc(monkeypatch):
    monkeypatch.delenv("VERTEX_ACCESS_TOKEN", raising=False)
    monkeypatch.delenv("GOOGLE_APPLICATION_CREDENTIALS", raising=False)
    with pytest.raises(ValueError, match="credentials"):
        VertexTranslationClient(project="test-project").session()


def test_input_validation_and_absent_usage():
    c, session = client()
    for overrides in ({"model": "different"}, {"max_tokens": True}, {"messages": []},
                      {"messages": [{"role": "assistant", "content": "x"}]},
                      {"messages": [{"role": "system", "content": "x"}]}):
        with pytest.raises(ValueError):
            c.create(**{**dict(model=c.model, max_tokens=10, messages=[{"role": "user", "content": "x"}]), **overrides})
    session.post.assert_not_called()
    data = payload()
    data.pop("usageMetadata")
    c, _ = client(data)
    assert complete(c).usage.total_tokens is None


def test_smoke_exercises_real_cascade_after_synthetic_429():
    import json
    from src.translation_cloud_smoke import validate
    c, session = client()
    responses = []
    for title, summary in [("模擬保險理賠減少12%", "測試保險公司的理賠減少12%。"),
                           ("虛構保險公司在台北設分店", "虛構保險公司已在台北開設分店。")]:
        data = payload()
        data["candidates"][0]["content"]["parts"] = [{"text": json.dumps([{"title_zh": title, "summary_zh": summary}])}]
        responses.append(Mock(status_code=200, json=lambda d=data: d))
    session.post.side_effect = responses
    report = validate(c)
    assert all(report["checks"].values())
    assert len(report["cloud_calls"]) == 2
    assert session.post.call_count == 2


def test_smoke_rejects_observed_unsupported_background():
    import json
    from src.translation_cloud_smoke import validate
    c, session = client()
    data = payload()
    data["candidates"][0]["content"]["parts"] = [{"text": json.dumps([{
        "title_zh": "台北理賠減少12%", "summary_zh": "測試台北理賠減少12%，旨在驗證跨國業務與監管審批。"}])}]
    session.post.return_value = Mock(status_code=200, json=lambda: data)
    assert not validate(c)["checks"]["no_unstated_context"]


@pytest.mark.parametrize("title,failed_check", [
    ("綜合保險報告：理賠下降 12%", "synthetic_title_preserved"),
    ("架構保險公司於台北開設分公司", "fictional_insurer_preserved"),
])
def test_smoke_rejects_observed_mistranslations(title, failed_check):
    import json
    from src.translation_cloud_smoke import validate
    c, session = client()
    data = payload()
    data["candidates"][0]["content"]["parts"] = [{"text": json.dumps([{
        "title_zh": title, "summary_zh": "測試保險公司在台北的理賠減少 12%。"}])}]
    session.post.return_value = Mock(status_code=200, json=lambda: data)
    assert not validate(c)["checks"][failed_check]
