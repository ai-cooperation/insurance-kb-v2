"""Offline translation review CLI. No models, external URLs or D1 writes."""
import argparse
import json
import re
from datetime import datetime
from pathlib import Path

from src.monthly_store import MonthlyStore, StorageError, atomic_write, digest, encode, read_json
from src.translation_queue import QUEUE_PATH, load_queue, source_hash

ROOT = Path(__file__).resolve().parent.parent
FIELDS = {"uid", "expected_revision_id", "title_status", "title_zh", "summary_status", "summary_zh"}


def pending(store, queue_path, limit=20, offset=0):
    if type(limit) is not int or type(offset) is not int or limit < 1 or offset < 0:
        raise StorageError("INVALID_ARGUMENT: pagination")
    manifest = store.manifest()
    rows = {r["uid"]: r for r in store.load(snapshot_id=manifest["snapshot_id"])}
    queue = load_queue(queue_path)
    candidates = [(uid, e) for uid, e in sorted(queue["entries"].items())
                  if "pending" in e["translation_state"].values()]
    items, skipped = [], []
    page = candidates[offset:offset + limit]
    for uid, entry in page:
        row = rows.get(uid)
        reason = ("article_missing" if row is None else
                  "revision_changed" if row["_lineage"]["revision_id"] != entry["expected_revision_id"] else
                  "source_changed" if source_hash(row) != entry["source_hash"] else None)
        if reason:
            skipped.append({"uid": uid, "reason": reason})
        else:
            items.append({"uid": uid, **entry, **{k: row.get(k, "") for k in
                          ("title_en", "source_excerpt", "title", "summary")}})
    return {"base_snapshot_id": manifest["snapshot_id"], "queue_hash": digest(queue),
            "total": len(candidates), "page_count": len(page), "items": items, "skipped": skipped}


def _prepare(store, base_queue, patch):
    if (not isinstance(patch, dict)
            or set(patch) != {"schema_version", "base_snapshot_id", "base_queue_hash", "updates"}
            or type(patch["schema_version"]) is not int or patch["schema_version"] != 1
            or not isinstance(patch["updates"], list) or not patch["updates"]):
        raise StorageError("INVALID_PATCH: schema or empty updates")
    if digest(base_queue) != patch["base_queue_hash"]:
        raise StorageError("REVISION_MISMATCH: queue changed")
    rows = store.load(snapshot_id=patch["base_snapshot_id"])
    by_uid = {r["uid"]: r for r in rows}
    prepared, entries, seen = dict(by_uid), dict(base_queue["entries"]), set()
    for update in patch["updates"]:
        if not isinstance(update, dict) or set(update) - FIELDS:
            raise StorageError("INVALID_PATCH: unsupported fields")
        uid = update.get("uid")
        if not isinstance(uid, str) or uid in seen or uid not in by_uid or uid not in entries:
            raise StorageError("INVALID_PATCH: unknown or duplicate uid")
        seen.add(uid)
        row, entry = by_uid[uid], entries[uid]
        revision = row["_lineage"]["revision_id"]
        if (update.get("expected_revision_id") != revision
                or entry["expected_revision_id"] != revision or source_hash(row) != entry["source_hash"]):
            raise StorageError(f"REVISION_MISMATCH: {uid}")
        states, changes, actions = dict(entry["translation_state"]), {}, 0
        for field in ("title", "summary"):
            status, translated = update.get(field + "_status"), update.get(field + "_zh")
            if status is None:
                if field + "_zh" in update:
                    raise StorageError("INVALID_PATCH: text without status")
                continue
            actions += 1
            if states[field] != "pending" or status not in {"completed", "not_required"}:
                raise StorageError(f"INVALID_TRANSITION: {uid}/{field}")
            if status == "not_required":
                if field != "title" or field + "_zh" in update or not row.get("title_en", "").strip():
                    raise StorageError("INVALID_PATCH: only a reviewed title can be not_required")
            else:
                if (not isinstance(translated, str) or not translated.strip()
                        or not re.search(r"[\u3400-\u9fff]", translated)):
                    raise StorageError("INVALID_PATCH: translation must contain Chinese")
                source = row.get("title_en" if field == "title" else "source_excerpt", "")
                # A length floor is NOT proof of factual support. The reviewer
                # must check every statement against the saved source as well.
                if not isinstance(source, str) or len(source.strip()) < (20 if field == "summary" else 1):
                    raise StorageError(f"SOURCE_INSUFFICIENT: {uid}/{field}")
                changes[field] = translated
            states[field] = status
        if not actions:
            raise StorageError("INVALID_PATCH: no reviewed fields")
        prepared[uid] = {**row, **changes}
        content = {k: v for k, v in prepared[uid].items() if k != "_lineage"}
        entries[uid] = {**entry, "translation_state": states, "expected_revision_id": digest(content)}
    return list(prepared.values()), {"schema_version": 1, "entries": entries}, seen


