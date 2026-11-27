"""Synthetic for testing only: batch PR restrictions and exact D1 payloads."""
import pytest
import json
import subprocess

from src.monthly_store import StorageError
from src.translation_batch_check import check_paths, check_plan


def test_full_committed_batch_is_bound_to_git_base(tmp_path):
    from src.monthly_store import MonthlyStore
    from src.translation_queue import record_attempts, mark_attempts
    from src.translation_backfill import pending, apply_patch
    from src.translation_batch_check import verify_batch
    from src.agent_publication import publish_articles, write_search_sync_plan
    root = tmp_path
    store = MonthlyStore(root / "index/master-index.json")
    store.save([{"uid": "a", "date": "2026-11-21", "title": "Original headline",
                 "title_en": "Original headline", "summary": "Source summary",
                 "source_excerpt": "The insurer opened a new office in Taipei on Monday.",
                 "source_url": "https://example.test/news", "filter": "", "category": "市場趨勢"}])
    queue = root / "index/translation-queue.json"
    queue.write_text('{"schema_version":1,"entries":{}}')
    record_attempts(mark_attempts(store.load()), store.load(), queue)
    before_rows = store.load()
    agent = root / "frontend/public/data/agent"
    before_manifest = publish_articles(before_rows, agent)
    def git(*args):
        return subprocess.check_output(["git", "-c", "user.name=Synthetic Test", "-c",
                                        "user.email=test@example.test", *args], cwd=root, text=True).strip()
    git("init", "-q")
    git("add", ".")
    git("commit", "-qm", "Synthetic base")
    base = git("rev-parse", "HEAD")
    assert verify_batch(base, root) == {"batch": None}
    with pytest.raises(StorageError):
        verify_batch(base, root, required=True)
    page = pending(store, queue)
    patch = {"schema_version": 1, "base_snapshot_id": page["base_snapshot_id"],
             "base_queue_hash": page["queue_hash"], "updates": [{
                 "uid": "a", "expected_revision_id": page["items"][0]["expected_revision_id"],
                 "title_status": "completed", "title_zh": "保險公司在台北開設辦公室"}]}
    apply_patch(store, queue, patch)
    after_manifest = publish_articles(store.load(), agent)
    (root / "repairs").mkdir()
    patch_path = root / "repairs/translation-batch-20261127-120000.json"
    patch_path.write_text(json.dumps(patch))
    plan_path = root / "repairs/agent-index-sync-20261127-120000.json"
    write_search_sync_plan(plan_path, before_manifest, before_rows, after_manifest, store.load())
    git("add", ".")
    git("commit", "-qm", "Synthetic translation")
    assert verify_batch(base, root, required=True)["updated"] == 1
    with pytest.raises(StorageError):
        verify_batch("HEAD", root)
    # A review made against a different queue cannot borrow a valid archive.
    patch["base_queue_hash"] = "0" * 64
    patch_path.write_text(json.dumps(patch))
    with pytest.raises(StorageError, match="base queue differs"):
        verify_batch(base, root)


def test_batch_only_changes_data_and_keeps_immutable_files():
    check_paths([("A", "repairs/translation-batch-20261127-120000.json"),
                 ("M", "index/translation-queue.json"),
                 ("A", "index/objects/2026-11/abc.json")])
    for status, path in [("M", "src/classifier.py"), ("D", "index/objects/x.json"),
                         ("M", "index/objects/x.json"), ("A", ".github/workflows/evil.yml"),
                         ("M", "repairs/translation-batch-old.json")]:
        with pytest.raises(StorageError):
            check_paths([(status, path)])


def test_plan_no_deletes_exact_upserts_and_snapshot():
    before = {"snapshot_id": "base", "total_records": 1}
    after = {"snapshot_id": "current", "total_records": 1}
    row = {"uid": "a", "revision_id": "r"}
    plan = {"schema_version": 1, "from_snapshot_id": "base", "to_snapshot_id": "current",
            "total_records": 1, "upserts": [row], "deletes": []}
    check_plan(plan, before, after, [row])
    for bad in ({"deletes": ["a"]}, {"upserts": []}, {"upserts": [row, row]},
                {"from_snapshot_id": "stale"}, {"total_records": 2}):
        with pytest.raises(StorageError):
            check_plan({**plan, **bad}, before, after, [row])


def test_batch_cli_writes_validated_plan_only(tmp_path, monkeypatch, capsys):
    import sys
    from src import translation_batch_check as module
    output = tmp_path / "output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    monkeypatch.setattr(sys, "argv", ["check", "--base", "0" * 40])
    monkeypatch.setattr(module, "verify_batch", lambda *args, **kwargs: {
        "batch": "repairs/translation-batch-20261127-120000.json",
        "plan": "repairs/agent-index-sync-20261127-120000.json"})
    module.main()
    assert output.read_text() == "plan=repairs/agent-index-sync-20261127-120000.json\n"
    assert json.loads(capsys.readouterr().out)["plan"]
    def failed(*args, **kwargs):
        raise StorageError("Synthetic failure")
    monkeypatch.setattr(module, "verify_batch", failed)
    with pytest.raises(SystemExit) as error:
        module.main()
    assert error.value.code == 1
