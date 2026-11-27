"""Validate a reviewed data-only batch against its actual Git base before release."""
import argparse
import json
import os
import re
import subprocess
from pathlib import Path

from src.agent_publication import search_sync_row, visible_rows
from src.monthly_store import MonthlyStore, StorageError, digest, read_json
from src.translation_backfill import verify_patch

ROOT = Path(__file__).resolve().parent.parent
BATCH = re.compile(r"repairs/translation-batch-\d{8}-\d{6}\.json")


def check_paths(changes):
    for status, path in changes:
        immutable = any(part in path for part in ("/objects/", "/snapshots/", "/catalogs/", "/translation-queue-snapshots/"))
        allowed = (path in {"index/master-index.json", "index/translation-queue.json"}
                   or path.startswith(("index/objects/", "index/snapshots/", "index/translation-queue-snapshots/",
                                       "frontend/public/data/"))
                   or bool(re.fullmatch(r"repairs/(translation-batch|agent-index-sync)-\d{8}-\d{6}\.json", path)))
        if not allowed or status not in {"A", "M"} or (immutable and status != "A"):
            raise StorageError(f"INVALID_DIFF: {status} {path}")
        if path.startswith("repairs/") and status != "A":
            raise StorageError("INVALID_DIFF: repair ledgers are append-only")


def check_plan(plan, before, after, expected):
    wanted = {"schema_version": 1, "from_snapshot_id": before["snapshot_id"],
              "to_snapshot_id": after["snapshot_id"], "total_records": after["total_records"],
              "upserts": sorted(expected, key=lambda r: r["uid"]), "deletes": []}
    if plan != wanted:
        raise StorageError("INVALID_PLAN: must exactly match reviewed visible upserts, no deletes")


def git_json(base, path, root):
    return json.loads(subprocess.check_output(["git", "show", f"{base}:{path}"], cwd=root))


def verify_batch(base, root=ROOT, required=False):
    if not re.fullmatch(r"[a-f0-9]{40}", base):
        raise StorageError("INVALID_ARGUMENT: full base commit SHA required")
    raw = subprocess.check_output(["git", "diff", "--no-renames", "--name-status", base, "HEAD"], cwd=root, text=True)
    changes = [tuple(line.split("\t")) for line in raw.splitlines()]
    patches = [p for s, p in changes if BATCH.fullmatch(p)]
    if not patches and not required:
        return {"batch": None}
    if len(patches) != 1:
        raise StorageError("INVALID_BATCH: exactly one new translation patch required")
    check_paths(changes)
    path = patches[0]
    stamp = Path(path).stem.removeprefix("translation-batch-")
    plan_path = f"repairs/agent-index-sync-{stamp}.json"
    plans = [p for s, p in changes if p.startswith("repairs/agent-index-sync-")]
    if plans != [plan_path]:
        raise StorageError("INVALID_BATCH: one matching D1 plan required")
    patch = read_json(root / path)
    if git_json(base, "index/master-index.json", root)["snapshot_id"] != patch["base_snapshot_id"]:
        raise StorageError("REVISION_MISMATCH: re-review on latest base snapshot")
    if digest(git_json(base, "index/translation-queue.json", root)) != patch["base_queue_hash"]:
        raise StorageError("REVISION_MISMATCH: base queue differs")
    store = MonthlyStore(root / "index/master-index.json")
    result = verify_patch(store, root / "index/translation-queue.json", patch)
    before_rows = {r["uid"]: r for r in visible_rows(store.load(snapshot_id=patch["base_snapshot_id"]))}
    after_rows = {r["uid"]: r for r in visible_rows(store.load())}
    if before_rows.keys() != after_rows.keys():
        raise StorageError("INVALID_BATCH: translation changed article visibility")
    expected = [search_sync_row(row) for uid, row in after_rows.items()
                if search_sync_row(row) != search_sync_row(before_rows[uid])]
    ids = {u["uid"] for u in patch["updates"]}
    if any(row["uid"] not in ids for row in expected):
        raise StorageError("INVALID_PLAN: unrelated upsert")
    before_manifest = git_json(base, "frontend/public/data/agent/manifest.json", root)
    after_manifest = read_json(root / "frontend/public/data/agent/manifest.json")
    check_plan(read_json(root / plan_path), before_manifest, after_manifest, expected)
    return {**result, "batch": path, "plan": plan_path}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True)
    parser.add_argument("--required", action="store_true")
    args = parser.parse_args()
    try:
        result = verify_batch(args.base, required=args.required)
        if result["batch"] and os.environ.get("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a") as output:
                output.write(f"plan={result['plan']}\n")
        print(json.dumps(result, ensure_ascii=False))
    except (StorageError, OSError, ValueError, KeyError, subprocess.CalledProcessError) as exc:
        parser.exit(1, f"translation-batch: {exc}\n")


if __name__ == "__main__":
    main()
