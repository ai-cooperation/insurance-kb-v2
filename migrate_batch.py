#!/usr/bin/env python3
"""Batch migration helper. Usage:
  python3 migrate_batch.py show <batch_num>     # Show batch for Claude to classify
  python3 migrate_batch.py apply <batch_num>    # Apply Claude's classification from /tmp/batch_result.json
  python3 migrate_batch.py status               # Show progress
  python3 migrate_batch.py finalize             # Merge all results into v2 index
"""

import json
import re
import sys
from collections import Counter
from pathlib import Path

WORK = Path("/tmp/v1-migrate.json")
RESULTS_DIR = Path("/tmp/migrate-results")
RESULTS_DIR.mkdir(exist_ok=True)
V2_INDEX = Path(__file__).resolve().parent / "index" / "master-index.json"
BATCH_SIZE = 100

SOURCE_MAP = {
    "GNews: 亞洲保險產業": "gnews_insurance_asia",
    "GNews: 全球保險產業": "gnews_insurance_global",
    "GNews: InsurTech": "gnews_insurtech",
    "GNews: 新加坡保險公司 (1)": "gnews_sg_companies_1",
    "GNews: 新加坡保險公司 (2)": "gnews_sg_companies_2",
    "GNews: 香港保險公司 (1)": "gnews_hk_companies_1",
    "GNews: 香港保險公司 (2)": "gnews_hk_companies_2",
    "GNews: 香港保監局": "gnews_hk_regulator",
    "GNews: 香港保險 (中文)": "gnews_hk_zh",
    "GNews: 中國保險公司 (1)": "gnews_cn_companies_1",
    "GNews: 中國保險公司 (2)": "gnews_cn_companies_2",
    "GNews: 中國保險產業": "gnews_cn_industry",
    "GNews: 日本保險公司 (日文)": "gnews_jp_companies_ja",
    "GNews: 日本保險公司 (2)": "gnews_jp_companies_2",
    "GNews: Japan Insurance (EN)": "gnews_jp_en",
    "GNews: 日本保險產業": "gnews_jp_industry",
    "GNews: 日本少額短期保険": "gnews_jp_mini",
    "GNews: 韓國保險公司 (1)": "gnews_kr_companies_1",
    "GNews: 韓國保險公司 (2)": "gnews_kr_companies_2",
    "GNews: Korea Insurance (EN)": "gnews_kr_en",
    "GNews: 韓國保險產業": "gnews_kr_industry",
    "GNews: 全球再保公司": "gnews_reinsurers",
    "GNews: 顧問公司保險洞察": "gnews_consultants",
    "GNews: 信評機構 (1)": "gnews_ratings_1",
    "GNews: 信評機構 (2)": "gnews_ratings_2",
    "GNews: WSJ 保險": "gnews_wsj_insurance",
    "GNews: Bloomberg 保險": "gnews_bloomberg_insurance",
    "GNews: NYT 保險": "gnews_nyt_insurance",
    "GNews: 新浪財金保險": "gnews_sina_insurance",
    "GNews: ESG 保險": "gnews_esg_insurance",
    "GNews: Hive Insurance": "gnews_hive_insurance",
    "GNews: 腦科學與保險": "gnews_neuroscience_insurance",
    "GNews: 台灣保險": "gnews_tw_insurance",
    "GNews: MAS 保險監管": "gnews_mas",
    "HKIA Press Releases": "hkia_rss",
    "Asia Insurance Review": "air_news",
    "LIA Singapore News": "lia_sg",
    "Great Eastern Life": "greateastern",
    "AIA Hong Kong": "aia_hk",
    "中國平安": "pingan",
    "Sompo Holdings": "sompo_hd",
    "Munich Re News": "munichre_news",
    "MAS Media Releases": "mas_media",
    "Swiss Re Media": "gnews_swissre",
    "LIAJ Japan News": "gnews_liaj",
}


