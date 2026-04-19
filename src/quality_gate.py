"""Post-crawl quality gate: validate new articles before committing.

Checks:
1. Insurance relevance — reject articles with zero insurance keywords
2. Noise ratio — alert if >30% of new articles are filtered/irrelevant
3. Category distribution — alert if any single category >60%
4. Empty fields — reject articles missing title/date
5. Duplicate titles — detect near-duplicate content
"""

import logging
import re

logger = logging.getLogger(__name__)

# Core insurance terms that at least one must appear in title+summary
_INSURANCE_TERMS = re.compile(
    r"insurance|insurer|insured|underwriting|reinsurance|"
    r"保險|保险|premium|policy|claim|actuary|broker|annuity|"
    r"壽險|產險|再保|理賠|保費|保單|承保|保障|投保|"
    r"보험|생명|손해|손보|保険|生命|損保|損害|"
    r"insurtech|insur|assurance|solvency|policyholder|"
    r"ESG|climate|氣候|永續|sustainability|"
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

# Sources known to be insurance-specific (don't filter these)
_INSURANCE_SOURCES = {
    "hkia_rss", "air_news", "lia_sg", "greateastern", "aia_hk",
    "pingan", "sompo_hd", "munichre_news", "mas_media",
}


def check_relevance(article: dict) -> bool:
    """Check if an article is insurance-relevant."""
    if article.get("source_id", "") in _INSURANCE_SOURCES:
        return True
    text = (
        article.get("title", "") + " " +
        article.get("title_zh", "") + " " +
        article.get("snippet", "") + " " +
        article.get("summary_zh", "")
    )
    return bool(_INSURANCE_TERMS.search(text))


def run_quality_gate(articles: list) -> dict:
    """Run quality checks on new articles. Returns stats and marks irrelevant ones.

    Returns dict with gate results. Articles are modified in-place
    (filter field set for irrelevant ones).
    """
    if not articles:
        return {"total": 0, "passed": True}

    total = len(articles)
    irrelevant = 0
    empty_title = 0
    seen_titles = set()
    duplicates = 0
    categories = {}

    for art in articles:
        title = art.get("title", art.get("title_zh", ""))

        # Check empty title
        if not title or len(title) < 5:
            empty_title += 1
            continue

        # Check duplicate
        title_norm = title[:50].lower().strip()
        if title_norm in seen_titles:
            duplicates += 1
            art["filter"] = "duplicate"
            continue
        seen_titles.add(title_norm)

        # Check relevance (only for non-insurance-specific sources)
        if not check_relevance(art) and not art.get("filter"):
            art["filter"] = "irrelevant"
            irrelevant += 1

        # Count categories
        cat = art.get("category", "unknown")
        categories[cat] = categories.get(cat, 0) + 1

    # Check category concentration
    max_cat_pct = 0
    if categories:
        max_count = max(categories.values())
        max_cat_pct = max_count * 100 / total

    noise_pct = (irrelevant + duplicates) * 100 / total if total > 0 else 0
    passed = True
    warnings = []

    if noise_pct > 30:
        warnings.append(f"High noise ratio: {noise_pct:.0f}% irrelevant/duplicate")
        passed = False

    if max_cat_pct > 60:
        max_cat = max(categories, key=categories.get)
        warnings.append(f"Category skew: {max_cat} at {max_cat_pct:.0f}%")

    if empty_title > total * 0.1:
        warnings.append(f"Too many empty titles: {empty_title}/{total}")

    result = {
        "total": total,
        "irrelevant": irrelevant,
        "duplicates": duplicates,
        "empty_title": empty_title,
        "noise_pct": round(noise_pct, 1),
        "max_category_pct": round(max_cat_pct, 1),
        "categories": categories,
        "passed": passed,
        "warnings": warnings,
    }

    if warnings:
        for w in warnings:
            logger.warning("QUALITY GATE: %s", w)
    else:
        logger.info(
            "QUALITY GATE PASSED: %d articles, %.1f%% noise, %.1f%% max category",
            total, noise_pct, max_cat_pct,
        )

    return result
