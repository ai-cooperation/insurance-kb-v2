"""Send an operational event to the ops-inbox (GitHub Issues).

Replaces the per-module Telegram senders (2026-11-16). One event = one
issue in ai-cooperation/ops-inbox; a repeat of the same title while the
issue is still open appends a comment instead of opening a new one, so
keep titles STABLE (no dates / counts — those go in the body).

Contract: https://github.com/ai-cooperation/ops-inbox#readme
Env: OPS_INBOX_TOKEN (fine-grained PAT, Issues read/write on that repo).
Stdlib only, never raises — an alert must not kill the pipeline — but it
never fails silently either: every non-delivery is logged at WARNING and
reported through the False return value.
"""

import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request

logger = logging.getLogger(__name__)

REPO = "ai-cooperation/ops-inbox"
SOURCE = "insurance-kb-v2"
MENTION = "AlanChen75"
SEVERITIES = ("critical", "warn", "info")
_API = "https://api.github.com"
_TIMEOUT = 20
_MAX_BODY = 60000


def _api(token: str, method: str, path: str, payload=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        f"{_API}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "insurance-kb-v2-ops-inbox",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8") or "null")


def send_event(title: str, body: str, severity: str = "warn") -> bool:
    """Open (or comment on) the ops-inbox issue for this event.

    Returns True only when GitHub accepted the write.
    """
    if severity not in SEVERITIES or not title.strip():
        logger.warning("ops-inbox: invalid event (severity=%r title=%r)", severity, title)
        return False
    token = os.environ.get("OPS_INBOX_TOKEN", "")
    if not token:
        logger.warning("ops-inbox: OPS_INBOX_TOKEN not set — event NOT delivered: %s", title)
        return False
    body = (body or "").strip()[:_MAX_BODY]
    try:
        query = urllib.parse.urlencode(
            {"state": "open", "labels": f"src:{SOURCE}", "per_page": 100}
        )
        open_issues = _api(token, "GET", f"/repos/{REPO}/issues?{query}") or []
        existing = next(
            (i["number"] for i in open_issues
             if "pull_request" not in i and i.get("title") == title),
            None,
        )
        if existing is not None:
            _api(token, "POST", f"/repos/{REPO}/issues/{existing}/comments",
                 {"body": f"再次發生（{severity}）\n\n{body}"})
            logger.info("ops-inbox: commented #%s (%s)", existing, title)
            return True
        mention = f"@{MENTION} " if severity == "critical" else ""
        created = _api(token, "POST", f"/repos/{REPO}/issues", {
            "title": title[:250],
            "body": f"{mention}{body}",
            "labels": [f"sev:{severity}", f"src:{SOURCE}"],
        })
        logger.info("ops-inbox: created #%s (%s)", created.get("number"), title)
        return True
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:200]
        logger.warning("ops-inbox: HTTP %s — event NOT delivered: %s (%s)", exc.code, title, detail)
    except (urllib.error.URLError, OSError, ValueError, KeyError) as exc:
        logger.warning("ops-inbox: send failed — event NOT delivered: %s (%s)", title, exc)
    return False
