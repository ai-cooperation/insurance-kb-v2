"""Synthetic for testing only: offline translation repair acceptance tests."""
import json

import pytest

from src.monthly_store import MonthlyStore, StorageError
from src.translation_queue import load_queue, record_attempts, mark_attempts, mark_result
from src.translation_backfill import apply_patch, pending, verify_patch


@pytest.fixture
def corpus(tmp_path):
    store = MonthlyStore(tmp_path / "master-index.json")
    store.save([{"uid": f"a{i:02}", "date": "2026-11-21", "title": "Original title",
                 "title_en": "Original title", "summary": "Original summary",
                 "source_excerpt": "The insurer opened a new office in Taipei on Monday.",
                 "category": "市場趨勢", "source_url": "https://example.test/news"}
                for i in range(25)])
    queue = tmp_path / "translation-queue.json"
    queue.write_text('{"schema_version":1,"entries":{}}')
    record_attempts(mark_attempts(store.load()), store.load(), queue)
    return store, queue


def review(store, queue, **changes):
    page = pending(store, queue)
    row = page["items"][0]
    return {"schema_version": 1, "base_snapshot_id": page["base_snapshot_id"],
            "base_queue_hash": page["queue_hash"], "updates": [{
                "uid": row["uid"], "expected_revision_id": row["expected_revision_id"],
                "title_status": "completed", "title_zh": "保險公司設立新辦公室", **changes}]}


def test_pagination_is_readonly_and_covers_whole_queue(corpus):
    store, queue = corpus
    before = (store.path.read_bytes(), queue.read_bytes())
    pages = [pending(store, queue, offset=n) for n in (0, 20, 40)]
    assert [p["page_count"] for p in pages] == [20, 5, 0]
    assert len({r["uid"] for p in pages for r in p["items"]}) == 25
    assert before == (store.path.read_bytes(), queue.read_bytes())


def test_absent_status_is_never_inferred(corpus):
    store, queue = corpus
    queue.write_text('{"schema_version":1,"entries":{}}')
    record_attempts(store.load(), store.load(), queue)
    assert pending(store, queue)["total"] == 0
    with pytest.raises(StorageError):
        pending(store, queue.with_name("missing.json"))


def test_partial_review_preserves_every_unreviewed_field_and_replays(corpus):
    store, queue = corpus
    before = store.load()
    patch = review(store, queue)
    apply_patch(store, queue, patch)
    after = store.load()
    assert {k: v for k, v in before[0].items() if k not in {"title", "_lineage"}} == {
        k: v for k, v in after[0].items() if k not in {"title", "_lineage"}}
    assert after[1:] == before[1:]
    assert load_queue(queue)["entries"]["a00"]["translation_state"]["summary"] == "pending"
    assert verify_patch(store, queue, patch)["updated"] == 1
    saved = (store.path.read_bytes(), queue.read_bytes())
    apply_patch(store, queue, patch)
    assert saved == (store.path.read_bytes(), queue.read_bytes())


def test_not_required_does_not_create_article_revision(corpus):
    store, queue = corpus
    patch = review(store, queue, title_status="not_required")
    patch["updates"][0].pop("title_zh")
    before = store.path.read_bytes()
    apply_patch(store, queue, patch)
    assert store.path.read_bytes() == before


@pytest.mark.parametrize("changes", [
    {"expected_revision_id": "0" * 64}, {"category": "其他"}, {"title_en": "changed"},
    {"title_zh": ""}, {"title_zh": "English"}, {"title_status": "unknown"},
    {"summary_zh": "沒有狀態"}, {"summary_status": "not_required"},
])
def test_invalid_review_has_no_writes(corpus, changes):
    store, queue = corpus
    patch = review(store, queue, **changes)
    before = (store.path.read_bytes(), queue.read_bytes())
    with pytest.raises(StorageError):
        apply_patch(store, queue, patch)
    assert before == (store.path.read_bytes(), queue.read_bytes())


def test_duplicate_stale_and_completed_reviews_rejected(corpus):
    store, queue = corpus
    patch = review(store, queue)
    for invalid in ({**patch, "updates": patch["updates"] * 2},
                    {**patch, "base_snapshot_id": "0" * 64},
                    {**patch, "base_queue_hash": "0" * 64}):
        with pytest.raises(StorageError):
            apply_patch(store, queue, invalid)
    apply_patch(store, queue, patch)
    with pytest.raises(StorageError):
        apply_patch(store, queue, review(store, queue))


def test_source_insufficient_summary_and_stale_queue(corpus):
    store, queue = corpus
    store.save([{**r, "source_excerpt": ""} for r in store.load()])
    assert pending(store, queue)["skipped"][0]["reason"] == "revision_changed"
    record_attempts(mark_attempts(store.load()), store.load(), queue)
    with pytest.raises(StorageError):
        apply_patch(store, queue, review(store, queue, summary_status="completed", summary_zh="虛構摘要"))


