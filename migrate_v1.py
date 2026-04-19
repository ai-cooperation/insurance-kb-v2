#!/usr/bin/env python3
"""Migrate v1 articles into v2 master-index.json.

Does everything locally, no external API calls:
- Source name mapping (v1 → v2 format)
- Format conversion (add title_en, filter fields)
- Noise filtering (regex + insurance keyword check)
- Rule-based reclassification (v2 enhanced classifier)
- Dedup by UID
"""

import json
import re
import sys
from collections import Counter
from pathlib import Path

V1_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/v1-index.json")
V2_PATH = Path(__file__).resolve().parent / "index" / "master-index.json"

# ── Source name mapping ──────────────────────────────────────────────
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

# ── Noise patterns ───────────────────────────────────────────────────
NOISE_RE = re.compile(
    r"百年構想|J[123]リーグ|Jリーグ|SVリーグ|B\.?LEAGUE|"
    r"アントラーズ|レッズ|ガンバ|ホーリーホック|フロンターレ|"
    r"レイソル|グランパス|コンサドーレ|サンフレッチェ|"
    r"ヴィッセル|エスパルス|ベガルタ|アルビレックス|"
    r"ブレックス|ジェッツ|ブレイザーズ|サンバーズ|"
    r"vs\.\s*\S+\s*(第\d+節|試合)|ハイライト.*CHAMPIONSHIP|"
    r"サッカー.{0,10}(試合|結果|戦)|"
    r"バレーボール.{0,10}(試合|結果)|"
    r"역전승|꺾고.{0,5}(강|승)|4강\s*PO|플레이오프|"
    r"승\s*\d+패|電子競技|esports?.{0,5}(defeat|win|lose)|e스포츠",
    re.IGNORECASE,
)

# Insurance-specific sources (don't filter these for relevance)
INSURANCE_SOURCES = {
    "hkia_rss", "air_news", "lia_sg", "greateastern", "aia_hk",
    "pingan", "sompo_hd", "munichre_news", "mas_media",
}

# Noisy GNews sources that need insurance keyword check
NOISY_SOURCES = {
    "gnews_wsj_insurance", "gnews_nyt_insurance", "gnews_bloomberg_insurance",
    "gnews_consultants", "gnews_hive_insurance", "gnews_neuroscience_insurance",
}

INSURANCE_RE = re.compile(
    r"insurance|insurer|insured|underwriting|reinsurance|"
    r"保險|保险|premium|policy|claim|actuary|broker|annuity|"
    r"壽險|產險|再保|理賠|保費|保單|承保|保障|投保|"
    r"보험|생명|손해|손보|保険|生命|損保|損害|"
    r"insurtech|insur|assurance|solvency|policyholder|"
    r"ESG|sustainability|climate|氣候|永續|"
    r"fintech|cyber|blockchain|digital|AI|"
    r"Munich Re|Swiss Re|Hannover|SCOR|"
    r"AIA|Prudential|Manulife|Great Eastern|Tokio Marine|"
    r"Sompo|Nippon Life|Samsung Life|Hanwha|Kyobo|"
    r"平安|人壽|人寿|人保|太平洋|太保|大東方|國壽|"
    r"AM Best|Fitch|Moody|KBRA|S&P|"
    r"MAS|HKIA|IRDAI|金管會|保監|銀保監|"
    r"pension|年金|退休|annuit|"
    r"risk|風險|catastrophe|巨災|cat bond",
    re.IGNORECASE,
)

# ── Enhanced rule-based classifier ───────────────────────────────────
CATEGORY_RULES = {
    "監管動態": re.compile(
        r"regulation|regulatory|regulator|compliance|solvency|supervision|"
        r"penalty|fine|sanction|license|licence|law|act\b|rule|"
        r"監管|法規|規管|MAS|HKIA|FSA|IRDAI|監理|"
        r"金管會|保監局|銀保監|C-ROSS|IFRS.17|RBC|"
        r"directive|guideline|circular|amendment|"
        r"禁止|吊銷|撤銷|處罰|罰款|違規",
        re.IGNORECASE,
    ),
    "科技應用": re.compile(
        r"insurtech|digital|(?<!\w)AI(?!\w)|blockchain|cyber|fintech|"
        r"automation|machine.learning|cloud|API|platform|"
        r"telematics|IoT|chatbot|robo|parametric|"
        r"科技|數位|数字|人工智能|區塊鏈|自動化|"
        r"tokeniz|big.data|analytics|GPT|LLM",
        re.IGNORECASE,
    ),
    "產品創新": re.compile(
        r"product|launch|coverage|rider|embedded.insurance|"
        r"microinsurance|usage-based|on-demand|new.plan|"
        r"產品|保單|保障|附約|方案|嵌入式|微保險|"
        r"推出|上市|新險種",
        re.IGNORECASE,
    ),
    "再保市場": re.compile(
        r"reinsurance|reinsurer|retrocession|catastrophe|cat.bond|"
        r"ILS|sidecar|renewal|treaty|facultative|"
        r"再保|巨災|天災|分保|catastroph",
        re.IGNORECASE,
    ),
    "ESG永續": re.compile(
        r"ESG|sustainability|climate|green|carbon|TCFD|"
        r"net.zero|biodiversity|ISSB|"
        r"永續|氣候|綠色|碳排|可持续|淨零",
        re.IGNORECASE,
    ),
    "消費者保護": re.compile(
        r"consumer|complaint|dispute|claims?.handling|fraud|"
        r"policyholder|misselling|transparency|disclosure|"
        r"消費者|理賠|申訴|爭議|詐欺|mis-selling|保戶|騙保",
        re.IGNORECASE,
    ),
    "人才與組織": re.compile(
        r"talent|hiring|workforce|CEO|appoint|resign|"
        r"leadership|culture|diversity|training|"
        r"人才|任命|人事|招聘|board|executive|總經理|董事",
        re.IGNORECASE,
    ),
}


