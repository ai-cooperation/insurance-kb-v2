"""Backfill selector truth table.

Titles and sources come from the 2026-11 index. The hkia, 「ぴたほ」, Korean,
English and Nanshan rows are verbatim records; for the T League row only the
translated title is verbatim, and the simplified-Chinese, legacy and
"mostly kana" rows are constructed to pin the rule's edges."""
import pytest

from reclassify import needs_retranslation
from src.sources import SOURCES, ZH_HANT_SOURCE_IDS

SUMMARY = "已有中文摘要。"

CASES = [
    # --- finished rows the old selector re-selected forever (2026-11-21) ---
    ("hkia zh-Hant source, title == original", False,
     {"source": "hkia_rss", "summary": SUMMARY,
      "title": "保險業監管局向香港船東互保協會有限公司發出新授權",
      "title_en": "保險業監管局向香港船東互保協會有限公司發出新授權"}),
    ("translated, product name kept in kana", False,
     {"source": "gnews_jp_companies_ja", "summary": SUMMARY,
      "title": "日本生命將受邀於宣傳會議「行銷論壇」分享「ぴたほ」電視與聯網電視整合廣告策略",
      "title_en": "宣伝会議主催「マーケティング・フォーラム」に登壇～日本生命「ぴたほ」の地上波×コネクテッドTV広告施策を事例に解説 - REVISIO株式会社"}),
    ("translated, team names kept in kana (43% of CJK)", False,
     {"source": "gnews_jp_companies_ja", "summary": SUMMARY,
      "title": "Nojima T League 2026-2027賽季：京都カグヤライズ對戰日本生命レッドエルフ出場名單公佈",
      "title_en": "ノジマTリーグ 2026-2027シーズン 京都カグヤライズ vs 日本生命レッドエルフ 出場選手発表"}),
    ("tw zh-Hant source, title == original", False,
     {"source": "gnews_tw_lifers", "summary": SUMMARY,
      "title": "南山利變保單宣告利率4.4% - 經濟日報", "title_en": "南山利變保單宣告利率4.4% - 經濟日報"}),
    # --- genuinely untranslated rows ---
    ("korean headline untouched", True,
     {"source": "gnews_kr_industry", "summary": "KDB생명, 치매·장기요양 시 연금 50% 추가 지급",
      "title": "KDB생명, 치매·장기요양 시 연금 50% 추가 지급 - 보험매일",
      "title_en": "KDB생명, 치매·장기요양 시 연금 50% 추가 지급 - 보험매일"}),
    ("english headline untouched", True,
     {"source": "gnews_consultants", "summary": "Massimore joins Alvarez & Marsal as director",
      "title": "Massimore joins Alvarez & Marsal as director - Captive Insurance Times",
      "title_en": "Massimore joins Alvarez & Marsal as director - Captive Insurance Times"}),
    ("japanese kanji-heavy headline untouched (non zh-Hant source)", True,
     {"source": "gnews_liaj", "summary": "年管管発",
      "title": "年管管発 1102 第１号 金 資 保 第 359 号 令和８年 11 月２日 一般社団法人 生命保険協会",
      "title_en": "年管管発 1102 第１号 金 資 保 第 359 号 令和８年 11 月２日 一般社団法人 生命保険協会"}),
    ("simplified-chinese source, title == original", True,
     {"source": "gnews_cn_companies_1", "summary": SUMMARY,
      "title": "中国平安发布三季报", "title_en": "中国平安发布三季报"}),
    ("empty summary always selected", True,
     {"source": "hkia_rss", "summary": "  ", "title": "標題", "title_en": "標題"}),
    ("legacy row without stored original, kana in title", True,
     {"source": "gnews_jp_companies_ja", "summary": SUMMARY, "title": "日本生命「ぴたほ」の新CM", "title_en": ""}),
    ("legacy row without stored original, chinese title", False,
     {"source": "gnews_jp_companies_ja", "summary": SUMMARY, "title": "日本生命推出新廣告", "title_en": ""}),
    ("title changed but still mostly kana", True,
     {"source": "gnews_jp_companies_ja", "summary": SUMMARY,
      "title": "マーケティング・フォーラムに登壇", "title_en": "マーケティング・フォーラムに登壇 - REVISIO"}),
]


@pytest.mark.parametrize("label,expected,art", CASES, ids=[c[0] for c in CASES])
def test_needs_retranslation(label, expected, art):
    assert needs_retranslation(art) is expected


def test_zh_hant_sources_are_real_and_cover_known_feeds():
    ids = {s["id"] for s in SOURCES}
    assert ZH_HANT_SOURCE_IDS <= ids  # a renamed/removed source must not linger here
    assert {"hkia_rss", "gnews_tw_lifers", "gnews_hk_zh"} <= ZH_HANT_SOURCE_IDS
    assert not {"gnews_cn_companies_1", "gnews_liaj", "gnews_jp_companies_ja"} & ZH_HANT_SOURCE_IDS
