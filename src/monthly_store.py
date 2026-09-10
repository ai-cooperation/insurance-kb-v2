"""Immutable monthly shards and a small, atomically replaced current manifest.

Invariant (2026-09-10): full-history master-index exceeded GitHub's 100 MiB
limit in run 33473728371. Commit 87210da partitioned browser output only.
Never write an all-history article array back to the current manifest.
Snapshots/objects are retained so an old citation survives later corrections.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import date, datetime, timezone
from pathlib import Path
from uuid import uuid4

LOG = logging.getLogger(__name__)
DEFAULT_MAX_BYTES = 2 * 1024 * 1024


class StorageError(ValueError):
    pass


def encode(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def digest(value) -> str:
    return hashlib.sha256(encode(value)).hexdigest()


def atomic_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + "." + uuid4().hex + ".tmp")
    try:
        tmp.write_bytes(payload)
        tmp.replace(path)
    finally:
        if tmp.exists():
            tmp.unlink()


def read_json(path: Path):
    try:
        return json.loads(path.read_bytes())
    except (OSError, ValueError) as exc:
        raise StorageError(f"DATA_UNAVAILABLE: {path}: {exc}") from exc


def month_of(record: dict) -> str:
    try:
        value = record.get("date", "")
        if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            return "unknown"
        date.fromisoformat(value)
        return value[:7]
    except (TypeError, ValueError):
        return "unknown"


def validate_rows(rows) -> None:
    if not isinstance(rows, list):
        raise StorageError("INTEGRITY_ERROR: expected article list")
    ids = set()
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("uid"), str):
            raise StorageError("INTEGRITY_ERROR: invalid article")
        uid = row["uid"]
        if "date" in row and not isinstance(row["date"], str):
            raise StorageError("INTEGRITY_ERROR: date must be a string (invalid dates use unknown bucket)")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", uid) or uid in ids:
            raise StorageError(f"INTEGRITY_ERROR: empty/duplicate/invalid uid {uid!r}")
        ids.add(uid)


def put_object(root: Path, value, folder="objects") -> tuple[str, str, int]:
    payload = encode(value)
    sha = hashlib.sha256(payload).hexdigest()
    relative = f"{folder}/{sha}.json"
    path = root / relative
    if path.exists():
        if path.read_bytes() != payload:
            raise StorageError(f"INTEGRITY_ERROR: immutable object changed: {relative}")
    else:
        atomic_write(path, payload)
    return relative, sha, len(payload)


def read_object(root: Path, item: dict):
    relative = item.get("file", "")
    if not re.fullmatch(r"(?:objects|catalogs)/[A-Za-z0-9_/-]*[a-f0-9]{64}\.json", relative):
        raise StorageError("INTEGRITY_ERROR: invalid object path")
    path = root / relative
    try:
        payload = path.read_bytes()
    except OSError as exc:
        raise StorageError(f"DATA_UNAVAILABLE: {relative}") from exc
    if hashlib.sha256(payload).hexdigest() != item.get("sha256"):
        raise StorageError(f"INTEGRITY_ERROR: checksum mismatch: {relative}")
    try:
        return json.loads(payload)
    except ValueError as exc:
        raise StorageError(f"INTEGRITY_ERROR: malformed JSON: {relative}") from exc


def split_rows(rows: list, max_bytes: int):
    batch, size = [], 2
    for row in rows:
        row_size = len(encode(row))
        if row_size + 2 > max_bytes:
            raise StorageError(f"INTEGRITY_ERROR: individual article exceeds {max_bytes} bytes")
        if batch and size + row_size + 1 > max_bytes:
            yield batch
            batch, size = [], 2
        batch.append(row)
        size += row_size + 1
    if batch:
        yield batch


def write_shards(root: Path, rows: list, max_bytes: int):
    groups = {}
    for row in rows:
        groups.setdefault(month_of(row), []).append(row)
    shards = []
    for month in sorted(groups, reverse=True):
        for part, batch in enumerate(split_rows(groups[month], max_bytes)):
            path, sha, size = put_object(root, batch, f"objects/{month}")
            shards.append({"month": month, "part": part, "file": path,
                           "sha256": sha, "bytes": size, "count": len(batch)})
    return shards


def write_snapshot(root: Path, manifest: dict, current: Path) -> dict:
    snapshot = {**manifest, "snapshot_id": digest(manifest)}
    payload = encode(snapshot)
    path = root / "snapshots" / f"{snapshot['snapshot_id']}.json"
    if path.exists() and path.read_bytes() != payload:
        raise StorageError("INTEGRITY_ERROR: snapshot collision")
    if not path.exists():
        atomic_write(path, payload)
    atomic_write(current, payload)
    return snapshot


def check_manifest(value: dict) -> dict:
    if not isinstance(value, dict) or value.get("schema_version") != 3:
        raise StorageError("INTEGRITY_ERROR: unknown manifest schema")
    body = {k: v for k, v in value.items() if k != "snapshot_id"}
    if value.get("snapshot_id") != digest(body):
        raise StorageError("INTEGRITY_ERROR: manifest checksum mismatch")
    return value


class MonthlyStore:
    def __init__(self, path: Path, max_bytes: int = DEFAULT_MAX_BYTES):
        self.path, self.root, self.max_bytes = Path(path), Path(path).parent, max_bytes

    def manifest(self, snapshot_id=None):
        path = self.path
        if snapshot_id is not None:
            if not re.fullmatch(r"[a-f0-9]{64}", snapshot_id):
                raise StorageError("INVALID_ARGUMENT: snapshot_id")
            path = self.root / "snapshots" / f"{snapshot_id}.json"
        return check_manifest(read_json(path))

    def load(self, months=None, snapshot_id=None):
        if snapshot_id is None and not self.path.exists():
            raise StorageError(f"DATA_UNAVAILABLE: {self.path}")
        value = read_json(self.path) if snapshot_id is None else self.manifest(snapshot_id)
        if isinstance(value, list):  # read-only migration compatibility
            validate_rows(value)
            return [r for r in value if months is None or month_of(r) in months]
        manifest = check_manifest(value)
        rows = []
        for shard in manifest["shards"]:
            if months is None or shard["month"] in months:
                batch = read_object(self.root, shard)
                validate_rows(batch)
                if len(batch) != shard["count"]:
                    raise StorageError("INTEGRITY_ERROR: shard count mismatch")
                rows.extend(batch)
        validate_rows(rows)
        if months is None and len(rows) != manifest["total_records"]:
            raise StorageError("INTEGRITY_ERROR: total count mismatch")
        return sorted(rows, key=lambda r: r.get("date", ""), reverse=True)

    def save(self, rows, reason="pipeline update", actor="pipeline"):
        validate_rows(rows)
        prior_bytes = self.path.read_bytes() if self.path.exists() else None
        old = {r["uid"]: r for r in self.load()} if prior_bytes is not None else {}
        # A stale full-list writer must not erase articles another run appended.
        # Withdrawal uses filter/status revisions; physical deletion needs an
        # explicit retention process and must not piggyback on normal saves.
        omitted = set(old) - {r["uid"] for r in rows}
        if omitted:
            raise StorageError(f"REVISION_MISMATCH: save omits {len(omitted)} existing records")
        now = datetime.now(timezone.utc).isoformat()
        prepared = []
        for row in rows:
            content = {k: v for k, v in row.items() if k != "_lineage"}
            revision = digest(content)
            previous = old.get(row["uid"], {})
            lineage = previous.get("_lineage", {})
            if lineage and digest({k:v for k,v in previous.items() if k != "_lineage"}) == revision:
                prepared.append(previous)
                continue
            if lineage and row.get("_lineage", {}).get("revision_id") != lineage["revision_id"]:
                raise StorageError(f"REVISION_MISMATCH: stale edit of {row['uid']}")
            prepared.append({**content, "_lineage": {
                "article_id": row["uid"], "revision_id": revision, "content_hash": revision,
                "previous_revision_id": lineage.get("revision_id"), "observed_at": now,
                "retrieved_at": row.get("retrieved_at"), "published_at": row.get("date"),
                "source_url": row.get("source_url"), "actor": actor, "reason": reason,
                "content_kind": row.get("content_kind", "legacy_saved_summary_origin_unverified"),
                "verification_status": "unverified",
            }})
        prepared.sort(key=lambda r: r.get("date", ""), reverse=True)
        shards = write_shards(self.root, prepared, self.max_bytes)
        # Optimistic single-writer check complements the Actions concurrency lock.
        if (self.path.read_bytes() if self.path.exists() else None) != prior_bytes:
            raise StorageError("REVISION_MISMATCH: manifest changed during write")
        manifest = write_snapshot(self.root, {"schema_version": 3, "kind": "article_store",
            "total_records": len(prepared), "shards": shards}, self.path)
        LOG.info("storage_commit snapshot=%s rows=%d shards=%d", manifest["snapshot_id"], len(rows), len(shards))
        return manifest
