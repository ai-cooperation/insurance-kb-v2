#!/usr/bin/env python3
"""Build slim articles for the frontend, partitioned by month.

Output layout (under frontend/public/data/):

  - articles-manifest.json     — small index: list of months with counts
                                  + newest_date. Frontend fetches this first
                                  to know which month files exist.
  - articles-YYYY-MM.json       — one file per month, ~3-5 MiB each.
                                  Loaded on demand by the frontend.
  - articles.json               — LEGACY: union of last ~90 days, kept so
                                  workers/src/search.ts (chat API) keeps
                                  working until it migrates to the manifest.
  - stats.json                  — aggregates (total / by_region / by_category
                                  / by_date) computed over the full visible
                                  payload.

Why monthly partitioning:
- Each file is bounded (~3-5 MiB) → 25 MiB Cloudflare Pages single-file
  limit is impossible to hit, no matter how long the KB runs.
- Old month files never change → CDN caches them permanently.
- Frontend can lazy-load only what the user is viewing.

History:
- 2026-06-03 single-file articles.json hit 26 MiB and broke Pages deploy.
  Fixed first by visible-only output (→ 19.9 MiB), then by splitting into
  recent + archive (8 / 12 MiB).
- 2026-06-04 monthly partition. Recent + archive retired in favor of
  per-month files; the 90-day legacy articles.json stays only for the
  worker chat path until it migrates.

Filtered entries (irrelevant / sports / dup / translation_partial) stay
in master-index.json for retroactive fixes but never ship to any
frontend file.
"""

import json
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import NamedTuple

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from src.classifier import _detect_kr_sports, _normalize_kr_names  # noqa: E402

INDEX_PATH = ROOT / "index" / "master-index.json"
DATA_DIR = ROOT / "frontend" / "public" / "data"
MANIFEST_PATH = DATA_DIR / "articles-manifest.json"
LEGACY_PATH = DATA_DIR / "articles.json"
STATS_PATH = DATA_DIR / "stats.json"

# Worker chat search.ts fetches articles.json. Until it migrates to the
# manifest, ship a union of the last LEGACY_DAYS days there. Keep this
# tight — at 90d the file approached 20 MiB which was uncomfortably
# close to the 25 MiB Cloudflare Pages single-file limit.
LEGACY_DAYS = 30


class MonthBucket(NamedTuple):
    """A month's worth of articles, ready to serialize."""

    month: str  # YYYY-MM
    entries: list[dict]


def newest_date(entries: list[dict]) -> str:
    """Find the newest YYYY-MM-DD across entries; '' if empty."""
    return max((e.get("date", "") for e in entries), default="")


def build_slim_entries(idx: list[dict]) -> tuple[list[dict], int]:
    """Apply KR normalization + sports detection, drop filtered entries.

    Returns (slim entries, count of skipped-because-filtered).
    """
    slim: list[dict] = []
    skipped_filtered = 0
    for a in idx:
        title = _normalize_kr_names(a.get("title", "") or "")
        summary = _normalize_kr_names(a.get("summary", "") or "")
        filter_reason = a.get("filter", "") or ""
        if not filter_reason and _detect_kr_sports(
            title, a.get("title_en", "") or ""
        ):
            filter_reason = "noise_sports"
        if filter_reason:
            skipped_filtered += 1
            continue

        entry = {
            "uid": a["uid"],
            "title": title,
            "date": a.get("date", ""),
            "source": a.get("source", ""),
            "source_url": a.get("source_url", ""),
            "category": a.get("category", ""),
            "region": a.get("region", ""),
            "importance": a.get("importance", ""),
            "summary": summary[:200],
        }
        if a.get("title_en"):
            entry["title_en"] = a["title_en"]
        slim.append(entry)
    return slim, skipped_filtered


def dedup_l2(entries: list[dict]) -> tuple[list[dict], int]:
    """L2 dedup: same source + same title → keep newest only.

    URL-hash UID dedup at crawl time misses periodic re-publishes from
    the same source where the URL contains a date but the content is
    identical (e.g. HKIA "呼籲留意欺詐網站" reposted x39 across two years).
    Returns (deduped list, count removed).
    """
    seen: dict[tuple[str, str] | tuple[str, int], int] = {}
    for i, a in enumerate(entries):
        title = a.get("title", "")
        if not title:
            seen[("__notitle__", i)] = i
            continue
        key = (a.get("source", ""), title)
        cur = seen.get(key)
        if cur is None or a.get("date", "") > entries[cur].get("date", ""):
            seen[key] = i
    keep = set(seen.values())
    deduped = [a for i, a in enumerate(entries) if i in keep]
    return deduped, len(entries) - len(deduped)


def partition_by_month(entries: list[dict]) -> list[MonthBucket]:
    """Group entries by YYYY-MM derived from each entry's date.

    Within each month, sort newest-first so the frontend can render
    cards in the order users expect without re-sorting on load.
    Months returned newest-first.
    """
    buckets: dict[str, list[dict]] = {}
    for a in entries:
        d = a.get("date", "")
        if len(d) < 7:
            continue
        buckets.setdefault(d[:7], []).append(a)

    result: list[MonthBucket] = []
    for month in sorted(buckets.keys(), reverse=True):
        bucket = sorted(buckets[month], key=lambda x: x.get("date", ""), reverse=True)
        result.append(MonthBucket(month=month, entries=bucket))
    return result


