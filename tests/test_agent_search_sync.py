import json

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
