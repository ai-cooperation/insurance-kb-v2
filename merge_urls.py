#!/usr/bin/env python3
"""Merge resolved URLs from old index into current (reclassified) index.

Usage: python3 merge_urls.py old_index.json
Reads old_index.json for resolved URLs, applies them to current index/master-index.json.
"""

import json
import sys
from pathlib import Path

INDEX_PATH = Path(__file__).resolve().parent / "index" / "master-index.json"


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 merge_urls.py <old_index_with_resolved_urls.json>")
        sys.exit(1)

    old_path = Path(sys.argv[1])
    old_idx = json.loads(old_path.read_text(encoding="utf-8"))
    cur_idx = json.loads(INDEX_PATH.read_text(encoding="utf-8"))

    # Build UID → resolved URL mapping from old index
    url_map = {}
    for a in old_idx:
        url = a.get("source_url", "")
        if url and "news.google.com" not in url:
            url_map[a["uid"]] = url

    # Apply to current index
    updated = 0
    for a in cur_idx:
        if a["uid"] in url_map and "news.google.com" in a.get("source_url", ""):
            a["source_url"] = url_map[a["uid"]]
            updated += 1

    print(f"Updated {updated} URLs in current index")

    INDEX_PATH.write_text(
        json.dumps(cur_idx, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print("Saved")


if __name__ == "__main__":
    main()
