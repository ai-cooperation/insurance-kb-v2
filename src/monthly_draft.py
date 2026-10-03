"""Fail-closed validation for Codex-authored monthly Wiki drafts.

Draft generation is performed by the Codex scheduled task. GitHub Actions only
validates the complete draft set and publishes merged pages; it never calls an
LLM provider. A page set tied to a different article snapshot is rejected.
"""
from __future__ import annotations

import argparse
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import yaml

from src.agent_publication import candidate_hash, parse_markdown
from src.distill import filter_by_month, group_by_category_region, load_articles
from src.monthly_store import (
    StorageError,
    check_manifest,
    digest,
    read_json,
    read_object,
)

ROOT = Path(__file__).resolve().parents[1]
MIN_BODY_CHARS = 500
MIN_REFERENCES = 3
MAX_REFERENCES = 50
PROMPT_VERSION = "codex-monthly-v1"
COMPILED_BY = "codex-scheduled-task"
MONTH_PATH = re.compile(r"^compiled/monthly/(\d{4}-\d{2})/[^/]+\.md$")
SNAPSHOT_ID_PATTERN = re.compile(r"^[a-f0-9]{64}$")


class DraftValidationError(ValueError):
    """A monthly draft is incomplete, stale, or lacks required lineage."""


def _validate_period(period: str) -> None:
    try:
        parsed = datetime.strptime(period, "%Y-%m").replace(tzinfo=timezone.utc)
    except ValueError as exc:
        raise DraftValidationError(f"invalid period {period!r}; expected YYYY-MM") from exc
    if parsed.strftime("%Y-%m") != period:
        raise DraftValidationError(f"invalid period {period!r}; expected YYYY-MM")


def expected_groups_for_month(rows: list[dict], period: str) -> dict[tuple[str, str], list[dict]]:
    """Return the same mapped, minimum-size groups used by monthly distillation."""
    _validate_period(period)
    return group_by_category_region(filter_by_month(rows, period))


def periods_from_paths(paths) -> list[str]:
    """Extract unique monthly Wiki periods from changed repository paths."""
    return sorted({match.group(1) for path in paths if (match := MONTH_PATH.fullmatch(str(path)))})


def _page_id(period: str, stem: str) -> str:
    return f"{period}/{stem}"


def _check_section(body: str, name: str) -> bool:
    match = re.search(
        rf"(?ms)^#{{2,4}}\s*{re.escape(name)}\s*\n(.*?)(?=^#{{2,4}}\s|\Z)",
        body,
    )
    return bool(match and len(match.group(1).strip()) >= 80)


