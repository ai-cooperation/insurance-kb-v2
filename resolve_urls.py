#!/usr/bin/env python3
"""Resolve GNews redirect URLs in master-index.json to actual article URLs.

Usage:
    python3 resolve_urls.py [--limit 50] [--dry-run]
"""

import argparse
import json
import logging
import time
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

INDEX_PATH = Path(__file__).resolve().parent / "index" / "master-index.json"


def resolve_urls(limit: int = 0, dry_run: bool = False):
    try:
        from googlenewsdecoder import new_decoderv1
    except ImportError:
        logger.error("googlenewsdecoder not installed: pip install googlenewsdecoder")
        return

    idx = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    gnews = [(i, a) for i, a in enumerate(idx)
             if "news.google.com/rss/articles" in a.get("source_url", "")]
    logger.info("GNews URLs to resolve: %d / %d total", len(gnews), len(idx))

    if limit > 0:
        gnews = gnews[:limit]

    resolved = 0
    failed = 0
    for count, (i, a) in enumerate(gnews):
        url = a["source_url"]
        try:
            result = new_decoderv1(url, interval=1)
            if result.get("status"):
                new_url = result["decoded_url"]
                idx[i]["source_url"] = new_url
                resolved += 1
                if count < 5 or count % 100 == 0:
                    logger.info("[%d/%d] %s", count + 1, len(gnews), new_url[:80])
            else:
                failed += 1
        except Exception as exc:
            failed += 1
            if count < 5:
                logger.warning("[%d] Failed: %s", count + 1, exc)

        # Rate limit: googlenewsdecoder hits Google, don't spam
        if count < len(gnews) - 1:
            time.sleep(0.5)

    logger.info("Resolved: %d, Failed: %d", resolved, failed)

    if not dry_run and resolved > 0:
        INDEX_PATH.write_text(
            json.dumps(idx, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        logger.info("Saved updated index")
    elif dry_run:
        logger.info("DRY RUN - no changes saved")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    resolve_urls(limit=args.limit, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
