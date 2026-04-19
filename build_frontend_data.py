#!/usr/bin/env python3
"""Build slim articles.json for frontend (Cloudflare Pages 25MB limit).

Removes empty fields and truncates summaries to keep file size under 25MB.
"""

import json
from pathlib import Path

INDEX_PATH = Path(__file__).resolve().parent / "index" / "master-index.json"
OUT_PATH = Path(__file__).resolve().parent / "frontend" / "public" / "data" / "articles.json"


def build():
    idx = json.loads(INDEX_PATH.read_text(encoding="utf-8"))

    slim = []
    for a in idx:
        entry = {
            "uid": a["uid"],
            "title": a.get("title", ""),
            "date": a.get("date", ""),
            "source": a.get("source", ""),
            "source_url": a.get("source_url", ""),
            "category": a.get("category", ""),
            "region": a.get("region", ""),
            "importance": a.get("importance", ""),
            "summary": a.get("summary", "")[:200],
            "filter": a.get("filter", ""),
        }
        if a.get("title_en"):
            entry["title_en"] = a["title_en"]
        slim.append(entry)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    out = json.dumps(slim, ensure_ascii=False, separators=(",", ":"))
    OUT_PATH.write_text(out, encoding="utf-8")

    size_mb = OUT_PATH.stat().st_size / 1024 / 1024
    visible = sum(1 for a in slim if not a.get("filter"))
    print(f"articles.json: {size_mb:.1f} MB, {len(slim)} total, {visible} visible")


if __name__ == "__main__":
    build()
