#!/usr/bin/env python3
"""Reclassify existing articles in master-index.json using LLM.

Usage:
    MODELS_PAT=xxx python3 reclassify.py [--dry-run] [--batch-size 10] [--limit 50]

Reads index/master-index.json, sends articles through the LLM classifier
in batches, and writes back with updated category/importance/filter fields.
"""

import argparse
import json
import logging
import os
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from src.classifier import (
    _CATEGORIES,
    _LLM_SYSTEM,
    _build_cascade,
    _merge_llm_results,
)

INDEX_PATH = Path(__file__).resolve().parent / "index" / "master-index.json"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


def _build_reclassify_prompt(articles: list) -> str:
    """Build prompt for reclassification of existing articles."""
    lines = ["文章列表："]
    for i, art in enumerate(articles, 1):
        title_en = art.get("title_en", "")
        title = title_en or art.get("title", "")
        source = art.get("source", "unknown")
        summary = art.get("summary", "")[:200]
        lines.append(f"{i}. {title} - {source} - {summary}")
    return "\n".join(lines)


def reclassify(
    api_key: str,
    batch_size: int = 10,
    delay: float = 3.0,
    limit: int = 0,
    dry_run: bool = False,
    korean_only: bool = False,
    untranslated_since: str = "",
):
    """Reclassify all articles in the index."""
    index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    logger.info("Loaded %d articles from index", len(index))

    if untranslated_since:
        # Backfill mode (2026-07-31 GitHub Models retirement outage):
        # articles that shipped with untranslated titles or empty
        # summaries because every translation batch 401'd.
        import re as _re
        cjk_src = _re.compile(r"[가-힯ァ-ヶぁ-ん]")
        to_reclassify = [
            (i, art) for i, art in enumerate(index)
            if (art.get("date") or "") >= untranslated_since
            and not art.get("filter")
            and (
                (art.get("title") or "") == (art.get("title_en") or "")
                or cjk_src.search(art.get("title") or "")
                or not (art.get("summary") or "").strip()
            )
        ]
        logger.info(
            "Untranslated-since-%s mode: %d articles need re-translation",
            untranslated_since, len(to_reclassify),
        )
    elif korean_only:
        # Re-translate KR-source articles whose title still contains Hangul.
        # These are leftovers from the old gpt-4.1-nano cascade where the
        # model returned partial / invalid JSON and the article kept its raw
        # Korean title. Run once after upgrading the cascade (mini start).
        import re as _re
        hangul = _re.compile(r"[가-힯]")
        to_reclassify = [
            (i, art) for i, art in enumerate(index)
            if art.get("source", "").startswith("gnews_kr")
            and hangul.search(art.get("title", "") or "")
        ]
        logger.info("Korean-only mode: %d KR-source articles still in Hangul",
                    len(to_reclassify))
    else:
        # Only reclassify articles that need it (default category or no LLM classification)
        to_reclassify = [
            (i, art) for i, art in enumerate(index)
            if art.get("category") == "市場趨勢" or not art.get("title_en")
        ]
    if limit > 0:
        to_reclassify = to_reclassify[:limit]

    logger.info("Articles to reclassify: %d", len(to_reclassify))
    if not to_reclassify:
        return

    # Provider-aware cascade (Groq primary since GitHub Models retirement)
    try:
        slots = _build_cascade(api_key)
    except ImportError:
        logger.error("openai package not installed")
        return
    if not slots:
        logger.error("No translation provider available")
        return
    slot_idx = 0
    stats = Counter()

    # Incremental save every N batches — protects against workflow timeout.
    # Without this, a 4+ hour reclassify (9k+ articles) loses everything if
    # the 120-min GitHub Actions timeout hits before the final save.
    SAVE_EVERY_BATCHES = 50
    batches_since_save = 0

    for start in range(0, len(to_reclassify), batch_size):
        batch_items = to_reclassify[start:start + batch_size]
        batch_articles = [art for _, art in batch_items]
        batch_indices = [i for i, _ in batch_items]

        prompt = _build_reclassify_prompt(batch_articles)
        logger.info(
            "Batch %d-%d / %d [%s]",
            start + 1, start + len(batch_items), len(to_reclassify),
            slots[min(slot_idx, len(slots) - 1)][0],
        )

        success = False
        for attempt in range(3):
            if slot_idx >= len(slots):
                break
            label, client, current_model = slots[slot_idx]
            try:
                response = client.chat.completions.create(
                    model=current_model,
                    messages=[
                        {"role": "system", "content": _LLM_SYSTEM},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.3,
                    max_tokens=2000,
                )
                text = response.choices[0].message.content.strip()
                if text.startswith("```"):
                    text = text.split("\n", 1)[1] if "\n" in text else text[3:]
                if text.endswith("```"):
                    text = text[:-3]
                translations = json.loads(text.strip())

                merged = _merge_llm_results(batch_articles, translations)
                for j, merged_art in enumerate(merged):
                    idx = batch_indices[j]
                    old_cat = index[idx].get("category", "")
                    new_cat = merged_art.get("category", old_cat)
                    new_imp = merged_art.get("importance", "中")
                    new_filter = merged_art.get("filter", "")

                    # Update in place
                    index[idx]["category"] = new_cat
                    index[idx]["importance"] = new_imp
                    if new_filter:
                        index[idx]["filter"] = new_filter
                    # Update title/summary if improved
                    if merged_art.get("title_zh"):
                        index[idx]["title"] = merged_art["title_zh"]
                    if merged_art.get("summary_zh"):
                        index[idx]["summary"] = merged_art["summary_zh"]

                    if old_cat != new_cat:
                        stats[f"{old_cat} -> {new_cat}"] += 1
                    else:
                        stats["unchanged"] += 1

                success = True
                break

            except Exception as exc:
                # ANY failure advances the cascade — the previous "short
                # 429 -> sleep 30 and retry same slot" branch keyed on the
                # GitHub-Models-specific '86400' marker; Groq's DAILY-limit
                # 429s don't contain it, so a dead llama slot got retried
                # forever while 8 healthy slots sat unused (rounds 5-7 of
                # the 2026-08-01 backfill stalled at ~90% failure on this).
                slot_idx += 1
                if slot_idx < len(slots):
                    logger.warning(
                        "Batch failed on %s (%s), rotating to %s",
                        label, str(exc)[:80], slots[slot_idx][0],
                    )
                    continue
                logger.error("All cascade slots exhausted at batch %d", start)
                break

        if not success:
            stats["failed"] += len(batch_items)

        # Incremental save checkpoint
        batches_since_save += 1
        if not dry_run and batches_since_save >= SAVE_EVERY_BATCHES:
            INDEX_PATH.write_text(
                json.dumps(index, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            logger.info(
                "[checkpoint] Saved after %d batches (%d articles processed)",
                batches_since_save, start + len(batch_items),
            )
            batches_since_save = 0

        if start + batch_size < len(to_reclassify):
            time.sleep(delay)

    # Print stats
    logger.info("=== Reclassification Stats ===")
    for key, cnt in stats.most_common():
        logger.info("  %s: %d", key, cnt)

    # Final distribution
    final_cats = Counter(a.get("category", "") for a in index)
    logger.info("=== Final Distribution ===")
    for cat, cnt in final_cats.most_common():
        logger.info("  %s: %d (%.1f%%)", cat, cnt, cnt * 100 / len(index))

    if not dry_run:
        INDEX_PATH.write_text(
            json.dumps(index, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        logger.info("Saved updated index")
    else:
        logger.info("DRY RUN - no changes saved")


def main():
    parser = argparse.ArgumentParser(description="Reclassify articles via LLM")
    parser.add_argument("--dry-run", action="store_true", help="Don't save changes")
    parser.add_argument("--batch-size", type=int, default=10)
    parser.add_argument("--limit", type=int, default=0, help="Max articles to process (0=all)")
    parser.add_argument("--delay", type=float, default=3.0)
    parser.add_argument("--korean-only", action="store_true",
                        help="Only re-translate KR-source articles whose title still contains Hangul")
    parser.add_argument("--untranslated-since", default="",
                        help="Backfill mode: re-translate articles dated >= YYYY-MM-DD "
                             "whose title is untranslated or summary empty "
                             "(2026-07 GitHub Models retirement outage)")
    args = parser.parse_args()

    api_key = os.environ.get("MODELS_PAT", "")
    if not api_key and not os.environ.get("GROQ_API_KEY"):
        logger.error("Neither GROQ_API_KEY nor MODELS_PAT set")
        sys.exit(1)

    reclassify(
        api_key=api_key,
        batch_size=args.batch_size,
        delay=args.delay,
        limit=args.limit,
        dry_run=args.dry_run,
        korean_only=args.korean_only,
        untranslated_since=args.untranslated_since,
    )


if __name__ == "__main__":
    main()
