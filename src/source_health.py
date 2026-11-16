"""Per-source freshness alarm — the missing loop behind four incidents.

A crawl run can be green while an individual source silently dies:
greateastern yielded nothing for two months (2026-05..07, /about-us/
URL-filter kill), aia_hk and mas_media went quiet for 3+ months, and
nobody noticed until a manual audit. Workflow-level failure alerts can
never catch this class — the job succeeds.

Design:
- Threshold is auto-calibrated per source: median gap between distinct
  output dates over the trailing window, times 3, clamped to [3, 45]
  days. A daily wire alarms after ~3 quiet days; a 1-2 release/month
  newsroom only after ~45. No hand-maintained per-source config.
- Alerts fire on STATE TRANSITIONS only (ok -> overdue, overdue -> ok),
  tracked in data/source-health.json, so a dead source pings once, not
  every crawl.
- Alerts go to the ops-inbox (src/ops_inbox.py, env OPS_INBOX_TOKEN);
  without the token the report still prints to stdout and the
  non-delivery is logged.

Run: python -m src.source_health [--dry-run]
"""

import json
import logging
import os
import sys
from datetime import date, timedelta
from pathlib import Path
from statistics import median

from src.ops_inbox import send_event

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent
INDEX_PATH = ROOT / "index" / "master-index.json"
STATE_PATH = ROOT / "data" / "source-health.json"

LOOKBACK_DAYS = 120
# Floor of 5: daily wires naturally pause 1-2 days (weekends, holidays);
# alarming on those would train everyone to ignore the channel.
MIN_THRESHOLD_DAYS = 5
MAX_THRESHOLD_DAYS = 45
# Sources with too little history to calibrate get the max threshold.
MIN_DATES_FOR_CALIBRATION = 3


def _load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def _threshold_days(output_dates: list[date]) -> int:
    """3x the median gap between distinct output dates, clamped."""
    if len(output_dates) < MIN_DATES_FOR_CALIBRATION:
        return MAX_THRESHOLD_DAYS
    ordered = sorted(set(output_dates))
    gaps = [
        (b - a).days for a, b in zip(ordered, ordered[1:]) if (b - a).days > 0
    ]
    if not gaps:
        return MAX_THRESHOLD_DAYS
    return max(MIN_THRESHOLD_DAYS, min(MAX_THRESHOLD_DAYS, 3 * round(median(gaps))))


def check_source_health(today: date | None = None) -> dict:
    """Compute per-source freshness status against calibrated thresholds.

    Returns {source_id: {last, threshold, overdue_days, status}}.
    """
    from src.sources import SOURCES

    today = today or date.today()
    cutoff = (today - timedelta(days=LOOKBACK_DAYS)).isoformat()

    from src.index_manager import load_index
    index = load_index()
    dates_by_source: dict[str, list[date]] = {}
    for a in index:
        d = (a.get("date") or "")[:10]
        if d < cutoff or len(d) != 10:
            continue
        try:
            parsed = date.fromisoformat(d)
        except ValueError:
            continue
        dates_by_source.setdefault(a.get("source", ""), []).append(parsed)

    report: dict[str, dict] = {}
    for src in SOURCES:
        sid = src["id"]
        dates = dates_by_source.get(sid, [])
        if not dates:
            # No output inside the lookback at all — overdue by definition.
            report[sid] = {
                "last": "none-in-window",
                "threshold": MAX_THRESHOLD_DAYS,
                "overdue_days": LOOKBACK_DAYS,
                "status": "overdue",
            }
            continue
        last = max(dates)
        threshold = _threshold_days(dates)
        silent = (today - last).days
        report[sid] = {
            "last": last.isoformat(),
            "threshold": threshold,
            "overdue_days": max(0, silent - threshold),
            "status": "overdue" if silent > threshold else "ok",
        }
    return report


def main() -> None:
    dry_run = "--dry-run" in sys.argv
    report = check_source_health()
    prev_state = _load_json(STATE_PATH, {})

    newly_overdue = []
    recovered = []
    for sid, info in report.items():
        prev = prev_state.get(sid, {}).get("status", "ok")
        if info["status"] == "overdue" and prev != "overdue":
            newly_overdue.append((sid, info))
        elif info["status"] == "ok" and prev == "overdue":
            recovered.append((sid, info))

    overdue_total = [s for s, i in report.items() if i["status"] == "overdue"]
    print(
        f"source health: {len(report)} sources, "
        f"{len(overdue_total)} overdue "
        f"({len(newly_overdue)} new, {len(recovered)} recovered)"
    )
    for sid, info in sorted(report.items()):
        if info["status"] == "overdue":
            print(
                f"  OVERDUE {sid}: last={info['last']} "
                f"threshold={info['threshold']}d overdue+{info['overdue_days']}d"
            )

    if not dry_run and (newly_overdue or recovered):
        lines = ["[Insurance KB] 資訊源健康告警"]
        if newly_overdue:
            lines.append("新逾期（該源可能默死）：")
            for sid, info in newly_overdue:
                lines.append(
                    f"  - {sid}：最後產出 {info['last']}，"
                    f"門檻 {info['threshold']} 天"
                )
        if recovered:
            lines.append("已復活：")
            for sid, info in recovered:
                lines.append(f"  - {sid}：{info['last']} 恢復產出")
        sent = send_event("資訊源健康告警", "\n".join(lines), "warn")
        print(f"ops-inbox alert: {'sent' if sent else 'NOT delivered (see log)'}")

    if not dry_run:
        STATE_PATH.write_text(
            json.dumps(
                {sid: {"status": i["status"], "last": i["last"]}
                 for sid, i in report.items()},
                ensure_ascii=False, indent=1,
            ),
            encoding="utf-8",
        )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main()
