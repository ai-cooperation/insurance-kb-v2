"""Synchronize the verified current Agent snapshot into its D1 query index."""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import requests


def sync(plan_path: Path, endpoint: str, token: str) -> dict:
    plan = json.loads(plan_path.read_text())
    last_error = None
    for attempt in range(3):
        try:
            response = requests.post(
                endpoint,
                json=plan,
                headers={"Authorization": f"Bearer {token}"},
                timeout=60,
            )
            response.raise_for_status()
            result = response.json()
            if (result.get("snapshot_id") != plan["to_snapshot_id"]
                    or result.get("total_records") != plan["total_records"]):
                raise RuntimeError("D1 sync verification differs from requested snapshot")
            return result
        except (requests.RequestException, ValueError, RuntimeError) as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(2 ** attempt)
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
