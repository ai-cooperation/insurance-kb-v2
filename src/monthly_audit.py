"""Monthly quality audit: run during distill to detect classification drift.

Checks:
1. Category-keyword cross-validation: flag articles whose keywords don't match category
2. Distribution anomaly: compare with expected range
3. Noise leak: articles that slipped through quality gate
4. Generate report and optionally notify via Telegram
"""

import json
import logging
import os
import re
from collections import Counter
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

INDEX_PATH = Path(__file__).resolve().parent.parent / "index" / "master-index.json"

# Category signature keywords — if an article has these, it SHOULD be in this category
_CATEGORY_SIGNATURES = {
    "監管動態": re.compile(
        r"regulation|regulatory|regulator|compliance|solvency|supervision|"
        r"penalty|fine|sanction|license|監管|法規|規管|金管會|保監|銀保監|"
        r"IFRS.17|RBC|C-ROSS|directive|guideline|circular",
        re.IGNORECASE,
    ),
    "科技應用": re.compile(
        r"insurtech|digital|AI|blockchain|cyber|fintech|automation|"
        r"machine.learning|cloud|API|platform|telematics|IoT|chatbot|"
        r"robo|parametric|科技|數位|数字|人工智能|區塊鏈|自動化|tokeniz",
        re.IGNORECASE,
    ),
    "再保市場": re.compile(
        r"reinsurance|reinsurer|retrocession|catastrophe|cat.bond|"
        r"ILS|sidecar|renewal|treaty|facultative|再保|巨災|天災|分保",
        re.IGNORECASE,
    ),
    "ESG永續": re.compile(
        r"ESG|sustainability|climate|green|carbon|TCFD|net.zero|"
        r"biodiversity|ISSB|永續|氣候|綠色|碳排|可持续|淨零",
        re.IGNORECASE,
    ),
    "消費者保護": re.compile(
        r"consumer|complaint|dispute|claims.handling|fraud|"
        r"policyholder|misselling|transparency|disclosure|"
        r"消費者|理賠|申訴|爭議|詐欺|mis-selling|保戶|騙保",
        re.IGNORECASE,
    ),
    "人才與組織": re.compile(
        r"talent|hiring|workforce|CEO|appoint|resign|leadership|"
        r"culture|diversity|training|人才|任命|人事|招聘|board|"
        r"executive|總經理|董事",
        re.IGNORECASE,
    ),
    "產品創新": re.compile(
        r"product|launch|coverage|rider|embedded.insurance|"
        r"microinsurance|usage-based|on-demand|產品|保單|保障|"
        r"附約|方案|嵌入式|微保險",
        re.IGNORECASE,
    ),
}

# Expected distribution ranges (min%, max%)
_EXPECTED_RANGE = {
    "市場趨勢": (20, 45),
    "監管動態": (10, 25),
    "科技應用": (8, 25),
    "消費者保護": (3, 15),
    "人才與組織": (3, 15),
    "再保市場": (3, 12),
    "產品創新": (3, 12),
    "ESG永續": (2, 10),
}


def _cross_validate(articles):
    """Find articles whose content strongly matches a different category."""
    mismatches = []
    for art in articles:
        if art.get("filter"):
            continue
        assigned = art.get("category", "")
        text = (
            art.get("title", "") + " " +
            art.get("title_en", "") + " " +
            art.get("summary", "")
        )
        # Check if content matches a DIFFERENT category's signature more strongly
        for cat, pattern in _CATEGORY_SIGNATURES.items():
            if cat == assigned:
                continue
            if pattern.search(text):
                # Content matches another category — potential misclassification
                # Only flag if assigned category's signature does NOT match
                assigned_pattern = _CATEGORY_SIGNATURES.get(assigned)
                if assigned_pattern and not assigned_pattern.search(text):
                    mismatches.append({
                        "uid": art.get("uid", ""),
                        "title": art.get("title", "")[:60],
                        "assigned": assigned,
                        "suggested": cat,
                    })
                    break  # Only flag first mismatch
    return mismatches


def run_monthly_audit(notify=True):
    """Run monthly quality audit and optionally send Telegram notification."""
    idx = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    visible = [a for a in idx if not a.get("filter")]
    total = len(visible)

    # 1. Distribution check
    cats = Counter(a.get("category", "") for a in visible)
    dist_warnings = []
    for cat, (lo, hi) in _EXPECTED_RANGE.items():
        pct = cats.get(cat, 0) * 100 / total if total > 0 else 0
        if pct < lo or pct > hi:
            dist_warnings.append(f"{cat}: {pct:.1f}% (expected {lo}-{hi}%)")

    # 2. Cross-validation (sample to avoid too much processing)
    import random
    random.seed(42)
    sample = random.sample(visible, min(500, len(visible)))
    mismatches = _cross_validate(sample)
    mismatch_rate = len(mismatches) * 100 / len(sample) if sample else 0

    # 3. Noise check
    filtered = len(idx) - total
    noise_pct = filtered * 100 / len(idx) if idx else 0

    # 4. URL quality
    gnews_urls = sum(1 for a in visible if "news.google.com" in a.get("source_url", ""))
    url_quality = (total - gnews_urls) * 100 / total if total else 0

    # Build report
    report_lines = [
        "📊 Insurance KB v2 Monthly Audit",
        f"Total: {len(idx)} | Visible: {total} | Filtered: {filtered} ({noise_pct:.0f}%)",
        "",
        "📂 Category Distribution:",
    ]
    for cat, cnt in cats.most_common():
        pct = cnt * 100 / total
        report_lines.append(f"  {cat}: {cnt} ({pct:.1f}%)")

    if dist_warnings:
        report_lines.append("")
        report_lines.append("⚠️ Distribution Anomalies:")
        for w in dist_warnings:
            report_lines.append(f"  {w}")

    report_lines.append("")
    report_lines.append(f"🔍 Cross-validation: {len(mismatches)}/{len(sample)} mismatches ({mismatch_rate:.1f}%)")
    if mismatches[:5]:
        for m in mismatches[:5]:
            report_lines.append(f"  {m['title']} [{m['assigned']}→{m['suggested']}]")

    report_lines.append(f"🔗 URL quality: {url_quality:.0f}% real URLs")

    # Overall score
    score = 100
    if dist_warnings:
        score -= len(dist_warnings) * 3
    score -= mismatch_rate * 0.5
    score -= (100 - url_quality) * 0.1
    score = max(0, min(100, score))
    report_lines.append(f"\n📈 Quality Score: {score:.0f}/100")

    report = "\n".join(report_lines)
    logger.info("\n%s", report)

    # Telegram notification
    if notify:
        _send_telegram(report)

    return {
        "score": score,
        "total": len(idx),
        "visible": total,
        "mismatches": len(mismatches),
        "mismatch_rate": mismatch_rate,
        "dist_warnings": dist_warnings,
        "report": report,
    }


def _send_telegram(message):
    """Send message to Telegram bot."""
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "8550440980")
    if not bot_token:
        logger.info("TELEGRAM_BOT_TOKEN not set, skipping notification")
        return
    try:
        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        resp = requests.post(url, json={
            "chat_id": chat_id,
            "text": message,
            "parse_mode": "HTML",
        }, timeout=10)
        if resp.ok:
            logger.info("Telegram notification sent")
        else:
            logger.warning("Telegram send failed: %s", resp.text[:100])
    except Exception as exc:
        logger.warning("Telegram error: %s", exc)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    import os
    should_notify = bool(os.environ.get("TELEGRAM_BOT_TOKEN"))
    run_monthly_audit(notify=should_notify)
