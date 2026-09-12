"""Synthetic for testing only: immutable publication and Wiki lineage."""
import tempfile
import unittest
from pathlib import Path
from src.monthly_store import MonthlyStore, read_json, read_object
from src.agent_publication import publish_articles, publish_wikis
from test_monthly_store import article


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.store = MonthlyStore(self.root / "index/master-index.json")
        self.out = self.root / "public/agent"

    def test_full_saved_content_and_lookup_survive_revision(self):
        self.store.save([article()])
        rows = self.store.load()
        old = publish_articles(rows, self.out)
        self.store.save([{**rows[0], "summary": "new summary"}])
        new = publish_articles(self.store.load(), self.out)
        self.assertNotEqual(old["snapshot_id"], new["snapshot_id"])
        saved = read_json(self.out / "snapshots" / f"{old['snapshot_id']}.json")
        catalog = read_object(self.out, saved["catalogs"]["a"])
        shard = read_object(self.out, catalog["a1"])
        self.assertEqual(shard[0]["summary"], rows[0]["summary"])

    def test_search_projection_covers_every_visible_revision(self):
        self.store.save([
            article("a1", "2026-08-01", source="Synthetic", category="market", region="TW"),
            article("b2", "2013-05-21", source="Archive", category="regulation", region="JP"),
        ])
        manifest = publish_articles(self.store.load(), self.out)
        self.assertEqual(manifest["search_records"], manifest["total_records"])
        self.assertLessEqual(len(manifest["search_shards"]), 40)
        projected = []
        for ref in manifest["search_shards"]:
            self.assertLessEqual(ref["bytes"], 1900 * 1024)
            self.assertIn("from_month", ref)
            self.assertIn("to_month", ref)
            projected.extend(read_object(self.out, ref))
        self.assertEqual(
            {(row["uid"], row["_lineage"]["revision_id"]) for row in projected},
            {(row["uid"], row["_lineage"]["revision_id"]) for row in self.store.load()},
        )
        self.assertEqual(projected[0]["source_url"], "https://example.test/article")

    def test_new_article_rewrites_only_one_stable_search_bucket(self):
        self.store.save([article(f"a{i}") for i in range(100)])
        first = publish_articles(self.store.load(), self.out)
        before = {ref["part"]: ref["file"] for ref in first["search_shards"]}
        self.store.save([*self.store.load(), article("new101")])
        second = publish_articles(self.store.load(), self.out)
        after = {ref["part"]: ref["file"] for ref in second["search_shards"]}
        changed = {part for part in set(before) | set(after) if before.get(part) != after.get(part)}
        self.assertEqual(len(changed), 1)

    def test_reject_filtered_publication(self):
        self.store.save([article(filter="irrelevant")])
        with self.assertRaises(ValueError):
            publish_articles(self.store.load(), self.out)

    def test_wiki_preserves_body_and_marks_changed_evidence_stale(self):
        self.store.save([article()])
        row = self.store.load()[0]
        snapshot = publish_articles([row], self.out)
        compiled = self.root / "compiled/2026-08"
        compiled.mkdir(parents=True)
        import json
        refs = [{"article_id": row["uid"], "revision_id": row["_lineage"]["revision_id"],
                 "snapshot_id": snapshot["snapshot_id"]}]
        body = "### 本月重點\nSynthetic finding [1].\n\n### 來源文章索引\nhttps://example.test/article"
        (compiled / "market-global.md").write_text("---\nperiod: 2026-08\nsource_refs: " + json.dumps(refs) + "\n---\n" + body)
        first = publish_wikis(compiled.parent, self.out, [row])
        page = read_object(self.out, first["pages"]["2026-08/market-global"])
        self.assertEqual(page["body"], body)
        self.assertEqual(page["lifecycle_status"], "current")
        self.assertEqual(page["claims"][0]["source_refs"], refs)
        self.store.save([{**row, "summary": "corrected"}])
        second = publish_wikis(compiled.parent, self.out, self.store.load())
        self.assertEqual(read_object(self.out, second["pages"][page["page_id"]])["lifecycle_status"], "stale")
        self.assertTrue((self.out / "snapshots" / f"{first['snapshot_id']}.json").exists())

    def test_legacy_wiki_never_invents_evidence(self):
        folder = self.root / "compiled/2026-07"
        folder.mkdir(parents=True)
        (folder / "market-global.md").write_text("---\nperiod: 2026-07\n---\nOld wiki with [1]")
        manifest = publish_wikis(folder.parent, self.out, [])
        page = read_object(self.out, next(iter(manifest["pages"].values())))
        self.assertEqual(page["lineage_status"], "unknown")
        self.assertEqual(page["source_refs"], [])


if __name__ == "__main__":
    unittest.main()
