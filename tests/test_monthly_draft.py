from pathlib import Path

import pytest
import yaml

from src import monthly_draft
from src.agent_publication import candidate_hash
from src.monthly_draft import (
    DraftValidationError,
    expected_groups_for_month,
    periods_from_paths,
    validate_draft_set,
)

SNAPSHOT_ID = "f" * 64


def article(uid: str, date: str, category="市場趨勢", region="日本"):
    revision_id = uid[0] * 64
    return {
        "uid": uid,
        "date": date,
        "category": category,
        "region": region,
        "_lineage": {"revision_id": revision_id},
    }


def page_text(rows, body=None, snapshot_id=SNAPSHOT_ID, **overrides):
    refs = [
        {
            "article_id": row["uid"],
            "revision_id": row["_lineage"]["revision_id"],
            "snapshot_id": snapshot_id,
        }
        for row in rows
    ]
    meta = {
        "type": "monthly",
        "period": "2026-09",
        "category": "market",
        "region": "japan",
        "articles_count": len(rows),
        "compiled_by": "codex-scheduled-task",
        "model": "Codex",
        "prompt_version": "codex-monthly-v1",
        "candidate_hash": candidate_hash(rows),
        "candidate_category": "市場趨勢",
        "candidate_region": "日本",
        "selected_count": len(refs),
        "source_refs": refs,
    }
    meta.update(overrides)
    if body is None:
        body = (
            "# 日本保險市場月度觀察\n\n"
            "## 本月重點\n\n"
            + "日本市場的保障與承保策略出現具體變化。" * 20
            + " [1] [2]\n\n"
            "## 趨勢分析\n\n"
            + "後續發展需觀察商品定價與再保條件的相互影響。" * 20
            + " [3]\n"
        )
    return "---\n" + yaml.safe_dump(meta, allow_unicode=True, sort_keys=False) + "---\n\n" + body


def write_page(compiled_root: Path, rows, body=None, snapshot_id=SNAPSHOT_ID, **overrides):
    month_dir = compiled_root / "2026-09"
    month_dir.mkdir(parents=True, exist_ok=True)
    (month_dir / "market-japan.md").write_text(
        page_text(rows, body=body, snapshot_id=snapshot_id, **overrides), encoding="utf-8"
    )


def base_rows():
    return [
        article("a1", "2026-09-28"),
        article("b2", "2026-09-27"),
        article("c3", "2026-09-26"),
    ]


def test_expected_groups_filter_period_and_underfilled_or_unmapped_groups():
    rows = base_rows() + [
        article("d4", "2026-08-31"),
        article("e5", "2026-09-25", region="印度"),
        article("f6", "2026-09-24", region="印度"),
    ]

    groups = expected_groups_for_month(rows, "2026-09")

    assert list(groups) == [("market", "japan")]
    assert [row["uid"] for row in groups[("market", "japan")]] == ["a1", "b2", "c3"]


def test_valid_codex_draft_passes_complete_set_and_citation_checks(tmp_path):
    rows = base_rows()
    groups = {("market", "japan"): rows}
    write_page(tmp_path, rows)

    result = validate_draft_set("2026-09", groups, SNAPSHOT_ID, tmp_path)

    assert result["expected_pages"] == 1
    assert result["validated_pages"] == 1


def test_validation_supports_hyphenated_category_and_region_slugs(tmp_path):
    rows = base_rows()
    month_dir = tmp_path / "2026-09"
    month_dir.mkdir(parents=True)
    (month_dir / "insurance-technology-southeast-asia.md").write_text(
        page_text(rows, category="insurance-technology", region="southeast-asia"),
        encoding="utf-8",
    )

    result = validate_draft_set(
        "2026-09", {("insurance-technology", "southeast-asia"): rows}, SNAPSHOT_ID, tmp_path
    )

    assert result["validated_pages"] == 1


def test_missing_or_unexpected_pages_fail_closed(tmp_path):
    rows = base_rows()
    groups = {("market", "japan"): rows, ("products", "japan"): rows}
    write_page(tmp_path, rows)
    month_dir = tmp_path / "2026-09"
    (month_dir / "unexpected.md").write_text("draft", encoding="utf-8")

    with pytest.raises(DraftValidationError, match="page set mismatch"):
        validate_draft_set("2026-09", groups, SNAPSHOT_ID, tmp_path)


def test_snapshot_revision_hash_and_codex_provenance_are_required(tmp_path):
    rows = base_rows()
    groups = {("market", "japan"): rows}
    write_page(
        tmp_path,
        rows,
        compiled_by="distill-cli",
        source_refs=[
            {"article_id": row["uid"], "revision_id": row["_lineage"]["revision_id"],
             "snapshot_id": "0" * 64}
            for row in rows
        ],
    )

    with pytest.raises(DraftValidationError, match="codex provenance|snapshot_id"):
        validate_draft_set("2026-09", groups, SNAPSHOT_ID, tmp_path)


