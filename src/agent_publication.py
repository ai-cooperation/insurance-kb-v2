"""Versioned, visible-only Agent corpus. No browser or Chat contract changes."""
from __future__ import annotations

import re
from datetime import date, datetime
from collections import defaultdict
from pathlib import Path

import yaml

from src.monthly_store import (StorageError, digest, put_object, read_object,
                               validate_rows, write_shards, write_snapshot)

AGENT_MAX_BYTES = 512 * 1024


def publish_articles(rows: list, root: Path) -> dict:
    validate_rows(rows)
    if any(r.get("filter") or not r.get("_lineage") for r in rows):
        raise StorageError("INTEGRITY_ERROR: Agent export requires visible versioned rows")
    rows = sorted(rows, key=lambda r: r.get("date", ""), reverse=True)
    shards = write_shards(root, rows, AGENT_MAX_BYTES)
    catalogs = defaultdict(dict)
    months = defaultdict(int)
    for shard in shards:
        months[shard["month"]] += shard["count"]
        for row in read_object(root, shard):
            catalogs[row["uid"][:1]][row["uid"]] = {
                "file": shard["file"], "sha256": shard["sha256"],
                "revision_id": row["_lineage"]["revision_id"],
            }
    links = {}
    # Start with 16 buckets for hexadecimal UIDs, not 256 rewritten tiny files
    # every crawl. Split only buckets that approach the read-size budget.
    pending = list(sorted(catalogs.items()))
    while pending:
        prefix, catalog = pending.pop(0)
        from src.monthly_store import encode
        if len(encode(catalog)) > 2 * 1024 * 1024:
            buckets = defaultdict(dict)
            for uid, entry in catalog.items():
                buckets[uid[:len(prefix)+1]][uid] = entry
            if len(buckets) == 1 and next(iter(buckets)) == prefix:
                raise StorageError("INTEGRITY_ERROR: ID lookup bucket cannot be split")
            pending.extend(sorted(buckets.items()))
            continue
        file, sha, size = put_object(root, catalog, "catalogs")
        links[prefix] = {"file": file, "sha256": sha, "bytes": size}
    return write_snapshot(root, {
        "schema_version": 3, "kind": "agent_articles", "total_records": len(rows),
        "visibility_policy": "browser-visible-v1", "content_scope": "full_saved_record_not_source_fulltext",
        "months": dict(months), "shards": shards, "catalogs": links,
        "newest_date": max((r.get("date", "") for r in rows), default=""),
    }, root / "manifest.json")


def parse_markdown(text: str):
    if not text.startswith("---\n"):
        return {}, text
    parts = text.split("\n---", 1)
    if len(parts) != 2:
        raise StorageError("INTEGRITY_ERROR: unclosed Wiki metadata")
    meta = yaml.safe_load(parts[0][4:]) or {}
    if not isinstance(meta, dict):
        raise StorageError("INTEGRITY_ERROR: Wiki metadata must be a mapping")
    # YAML decodes unquoted ISO timestamps to datetime; keep JSON publication deterministic.
    meta = {k: v.isoformat() if isinstance(v, (date, datetime)) else v for k, v in meta.items()}
    return meta, parts[1].lstrip("\n")


def candidate_hash(rows: list) -> str:
    return digest(sorted((r["uid"], r["_lineage"]["revision_id"]) for r in rows))


def wiki_state(meta: dict, current: dict, body: str):
    refs = meta.get("source_refs", [])
    if not isinstance(refs, list):
        raise StorageError("INTEGRITY_ERROR: source_refs must be an array")
    changes = []
    for ref in refs:
        if (not isinstance(ref, dict)
                or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", str(ref.get("article_id", "")))
                or not all(re.fullmatch(r"[a-f0-9]{64}", str(ref.get(k, ""))) for k in ("revision_id", "snapshot_id"))):
            raise StorageError("INTEGRITY_ERROR: invalid Wiki source reference")
        row = current.get(ref["article_id"])
        if not row or row["_lineage"]["revision_id"] != ref["revision_id"]:
            changes.append(ref["article_id"])
    if meta.get("candidate_hash"):
        candidates = [r for r in current.values() if r.get("date", "").startswith(meta.get("period", "!"))
            and r.get("category") == meta.get("candidate_category")
            and r.get("region") == meta.get("candidate_region")]
        if candidate_hash(candidates) != meta["candidate_hash"]:
            changes.append("candidate_set_changed")
    claims, unresolved = [], []
    # Only explicit paragraph markers establish links. Never infer citations
    # by matching source URLs to legacy prose.
    if refs:
        for paragraph in body.split("\n\n"):
            markers = sorted(set(int(n) for n in re.findall(r"\[(\d+)\]", paragraph)))
            valid = [refs[n-1] for n in markers if 1 <= n <= len(refs)]
            unresolved.extend(n for n in markers if not 1 <= n <= len(refs))
            if valid:
                claims.append({"claim_id": digest(paragraph), "text": paragraph,
                               "source_refs": valid, "verification_status": "unverified"})
    return {"source_refs": refs, "claims": claims, "unresolved_markers": unresolved,
            "lineage_status": ("explicit_citation_links" if claims and not unresolved else "source_manifest_only") if refs else "unknown",
            "lifecycle_status": "stale" if changes else "current" if refs else "unknown",
            "changed_dependencies": changes}


def publish_wikis(compiled: Path, root: Path, rows: list) -> dict:
    current = {r["uid"]: r for r in rows}
    pages = {}
    for path in sorted(compiled.glob("*/*.md")):
        raw = path.read_text(encoding="utf-8")
        meta, body = parse_markdown(raw)
        page_id = f"{path.parent.name}/{path.stem}"
        state = wiki_state(meta, current, body)
        page = {"page_id": page_id, "revision_id": digest(raw), "body": body,
                "saved_markdown": raw, "period": path.parent.name,
                "content_kind": "derived_wiki", "verification_status": "unverified",
                "generation": {k: meta.get(k) for k in ("model", "compiled_at", "prompt_version",
                    "articles_count", "selected_count", "evidence_input", "evidence_scope", "revision_reason", "candidate_hash")}, **state}
        file, sha, size = put_object(root, page, "objects/wiki")
        if size > 2 * 1024 * 1024:
            raise StorageError(f"INTEGRITY_ERROR: Wiki page exceeds size budget: {page_id}")
        pages[page_id] = {"file": file, "sha256": sha, "bytes": size,
                         "revision_id": page["revision_id"], "period": page["period"],
                         "lifecycle_status": page["lifecycle_status"], "lineage_status": page["lineage_status"]}
    return write_snapshot(root, {"schema_version": 3, "kind": "agent_wikis", "pages": pages}, root / "wiki-manifest.json")


def visible_rows(rows: list) -> list:
    from build_frontend_data import build_slim_entries, dedup_l2
    slim, _ = build_slim_entries(rows)
    visible, _ = dedup_l2(slim)
    ids = {r["uid"] for r in visible}
    return [r for r in rows if r["uid"] in ids]


def build_agent_data():
    from src.index_manager import load_index
    root = Path(__file__).resolve().parent.parent
    selected = visible_rows(load_index())
    articles = publish_articles(selected, root / "frontend/public/data/agent")
    wiki = publish_wikis(root / "compiled/monthly", root / "frontend/public/data/agent", selected)
    print(f"Agent publication: {articles['total_records']} records, {len(articles['shards'])} shards; "
          f"{len(wiki['pages'])} Wiki pages; snapshot={articles['snapshot_id']}")
    return articles, wiki


if __name__ == "__main__":
    build_agent_data()
