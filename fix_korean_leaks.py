#!/usr/bin/env python3
"""One-off retro fix for Korean Hangul leaks in master-index.json.

Pass 1: applies the expanded _KR_NAME_MAP from src/classifier.py
  (pure string replacement, no API).
Pass 2: any article whose title still contains Hangul OR whose
  summary contains a Hangul run of 3+ chars is marked with
  filter='translation_partial' — the LLM translation failed badly
  enough that showing it to users is worse than hiding it. The next
  daily crawl (with hardened prompt) will overwrite these correctly.
"""

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from src.classifier import _KR_NAME_MAP, _normalize_kr_names

INDEX = Path(__file__).resolve().parent / "index" / "master-index.json"
HANGUL = re.compile(r"[가-힯]")
HANGUL_RUN_3 = re.compile(r"[가-힯]{3,}")


def main() -> None:
    data = json.loads(INDEX.read_text(encoding="utf-8"))

    fixed_titles = 0
    fixed_summaries = 0
    marked_partial = 0
    still_visible_leaking_titles = 0

    for art in data:
        if art.get("region") != "韓國":
            continue

        # Pass 1: dictionary normalization
        old_title = art.get("title", "") or ""
        old_summary = art.get("summary", "") or ""
        new_title = _normalize_kr_names(old_title)
        new_summary = _normalize_kr_names(old_summary)
        if new_title != old_title:
            art["title"] = new_title
            fixed_titles += 1
        if new_summary != old_summary:
            art["summary"] = new_summary
            fixed_summaries += 1

        # Pass 2: filter the badly-broken ones
        # - title contains ANY Hangul (any user-visible failure)
        # - OR summary contains 3+ Hangul-character run (sentence-level failure)
        if art.get("filter"):
            # Already filtered for other reasons (irrelevant / sports / dup) — leave it
            continue
        if HANGUL.search(new_title) or HANGUL_RUN_3.search(new_summary):
            art["filter"] = "translation_partial"
            marked_partial += 1
        elif HANGUL.search(new_summary):
            # Small leak still in summary but title clean — count for stats
            still_visible_leaking_titles += 1

    INDEX.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"Map entries applied:                       {len(_KR_NAME_MAP)}")
    print(f"Titles modified (pass 1 dictionary):       {fixed_titles}")
    print(f"Summaries modified (pass 1 dictionary):    {fixed_summaries}")
    print(f"Articles marked filter='translation_partial' (pass 2): {marked_partial}")
    print(f"Articles still visible with small summary leak: {still_visible_leaking_titles}")


if __name__ == "__main__":
    main()