def test_empty_or_unfinished_sections_fail(tmp_path):
    rows = base_rows()
    groups = {("market", "japan"): rows}
    write_page(
        tmp_path,
        rows,
        body="# draft\n\n## 本月重點\n\n待補資料。\n\n## 趨勢分析\n\nTBD\n",
    )

    with pytest.raises(DraftValidationError, match="placeholder|minimum body|section"):
        validate_draft_set("2026-09", groups, SNAPSHOT_ID, tmp_path)


def test_pull_request_period_detection_ignores_non_monthly_paths():
    paths = [
        "compiled/monthly/2026-09/market-japan.md",
        "compiled/monthly/2026-09/products-japan.md",
        "compiled/quarterly/2026-Q3.md",
        "src/monthly_draft.py",
    ]

    assert periods_from_paths(paths) == ["2026-09"]


def test_monthly_github_workflow_only_validates_and_publishes_without_llm_calls():
    workflow_path = Path(__file__).resolve().parents[1] / ".github/workflows/distill.yml"
    workflow = yaml.load(workflow_path.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)

    assert set(workflow["on"]) == {"pull_request", "push", "workflow_dispatch"}
    assert workflow["jobs"]["publish"]["if"] == "github.event_name != 'pull_request'"
    assert workflow["on"]["workflow_dispatch"]["inputs"]["period"]["required"] == "true"
    publish_steps = workflow["jobs"]["publish"]["steps"]
    workflow_text = workflow_path.read_text(encoding="utf-8")
    assert "python -m src.distill" not in workflow_text
    assert not any(secret in workflow_text for secret in ("GEMINI_API_KEY", "GROQ_API_KEY", "MODELS_PAT"))
    assert any("verify-published" in step.get("run", "") or "verify-changed" in step.get("run", "")
               for step in publish_steps)
    assert any(step.get("if") == "failure()" for step in publish_steps)


@pytest.mark.parametrize("period", ["2026-13", "2026-9", "not-a-month"])
def test_invalid_period_is_rejected(period):
    with pytest.raises(DraftValidationError, match="invalid period"):
        expected_groups_for_month(base_rows(), period)


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"type": "annual"}, "type/period"),
        ({"category": "unknown"}, "category/region"),
        ({"compiled_by": "distill-cli"}, "codex provenance"),
        ({"prompt_version": "old"}, "codex provenance"),
        ({"model": "Gemini"}, "model metadata"),
        ({"candidate_hash": "0" * 64}, "candidate_hash"),
        ({"candidate_category": "wrong"}, "candidate_category"),
        ({"candidate_region": "wrong"}, "candidate_region"),
        ({"articles_count": 4}, "articles_count"),
        ({"source_refs": []}, "source_refs count"),
        ({"selected_count": 2}, "selected_count"),
    ],
)
def test_page_frontmatter_mismatches_fail_closed(tmp_path, overrides, message):
    rows = base_rows()
    write_page(tmp_path, rows, **overrides)

    with pytest.raises(DraftValidationError, match=message):
        validate_draft_set("2026-09", {("market", "japan"): rows}, SNAPSHOT_ID, tmp_path)


@pytest.mark.parametrize(
    ("refs", "message"),
    [
        (
            [
                "not a mapping",
                {"article_id": "b2", "revision_id": "b" * 64, "snapshot_id": SNAPSHOT_ID},
                {"article_id": "c3", "revision_id": "c" * 64, "snapshot_id": SNAPSHOT_ID},
            ],
            "source_refs entries",
        ),
        ([
            {"article_id": "a1", "revision_id": "a" * 64, "snapshot_id": SNAPSHOT_ID},
            {"article_id": "a1", "revision_id": "a" * 64, "snapshot_id": SNAPSHOT_ID},
            {"article_id": "c3", "revision_id": "c" * 64, "snapshot_id": SNAPSHOT_ID},
        ], "duplicate or out-of-scope"),
        ([
            {"article_id": "a1", "revision_id": "bad", "snapshot_id": SNAPSHOT_ID},
            {"article_id": "b2", "revision_id": "b" * 64, "snapshot_id": SNAPSHOT_ID},
            {"article_id": "c3", "revision_id": "c" * 64, "snapshot_id": SNAPSHOT_ID},
        ], "invalid revision_id"),
        ([
            {"article_id": "a1", "revision_id": "f" * 64, "snapshot_id": SNAPSHOT_ID},
            {"article_id": "b2", "revision_id": "b" * 64, "snapshot_id": SNAPSHOT_ID},
            {"article_id": "c3", "revision_id": "c" * 64, "snapshot_id": SNAPSHOT_ID},
        ], "source revision is stale"),
        ([
            {"article_id": "a1", "revision_id": "a" * 64, "snapshot_id": "0" * 64},
            {"article_id": "b2", "revision_id": "b" * 64, "snapshot_id": SNAPSHOT_ID},
            {"article_id": "c3", "revision_id": "c" * 64, "snapshot_id": SNAPSHOT_ID},
        ], "source snapshot_id is stale"),
    ],
)
def test_invalid_citation_lineage_fails_closed(tmp_path, refs, message):
    rows = base_rows()
    write_page(tmp_path, rows, source_refs=refs)

    with pytest.raises(DraftValidationError, match=message):
        validate_draft_set("2026-09", {("market", "japan"): rows}, SNAPSHOT_ID, tmp_path)


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ("too short", "minimum body length"),
        ("x" * 600, "page title heading"),
        ("# title\n\n## 本月重點\n\n短。\n\n## 趨勢分析\n\n" + "x" * 600, "sections must be substantive"),
        ("# title\n\n## 本月重點\n\n" + "x" * 100 + "\n\n## 趨勢分析\n\n" + "TBD " * 150, "placeholder text"),
        (
            "# title\n\n## 本月重點\n\n" + "x" * 300 + "\n\n## 趨勢分析\n\n" + "[4] " + "y" * 300,
            "numeric citations",
        ),
    ],
)
def test_unpublishable_page_body_fails_closed(tmp_path, body, message):
    rows = base_rows()
    write_page(tmp_path, rows, body=body)

    with pytest.raises(DraftValidationError, match=message):
        validate_draft_set("2026-09", {("market", "japan"): rows}, SNAPSHOT_ID, tmp_path)


