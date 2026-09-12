"""Fail-loud publication gate. Check complete data, dependency links and capacity.

2026-09-10: the crawler succeeded while Git push failed on a 100 MiB index.
Run before push/deploy; existing workflow failure notifications carry this error.
Keep immutable objects: capacity exhaustion requires a reviewed retention plan,
never automatic deletion of citation targets.
"""
import argparse
import json
import subprocess
import time
from collections import Counter
from pathlib import Path

from src.agent_publication import project_article, visible_rows
from src.index_manager import load_index
from src.monthly_store import StorageError, check_manifest, read_json, read_object

ROOT = Path(__file__).resolve().parents[1]
LIVE_BASE_URLS = (
    "https://insurance-kb.cooperation.tw",
    "https://insurance-kb-v2.pages.dev",
)


def verify_publication(root: Path, rows: list):
    agent = root / "frontend/public/data/agent"
    manifest = check_manifest(read_json(agent / "manifest.json"))
    backend = {r["uid"]: r for r in visible_rows(rows)}
    found, month_counts, descriptors = {}, Counter(), {}
    for shard in manifest["shards"]:
        batch = read_object(agent, shard)
        if len(batch) != shard["count"]:
            raise StorageError("INTEGRITY_ERROR: Agent shard count")
        for row in batch:
            if row["uid"] in found:
                raise StorageError("INTEGRITY_ERROR: duplicate Agent ID")
            found[row["uid"]] = row
            descriptors[row["uid"]] = {k: shard[k] for k in ("file", "sha256")}
        month_counts[shard["month"]] += len(batch)
    if found != backend or len(found) != manifest["total_records"] or dict(month_counts) != manifest["months"]:
        raise StorageError("INTEGRITY_ERROR: Agent export differs from complete visible backend")
    catalog_ids = set()
    for prefix, ref in manifest["catalogs"].items():
        for uid, entry in read_object(agent, ref).items():
            if not uid.startswith(prefix) or uid not in found or uid in catalog_ids:
                raise StorageError("INTEGRITY_ERROR: invalid ID catalog")
            if ({k: entry[k] for k in ("file", "sha256")} != descriptors[uid]
                    or entry["revision_id"] != found[uid]["_lineage"]["revision_id"]):
                raise StorageError("INTEGRITY_ERROR: catalog points to wrong record")
            catalog_ids.add(uid)
    if catalog_ids != set(found):
        raise StorageError("INTEGRITY_ERROR: incomplete ID lookup")
    if manifest.get("search_records") != manifest["total_records"]:
        raise StorageError("INTEGRITY_ERROR: search coverage total")
    search_found = {}
    for ref in manifest.get("search_shards", []):
        batch = read_object(agent, ref)
        if len(batch) != ref.get("count"):
            raise StorageError("INTEGRITY_ERROR: search coverage shard count")
        for row in batch:
            if row.get("uid") in search_found:
                raise StorageError("INTEGRITY_ERROR: duplicate search projection ID")
            search_found[row.get("uid")] = row
    expected_search = {uid: project_article(row) for uid, row in found.items()}
    if search_found != expected_search:
        raise StorageError("INTEGRITY_ERROR: search projection differs from Agent records")
    browser = read_json(root / "frontend/public/data/articles-manifest.json")
    browser_ids = set()
    for month in browser["months"]:
        for row in read_json(root / "frontend/public/data" / month["file"]):
            browser_ids.add(row["uid"])
    if browser_ids != set(found):
        raise StorageError("INTEGRITY_ERROR: browser/Agent visibility mismatch")
    wiki = check_manifest(read_json(agent / "wiki-manifest.json"))
    statuses = Counter()
    history = {}
    for page_id, ref in wiki["pages"].items():
        page = read_object(agent, ref)
        if page["page_id"] != page_id or page["revision_id"] != ref["revision_id"]:
            raise StorageError("INTEGRITY_ERROR: Wiki catalog")
        statuses[page["lineage_status"]] += 1
        for source in page["source_refs"]:
            sid, uid = source["snapshot_id"], source["article_id"]
            if sid not in history:
                history[sid] = check_manifest(read_json(agent / "snapshots" / f"{sid}.json"))
            bucket = max((p for p in history[sid]["catalogs"] if uid.startswith(p)), key=len)
            cat = read_object(agent, history[sid]["catalogs"][bucket])
            if cat[uid]["revision_id"] != source["revision_id"]:
                raise StorageError("INTEGRITY_ERROR: Wiki source revision unavailable")
            source_rows = read_object(agent, cat[uid])
            if not any(r["uid"] == uid and r["_lineage"]["revision_id"] == source["revision_id"] for r in source_rows):
                raise StorageError("INTEGRITY_ERROR: Wiki source record unavailable")
    public_files = [p for p in (root / "frontend/public").rglob("*") if p.is_file()]
    # Local budgets deliberately below provider ceilings. Prevent another late failure.
    if len(public_files) > 15000:
        raise StorageError("CAPACITY_ERROR: public file count > 15000; review retention/storage")
    for file in public_files:
        if file.stat().st_size > 20 * 1024 * 1024:
            raise StorageError(f"CAPACITY_ERROR: public file > 20 MiB: {file}")
    return {"records": len(found), "months": len(month_counts), "agent_shards": len(manifest["shards"]),
            "search_shards": len(manifest["search_shards"]),
            "wiki_pages": len(wiki["pages"]), "wiki_lineage": dict(statuses),
            "public_files": len(public_files), "snapshot_id": manifest["snapshot_id"]}


