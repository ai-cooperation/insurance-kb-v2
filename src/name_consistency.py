"""Entity-name consistency detector — alert when the LLM freestyles a name.

Every proper-noun incident so far (라이나생명 → 萊茵/賴納/麗娜, アフラック
→ 友利/安聯/美國友邦/大都會, Great Eastern → 宏利) was discovered late:
by a user's failed search, a manual sweep, or luck during review. This
module closes the loop: after each crawl, articles whose ORIGINAL title
(title_en) names a watchlisted company but whose translation lacks every
accepted canonical token get flagged to Telegram in the same run.

Alert-only by design — the wrong rendering is often another company's
genuine name (宏利 = real Manulife elsewhere), so repairs stay manual:
add a conditional rule to fix_company_names.py, run it (idempotent),
push. The watchlist lives in classifier.py (_ENTITY_WATCHLIST) next to
the canonical tables it mirrors.

Run standalone for a full-index scan: python -m src.name_consistency [days]
"""

import json
import logging
import os
import re
import sys
from pathlib import Path

import requests

from src.classifier import _ENTITY_WATCHLIST

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent
INDEX_PATH = ROOT / "index" / "master-index.json"

_HANGUL = re.compile(r"[가-힯]")
_COMPILED = [(re.compile(pat), tokens) for pat, tokens in _ENTITY_WATCHLIST]


def check_articles(articles: list[dict]) -> list[dict]:
    """Return violations: watchlisted company in title_en, no accepted
    zh token in title+summary. Untranslated articles are skipped (they
    are a translation-failure problem, not a naming one)."""
    violations = []
    for a in articles:
        if a.get("filter"):
            continue  # already hidden from users (irrelevant / sports / dup)
        title = a.get("title") or a.get("title_zh") or ""
        title_en = a.get("title_en") or ""
        if not title or not title_en:
            continue
        if title == title_en or _HANGUL.search(title):
            continue  # untranslated — out of scope here
        haystack = title + (a.get("summary") or a.get("summary_zh") or "")
        for rx, tokens in _COMPILED:
            if not rx.search(title_en):
                continue
            if any(t in haystack for t in tokens):
                continue
            violations.append({
                "uid": a.get("uid", "?"),
                "source": a.get("source", a.get("source_id", "?")),
                "date": a.get("date", ""),
                "expected": " / ".join(tokens),
                "title_en": title_en[:80],
                "title": title[:60],
            })
            break  # one alert per article is enough
    return violations


def _send_telegram(message: str) -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "")
    topic_id = os.environ.get("TELEGRAM_TOPIC_ID", "")
    if not token or not chat_id:
        return False
    payload = {"chat_id": chat_id, "text": message}
    if topic_id:
        payload["message_thread_id"] = topic_id
    try:
        resp = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            data=payload,
            timeout=15,
        )
        return resp.ok
    except requests.RequestException as exc:
        logger.warning("Telegram send failed: %s", exc)
        return False


def notify_violations(violations: list[dict]) -> None:
    """Log violations and push a Telegram alert (best-effort)."""
    lines = ["[Insurance KB] 譯名一致性告警 — LLM 可能把公司譯成別的名字"]
    for v in violations[:10]:
        lines.append(
            f"- {v['uid']} ({v['source']} {v['date']}) 應含「{v['expected']}」\n"
            f"  原文: {v['title_en']}\n  譯文: {v['title']}"
        )
    if len(violations) > 10:
        lines.append(f"…共 {len(violations)} 筆")
    lines.append("處理：加規則到 fix_company_names.py 後重跑（冪等）")
    msg = "\n".join(lines)
    for v in violations:
        logger.warning("NAME DRIFT %s: %s -> %s", v["uid"], v["title_en"], v["title"])
    sent = _send_telegram(msg)
    logger.info("name-consistency alert: %s", "sent" if sent else "no TG creds")


def main() -> None:
    days = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 30
    from datetime import date, timedelta
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    recent = [a for a in index if (a.get("date") or "") >= cutoff]
    violations = check_articles(recent)
    print(f"scanned {len(recent)} articles (last {days}d): {len(violations)} violations")
    for v in violations:
        print(f"  {v['uid']} | {v['source']} | expect {v['expected']}")
        print(f"     en: {v['title_en']}")
        print(f"     zh: {v['title']}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main()
