#!/usr/bin/env python3
"""One-off retro fix for company-name translation splits in master-index.json.

Background (2026-07-06): ingest-time LLM translation had no canonical
mapping for several Korean insurers, so the same company was rendered
differently per article (라이나생명 → Lina人壽 / 萊茵人壽 / 萊納人壽 /
賴納人壽 / 麗娜生命 …), breaking substring search. Worse, a few articles
mistranslated one company into ANOTHER company's canonical name
(하나생명 → 韓華人壽), which a blind string replacement cannot repair
without corrupting the genuine 한화 articles.

Pass 1 — conditional cross-company repairs, gated on title_en (the
  untranslated original headline) as ground truth. Only articles whose
  original title names company A but whose zh text names company B get
  the B→A replacement.
Pass 2 — unconditional dictionary normalization via the expanded
  _KR_NAME_MAP from src/classifier.py (same table the daily pipeline
  and build_frontend_data.py apply), over title + summary of EVERY
  article. Global scope, not KR-only: English-source articles about
  the same companies live under region=全球 (e.g. uid 3802525fd9da).

Idempotent: running twice changes nothing on the second run.
"""

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from src.classifier import _normalize_kr_names

INDEX = Path(__file__).resolve().parent / "index" / "master-index.json"

# (title_en must match, title_en must NOT match, [(wrong zh, right zh), ...])
CONDITIONAL_RULES = [
    (
        re.compile(r"하나생명"),
        re.compile(r"한화"),
        [("韓華人壽", "Hana人壽")],
    ),
    (
        re.compile(r"하나손해보험|하나손보"),
        re.compile(r"한화"),
        [
            ("韓華損害保險", "Hana損害保險"),
            ("韓華損保", "Hana損保"),
            # 2026-07 one-day auto insurance burst variants (韓亞 = Hana
            # Financial's zh name but house canonical is Hana; 韓華 =
            # Hanwha collision — both safe inside the 하나 gate)
            ("韓亞產險", "Hana產險"),
            ("韓華產險", "Hana產險"),
            ("韓亞損保", "Hana損保"),
        ],
    ),
    (
        re.compile(r"한화손해보험|한화손보"),
        re.compile(r"한화생명"),
        [("韓華人壽", "韓華損保")],
    ),
    # JP: Aflac (アフラック / EN "Aflac") was rendered as several OTHER
    # companies' canonical names. Those tokens are genuine elsewhere
    # (安聯 = Allianz, 美國友邦 = AIA, 大都會人壽 = MetLife, 美亞 = AIG's
    # China JV, 美國運通 = Amex), so only articles whose original title
    # names Aflac get the repair. 2026-07 breach-news burst added the
    # 美亞/美國運通/bare-安聯 variants (name_consistency baseline scan).
    (
        re.compile(r"アフラック|[Aa]flac|AFLAC"),
        re.compile(r"メットライフ|AIA|アリアンツ|[Aa]llianz"),
        [
            ("安聯生命", "Aflac生命"),
            ("美國友邦生命", "Aflac生命"),
            ("美國友邦保險", "Aflac生命"),
            ("美國友邦", "Aflac"),
            ("大都會人壽", "Aflac生命"),
            ("美國運通保險", "Aflac"),
            ("美亞保險", "Aflac"),
            ("安聯", "Aflac"),
            ("友利", "Aflac"),  # bare leftover after map fixes 友利生命
        ],
    ),
    # Manulife (katakana OR English sources) — 萬通人壽 is genuine
    # MassMutual in US articles, 大東方 genuine Great Eastern, so gate
    # on the original title. 直布羅陀/大東方 renderings observed on
    # Manulife Indonesia articles 2026-07 (baseline scan).
    (
        re.compile(r"マニュライフ|[Mm]anulife"),
        re.compile(r"マスミューチュアル|MassMutual|[Gg]reat [Ee]astern"),
        [
            ("萬通人壽", "宏利人壽"),
            ("萬通大廈", "宏利大廈"),
            ("直布羅陀生命", "宏利人壽"),
            ("大東方", "宏利"),
        ],
    ),
    # JP: Prudential (US) — 保誠 is genuine Prudential plc (UK) elsewhere
    (
        re.compile(r"プルデンシャル"),
        re.compile(r"$^"),
        [("保誠生命", "保德信生命")],
    ),
    # JP: Gibraltar Life — 吉百利 is Cadbury, not an insurer
    (
        re.compile(r"ジブラルタ"),
        re.compile(r"$^"),
        [
            ("吉百利人壽", "直布羅陀生命"),
            ("吉百利生命", "直布羅陀生命"),
            ("吉百利", "直布羅陀生命"),
        ],
    ),
    # JP: Lifenet — ライフネット is not Rakuten's network
    (
        re.compile(r"ライフネット"),
        re.compile(r"$^"),
        [
            ("樂天網路人壽", "Lifenet生命"),
            ("樂天網路生命", "Lifenet生命"),
            ("樂天網生命", "Lifenet生命"),
        ],
    ),
    # JP: Japan Post Insurance — gate keeps Taiwan's 中華郵政 articles intact
    (
        re.compile(r"かんぽ|ゆうちょ|日本郵政|郵便"),
        re.compile(r"中華郵政"),
        [("日本郵政人壽", "郵政生命"), ("郵政人壽", "郵政生命")],
    ),
    # SG: Great Eastern mistranslated as 宏利 (Manulife — a direct
    # competitor). Caught 2026-07-09, first crawl of the official
    # newsroom source: 3 of 4 fresh GE releases rendered as 宏利.
    # 宏利 is genuine Manulife elsewhere, so gate on the original title.
    (
        re.compile(r"[Gg]reat [Ee]astern|GREAT EASTERN"),
        re.compile(r"[Mm]anulife|マニュライフ"),
        [("宏利人壽", "大東方"), ("宏利", "大東方")],
    ),
]


def apply_conditional(art: dict) -> bool:
    """Cross-company repairs gated on the original title. Returns True if changed."""
    title_en = art.get("title_en", "") or ""
    if not title_en:
        return False
    changed = False
    for must, must_not, pairs in CONDITIONAL_RULES:
        if not must.search(title_en) or must_not.search(title_en):
            continue
        for field in ("title", "summary"):
            old = art.get(field, "") or ""
            new = old
            for wrong, right in pairs:
                new = new.replace(wrong, right)
            if new != old:
                art[field] = new
                changed = True
    return changed


def main() -> None:
    data = json.loads(INDEX.read_text(encoding="utf-8"))

    conditional_fixed = 0
    normalized_titles = 0
    normalized_summaries = 0

    for art in data:
        if apply_conditional(art):
            conditional_fixed += 1

        old_title = art.get("title", "") or ""
        old_summary = art.get("summary", "") or ""
        new_title = _normalize_kr_names(old_title)
        new_summary = _normalize_kr_names(old_summary)
        if new_title != old_title:
            art["title"] = new_title
            normalized_titles += 1
        if new_summary != old_summary:
            art["summary"] = new_summary
            normalized_summaries += 1

    INDEX.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"conditional cross-company fixes: {conditional_fixed} articles")
    print(f"dictionary-normalized titles:    {normalized_titles}")
    print(f"dictionary-normalized summaries: {normalized_summaries}")


if __name__ == "__main__":
    main()
