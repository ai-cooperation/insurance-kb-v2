"""One-time, field-preserving migration; --apply required. No network or deletion.

Retain the original Git revision until validation is reviewed. Existing schema 3
is an idempotent no-op. Samples run in a temporary directory before full migration.
"""
import argparse
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.monthly_store import MonthlyStore, digest, read_json
from build_frontend_data import build_slim_entries, dedup_l2


def content_map(rows):
    return {r["uid"]: {k: v for k, v in r.items() if k != "_lineage"} for r in rows}


def migrate(path: Path, apply=False):
    store = MonthlyStore(path)
    original = read_json(path)
    if isinstance(original, dict):
        return {"status": "already_migrated", "records": len(store.load()),
                "snapshot_id": store.manifest()["snapshot_id"]}
    original_hash = digest(content_map(original))
    visible_before = dedup_l2(build_slim_entries(original)[0])[0]
    # Five heterogeneous actual records: oldest/newest, longest, filtered, middle.
    choices = [original[0], original[-1], max(original, key=lambda r: len(r.get("summary", ""))),
               next((r for r in original if r.get("filter")), original[0]), original[len(original)//2]]
    sample = list({r["uid"]: r for r in choices}.values())
    with tempfile.TemporaryDirectory(prefix="insurance-migration-") as temp:
        pilot = MonthlyStore(Path(temp) / "master-index.json")
        pilot.save(sample, reason="migration sample", actor="migration")
        if content_map(pilot.load()) != content_map(sample):
            raise ValueError("Migration sample lost fields")
    if not apply:
        return {"status": "sample_passed_not_applied", "sample_records": len(sample), "records": len(original)}
    manifest = store.save(original, reason="monthly migration; legacy evidence unverified", actor="migration")
    loaded = store.load()
    if digest(content_map(loaded)) != original_hash:
        raise ValueError("Migration field comparison failed; do not publish")
    visible_after = dedup_l2(build_slim_entries(loaded)[0])[0]
    if visible_after != visible_before:
        raise ValueError("Migration changed browser-visible records; do not publish")
    return {"status": "migrated_and_verified", "records": len(loaded),
            "visible_records": len(visible_after), "sample_records": len(sample),
            "original_content_sha256": original_hash, "snapshot_id": manifest["snapshot_id"],
            "manifest_bytes": path.stat().st_size, "shards": len(manifest["shards"]),
            "largest_shard_bytes": max(s["bytes"] for s in manifest["shards"])}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    print(json.dumps(migrate(ROOT / "index/master-index.json", args.apply), ensure_ascii=False, indent=2))