def verify_staged():
    paths = subprocess.check_output(["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], cwd=ROOT).split(b"\0")
    for path in paths:
        if path:
            # Check staged blob, not a potentially different working tree file.
            size = int(subprocess.check_output(["git", "cat-file", "-s", ":" + path.decode()], cwd=ROOT))
            if size > 50 * 1024 * 1024:
                raise StorageError(f"CAPACITY_ERROR: staged file > 50 MiB: {path.decode()}")


def verify_live(base_urls=LIVE_BASE_URLS, attempts=9, sleep_seconds=15):
    """Wait for both production aliases to serve this build's snapshots.

    Wrangler reports a completed upload before Pages aliases necessarily converge.
    Keep the gate fail-loud, but allow the observed sub-minute propagation window.
    Nine attempts at 15 seconds cap the wait at two minutes.
    """
    import requests

    if attempts < 1 or sleep_seconds < 0 or not base_urls:
        raise ValueError("live verification requires origins and a positive attempt count")
    expected = {
        name: read_json(ROOT / "frontend/public/data/agent" / name)
        for name in ("manifest.json", "wiki-manifest.json")
    }
    last_error = None
    for attempt in range(1, attempts + 1):
        try:
            for base_url in base_urls:
                for name, local in expected.items():
                    url = base_url.rstrip("/") + "/data/agent/" + name
                    response = requests.get(
                        url,
                        params={"v": local["snapshot_id"]},
                        headers={"Cache-Control": "no-cache"},
                        timeout=30,
                    )
                    response.raise_for_status()
                    observed = check_manifest(response.json())["snapshot_id"]
                    if observed != local["snapshot_id"]:
                        raise StorageError(
                            f"STALE_PUBLICATION: {url} expected "
                            f"{local['snapshot_id']} but served {observed}"
                        )
            return
        except (requests.RequestException, TypeError, ValueError) as exc:
            last_error = exc
            if attempt < attempts:
                print(
                    f"Publication aliases not current on attempt {attempt}/{attempts}; "
                    f"retrying in {sleep_seconds}s: {exc}",
                    flush=True,
                )
                time.sleep(sleep_seconds)
    raise StorageError(
        f"STALE_PUBLICATION: production aliases did not converge after "
        f"{attempts} attempts ({last_error})"
    ) from last_error


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staged", action="store_true")
    parser.add_argument("--live", action="store_true")
    args = parser.parse_args()
    if args.staged:
        verify_staged()
    elif args.live:
        verify_live()
    else:
        print(json.dumps(verify_publication(ROOT, load_index()), ensure_ascii=False, indent=2))