def test_verify_detects_unrelated_edits(corpus):
    store, queue = corpus
    patch = review(store, queue)
    apply_patch(store, queue, patch)
    rows = store.load()
    store.save([*rows[:-1], {**rows[-1], "category": "changed"}])
    with pytest.raises(StorageError):
        verify_patch(store, queue, patch)


def test_attempt_status_is_per_field_and_does_not_mutate_input():
    original = {"uid": "a", "title": "中文原標題"}
    marked = mark_attempts([original])[0]
    assert "_translation_state" not in original
    partial = mark_result(marked, {"title_zh": "中文標題"})
    assert partial["_translation_state"] == {"title": "completed", "summary": "pending"}
    assert marked["_translation_state"]["title"] == "pending"


def test_no_provider_retains_explicit_pending(monkeypatch):
    from src import classifier
    monkeypatch.setattr(classifier, "_build_cascade", lambda: [])
    monkeypatch.setattr(classifier, "_send_phase3_alarm", lambda message: None)
    result = classifier.classify_llm_batch([{"uid": "a", "title": "Original"}])
    assert result[0]["_translation_state"] == {"title": "pending", "summary": "pending"}


def test_partial_model_array_keeps_missing_rows_pending():
    from src.classifier import _merge_llm_results
    rows = mark_attempts([{"uid": "a"}, {"uid": "b"}])
    result = _merge_llm_results(rows, [{"title_zh": "標題"}])
    assert result[0]["_translation_state"] == {"title": "completed", "summary": "pending"}
    assert result[1]["_translation_state"] == {"title": "pending", "summary": "pending"}


def test_ingest_persists_queue_without_changing_article_contract(tmp_path, monkeypatch):
    from src import index_manager
    path = tmp_path / "master-index.json"
    store = MonthlyStore(path)
    store.save([])
    queue = tmp_path / "translation-queue.json"
    queue.write_text('{"schema_version":1,"entries":{}}')
    monkeypatch.setattr(index_manager, "INDEX_PATH", path)
    article = mark_attempts([{"uid": "a", "title": "Original", "snippet": "Source excerpt"}])[0]
    rows = index_manager.update_index([article])
    assert "_translation_state" not in rows[0] and "translation_state" not in rows[0]
    assert load_queue(queue)["entries"]["a"]["expected_revision_id"] == rows[0]["_lineage"]["revision_id"]


def test_resume_after_queue_write_failure(corpus, monkeypatch):
    import src.translation_backfill as module
    store, queue = corpus
    patch = review(store, queue)
    real = module.atomic_write
    def interrupted(path, payload):
        if path == queue:
            raise OSError("Synthetic interruption")
        return real(path, payload)
    with monkeypatch.context() as context:
        context.setattr(module, "atomic_write", interrupted)
        with pytest.raises(OSError):
            apply_patch(store, queue, patch)
    assert apply_patch(store, queue, patch)["updated"] == 1


def test_completed_summary_retires_uid(corpus):
    store, queue = corpus
    apply_patch(store, queue, review(store, queue, summary_status="completed", summary_zh="該保險公司週一在台北設立新辦公室。"))
    assert pending(store, queue)["total"] == 24


@pytest.mark.parametrize("payload", [[], {}, {"schema_version": 2, "entries": {}},
                                     {"schema_version": 1, "entries": {"a": []}},
                                     {"schema_version": 1, "entries": {"a": {}}}])
def test_bad_queue_fails_closed(corpus, payload):
    store, queue = corpus
    queue.write_text(json.dumps(payload))
    with pytest.raises(StorageError):
        pending(store, queue)


def test_missing_source_or_revision_in_queue_is_skipped(corpus):
    store, queue = corpus
    data = load_queue(queue)
    data["entries"]["gone"] = data["entries"]["a00"]
    data["entries"]["a00"] = {**data["entries"]["a00"], "source_hash": "0" * 64}
    queue.write_text(json.dumps(data))
    reasons = {r["reason"] for r in pending(store, queue, limit=100)["skipped"]}
    assert reasons == {"article_missing", "source_changed"}


def test_invalid_pagination(corpus):
    for options in ({"limit": 0}, {"offset": -1}):
        with pytest.raises(StorageError):
            pending(*corpus, **options)


def test_cli_pending_apply_verify_and_error(corpus, tmp_path, monkeypatch, capsys):
    import sys
    from src.translation_backfill import main
    store, queue = corpus
    patch = review(store, queue)
    path = tmp_path / "review.json"
    path.write_text(json.dumps(patch))
    for command in ("pending", "apply", "verify"):
        monkeypatch.setattr(sys, "argv", ["translation_backfill", command, "--index", str(store.path),
                                         "--queue", str(queue), "--patch", str(path)])
        main()
        assert json.loads(capsys.readouterr().out)
    monkeypatch.setattr(sys, "argv", ["translation_backfill", "pending", "--index", str(store.path),
                                     "--queue", str(queue), "--limit", "0"])
    with pytest.raises(SystemExit) as error:
        main()
    assert error.value.code == 1
