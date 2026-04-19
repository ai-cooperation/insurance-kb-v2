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
    """Extract content under a ### header."""
    pattern = rf"###\s*{re.escape(header)}\s*\n(.*?)(?=\n###\s|\Z)"
    m = re.search(pattern, body, re.DOTALL)
    return m.group(1).strip() if m else ""


def parse_highlights(text):
    """Parse bullet list into strings."""
    items = []
    for line in text.split("\n"):
        line = line.strip()
        if line.startswith("- "):
            items.append(line[2:].strip())
    return items


def parse_timeline(text):
    """Parse timeline entries like '- 2026-04-07：Event description'."""
    entries = []
    for line in text.split("\n"):
        line = line.strip()
        if not line.startswith("- "):
            continue
        rest = line[2:].strip()
        # Try to extract date
        m = re.match(r"(\d{4}-\d{2}-\d{2})[：:]\s*(.*)", rest)
        if m:
            entries.append({"date": m.group(1), "event": m.group(2)})
        else:
            entries.append({"date": "", "event": rest})
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
        "timeline": parse_timeline(timeline_raw),
        "analysis": analysis,
        "cross_topic": cross_topic,
    }


def build_wiki_json():
    """Build wiki.json from all compiled monthly wiki files."""
    # Find the latest period directory
    period_dirs = sorted(COMPILED_DIR.iterdir()) if COMPILED_DIR.exists() else []
    if not period_dirs:
        print("No compiled directories found")
        return

    latest = period_dirs[-1]
    print(f"Using period: {latest.name}")

    pages = []
    for md_file in sorted(latest.glob("*.md")):
        page = parse_wiki_file(md_file)
        if page:
            pages.append(page)
            print(f"  Parsed: {md_file.name} → {page['id']}")
        else:
            print(f"  Skipped: {md_file.name}")

    # Build tree structure: group by category
    tree: dict[str, dict] = {}
    for p in pages:
        cat = p["category"]
        if cat not in tree:
            tree[cat] = {
                "id": cat,
                "zh": p["category_zh"],
                "regions": [],
            }
        tree[cat]["regions"].append({
            "id": p["id"],
            "zh": p["region"],
        })

    output = {
        "period": latest.name,
        "tree": list(tree.values()),
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
