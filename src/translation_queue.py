"""Explicit attempt state kept OUTSIDE article revisions.

2026-11-27 repair of the unfinished 2026-10-10 Codex workflow (chat
01a0fc06-c1f9-7413-afe7-98a80f4478c2). Never infer pending from title equality,
language guesses or empty summaries. State-only reviews must not stale Wikis.
"""
import re
from pathlib import Path

from src.monthly_store import StorageError, atomic_write, digest, encode, read_json

QUEUE_PATH = Path(__file__).resolve().parent.parent / "index/translation-queue.json"
STATES = {"pending", "completed", "not_required"}


def source_hash(row):
    return digest([row.get("title_en", ""), row.get("source_excerpt", "")])


def load_queue(path=QUEUE_PATH):
    value = read_json(Path(path))
    if (not isinstance(value, dict) or set(value) != {"schema_version", "entries"}
            or type(value["schema_version"]) is not int or value["schema_version"] != 1
            or not isinstance(value["entries"], dict)):
        raise StorageError("INVALID_QUEUE: schema")
    for uid, entry in value["entries"].items():
        if not isinstance(entry, dict) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", uid):
            raise StorageError("INVALID_QUEUE: entry")
        states = entry.get("translation_state")
        if (not isinstance(states, dict) or set(states) != {"title", "summary"}
                or any(not isinstance(s, str) or s not in STATES for s in states.values())
                or not all(isinstance(entry.get(k), str) and re.fullmatch(r"[a-f0-9]{64}", entry[k])
                           for k in ("expected_revision_id", "source_hash"))):
            raise StorageError(f"INVALID_QUEUE: {uid}")
    return value


def record_attempts(articles, rows, path=QUEUE_PATH):
    queue = load_queue(path)
    entries = dict(queue["entries"])
    by_uid = {r["uid"]: r for r in rows}
    for article in articles:
        states = article.get("_translation_state")
        if states is None:
            continue
        uid = article.get("uid")
        if (uid not in by_uid or not isinstance(states, dict) or set(states) != {"title", "summary"}
                or any(not isinstance(s, str) or s not in STATES for s in states.values())):
            raise StorageError(f"INVALID_ATTEMPT: {uid}")
        if "pending" not in states.values() and uid not in entries:
            continue
        row = by_uid[uid]
        entries[uid] = {"translation_state": dict(states),
                        "expected_revision_id": row["_lineage"]["revision_id"],
                        "source_hash": source_hash(row)}
    updated = {"schema_version": 1, "entries": entries}
    if updated != queue:
        atomic_write(Path(path), encode(updated))
    return updated


def mark_attempts(articles):
    return [{**a, "_translation_state": {"title": "pending", "summary": "pending"}}
            for a in articles]


def mark_result(article, result):
    states = {field: ("completed" if isinstance(result.get(field + "_zh"), str)
                     and result[field + "_zh"].strip() else "pending")
              for field in ("title", "summary")}
    return {**article, "_translation_state": states}
