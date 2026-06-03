#!/usr/bin/env python3
"""Build slim articles for frontend (Cloudflare Pages 25 MiB limit).

Splits the visible article payload into two files:

  - articles-recent.json  — last RECENT_DAYS days, loaded eagerly by the
    React app on first paint. Powers the default "what's new" view and
    the search box.
  - articles-archive.json — everything older, fetched lazily only when
    the user explicitly toggles "include archive" or queries an old
    date range. Stays a single file (no further sharding) until it
    crosses 25 MiB itself.

Both files share the same shape; consumers can union them when archive
is loaded. articles.json (legacy single-file path) is kept as a copy of
articles-recent.json for one release cycle so the worker chat path
keeps working until workers/src/search.ts is migrated.

Filtered entries (irrelevant / sports / dup / translation_partial)
never ship — they stay in master-index.json for retroactive fixes.

History
- 2026-06-03 single-file articles.json crossed 26 MiB → wrangler pages
  deploy started failing. Switched to visible-only (26 → 19.9 MiB),
  earning ~18 days before hitting the limit again.
- 2026-06-03 (this commit) split into recent/archive to give a multi-
  year runway and shrink first-paint payload from 20 MiB to ~3-5 MiB.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from src.classifier import _normalize_kr_names, _detect_kr_sports  # noqa: E402

INDEX_PATH = ROOT / "index" / "master-index.json"
DATA_DIR = ROOT / "frontend" / "public" / "data"
RECENT_PATH = DATA_DIR / "articles-recent.json"
ARCHIVE_PATH = DATA_DIR / "articles-archive.json"
LEGACY_PATH = DATA_DIR / "articles.json"  # backward-compat for worker chat

# Articles within this many days of the newest article ship in -recent;
# older articles go to -archive. Set tight (30d) because the KB only
# began crawling ~2026-03, so dates skew very recent — a 90d cutoff
# leaves almost nothing in archive. With 30d the split is roughly
# 50/50 (recent ≈ 11 MiB, archive ≈ 9 MiB at current size) which keeps
# first-paint fast and gives the archive headroom before it crosses
# 25 MiB. Once Phase 3 (D1 FTS5) ships, both files retire in favor of
# /api/articles?recent=30d worker queries.
RECENT_DAYS = 30


def newest_date(entries: list[dict]) -> str:
    """Find the newest YYYY-MM-DD across entries; '' if empty."""
    return max((e.get("date", "") for e in entries), default="")


def cutoff_date(newest: str, days: int) -> str:
    """Return YYYY-MM-DD that is `days` days before `newest` (string math)."""
    if not newest or len(newest) < 10:
        return ""
    from datetime import date, timedelta
    try:
        d = date.fromisoformat(newest[:10])
    except ValueError:
        return ""
    return (d - timedelta(days=days)).isoformat()


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
        if not filter_reason and _detect_kr_sports(title, a.get("title_en", "") or ""):
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
            seen[("__notitle__", i)] = i  # entries without title kept as-is
            continue
        key = (a.get("source", ""), title)
        cur = seen.get(key)
        if cur is None or a.get("date", "") > entries[cur].get("date", ""):
            seen[key] = i
    keep = set(seen.values())
    deduped = [a for i, a in enumerate(entries) if i in keep]
    return deduped, len(entries) - len(deduped)


def write_json(path: Path, entries: list[dict]) -> float:
    """Serialize entries to path. Returns size in MiB."""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(entries, ensure_ascii=False, separators=(",", ":"))
    path.write_text(payload, encoding="utf-8")
    return path.stat().st_size / 1024 / 1024


def build() -> None:
    idx = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    slim, skipped = build_slim_entries(idx)
    deduped, dropped = dedup_l2(slim)

    # Partition into recent vs archive by date cutoff (relative to newest
    # article, not today — so a stalled crawl doesn't accidentally move
    # everything to archive).
    newest = newest_date(deduped)
    cutoff = cutoff_date(newest, RECENT_DAYS)
    if cutoff:
        recent = [a for a in deduped if a.get("date", "") >= cutoff]
        archive = [a for a in deduped if a.get("date", "") < cutoff]
    else:
        # No usable date → ship everything as recent (safer than empty UI).
        recent, archive = deduped, []

    recent_size = write_json(RECENT_PATH, recent)
    archive_size = write_json(ARCHIVE_PATH, archive)

    # Backward-compat: keep articles.json as a copy of recent so the
    # worker chat path (workers/src/search.ts) keeps working until it
    # migrates. Once both consumers fetch -recent + (lazy) -archive,
    # the legacy file can be deleted in a follow-up PR.
    legacy_size = write_json(LEGACY_PATH, recent)

    print(
        f"articles-recent.json:  {recent_size:>5.1f} MiB, {len(recent):>5} entries "
        f"(>= {cutoff})\n"
        f"articles-archive.json: {archive_size:>5.1f} MiB, {len(archive):>5} entries "
        f"(< {cutoff})\n"
        f"articles.json (legacy copy of recent): {legacy_size:>5.1f} MiB\n"
        f"Total pipeline: {len(deduped)} visible "
        f"(skipped {skipped} filtered, {dropped} L2 deduped)"
    )


if __name__ == "__main__":
    build()
