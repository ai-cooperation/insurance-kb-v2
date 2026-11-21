"""--translations-file: apply reviewed translations without calling the LLM."""
import json

import pytest

import reclassify
import src.index_manager as index_manager

GOOD = {"title_zh": "DB人壽為閱讀弱勢兒童舉辦童話朗讀志工活動", "summary_zh": "DB人壽舉辦童話朗讀志工活動，關懷閱讀資源不足的兒童。",
        "category": "行銷推廣", "importance": "低"}


def write(tmp_path, data):
    path = tmp_path / "t.json"
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return path


@pytest.mark.parametrize("patch", [
    {"title_zh": "DB Life reads to children"},          # not translated
    {"title_zh": "DB생명 舉辦朗讀活動"},                    # Hangul left in
    {"summary_zh": ""},
    {"summary_zh": "摘要含 한글"},
    {"category": "體育"},
    {"importance": "超高"},
])
def test_load_translations_fails_closed(tmp_path, patch):
    with pytest.raises(ValueError):
        reclassify.load_translations(write(tmp_path, {"u1": {**GOOD, **patch}}))


@pytest.mark.parametrize("data", [{}, [], {"u1": "x"}])
def test_load_translations_rejects_bad_shape(tmp_path, data):
    with pytest.raises(ValueError):
        reclassify.load_translations(write(tmp_path, data))


def rows():
    return [
        # untranslated Korean row -> gets everything
        {"uid": "u1", "date": "2026-11-10", "source": "gnews_kr_companies_3", "category": "市場趨勢", "filter": "",
         "title": "DB생명, 동화 낭독 봉사활동 진행", "title_en": "DB생명, 동화 낭독 봉사활동 진행", "summary": "DB생명 봉사활동"},
        # title already repaired by hand, only the summary is missing -> title must survive
        {"uid": "u2", "date": "2026-11-04", "source": "air_news", "category": "市場趨勢", "filter": "",
         "title": "韓國：推出全國首張教師專屬保險方案", "title_en": "South Korea: first insurance plan for teachers", "summary": ""},
        # finished row: in the file but not selected -> untouched
        {"uid": "u3", "date": "2026-11-10", "source": "air_news", "category": "產品創新", "filter": "",
         "title": "已翻譯的標題", "title_en": "Already translated", "summary": "已有摘要。"},
        # selected but not in the file -> untouched
        {"uid": "u4", "date": "2026-11-10", "source": "air_news", "category": "市場趨勢", "filter": "",
         "title": "Untouched headline", "title_en": "Untouched headline", "summary": "Untouched"},
        # before the cutoff -> untouched
        {"uid": "u5", "date": "2026-10-30", "source": "air_news", "category": "市場趨勢", "filter": "",
         "title": "Old headline", "title_en": "Old headline", "summary": "Old"},
    ]


def run(monkeypatch, translations, dry_run=False):
    saved = {}
    monkeypatch.setattr(index_manager, "load_index", lambda *a, **k: rows())
    monkeypatch.setattr(index_manager, "save_index", lambda entries, **k: saved.update(entries=entries, **k) or entries)
    monkeypatch.setattr(reclassify, "_build_cascade", lambda *a, **k: pytest.fail("LLM cascade must not be built"))
    reclassify.reclassify(api_key="", untranslated_since="2026-11-01", dry_run=dry_run, translations=translations)
    return saved


def test_applies_only_selected_rows_and_preserves_originals(monkeypatch):
    other = {**GOOD, "title_zh": "不該套用的標題", "summary_zh": "補上的摘要。", "category": "產品創新", "importance": "中"}
    saved = run(monkeypatch, {"u1": GOOD, "u2": other, "u3": other, "u5": other})
    by = {r["uid"]: r for r in saved["entries"]}
    assert by["u1"]["title"] == GOOD["title_zh"] and by["u1"]["summary"] == GOOD["summary_zh"]
    assert by["u1"]["title_en"] == "DB생명, 동화 낭독 봉사활동 진행"          # original kept
    assert by["u1"]["category"] == "行銷推廣" and by["u1"]["importance"] == "低"
    assert by["u2"]["title"] == "韓國：推出全國首張教師專屬保險方案"          # reviewed title kept
    assert by["u2"]["summary"] == "補上的摘要。"
    for uid in ("u3", "u4", "u5"):
        assert by[uid] == next(r for r in rows() if r["uid"] == uid)
    assert saved["actor"] == "manual-translation"


def test_irrelevant_category_sets_filter(monkeypatch):
    saved = run(monkeypatch, {"u1": {**GOOD, "category": "無關"}})
    row = next(r for r in saved["entries"] if r["uid"] == "u1")
    assert row["filter"] == "irrelevant" and row["category"] == "市場趨勢"


def test_dry_run_and_no_match_do_not_save(monkeypatch):
    assert run(monkeypatch, {"u1": GOOD}, dry_run=True) == {}
    assert run(monkeypatch, {"zzz": GOOD}) == {}
