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
import re
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

from src.sources import ZH_HANT_SOURCE_IDS

_HAN = re.compile(r"[\u4e00-\u9fff]")
_KANA_HANGUL = re.compile(r"[\u3040-\u30ff\u31f0-\u31ff\uac00-\ud7af]")


def needs_retranslation(art: dict, zh_hant_sources=ZH_HANT_SOURCE_IDS) -> bool:
    """Backfill selector: is this row still in its source language?

    The original selector (title == title_en OR any kana/hangul in title)
    re-selected finished rows forever, so the backlog count never reached
    zero (2026-11-21, two false positives after three full backfill runs):
      * hkia_rss — the source is Traditional Chinese, so title == title_en
        is the normal, finished state;
      * a translated Nissay headline that keeps the product name
        「ぴたほ」 in kana.
    """
    title = art.get("title") or ""
    original = art.get("title_en") or ""
    if not (art.get("summary") or "").strip():
        return True
    if title == original:
        return art.get("source") not in zh_hant_sources
    foreign = len(_KANA_HANGUL.findall(title))
    if not original:
        # Legacy rows with no stored original: any kana/hangul means the
        # source-language headline is still sitting in `title`.
        return foreign > 0
    # title differs from the stored original, i.e. it was translated. Proper
    # nouns kept in kana/hangul are fine (max 43% of CJK chars across the
    # 2026-11 index); only a headline that is still mostly kana/hangul counts.
    return foreign > len(_HAN.findall(title))


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


def _apply_merged(row: dict, merged_art: dict, stats: Counter,
                  keep_translated_title: bool = False) -> None:
    """Write one merged translation/classification result into an index row."""
    old_cat = row.get("category", "")
    new_cat = merged_art.get("category", old_cat)
    row["category"] = new_cat
    row["importance"] = merged_art.get("importance", "中")
    if merged_art.get("filter"):
        row["filter"] = merged_art["filter"]
    # Preserve the original into title_en first if it was never stored
    # (outage-cohort rows) — overwriting `title` would otherwise destroy
    # the source-language original.
    title_done = bool(row.get("title_en")) and row.get("title") != row.get("title_en")
    if merged_art.get("title_zh") and not (keep_translated_title and title_done):
        if not row.get("title_en"):
            row["title_en"] = row.get("title", "")
        row["title"] = merged_art["title_zh"]
    if merged_art.get("summary_zh"):
        row["summary"] = merged_art["summary_zh"]
    stats[f"{old_cat} -> {new_cat}" if old_cat != new_cat else "unchanged"] += 1


_HANGUL_ANY = re.compile(r"[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]")


def load_translations(path: Path) -> dict:
    """Read a reviewed translations file: {uid: {title_zh, summary_zh, category, importance}}.

    Same four fields the LLM is asked for (classifier._LLM_SYSTEM), so the
    result goes through the same _merge_llm_results normalisation. Used when
    the provider quota is exhausted and the backlog is translated by hand
    (2026-11-21: 599 rows dated 11-01..11-15). Fails closed on any row that
    is not actually translated.
    """
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not data:
        raise ValueError("translations file must be a non-empty object keyed by uid")
    allowed = set(_CATEGORIES) | {"無關"}
    for uid, t in data.items():
        if not isinstance(t, dict):
            raise ValueError(f"{uid}: entry must be an object")
        for field in ("title_zh", "summary_zh"):
            value = t.get(field)
            if not isinstance(value, str) or not _HAN.search(value):
                raise ValueError(f"{uid}: {field} is missing or not Chinese")
            if _HANGUL_ANY.search(value):
                raise ValueError(f"{uid}: {field} still contains Hangul")
        if t.get("category") not in allowed:
            raise ValueError(f"{uid}: unknown category {t.get('category')!r}")
        if t.get("importance") not in ("高", "中", "低"):
            raise ValueError(f"{uid}: unknown importance {t.get('importance')!r}")
    return data


def reclassify(
    api_key: str,
    batch_size: int = 10,
    delay: float = 3.0,
    limit: int = 0,
    dry_run: bool = False,
    korean_only: bool = False,
    untranslated_since: str = "",
    translations: dict | None = None,
):
    """Reclassify all articles in the index."""
    from src.index_manager import load_index, save_index
    index = load_index()
    logger.info("Loaded %d articles from index", len(index))

    if untranslated_since:
        # Backfill mode (2026-07-31 GitHub Models retirement outage):
        # articles that shipped with untranslated titles or empty
        # summaries because every translation batch 401'd.
        to_reclassify = [
            (i, art) for i, art in enumerate(index)
            if (art.get("date") or "") >= untranslated_since
            and not art.get("filter")
            and needs_retranslation(art)
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

    if translations is not None:
        # No LLM call: apply reviewed translations to the rows the selector
        # picked. Rows not in the file are left alone; uids in the file that
        # the selector did not pick are ignored (already translated).
        stats = Counter()
        hits = [(i, art) for i, art in to_reclassify if art.get("uid") in translations]
        logger.info("Translations file: %d entries, %d match selected rows",
                    len(translations), len(hits))
        for i, art in hits:
            merged_art = _merge_llm_results([art], [translations[art["uid"]]])[0]
            _apply_merged(index[i], merged_art, stats, keep_translated_title=True)
        logger.info("=== Reclassification Stats ===")
        for key, cnt in stats.most_common():
            logger.info("  %s: %d", key, cnt)
        if hits and not dry_run:
            save_index(index, reason="reviewed translation backfill", actor="manual-translation")
            logger.info("Saved updated index")
        else:
            logger.info("DRY RUN - no changes saved" if dry_run else "Nothing to apply")
        return

    # Provider-aware cascade (Groq primary since GitHub Models retirement)
    try:
        # _build_cascade() reads provider keys from env and takes no args
        # (signature changed after the 2026-08-05 run; passing api_key
        # crashed the 2026-11-21 backfill with TypeError before any batch).
        slots = _build_cascade()
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
                    _apply_merged(index[batch_indices[j]], merged_art, stats)

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
            saved = save_index(index, reason="LLM reclassification checkpoint")
            revisions = {a["uid"]: a["_lineage"] for a in saved}
            index = [{**a, "_lineage": revisions[a["uid"]]} for a in index]
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
        save_index(index, reason="LLM reclassification")
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
    parser.add_argument("--translations-file", type=Path, default=None,
                        help="Apply reviewed translations from this JSON instead of calling "
                             "the LLM (requires --untranslated-since)")
    args = parser.parse_args()

    translations = None
    if args.translations_file:
        if not args.untranslated_since:
            parser.error("--translations-file requires --untranslated-since")
        translations = load_translations(args.translations_file)

    api_key = os.environ.get("MODELS_PAT", "")
    if translations is None and not api_key and not os.environ.get("GROQ_API_KEY"):
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
        translations=translations,
    )


if __name__ == "__main__":
    main()
