"""Synchronize the verified current Agent snapshot into its D1 query index."""
from __future__ import annotations

import json
import os
import sys
import time
from email.utils import parsedate_to_datetime
from pathlib import Path

import requests


class SyncStopped(RuntimeError):
    """Retrying cannot repair this failure; preserve the plan for recovery."""


def retry_delay(response, attempt: int) -> float:
    value = getattr(response, "headers", {}).get("Retry-After")
    if value:
        try:
            delay = float(value)
        except ValueError:
            try:
                delay = parsedate_to_datetime(value).timestamp() - time.time()
            except (ValueError, TypeError, OverflowError):
                delay = 2 ** attempt
        # Do not ignore a long server cooldown and retry sooner.
        if delay > 60:
            raise SyncStopped("D1 sync rate limited; preserve the plan and retry after the server cooldown")
        return max(0, delay)
    return 2 ** attempt


def sync(plan_path: Path, endpoint: str, token: str) -> dict:
    plan = json.loads(plan_path.read_text())
    last_error = None
    for attempt in range(3):
        response = None
        try:
            response = requests.post(
                endpoint,
                json=plan,
                headers={"Authorization": f"Bearer {token}"},
                timeout=60,
            )
            # 2026-09-12 quota incident: all failures were retried, including
            # daily quota exhaustion and snapshot conflicts. Neither is transient.
            body = getattr(response, "text", "").lower()
            status = getattr(response, "status_code", 200)
            if "d1_quota_exceeded" in body or "free tier daily row" in body:
                raise SyncStopped("D1_QUOTA_EXCEEDED: sync stopped; preserve the plan until the daily reset")
            if 400 <= status < 500 and status not in (408, 429):
                raise SyncStopped(f"D1 sync stopped at HTTP {status}; preserve the plan for recovery")
            response.raise_for_status()
            result = response.json()
            if (not isinstance(result, dict)
                    or result.get("snapshot_id") != plan["to_snapshot_id"]
                    or result.get("total_records") != plan["total_records"]):
                raise SyncStopped("D1 sync verification differs from requested snapshot")
            return result
        except (requests.RequestException, ValueError) as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(retry_delay(response, attempt))
    raise RuntimeError(f"D1 Agent index sync failed after 3 attempts: {last_error}")


def main() -> None:
    path = os.environ.get("AGENT_INDEX_SYNC_PLAN")
    token = os.environ.get("AGENT_INDEX_SYNC_TOKEN")
    endpoint = os.environ.get(
        "AGENT_INDEX_SYNC_URL",
        "https://insurance-kb-api.alan-chen75.workers.dev/internal/agent-index/sync",
    )
    if not path or not token:
        raise RuntimeError("AGENT_INDEX_SYNC_PLAN and AGENT_INDEX_SYNC_TOKEN are required")
    result = sync(Path(path), endpoint, token)
    print(json.dumps({"snapshot_id": result["snapshot_id"],
                      "total_records": result["total_records"]}))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise
