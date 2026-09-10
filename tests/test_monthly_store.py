"""Synthetic for testing only: storage and lineage invariants."""
import json
import tempfile
import unittest
from pathlib import Path

from src.monthly_store import MonthlyStore, StorageError


def article(uid="a1", date="2026-08-01", **kwargs):
    return {"uid": uid, "date": date, "title": "Synthetic test article",
            "title_en": "Original test title", "summary": "saved excerpt " * 40,
            "source_url": "https://example.test/article", "filter": "", **kwargs}


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "master-index.json"
        self.store = MonthlyStore(self.path, max_bytes=2800)

    def test_migration_preserves_all_fields_and_filtered_records(self):
        rows = [article(), article("b2", "2013-05-21", filter="irrelevant")]
        self.path.write_text(json.dumps(rows))
        self.store.save(self.store.load(), reason="migration")
        actual = self.store.load()
        self.assertEqual([{k:v for k,v in r.items() if k != "_lineage"} for r in actual], rows)
        self.assertEqual(actual[1]["_lineage"]["retrieved_at"], None)
        self.assertEqual(actual[0]["_lineage"]["verification_status"], "unverified")
        self.assertEqual(self.store.manifest()["schema_version"], 3)

    def test_multiple_shards_and_idempotency(self):
        self.store.save([article(str(i)) for i in range(5)])
        before = self.path.read_bytes()
        self.assertGreater(len(self.store.manifest()["shards"]), 1)
        self.store.save(self.store.load())
        self.assertEqual(before, self.path.read_bytes())
        self.assertEqual(len(self.store.load()), 5)

    def test_old_snapshot_and_month_correction(self):
        self.store.save([article()])
        old = self.store.manifest()["snapshot_id"]
        row = self.store.load()[0]
        self.store.save([{**row, "date": "2026-07-31", "summary": "corrected"}], reason="human correction")
        new = self.store.load()[0]
        self.assertEqual(self.store.load(snapshot_id=old)[0]["summary"], row["summary"])
        self.assertEqual(new["_lineage"]["previous_revision_id"], row["_lineage"]["revision_id"])
        self.assertEqual(new["uid"], row["uid"])

    def test_stale_edit_rejected(self):
        self.store.save([article()])
        old = self.store.load()[0]
        self.store.save([{**old, "summary": "first correction"}])
        with self.assertRaises(StorageError):
            self.store.save([{**old, "summary": "stale correction"}])

    def test_corrupt_or_missing_shard_fails_closed(self):
        self.store.save([article()])
        shard = self.path.parent / self.store.manifest()["shards"][0]["file"]
        shard.write_text("[]")
        with self.assertRaises(StorageError):
            self.store.load()

    def test_bad_ids_and_oversized_record_leave_manifest_unchanged(self):
        self.store.save([article()])
        before = self.path.read_bytes()
        for rows in ([article("")], [article(), article()], [article(summary="x"*5000)]):
            with self.assertRaises(StorageError):
                self.store.save(rows)
            self.assertEqual(before, self.path.read_bytes())

    def test_empty_and_unknown_month(self):
        self.store.save([])
        self.assertEqual(self.store.load(), [])
        self.store.save([article(date="unknown")])
        self.assertEqual(self.store.manifest()["shards"][0]["month"], "unknown")

    def test_month_filter(self):
        self.store.save([article(), article("b2", "2025-01-01")])
        self.assertEqual([r["uid"] for r in self.store.load(months={"2025-01"})], ["b2"])

    def test_stale_full_list_cannot_drop_another_writers_new_records(self):
        self.store.save([article()])
        stale = self.store.load()
        self.store.save([*stale, article("b2")])
        with self.assertRaises(StorageError):
            self.store.save(stale)
        self.assertEqual(len(self.store.load()), 2)

    def test_failed_publication_keeps_old_current_snapshot(self):
        from unittest.mock import patch
        self.store.save([article()])
        before = self.path.read_bytes()
        row = self.store.load()[0]
        with patch("src.monthly_store.write_snapshot", side_effect=OSError("synthetic interruption")):
            with self.assertRaises(OSError):
                self.store.save([{**row, "summary": "new"}])
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(self.store.load()[0], row)


if __name__ == "__main__":
    unittest.main()
