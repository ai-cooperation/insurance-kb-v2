"""Knowledge distillation CLI — monthly, quarterly, annual wiki generation."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from src.distill_llm import MODEL, distill_annual, distill_monthly, distill_quarterly
from src.topics import CATEGORY_MAP, CATEGORY_REVERSE, REGION_MAP, REGION_REVERSE

BASE_DIR = Path(__file__).resolve().parent.parent
INDEX_PATH = BASE_DIR / "index" / "master-index.json"
COMPILED_DIR = BASE_DIR / "compiled"

MIN_ARTICLES_PER_GROUP = 3


def load_articles() -> list[dict[str, Any]]:
    """Load articles from master index, skipping filtered ones."""
    with open(INDEX_PATH, encoding="utf-8") as f:
        articles = json.load(f)
    return [a for a in articles if not a.get("filter")]


def filter_by_month(articles: list[dict[str, Any]], year_month: str) -> list[dict[str, Any]]:
    """Filter articles matching YYYY-MM date prefix."""
    return [a for a in articles if a.get("date", "").startswith(year_month)]


def filter_by_quarter(articles: list[dict[str, Any]], year: str, quarter: int) -> list[dict[str, Any]]:
    """Filter articles within a quarter (Q1=01-03, Q2=04-06, etc.)."""
    start_month = (quarter - 1) * 3 + 1
    months = [f"{year}-{m:02d}" for m in range(start_month, start_month + 3)]
    return [a for a in articles if any(a.get("date", "").startswith(m) for m in months)]


def filter_by_year(articles: list[dict[str, Any]], year: str) -> list[dict[str, Any]]:
    """Filter articles within a year."""
    return [a for a in articles if a.get("date", "").startswith(year)]


def group_by_category_region(articles: list[dict[str, Any]]) -> dict[tuple[str, str], list[dict[str, Any]]]:
    """Group articles by (category_slug, region_slug). Only groups with >= MIN_ARTICLES."""
    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for art in articles:
        cat_zh = art.get("category", "")
        region_zh = art.get("region", "")
        cat_slug = CATEGORY_MAP.get(cat_zh, "")
        region_slug = REGION_MAP.get(region_zh, "")
        if not cat_slug or not region_slug:
            continue
        key = (cat_slug, region_slug)
        groups.setdefault(key, []).append(art)
    return {k: v for k, v in groups.items() if len(v) >= MIN_ARTICLES_PER_GROUP}


def build_frontmatter(
    doc_type: str,
    period: str,
    category: str | None = None,
    region: str | None = None,
    articles_count: int = 0,
) -> str:
    """Build YAML frontmatter block."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    lines = [
        "---",
        f"type: {doc_type}",
        f"period: {period}",
    ]
    if category:
        lines.append(f"category: {category}")
    if region:
        lines.append(f"region: {region}")
    lines.extend([
        f"articles_count: {articles_count}",
        f"compiled_at: {now}",
        f"compiled_by: distill-cli",
        f"model: {MODEL}",
        "---",
        "",
    ])
    return "\n".join(lines)


def run_monthly(year_month: str | None = None) -> None:
    """Generate monthly wiki pages for each category x region group."""
    if year_month is None:
        now = datetime.now(timezone.utc)
        prev = now.month - 1
        year = now.year if prev >= 1 else now.year - 1
        month = prev if prev >= 1 else 12
        year_month = f"{year}-{month:02d}"

    print(f"[distill] Monthly: {year_month}")
    articles = filter_by_month(load_articles(), year_month)
    print(f"[distill] Found {len(articles)} articles")

    groups = group_by_category_region(articles)
    if not groups:
        print("[distill] No groups with enough articles, skipping")
        return

    out_dir = COMPILED_DIR / "monthly" / year_month
    out_dir.mkdir(parents=True, exist_ok=True)

    written = 0
    skipped = 0
    for (cat_slug, region_slug), group_articles in sorted(groups.items()):
        out_path = out_dir / f"{cat_slug}-{region_slug}.md"
        # Skip if already distilled this run (from a previous partial run)
        if out_path.exists() and out_path.stat().st_size > 500:
            print(f"[distill] Skipping {cat_slug}-{region_slug} (already exists)")
            written += 1
            continue
        # Limit to 50 most recent articles to stay within LLM token limits
        group_articles.sort(key=lambda a: a.get("date", ""), reverse=True)
        capped = group_articles[:50]
        print(f"[distill] Processing {cat_slug}-{region_slug} ({len(capped)}/{len(group_articles)} articles)")
        try:
            content = distill_monthly(capped, cat_slug, region_slug, year_month)
            frontmatter = build_frontmatter(
                "monthly", year_month, cat_slug, region_slug, len(group_articles)
            )
            out_path.write_text(frontmatter + content, encoding="utf-8")
            print(f"[distill] Written: {out_path}")
            written += 1
        except Exception as exc:
            exc_str = str(exc)
            if "exhausted" in exc_str or "429" in exc_str or "413" in exc_str:
                print(f"[distill] API limit hit ({type(exc).__name__}), stopping. Written {written} pages.")
                skipped = len(groups) - written
                break
            print(f"[distill] Error on {cat_slug}-{region_slug}: {exc}")
            skipped += 1
    print(f"[distill] Done: {written} written, {skipped} skipped")