def _validate_page(
    path: Path,
    period: str,
    category_slug: str,
    region_slug: str,
    rows: list[dict],
    snapshot_id: str,
) -> None:
    raw = path.read_text(encoding="utf-8")
    try:
        meta, body = parse_markdown(raw)
    except (StorageError, ValueError, yaml.YAMLError) as exc:
        raise DraftValidationError(f"{path.name}: invalid frontmatter: {exc}") from exc

    if meta.get("type") != "monthly" or meta.get("period") != period:
        raise DraftValidationError(f"{path.name}: type/period metadata mismatch")
    if meta.get("category") != category_slug or meta.get("region") != region_slug:
        raise DraftValidationError(f"{path.name}: category/region metadata mismatch")
    if meta.get("compiled_by") != COMPILED_BY or meta.get("prompt_version") != PROMPT_VERSION:
        raise DraftValidationError(f"{path.name}: codex provenance metadata is required")
    if meta.get("model") != "Codex":
        raise DraftValidationError(f"{path.name}: model metadata must identify Codex")
    if meta.get("candidate_hash") != candidate_hash(rows):
        raise DraftValidationError(f"{path.name}: candidate_hash is stale")
    if meta.get("candidate_category") != rows[0].get("category"):
        raise DraftValidationError(f"{path.name}: candidate_category mismatch")
    if meta.get("candidate_region") != rows[0].get("region"):
        raise DraftValidationError(f"{path.name}: candidate_region mismatch")
    if meta.get("articles_count") != len(rows):
        raise DraftValidationError(f"{path.name}: articles_count mismatch")

    refs = meta.get("source_refs")
    if not isinstance(refs, list) or not MIN_REFERENCES <= len(refs) <= min(MAX_REFERENCES, len(rows)):
        raise DraftValidationError(f"{path.name}: source_refs count must be between 3 and 50")
    if meta.get("selected_count") != len(refs):
        raise DraftValidationError(f"{path.name}: selected_count does not match source_refs")

    by_id = {row["uid"]: row for row in rows}
    seen = set()
    for ref in refs:
        if not isinstance(ref, dict):
            raise DraftValidationError(f"{path.name}: source_refs entries must be mappings")
        article_id = ref.get("article_id")
        revision_id = ref.get("revision_id")
        ref_snapshot_id = ref.get("snapshot_id")
        if article_id in seen or article_id not in by_id:
            raise DraftValidationError(f"{path.name}: source_refs contain duplicate or out-of-scope article_id")
        if not isinstance(revision_id, str) or not SNAPSHOT_ID_PATTERN.fullmatch(revision_id):
            raise DraftValidationError(f"{path.name}: invalid revision_id in source_refs")
        if by_id[article_id].get("_lineage", {}).get("revision_id") != revision_id:
            raise DraftValidationError(f"{path.name}: source revision is stale")
        if ref_snapshot_id != snapshot_id:
            raise DraftValidationError(f"{path.name}: source snapshot_id is stale")
        seen.add(article_id)

    if len(body.strip()) < MIN_BODY_CHARS:
        raise DraftValidationError(f"{path.name}: minimum body length is {MIN_BODY_CHARS} characters")
    if not re.search(r"(?m)^#\s+\S", body):
        raise DraftValidationError(f"{path.name}: a page title heading is required")
    if not _check_section(body, "本月重點") or not _check_section(body, "趨勢分析"):
        raise DraftValidationError(f"{path.name}: required 本月重點 and 趨勢分析 sections must be substantive")
    if re.search(r"(?i)\b(?:TODO|TBD)\b|待補|待生成|生成失敗|尚待補充", body):
        raise DraftValidationError(f"{path.name}: unresolved placeholder text")

    markers = {int(value) for value in re.findall(r"(?<![!\\])\[(\d+)\]", body)}
    if not markers or min(markers) < 1 or max(markers) > len(refs):
        raise DraftValidationError(f"{path.name}: numeric citations must resolve to source_refs")


def validate_draft_set(
    period: str,
    groups: dict[tuple[str, str], list[dict]],
    snapshot_id: str,
    compiled_root: Path,
) -> dict:
    """Require an exact, current, source-linked set of monthly Wiki pages."""
    _validate_period(period)
    if not SNAPSHOT_ID_PATTERN.fullmatch(str(snapshot_id)):
        raise DraftValidationError("invalid current article snapshot_id")
    if not groups:
        raise DraftValidationError(f"no eligible source groups for {period}")

    month_dir = Path(compiled_root) / period
    expected = {f"{category}-{region}.md": rows for (category, region), rows in groups.items()}
    actual = {path.name: path for path in month_dir.glob("*.md")} if month_dir.exists() else {}
    missing, unexpected = sorted(set(expected) - set(actual)), sorted(set(actual) - set(expected))
    if missing or unexpected:
        raise DraftValidationError(
            "page set mismatch: "
            + (f"missing={missing} " if missing else "")
            + (f"unexpected={unexpected}" if unexpected else "")
        )

    for (category_slug, region_slug), rows in groups.items():
        name = f"{category_slug}-{region_slug}.md"
        _validate_page(actual[name], period, category_slug, region_slug, rows, snapshot_id)
    return {"period": period, "expected_pages": len(expected), "validated_pages": len(expected),
            "snapshot_id": snapshot_id}


def _current_groups(period: str, root: Path = ROOT):
    rows = load_articles()
    groups = expected_groups_for_month(rows, period)
    manifest = check_manifest(read_json(root / "frontend/public/data/agent/manifest.json"))
    return groups, manifest["snapshot_id"]