def show(batch_num):
    articles = json.loads(WORK.read_text())
    start = batch_num * BATCH_SIZE
    batch = articles[start:start + BATCH_SIZE]
    if not batch:
        print("No more articles")
        return

    lines = []
    for i, a in enumerate(batch):
        idx = start + i
        title = a.get("title", "")[:100]
        src = a.get("source", "")[:25]
        lines.append(f"{idx}|{a['uid']}|{src}|{title}")
    print("\n".join(lines))


def apply_results(batch_num):
    result_file = Path(f"/tmp/batch_{batch_num:03d}.json")
    if not result_file.exists():
        print(f"Result file not found: {result_file}")
        return

    results = json.loads(result_file.read_text())
    out_file = RESULTS_DIR / f"batch_{batch_num:03d}.json"
    out_file.write_text(json.dumps(results, ensure_ascii=False))
    print(f"Saved {len(results)} results to {out_file}")


def status():
    articles = json.loads(WORK.read_text())
    total = len(articles)
    done_files = sorted(RESULTS_DIR.glob("batch_*.json"))
    done_count = 0
    stats = Counter()
    for f in done_files:
        results = json.loads(f.read_text())
        done_count += len(results)
        for r in results:
            if r.get("filter"):
                stats[r["filter"]] += 1
            else:
                stats[r.get("category", "?")] += 1

    print(f"Total: {total}")
    print(f"Done: {done_count} ({done_count*100//total}%)")
    print(f"Remaining: {total - done_count}")
    print(f"Batches done: {len(done_files)}/{ (total + BATCH_SIZE - 1) // BATCH_SIZE}")
    if stats:
        print("\nDistribution so far:")
        for k, v in stats.most_common():
            print(f"  {k}: {v}")


def finalize():
    articles = json.loads(WORK.read_text())
    v2 = json.loads(V2_INDEX.read_text())

    # Load all results
    result_map = {}
    for f in sorted(RESULTS_DIR.glob("batch_*.json")):
        for r in json.loads(f.read_text()):
            result_map[r["uid"]] = r

    print(f"Results loaded: {len(result_map)}")

    # Build migrated entries
    migrated = []
    skipped = 0
    for a in articles:
        uid = a["uid"]
        if uid not in result_map:
            skipped += 1
            continue

        r = result_map[uid]
        source_v2 = SOURCE_MAP.get(a.get("source", ""), a.get("source", ""))
        title = a.get("title", "")
        is_cjk = bool(re.search(r"[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]", title))

        entry = {
            "uid": uid,
            "title": title,
            "title_en": "" if is_cjk else title,
            "date": a.get("date", ""),
            "source": source_v2,
            "source_url": a.get("source_url", ""),
            "category": r.get("category", a.get("category", "市場趨勢")),
            "subcategory": a.get("subcategory", ""),
            "region": a.get("region", "全球"),
            "companies": a.get("companies", []),
            "keywords": a.get("keywords", []),
            "importance": r.get("importance", a.get("importance", "中")),
            "summary": a.get("summary", ""),
            "note_path": a.get("note_path", ""),
            "filter": r.get("filter", ""),
        }
        migrated.append(entry)

    # Merge
    merged = v2 + migrated
    merged.sort(key=lambda e: e.get("date", ""), reverse=True)

    visible = sum(1 for a in merged if not a.get("filter"))
    filtered = sum(1 for a in merged if a.get("filter"))
    cats = Counter(a.get("category", "") for a in merged if not a.get("filter"))

    print(f"Migrated: {len(migrated)}, Skipped: {skipped}")
    print(f"Merged total: {len(merged)}, Visible: {visible}, Filtered: {filtered}")
    print("\nCategory distribution (visible):")
    for cat, cnt in cats.most_common():
        print(f"  {cat}: {cnt} ({cnt*100/visible:.1f}%)")

    V2_INDEX.write_text(json.dumps(merged, ensure_ascii=False, indent=2))
    print(f"\nSaved to {V2_INDEX}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "show":
        show(int(sys.argv[2]))
    elif cmd == "apply":
        apply_results(int(sys.argv[2]))
    elif cmd == "status":
        status()
    elif cmd == "finalize":
        finalize()