def run_quarterly(period: str | None = None) -> None:
    """Generate quarterly overview from existing monthly wikis."""
    if period is None:
        now = datetime.now(timezone.utc)
        quarter = (now.month - 1) // 3
        if quarter == 0:
            quarter = 4
            year = now.year - 1
        else:
            year = now.year
        period = f"{year}-Q{quarter}"

    match = re.match(r"(\d{4})-Q(\d)", period)
    if not match:
        print(f"[distill] Invalid quarterly period: {period}")
        sys.exit(1)

    year, quarter = match.group(1), int(match.group(2))
    start_month = (quarter - 1) * 3 + 1
    months = [f"{year}-{m:02d}" for m in range(start_month, start_month + 3)]

    print(f"[distill] Quarterly: {period} (months: {months})")

    monthly_wikis = []
    for month in months:
        month_dir = COMPILED_DIR / "monthly" / month
        if not month_dir.exists():
            print(f"[distill] Warning: no monthly data for {month}")
            continue
        combined = []
        for md_file in sorted(month_dir.glob("*.md")):
            combined.append(md_file.read_text(encoding="utf-8"))
        if combined:
            monthly_wikis.append({"month": month, "content": "\n\n".join(combined)})

    if not monthly_wikis:
        print("[distill] No monthly wikis found, skipping")
        return

    content = distill_quarterly(monthly_wikis, period)
    frontmatter = build_frontmatter("quarterly", period)

    out_dir = COMPILED_DIR / "quarterly"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{period}.md"
    out_path.write_text(frontmatter + content, encoding="utf-8")
    print(f"[distill] Written: {out_path}")


def run_annual(year: str | None = None) -> None:
    """Generate annual overview from existing quarterly wikis."""
    if year is None:
        year = str(datetime.now(timezone.utc).year - 1)

    print(f"[distill] Annual: {year}")

    quarterly_wikis = []
    for q in range(1, 5):
        q_path = COMPILED_DIR / "quarterly" / f"{year}-Q{q}.md"
        if not q_path.exists():
            print(f"[distill] Warning: no quarterly data for {year}-Q{q}")
            continue
        quarterly_wikis.append({
            "quarter": f"{year}-Q{q}",
            "content": q_path.read_text(encoding="utf-8"),
        })

    if not quarterly_wikis:
        print("[distill] No quarterly wikis found, skipping")
        return

    content = distill_annual(quarterly_wikis, year)
    frontmatter = build_frontmatter("annual", year)

    out_dir = COMPILED_DIR / "annual"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{year}.md"
    out_path.write_text(frontmatter + content, encoding="utf-8")
    print(f"[distill] Written: {out_path}")


def main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="Insurance KB knowledge distillation")
    parser.add_argument("--monthly", nargs="?", const=None, default=False,
                        metavar="YYYY-MM", help="Generate monthly wiki (default: previous month)")
    parser.add_argument("--quarterly", nargs="?", const=None, default=False,
                        metavar="YYYY-QN", help="Generate quarterly overview (default: previous quarter)")
    parser.add_argument("--annual", nargs="?", const=None, default=False,
                        metavar="YYYY", help="Generate annual overview (default: previous year)")
    args = parser.parse_args()

    ran = False
    if args.monthly is not False:
        run_monthly(args.monthly)
        ran = True
    if args.quarterly is not False:
        run_quarterly(args.quarterly)
        ran = True
    if args.annual is not False:
        run_annual(args.annual)
        ran = True

    if not ran:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