def classify(title, summary=""):
    """Enhanced rule-based classification."""
    text = title + " " + summary
    scores = {}
    for cat, pattern in CATEGORY_RULES.items():
        matches = pattern.findall(text)
        if matches:
            scores[cat] = len(matches)
    if scores:
        return max(scores, key=scores.get)
    return "市場趨勢"


def is_chinese(text):
    """Check if text contains Chinese characters."""
    return bool(re.search(r"[\u4e00-\u9fff]", text))


def migrate():
    v1 = json.loads(V1_PATH.read_text(encoding="utf-8"))
    v2 = json.loads(V2_PATH.read_text(encoding="utf-8"))

    v2_uids = {a["uid"] for a in v2}
    v1_only = [a for a in v1 if a["uid"] not in v2_uids]

    print(f"v1 total: {len(v1)}, v2 total: {len(v2)}, to migrate: {len(v1_only)}")

    migrated = []
    stats = Counter()

    for art in v1_only:
        title = art.get("title", "")
        summary = art.get("summary", "")
        source_v1 = art.get("source", "")
        source_v2 = SOURCE_MAP.get(source_v1, source_v1)

        # 1. Skip empty
        if not title or len(title) < 5:
            stats["skip_empty"] += 1
            continue

        # 2. Sports noise filter
        if NOISE_RE.search(title):
            stats["filter_sports"] += 1
            filter_reason = "noise_sports"
        # 3. Noisy source + no insurance keyword
        elif source_v2 in NOISY_SOURCES:
            text = title + " " + summary
            if not INSURANCE_RE.search(text):
                stats["filter_unrelated"] += 1
                filter_reason = "noise_unrelated"
            else:
                filter_reason = ""
        else:
            filter_reason = ""

        # 4. Determine title_en vs title (Chinese)
        if is_chinese(title):
            title_zh = title
            title_en = ""
        else:
            title_zh = title  # v1 may have already translated
            title_en = title

        # 5. Reclassify with enhanced rules
        new_category = classify(title, summary)
        old_category = art.get("category", "市場趨勢")
        # Fix non-standard v1 categories
        if old_category in ("產業趨勢", "社會責任", "風險管理"):
            old_category = new_category

        # Use new classification if old was default
        if old_category == "市場趨勢" and new_category != "市場趨勢":
            category = new_category
            stats["reclassified"] += 1
        else:
            category = old_category

        # 6. Build v2 entry
        entry = {
            "uid": art["uid"],
            "title": title_zh,
            "title_en": title_en,
            "date": art.get("date", ""),
            "source": source_v2,
            "source_url": art.get("source_url", ""),
            "category": category,
            "subcategory": art.get("subcategory", ""),
            "region": art.get("region", "全球"),
            "companies": art.get("companies", []),
            "keywords": art.get("keywords", []),
            "importance": art.get("importance", "中"),
            "summary": summary,
            "note_path": art.get("note_path", ""),
            "filter": filter_reason,
        }
        migrated.append(entry)

        if not filter_reason:
            stats["clean"] += 1

    # Merge into v2
    merged = v2 + migrated
    merged.sort(key=lambda e: e.get("date", ""), reverse=True)

    # Stats
    total_visible = sum(1 for a in merged if not a.get("filter"))
    total_filtered = sum(1 for a in merged if a.get("filter"))
    cats = Counter(a.get("category", "") for a in merged if not a.get("filter"))

    print(f"\n=== Migration Result ===")
    print(f"Migrated: {len(migrated)}")
    print(f"  Clean: {stats['clean']}")
    print(f"  Filtered (sports): {stats['filter_sports']}")
    print(f"  Filtered (unrelated): {stats['filter_unrelated']}")
    print(f"  Skipped (empty): {stats['skip_empty']}")
    print(f"  Reclassified: {stats['reclassified']}")
    print(f"\n=== Merged Index ===")
    print(f"Total: {len(merged)}, Visible: {total_visible}, Filtered: {total_filtered}")
    print(f"\n=== Category Distribution (visible) ===")
    for cat, cnt in cats.most_common():
        pct = cnt * 100 / total_visible
        print(f"  {cat}: {cnt} ({pct:.1f}%)")

    # Save
    V2_PATH.write_text(
        json.dumps(merged, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\nSaved to {V2_PATH}")


if __name__ == "__main__":
    migrate()
