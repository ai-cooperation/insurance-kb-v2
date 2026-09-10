"""Manage master-index.json for Insurance KB v2."""

import json
import logging
from datetime import datetime
from pathlib import Path
from src.monthly_store import MonthlyStore

logger = logging.getLogger(__name__)

INDEX_PATH = Path(__file__).resolve().parent.parent / "index" / "master-index.json"


def _make_entry(article: dict) -> dict:
    """Build an index entry from an article dict."""
    return {
        "uid": article.get("uid", ""),
        "title": article.get("title_zh") or article.get("title", ""),
        # ALWAYS store the original title. The old conditional only kept
        # it when translation succeeded, so the 2026-07 outage cohort
        # (translation failed at ingest) had no title_en — and the later
        # backfill overwrote `title` with zh, silently destroying the
        # original for 54 articles (broke original-language search,
        # cross-source dedup, and name-consistency checks for them).
        # title == title_en simply marks an untranslated row.
        "title_en": article.get("title", ""),
        "date": article.get("published") or datetime.now().strftime("%Y-%m-%d"),
        "source": article.get("source_id", ""),
        "source_url": article.get("url", ""),
        "category": article.get("category", "general"),
        "subcategory": "",
        "region": article.get("region", "全球"),
        "companies": [],
        "keywords": [],
        "importance": article.get("importance", "medium"),
        "summary": article.get("summary_zh") or article.get("snippet", ""),
        "source_excerpt": article.get("snippet", ""),
        "retrieved_at": article.get("retrieved_at"),
        "content_kind": "ai_summary_with_source_excerpt" if article.get("summary_zh") else "source_excerpt",
        "note_path": article.get("note_path", ""),
        "filter": article.get("filter", ""),
    }


def load_index(months=None, snapshot_id=None) -> list:
    """Read complete records; a missing/corrupt shard is an error, never empty."""
    return MonthlyStore(INDEX_PATH).load(months=months, snapshot_id=snapshot_id)


def save_index(entries: list, reason="pipeline update"):
    """Save monthly immutable shards and refresh caller's revision tokens."""
    store = MonthlyStore(INDEX_PATH)
    store.save(entries, reason=reason)
    return store.load()


def update_index(articles: list) -> list:
    """Merge new articles into the master index. Returns the full index."""
    index = load_index()
    existing_uids = {e["uid"] for e in index}

    new_count = 0
    for art in articles:
        uid = art.get("uid", "")
        if uid and uid not in existing_uids:
            index.append(_make_entry(art))
            existing_uids.add(uid)
            new_count += 1

    if new_count > 0:
        # Sort by date descending
        index.sort(key=lambda e: e.get("date", ""), reverse=True)
        index = save_index(index)
        logger.info("Added %d new entries (total: %d)", new_count, len(index))
    else:
        logger.info("No new entries to add. Index has %d entries.", len(index))

    return index


def get_stats(index: list) -> dict:
    """Return basic stats about the index."""
    categories = {}
    regions = {}
    for e in index:
        cat = e.get("category", "general")
        categories[cat] = categories.get(cat, 0) + 1
        reg = e.get("region", "全球")
        regions[reg] = regions.get(reg, 0) + 1
    return {
        "total": len(index),
        "categories": categories,
        "regions": regions,
    }
