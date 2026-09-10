"""Synthetic fixtures only; no LLM or network calls."""
import json
from unittest.mock import patch
from src import distill, distill_llm
from src.agent_publication import candidate_hash, parse_markdown, wiki_state
from src.index_manager import _make_entry


def rows():
    return [{"uid": f"a{i:02}", "title": str(i), "date": f"2026-08-{i%28+1:02}",
             "summary": "x" * 400, "importance": "high", "category": "監理政策",
             "region": "台灣", "_lineage": {"revision_id": str(i).zfill(64)}} for i in range(60)]


def test_selection_and_numbered_evidence_use_identical_order():
    selected = distill_llm.select_articles_for_prompt(rows())
    assert selected == distill_llm.select_articles_for_prompt(list(reversed(rows())))
    assert len(selected) == distill_llm.MAX_ARTICLES_PER_PROMPT
    block = distill_llm._format_articles_for_prompt(rows())
    for i, row in enumerate(selected, 1):
        assert f"[{i}] {row['title']}\n" in block
    assert "x" * 101 not in block


def test_frontmatter_records_exact_inputs_and_all_candidate_revisions():
    candidates = rows()
    selected = distill_llm.select_articles_for_prompt(candidates)
    evidence = distill.lineage_metadata(candidates, selected, "a" * 64)
    meta, _ = parse_markdown(distill.build_frontmatter("monthly", "2026-08", provenance=evidence))
    assert meta["selected_count"] == len(selected)
    assert meta["candidate_hash"] == candidate_hash(candidates)
    assert [r["article_id"] for r in meta["source_refs"]] == [r["uid"] for r in selected]
    assert meta["evidence_input"] == distill_llm._format_articles_for_prompt(selected)
    current = {r["uid"]: r for r in candidates}
    meta["candidate_category"], meta["candidate_region"] = "監理政策", "台灣"
    assert wiki_state(meta, current, "Finding [1].")["lifecycle_status"] == "current"
    current.pop("a00")
    assert wiki_state(meta, current, "Finding [1].")["lifecycle_status"] == "stale"


def test_ingest_keeps_original_evidence_separate_from_generated_summary():
    entry = _make_entry({"uid": "a1", "snippet": "original", "summary_zh": "generated",
                         "retrieved_at": "2026-09-10T00:00:00+00:00"})
    assert entry["source_excerpt"] == "original"
    assert entry["summary"] == "generated"
    assert entry["retrieved_at"] == "2026-09-10T00:00:00+00:00"
    assert entry["content_kind"] == "ai_summary_with_source_excerpt"


def test_monthly_generation_skips_only_matching_inputs_and_preserves_page_on_failure(tmp_path):
    import pytest
    from src.monthly_store import MonthlyStore
    candidates = [{**r, "category": "市場趨勢", "title": "Synthetic " + r["uid"]} for r in rows()[:3]]
    store = MonthlyStore(tmp_path / "index/master-index.json")
    store.save(candidates)
    candidates = store.load()
    body = "### 本月重點\n" + "Synthetic finding [1]. " * 40
    with patch.object(distill, "BASE_DIR", tmp_path), patch.object(distill, "COMPILED_DIR", tmp_path / "compiled"), patch.object(distill, "load_articles", side_effect=lambda: store.load()):
        with patch.object(distill, "distill_monthly", return_value=body) as model:
            distill.run_monthly("2026-08")
            assert model.call_count == 1
            distill.run_monthly("2026-08")
            assert model.call_count == 1
        path = next((tmp_path / "compiled/monthly/2026-08").glob("*.md"))
        original = path.read_text()
        store.save([{**r, "summary": "corrected input"} for r in candidates])
        with patch.object(distill, "distill_monthly", side_effect=RuntimeError("synthetic model failure")):
            with pytest.raises(SystemExit):
                distill.run_monthly("2026-08")
        assert path.read_text() == original
        with patch.object(distill, "distill_monthly", return_value=body) as model:
            distill.run_monthly("2026-08")
            assert model.call_count == 1
        meta, _ = parse_markdown(path.read_text())
        assert meta["candidate_hash"] == candidate_hash(store.load())
