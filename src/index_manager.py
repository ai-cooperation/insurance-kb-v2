"""Manage master-index.json for Insurance KB v2."""

import json
import logging
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

INDEX_PATH = Path(__file__).resolve().parent.parent / "index" / "master-index.json"


def _make_entry(article: dict) -> dict:
    """Build an index entry from an article dict."""
    return {
        "uid": article.get("uid", ""),
        "title": article.get("title_zh") or article.get("title", ""),
        "title_en": article.get("title", "") if article.get("title_zh") else "",
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
        "note_path": article.get("note_path", ""),
        "filter": article.get("filter", ""),
    }


def load_index() -> list:
    """Load the master index. Returns empty list if not found."""
    if not INDEX_PATH.exists():
        return []
    try:
        data = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
        return []
    except (json.JSONDecodeError, TypeError) as exc:
        logger.warning("Failed to load index: %s", exc)
        return []


def save_index(entries: list):
    """Save the master index to disk."""
    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    INDEX_PATH.write_text(
        json.dumps(entries, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    logger.info("Saved index with %d entries", len(entries))


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
        save_index(index)
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