def validate_period(period: str, root: Path = ROOT) -> dict:
    groups, snapshot_id = _current_groups(period, root)
    result = validate_draft_set(period, groups, snapshot_id, root / "compiled/monthly")
    print(f"Validated {result['validated_pages']}/{result['expected_pages']} pages for {period}; "
          f"snapshot={snapshot_id}")
    return result


def _changed_periods(base: str, head: str, root: Path = ROOT) -> list[str]:
    paths = subprocess.check_output(
        ["git", "diff", "--name-only", base, head], cwd=root, text=True
    ).splitlines()
    return periods_from_paths(paths)


def validate_changed_periods(base: str, head: str, root: Path = ROOT) -> list[dict]:
    periods = _changed_periods(base, head, root)
    if not periods:
        print("No compiled monthly pages changed; draft completeness check is not applicable.")
        return []
    return [validate_period(period, root) for period in periods]


def verify_published_period(period: str, root: Path = ROOT) -> dict:
    """Confirm the release manifest contains the exact validated Git pages."""
    result = validate_period(period, root)
    agent_root = root / "frontend/public/data/agent"
    wiki_manifest = check_manifest(read_json(agent_root / "wiki-manifest.json"))
    expected_ids = {
        _page_id(period, path.stem)
        for path in (root / "compiled/monthly" / period).glob("*.md")
    }
    published_ids = {
        page_id for page_id, ref in wiki_manifest["pages"].items()
        if ref.get("period") == period
    }
    if published_ids != expected_ids:
        raise DraftValidationError(
            f"published Wiki page set mismatch for {period}: "
            f"missing={sorted(expected_ids-published_ids)} unexpected={sorted(published_ids-expected_ids)}"
        )
    for page_id in sorted(expected_ids):
        ref = wiki_manifest["pages"][page_id]
        page = read_object(agent_root, ref)
        raw = (root / "compiled/monthly" / period / f"{page_id.split('/', 1)[1]}.md").read_text(encoding="utf-8")
        if page.get("saved_markdown") != raw or page.get("revision_id") != digest(raw):
            raise DraftValidationError(f"published Wiki content differs from Git source: {page_id}")
        if ref.get("lineage_status") != "explicit_citation_links":
            raise DraftValidationError(f"published Wiki lacks explicit citation lineage: {page_id}")
    result["published_pages"] = len(published_ids)
    result["wiki_snapshot_id"] = wiki_manifest["snapshot_id"]
    print(f"Verified {len(published_ids)} published pages for {period}; "
          f"wiki_snapshot={wiki_manifest['snapshot_id']}")
    return result


def verify_changed_periods(base: str, head: str, root: Path = ROOT) -> list[dict]:
    periods = _changed_periods(base, head, root)
    return [verify_published_period(period, root) for period in periods]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    validate = commands.add_parser("validate", help="validate a complete monthly draft set")
    validate.add_argument("--period", required=True)
    changed = commands.add_parser("validate-changed", help="validate every changed monthly period")
    changed.add_argument("--base", required=True)
    changed.add_argument("--head", required=True)
    verify = commands.add_parser("verify-published", help="verify a published monthly period")
    verify.add_argument("--period", required=True)
    verify_changed = commands.add_parser("verify-changed", help="verify all changed monthly periods")
    verify_changed.add_argument("--base", required=True)
    verify_changed.add_argument("--head", required=True)
    args = parser.parse_args()
    try:
        if args.command == "validate":
            validate_period(args.period)
        elif args.command == "validate-changed":
            validate_changed_periods(args.base, args.head)
        elif args.command == "verify-published":
            verify_published_period(args.period)
        elif args.command == "verify-changed":
            verify_changed_periods(args.base, args.head)
    except (DraftValidationError, StorageError, OSError, subprocess.CalledProcessError) as exc:
        parser.exit(1, f"monthly draft validation failed: {exc}\n")


if __name__ == "__main__":
    main()
