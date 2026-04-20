#!/usr/bin/env python3
"""Upload visible articles to Workers KV for search/chat RAG."""

import json
import subprocess
import sys
from pathlib import Path

INDEX_PATH = Path(__file__).resolve().parent / "index" / "master-index.json"
KV_NAMESPACE_ID = "d57f70351eb94f7c8b13d338f0f811ad"


def main():
    idx = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    visible = [a for a in idx if not a.get("filter")]

    slim = [
        {
            "title": a.get("title", "")[:150],
            "date": a.get("date", ""),
            "source": a.get("source", ""),
            "source_url": a.get("source_url", ""),
            "summary": a.get("summary", "")[:200],
            "category": a.get("category", ""),
            "region": a.get("region", ""),
        }
        for a in visible
    ]

    tmp = Path("/tmp/kv-articles.json")
    tmp.write_text(json.dumps(slim, ensure_ascii=False), encoding="utf-8")

    size_mb = tmp.stat().st_size / 1024 / 1024
    print(f"KV upload: {len(slim)} articles, {size_mb:.1f} MB")

    result = subprocess.run(
        [
            "npx", "wrangler", "kv", "key", "put",
            "articles:index", "--path", str(tmp),
            "--namespace-id", KV_NAMESPACE_ID,
        ],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        print("KV upload success")
    else:
        print(f"KV upload failed: {result.stderr[:200]}")
        sys.exit(1)


if __name__ == "__main__":
    main()
