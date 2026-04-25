#!/usr/bin/env python3
"""Build slim articles.json for frontend (Cloudflare Pages 25MB limit).

Removes empty fields and truncates summaries to keep file size under 25MB.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from src.classifier import _normalize_kr_names, _detect_kr_sports  # noqa: E402

INDEX_PATH = ROOT / "index" / "master-index.json"
OUT_PATH = ROOT / "frontend" / "public" / "data" / "articles.json"


def build():
    idx = json.loads(INDEX_PATH.read_text(encoding="utf-8"))

    slim = []
    for a in idx:
        # Final-line post-processing: enforce KR naming + catch sports leaks
        # that bypassed the LLM-time post-processing (e.g. legacy entries
        # added before A+B+C was deployed).
        title = _normalize_kr_names(a.get("title", "") or "")
        summary = _normalize_kr_names(a.get("summary", "") or "")
        filter_reason = a.get("filter", "") or ""
        if not filter_reason and _detect_kr_sports(title, a.get("title_en", "") or ""):
            filter_reason = "noise_sports"

        entry = {
            "uid": a["uid"],
            "title": title,
            "date": a.get("date", ""),
            "source": a.get("source", ""),
            "source_url": a.get("source_url", ""),
            "category": a.get("category", ""),
            "region": a.get("region", ""),
            "importance": a.get("importance", ""),
            "summary": summary[:200],
            "filter": filter_reason,
        }
        if a.get("title_en"):
            entry["title_en"] = a["title_en"]
        slim.append(entry)

    # L2 dedup: same source + same title → keep newest only
    # (URL-hash UID dedup at crawl time misses periodic re-publishes from the
    # same source where the URL contains a date/article-id but the content is
    # identical — e.g. hkia "呼籲留意欺詐網站" reposted x39 across two years.)
    before = len(slim)
    seen = {}
    for i, a in enumerate(slim):
        title = a.get("title", "")
        if not title:
            seen[("__notitle__", i)] = i  # entries without title kept as-is
            continue
        key = (a.get("source", ""), title)
        cur = seen.get(key)
        if cur is None or a.get("date", "") > slim[cur].get("date", ""):
            seen[key] = i
    keep = set(seen.values())
    slim = [a for i, a in enumerate(slim) if i in keep]
    removed = before - len(slim)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    out = json.dumps(slim, ensure_ascii=False, separators=(",", ":"))
    OUT_PATH.write_text(out, encoding="utf-8")

    size_mb = OUT_PATH.stat().st_size / 1024 / 1024
    visible = sum(1 for a in slim if not a.get("filter"))
    print(f"articles.json: {size_mb:.1f} MB, {len(slim)} total ({removed} L2 deduped), {visible} visible")


if __name__ == "__main__":
    build()
