#!/usr/bin/env python3
"""Parse compiled/*.md wiki files into frontend/public/data/wiki.json."""

import json
import re
import sys
from pathlib import Path

COMPILED_DIR = Path(__file__).resolve().parent / "compiled" / "monthly"
OUT_PATH = Path(__file__).resolve().parent / "frontend" / "public" / "data" / "wiki.json"

# Map filename category slug → frontend category id
CAT_MAP = {
    "market": "market",
    "regulation": "regulation",
    "technology": "tech",
    "products": "product",
    "reinsurance": "reinsurance",
    "esg": "esg",
    "consumer": "consumer",
    "talent": "people",
    "marketing": "marketing",
}

CAT_ZH = {
    "market": "市場趨勢",
    "regulation": "監管動態",
    "tech": "科技應用",
    "product": "產品創新",
    "reinsurance": "再保市場",
    "esg": "ESG永續",
    "consumer": "消費者保護",
    "people": "人才與組織",
    "marketing": "行銷推廣",
}

REGION_MAP = {
    "asia-pacific": "亞太",
    "global": "全球",
    "china": "中國",
    "hongkong": "香港",
    "japan": "日本",
    "korea": "韓國",
    "singapore": "新加坡",
    "taiwan": "台灣",
    "us": "美國",
    "europe": "歐洲",
}


def parse_frontmatter(text):
    """Extract YAML frontmatter and return (meta, body)."""
    if not text.startswith("---"):
        return {}, text
    end = text.index("---", 3)
    fm_text = text[3:end].strip()
    body = text[end + 3:].strip()
    meta = {}
    for line in fm_text.split("\n"):
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    return meta, body


def parse_section(body: str, header: str) -> str:
    """Extract content under a ##/###/#### header (models drift on level)."""
    pattern = rf"#{{2,4}}\s*{re.escape(header)}\s*\n(.*?)(?=\n#{{2,4}}\s|\Z)"
    m = re.search(pattern, body, re.DOTALL)
    return m.group(1).strip() if m else ""


# LLM output drifts across model generations (2026-08-02: Gemini pages
# use "*" bullets and nested "**07-24**：" date headings; gpt-4.1 used
# flat "- 2026-07-24：event"). Parse both — a heading-format change must
# never silently empty the frontend again.
_BULLET_RE = re.compile(r"^(?:[-*]|\d+\.)\s+")
_TIMELINE_DATE_RE = re.compile(
    r"^\**\s*(?:(\d{4})-)?(\d{2})-(\d{2})\**\s*[：:]?\s*(.*)$"
)


def parse_highlights(text):
    """Parse bullet list ('-', '*', or numbered) into strings."""
    items = []
    for line in text.split("\n"):
        line = line.strip()
        m = _BULLET_RE.match(line)
        if m:
            items.append(line[m.end():].strip())
    return items


def parse_timeline(text, period=""):
    """Parse timeline entries — flat or nested under date headings.

    Flat:   '- 2026-04-07：Event description'
    Nested: '- **07-24**：' followed by indented '- event' sub-bullets
    (MM-DD dates get the year from the page's period).
    """
    default_year = period.split("-")[0] if period else ""
    entries = []
    current_date = ""
    for raw in text.split("\n"):
        line = raw.strip()
        m = _BULLET_RE.match(line)
        if not m:
            continue
        rest = line[m.end():].strip()
        dm = _TIMELINE_DATE_RE.match(rest)
        if dm:
            year = dm.group(1) or default_year
            current_date = (
                f"{year}-{dm.group(2)}-{dm.group(3)}" if year
                else f"{dm.group(2)}-{dm.group(3)}"
            )
            event = dm.group(4).strip()
            if event:
                entries.append({"date": current_date, "event": event})
        else:
            entries.append({"date": current_date, "event": rest})
    return entries


def parse_wiki_file(path: Path):
    """Parse a single wiki markdown file."""
    text = path.read_text(encoding="utf-8")
    meta, body = parse_frontmatter(text)

    # Extract category and region from filename: e.g. "market-japan.md"
    stem = path.stem  # "market-japan"
    parts = stem.split("-", 1)
    if len(parts) != 2:
        return None

    file_cat, file_region = parts[0], parts[1]
    cat_id = CAT_MAP.get(file_cat)
    region_zh = REGION_MAP.get(file_region)
    if not cat_id or not region_zh:
        return None

    highlights_raw = parse_section(body, "本月重點")
    timeline_raw = parse_section(body, "時間線")
    analysis = parse_section(body, "趨勢分析")
    cross_topic = parse_section(body, "跨主題關聯")

    return {
        "id": f"{cat_id}-{file_region}",
        "category": cat_id,
        "category_zh": CAT_ZH.get(cat_id, ""),
        "region": region_zh,
        "period": meta.get("period", ""),
        "articles_count": int(meta.get("articles_count", "0")),
        "compiled_at": meta.get("compiled_at", ""),
        "model": meta.get("model", ""),
        "highlights": parse_highlights(highlights_raw),
        "timeline": parse_timeline(timeline_raw, meta.get("period", "")),
        "analysis": analysis,
        "cross_topic": cross_topic,
    }


def build_wiki_json():
    """Build wiki.json from all compiled monthly wiki files."""
    period_dirs = sorted(COMPILED_DIR.iterdir()) if COMPILED_DIR.exists() else []
    if not period_dirs:
        print("No compiled directories found")
        return

    # Collect pages from ALL periods (latest version wins for same id)
    all_pages = {}
    periods = []
    for period_dir in period_dirs:
        if not period_dir.is_dir():
            continue
        periods.append(period_dir.name)
        print(f"Scanning period: {period_dir.name}")
        for md_file in sorted(period_dir.glob("*.md")):
            page = parse_wiki_file(md_file)
            if page:
                # Use period-prefixed id for uniqueness
                page_id = f"{period_dir.name}/{page['id']}"
                page["id"] = page_id
                all_pages[page_id] = page
                print(f"  Parsed: {md_file.name} → {page_id}")

    pages = list(all_pages.values())
    print(f"\nTotal pages: {len(pages)} across {len(periods)} periods")

    # Build tree: group by period → category → regions
    tree = []
    for period in sorted(periods, reverse=True):
        period_pages = [p for p in pages if p["period"] == period]
        cats = {}
        for p in period_pages:
            cat = p["category"]
            if cat not in cats:
                cats[cat] = {
                    "id": f"{period}/{cat}",
                    "zh": f"{p['category_zh']}",
                    "period": period,
                    "regions": [],
                }
            cats[cat]["regions"].append({
                "id": p["id"],
                "zh": p["region"],
            })
        tree.extend(cats.values())

    output = {
        "periods": periods,
        "tree": tree,
        "pages": {p["id"]: p for p in pages},
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(output, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\nWrote {len(pages)} wiki pages to {OUT_PATH}")


if __name__ == "__main__":
    build_wiki_json()