def test_bad_frontmatter_empty_groups_and_snapshot_fail_closed(tmp_path):
    rows = base_rows()
    month_dir = tmp_path / "2026-09"
    month_dir.mkdir(parents=True)
    (month_dir / "market-japan.md").write_text("---\ninvalid: [\n---\nbody", encoding="utf-8")

    with pytest.raises(DraftValidationError, match="invalid frontmatter"):
        validate_draft_set("2026-09", {("market", "japan"): rows}, SNAPSHOT_ID, tmp_path)
    with pytest.raises(DraftValidationError, match="invalid current article snapshot_id"):
        validate_draft_set("2026-09", {("market", "japan"): rows}, "bad", tmp_path)
    with pytest.raises(DraftValidationError, match="no eligible source groups"):
        validate_draft_set("2026-09", {}, SNAPSHOT_ID, tmp_path)


def test_current_snapshot_publication_can_be_verified_and_stale_content_is_rejected(tmp_path, monkeypatch):
    from src.agent_publication import publish_articles, publish_wikis

    rows = base_rows()
    root = tmp_path
    agent_root = root / "frontend/public/data/agent"
    article_manifest = publish_articles(rows, agent_root)
    write_page(root / "compiled/monthly", rows, snapshot_id=article_manifest["snapshot_id"])
    publish_wikis(root / "compiled/monthly", agent_root, rows)
    monkeypatch.setattr(monthly_draft, "load_articles", lambda: rows)

    result = monthly_draft.verify_published_period("2026-09", root)

    assert result["published_pages"] == 1
    (root / "compiled/monthly/2026-09/market-japan.md").write_text(
        (root / "compiled/monthly/2026-09/market-japan.md").read_text(encoding="utf-8") + "changed",
        encoding="utf-8",
    )
    with pytest.raises(DraftValidationError, match="differs from Git source"):
        monthly_draft.verify_published_period("2026-09", root)


def test_changed_period_helpers_use_git_diff_paths(monkeypatch, tmp_path):
    monkeypatch.setattr(
        monthly_draft.subprocess,
        "check_output",
        lambda *args, **kwargs: "compiled/monthly/2026-09/a.md\ncompiled/monthly/2026-09/b.md\nREADME.md\n",
    )
    assert monthly_draft._changed_periods("base", "head", tmp_path) == ["2026-09"]


@pytest.mark.parametrize(
    ("command", "args", "function_name"),
    [
        ("validate", ["--period", "2026-09"], "validate_period"),
        ("validate-changed", ["--base", "base", "--head", "head"], "validate_changed_periods"),
        ("verify-published", ["--period", "2026-09"], "verify_published_period"),
        ("verify-changed", ["--base", "base", "--head", "head"], "verify_changed_periods"),
    ],
)
def test_cli_routes_to_requested_validator(monkeypatch, command, args, function_name):
    calls = []
    monkeypatch.setattr(monthly_draft, function_name, lambda *values: calls.append(values))
    monkeypatch.setattr("sys.argv", ["monthly_draft", command, *args])

    monthly_draft.main()

    assert len(calls) == 1


def test_cli_reports_validation_failure(monkeypatch, capsys):
    monkeypatch.setattr(
        monthly_draft,
        "validate_period",
        lambda *_: (_ for _ in ()).throw(DraftValidationError("broken draft")),
    )
    monkeypatch.setattr("sys.argv", ["monthly_draft", "validate", "--period", "2026-09"])

    with pytest.raises(SystemExit) as exc_info:
        monthly_draft.main()

    assert exc_info.value.code == 1
    assert "broken draft" in capsys.readouterr().err
