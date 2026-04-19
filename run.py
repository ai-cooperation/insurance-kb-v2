#!/usr/bin/env python3
"""Main orchestrator for Insurance KB v2 crawl pipeline."""

import argparse
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

# Ensure src is importable
sys.path.insert(0, str(Path(__file__).resolve().parent))

from src.classifier import classify_llm_batch, classify_rule
from src.crawler import CrawlResult, Deduplicator, crawl_all, resolve_gnews_urls
from src.index_manager import get_stats, update_index
from src.md_generator import generate_all
from src.quality_gate import run_quality_gate
from src.sources import SOURCES

LOG_DIR = Path(__file__).resolve().parent / "logs"


def setup_logging():
    """Configure logging to both console and file."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_file = LOG_DIR / f"crawl-{datetime.now():%Y%m%d-%H%M%S}.log"

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(log_file, encoding="utf-8"),
        ],
    )
    return logging.getLogger(__name__)


def _results_to_dicts(results, sources):
    """Convert CrawlResult list to dicts with source region/type info."""
    source_map = {s["id"]: s for s in sources}
    articles = []
    for r in results:
        src = source_map.get(r.source_id, {})
        articles.append({
            "uid": r.uid,
            "title": r.title,
            "url": r.url,
            "snippet": r.snippet,
            "published": r.published,
            "source_id": r.source_id,
            "region": src.get("region", ""),
            "source_type": src.get("type", ""),
        })
    return articles


def build_card_view(index):
    """Build a simple HTML card view at docs/index.html."""
    docs_dir = Path(__file__).resolve().parent / "docs"
    docs_dir.mkdir(parents=True, exist_ok=True)

    # Filter out articles marked by content filter
    visible = [e for e in index if not e.get("filter")]

    cards_html = []
    for entry in visible[:200]:
        title = entry.get("title", "No title")
        date = entry.get("date", "")
        region = entry.get("region", "")
        category = entry.get("category", "")
        summary = entry.get("summary", "")[:150]
        url = entry.get("source_url", "#")
        importance = entry.get("importance", "medium")

        badge_color = {
            "high": "#e74c3c",
            "medium": "#f39c12",
            "low": "#95a5a6",
        }.get(importance, "#95a5a6")

        cards_html.append(
            f'<div class="card">'
            f'<div class="card-header">'
            f'<span class="badge" style="background:{badge_color}">{importance}</span>'
            f'<span class="region">{region}</span>'
            f'<span class="category">{category}</span>'
            f'</div>'
            f'<h3><a href="{url}" target="_blank">{title}</a></h3>'
            f'<p class="summary">{summary}</p>'
            f'<div class="card-footer"><span class="date">{date}</span></div>'
            f'</div>'
        )

    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    html = (
        '<!DOCTYPE html>\n<html lang="zh-Hant">\n<head>\n'
        '  <meta charset="UTF-8">\n'
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
        '  <title>Insurance KB v2 - Card View</title>\n'
        '  <style>\n'
        '    * { margin: 0; padding: 0; box-sizing: border-box; }\n'
        '    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif;\n'
        '           background: #f5f5f5; padding: 20px; }\n'
        '    h1 { text-align: center; margin-bottom: 10px; color: #2c3e50; }\n'
        '    .stats { text-align: center; color: #7f8c8d; margin-bottom: 20px; }\n'
        '    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));\n'
        '             gap: 16px; max-width: 1200px; margin: 0 auto; }\n'
        '    .card { background: #fff; border-radius: 8px; padding: 16px;\n'
        '             box-shadow: 0 1px 3px rgba(0,0,0,0.1); }\n'
        '    .card-header { display: flex; gap: 8px; margin-bottom: 8px; }\n'
        '    .badge { color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 12px; }\n'
        '    .region, .category { font-size: 12px; color: #7f8c8d; }\n'
        '    .card h3 { font-size: 15px; margin-bottom: 8px; }\n'
        '    .card h3 a { color: #2c3e50; text-decoration: none; }\n'
        '    .card h3 a:hover { color: #3498db; }\n'
        '    .summary { font-size: 13px; color: #555; margin-bottom: 8px; }\n'
        '    .card-footer { font-size: 12px; color: #95a5a6; }\n'
        '  </style>\n</head>\n<body>\n'
        '  <h1>Insurance KB v2</h1>\n'
        f'  <p class="stats">Showing {len(cards_html)} of {len(visible)} articles'
        f' (updated {now})</p>\n'
        '  <div class="grid">\n'
        + "\n".join(cards_html) +
        '\n  </div>\n</body>\n</html>'
    )

    out_path = docs_dir / "index.html"
    out_path.write_text(html, encoding="utf-8")
    logger.info("Built card view: %s (%d cards)", out_path, len(cards_html))


def main():
    parser = argparse.ArgumentParser(description="Insurance KB v2 crawl pipeline")
    parser.add_argument("--no-ai", action="store_true", help="Skip LLM step")
    args = parser.parse_args()

    global logger
    logger = setup_logging()
    logger.info("=" * 60)
    logger.info("Insurance KB v2 - Crawl Pipeline Start")
    logger.info("Sources: %d | AI: %s", len(SOURCES), "OFF" if args.no_ai else "ON")
    logger.info("=" * 60)

    # Phase 1: Crawl
    logger.info("Phase 1: Crawling %d sources...", len(SOURCES))
    dedup = Deduplicator()
    results = crawl_all(SOURCES, dedup, delay=1.0)
    # Resolve GNews redirect URLs (batch, max 200 per run to stay under timeout)
    results = resolve_gnews_urls(results, max_resolve=200)
    articles = _results_to_dicts(results, SOURCES)
    logger.info("Phase 1 complete: %d new articles", len(articles))

    if not articles:
        logger.info("No new articles found. Exiting.")
        return

    # Phase 2: Rule-based classification
    logger.info("Phase 2: Rule-based classification...")
    articles = [classify_rule(art) for art in articles]
    logger.info("Phase 2 complete")

    # Phase 3: LLM classification (Chinese title + summary via GitHub Models)
    if not args.no_ai:
        api_key = os.environ.get("MODELS_PAT", "")
        if api_key:
            logger.info("Phase 3: LLM classification via GitHub Models (batches of 10)...")
            articles = classify_llm_batch(articles, api_key)
            logger.info("Phase 3 complete")
        else:
            logger.warning(
                "Phase 3 skipped: MODELS_PAT not set. "
                "Set it for Chinese title/summary generation."
            )
    else:
        logger.info("Phase 3 skipped (--no-ai flag)")

    # Phase 3.5: Quality gate
    logger.info("Phase 3.5: Quality gate...")
    gate = run_quality_gate(articles)
    logger.info(
        "Quality gate: %d total, %d irrelevant, %d duplicates, %.1f%% noise",
        gate["total"], gate["irrelevant"], gate["duplicates"], gate["noise_pct"],
    )
    if not gate["passed"]:
        for w in gate["warnings"]:
            logger.warning("  !! %s", w)

    # Phase 4: Generate MD files + update index
    logger.info("Phase 4: Generating MD files + updating index...")
    articles = generate_all(articles)
    index = update_index(articles)
    stats = get_stats(index)
    logger.info(
        "Phase 4 complete: %d total | Categories: %s | Regions: %s",
        stats["total"],
        dict(sorted(stats["categories"].items(), key=lambda x: -x[1])),
        dict(sorted(stats["regions"].items(), key=lambda x: -x[1])),
    )

    # Phase 5: Build Card View + Frontend Data
    logger.info("Phase 5: Building Card View + Frontend Data...")
    build_card_view(index)

    # Copy master-index.json to frontend/public/data/ for SPA
    frontend_data_dir = Path(__file__).resolve().parent / "frontend" / "public" / "data"
    frontend_data_dir.mkdir(parents=True, exist_ok=True)
    import shutil
    src_index = Path(__file__).resolve().parent / "index" / "master-index.json"
    if src_index.exists():
        shutil.copy2(src_index, frontend_data_dir / "articles.json")
        logger.info("Copied master-index.json → frontend/public/data/articles.json")

    logger.info("Phase 5 complete")

    logger.info("=" * 60)
    logger.info("Pipeline finished. %d new articles processed.", len(articles))
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