def write_json(path: Path, data: object) -> int:
    """Serialize data to path. Returns size in bytes."""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    path.write_text(payload, encoding="utf-8")
    return path.stat().st_size


def prune_old_month_files(active_months: set[str]) -> int:
    """Delete legacy/stale article files.

    Removes (a) the pre-monthly-partition files articles-recent.json and
    articles-archive.json (replaced by manifest + per-month files); and
    (b) any articles-YYYY-MM.json no longer in the active set (e.g. if a
    month emptied via a full reclassify run).

    Returns count of files removed.
    """
    removed = 0
    # Pre-partition legacy files
    for legacy_name in ("articles-recent.json", "articles-archive.json"):
        f = DATA_DIR / legacy_name
        if f.exists():
            f.unlink()
            removed += 1
    # Stale month files
    for f in DATA_DIR.glob("articles-2*.json"):
        name = f.stem
        if not name.startswith("articles-"):
            continue
        month_part = name[len("articles-"):]
        if len(month_part) == 7 and month_part not in active_months:
            f.unlink()
            removed += 1
    return removed


def build_legacy_window(buckets: list[MonthBucket], newest: str, days: int) -> list[dict]:
    """Combine recent month buckets into a single list spanning the last
    `days` days from `newest`. Used to power articles.json for the worker
    chat path until it migrates to the manifest.
    """
    if not newest or len(newest) < 10:
        return []
    try:
        n = date.fromisoformat(newest[:10])
    except ValueError:
        return []
    cutoff = (n - timedelta(days=days)).isoformat()
    combined: list[dict] = []
    for bucket in buckets:
        for entry in bucket.entries:
            if entry.get("date", "") >= cutoff:
                combined.append(entry)
    return combined


def write_stats(path: Path, entries: list[dict]) -> None:
    """Aggregates over all visible entries — drives Home stat cards."""
    from collections import Counter

    by_region: Counter[str] = Counter()
    by_category: Counter[str] = Counter()
    by_date: Counter[str] = Counter()
    by_importance: Counter[str] = Counter()
    for a in entries:
        if a.get("region"):
            by_region[a["region"]] += 1
        if a.get("category"):
            by_category[a["category"]] += 1
        if a.get("date"):
            by_date[a["date"]] += 1
        if a.get("importance"):
            by_importance[a["importance"]] += 1

    newest = max((a.get("date", "") for a in entries), default="")
    latest_count = by_date.get(newest, 0) if newest else 0

    stats = {
        "total_visible": len(entries),
        "newest_date": newest,
        "latest_date_count": latest_count,
        "by_region": dict(by_region.most_common()),
        "by_category": dict(by_category.most_common()),
        "by_importance": dict(by_importance.most_common()),
        "by_date": dict(sorted(by_date.items(), reverse=True)),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(stats, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def build() -> None:
    idx = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    slim, skipped = build_slim_entries(idx)
    deduped, dropped = dedup_l2(slim)

    buckets = partition_by_month(deduped)
    active_months = {b.month for b in buckets}

    # Write per-month files + collect manifest entries
    manifest_entries: list[dict] = []
    total_month_bytes = 0
    for bucket in buckets:
        path = DATA_DIR / f"articles-{bucket.month}.json"
        size_bytes = write_json(path, bucket.entries)
        total_month_bytes += size_bytes
        newest_in = max(e.get("date", "") for e in bucket.entries) if bucket.entries else ""
        oldest_in = min(e.get("date", "") for e in bucket.entries) if bucket.entries else ""
        manifest_entries.append({
            "month": bucket.month,
            "file": f"articles-{bucket.month}.json",
            "count": len(bucket.entries),
            "size_kb": round(size_bytes / 1024, 1),
            "newest": newest_in,
            "oldest": oldest_in,
        })

    # Manifest summary
    newest = newest_date(deduped)
    manifest = {
        "version": 2,
        "newest_date": newest,
        "total_visible": len(deduped),
        "months": manifest_entries,  # already newest-first from partition_by_month
    }
    manifest_size = write_json(MANIFEST_PATH, manifest)

    # Legacy articles.json — 90d window for worker chat compat
    legacy_window = build_legacy_window(buckets, newest, LEGACY_DAYS)
    legacy_size = write_json(LEGACY_PATH, legacy_window)

    # stats.json — aggregates over the full visible payload
    write_stats(STATS_PATH, deduped)
    stats_size = STATS_PATH.stat().st_size

    # Clean up stale month files (e.g. if a month emptied via retroactive
    # fix or full reclassify run). Active months are preserved.
    pruned = prune_old_month_files(active_months)

    print(
        f"articles-manifest.json: {manifest_size/1024:>5.1f} KiB, "
        f"{len(manifest_entries)} months listed\n"
        f"Per-month files:        {len(manifest_entries)} written, "
        f"{total_month_bytes/1024/1024:>5.1f} MiB total\n"
        f"  largest month:        {max((m['size_kb'] for m in manifest_entries), default=0):>5.0f} KiB\n"
        f"articles.json (legacy {LEGACY_DAYS}d window): "
        f"{legacy_size/1024/1024:>5.1f} MiB, {len(legacy_window)} entries\n"
        f"stats.json:             {stats_size/1024:>5.1f} KiB, "
        f"aggregates over {len(deduped)} entries\n"
        f"Pruned stale month files: {pruned}\n"
        f"Total pipeline: {len(deduped)} visible "
        f"(skipped {skipped} filtered, {dropped} L2 deduped)"
    )


if __name__ == "__main__":
    build()