def _baseline_path(queue_path, patch):
    value = patch.get("base_queue_hash", "") if isinstance(patch, dict) else ""
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value):
        raise StorageError("INVALID_PATCH: base_queue_hash")
    return Path(queue_path).parent / "translation-queue-snapshots" / f"{value}.json"


def _compare_rows(expected, actual):
    def contents(rows):
        return {r["uid"]: {k: v for k, v in r.items() if k != "_lineage"} for r in rows}
    if contents(expected) != contents(actual):
        raise StorageError("VERIFY_FAILED: articles differ from reviewed fields")
    by_uid = {r["uid"]: r for r in expected}
    for row in actual:
        revision = digest({k: v for k, v in row.items() if k != "_lineage"})
        lineage = row["_lineage"]
        prior = by_uid[row["uid"]]["_lineage"]
        if lineage["revision_id"] != revision:
            raise StorageError("VERIFY_FAILED: revision hash")
        if revision == prior["revision_id"]:
            wanted = prior
        else:
            try:
                datetime.fromisoformat(lineage["observed_at"])
            except (KeyError, TypeError, ValueError) as exc:
                raise StorageError("VERIFY_FAILED: observed_at") from exc
            wanted = {"article_id": row["uid"], "revision_id": revision, "content_hash": revision,
                      "previous_revision_id": prior["revision_id"], "observed_at": lineage["observed_at"],
                      "retrieved_at": row.get("retrieved_at"), "published_at": row.get("date"),
                      "source_url": row.get("source_url"), "actor": "codex-translation",
                      "reason": "reviewed translation batch", "verification_status": "unverified",
                      "content_kind": row.get("content_kind", "legacy_saved_summary_origin_unverified")}
        if lineage != wanted:
            raise StorageError("VERIFY_FAILED: unexpected lineage changes")


def apply_patch(store, queue_path, patch):
    archive = _baseline_path(queue_path, patch)
    queue = load_queue(queue_path)
    base_queue = load_queue(archive) if archive.exists() else queue
    expected, expected_queue, ids = _prepare(store, base_queue, patch)
    if store.manifest()["snapshot_id"] != patch["base_snapshot_id"]:
        # Only exact replay/recovery is accepted after the base changes.
        _compare_rows(expected, store.load())
    if queue not in (base_queue, expected_queue):
        raise StorageError("REVISION_MISMATCH: queue changed")
    if not archive.exists():
        atomic_write(archive, encode(base_queue))
    if store.manifest()["snapshot_id"] == patch["base_snapshot_id"]:
        store.save(expected, reason="reviewed translation batch", actor="codex-translation")
    if queue != expected_queue:
        atomic_write(Path(queue_path), encode(expected_queue))
    return verify_patch(store, queue_path, patch)


def verify_patch(store, queue_path, patch):
    expected, expected_queue, ids = _prepare(store, load_queue(_baseline_path(queue_path, patch)), patch)
    _compare_rows(expected, store.load())
    if load_queue(queue_path) != expected_queue:
        raise StorageError("VERIFY_FAILED: unexpected queue changes")
    return {"updated": len(ids), "base_snapshot_id": patch["base_snapshot_id"],
            "current_snapshot_id": store.manifest()["snapshot_id"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("pending", "apply", "verify"))
    parser.add_argument("--index", type=Path, default=ROOT / "index/master-index.json")
    parser.add_argument("--queue", type=Path, default=QUEUE_PATH)
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--patch", type=Path)
    args = parser.parse_args()
    try:
        store = MonthlyStore(args.index)
        if args.command == "pending":
            result = pending(store, args.queue, args.limit, args.offset)
        else:
            if args.patch is None:
                parser.error("--patch is required")
            result = (apply_patch if args.command == "apply" else verify_patch)(store, args.queue, read_json(args.patch))
        print(json.dumps(result, ensure_ascii=False))
    except (StorageError, OSError, TypeError, KeyError) as exc:
        parser.exit(1, f"translation-backfill: {exc}\n")


if __name__ == "__main__":
    main()
