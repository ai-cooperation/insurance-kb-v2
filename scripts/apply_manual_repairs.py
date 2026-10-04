#!/usr/bin/env python3
"""Validate a reviewed content-repair ledger; persist only with --apply."""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.index_manager import load_index, save_index
from src.manual_repairs import RepairError, apply_repairs


DEFAULT_LEDGER = ROOT / "repairs" / "manual-content-repairs-2026-10-04.jsonl"


def read_ledger(path: Path) -> list[dict]:
    repairs = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            repairs.append(json.loads(line))
        except json.JSONDecodeError as exc:
            raise RepairError(f"invalid JSON at {path}:{line_number}: {exc}") from exc
    return repairs


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", type=Path, default=DEFAULT_LEDGER)
    parser.add_argument("--apply", action="store_true", help="persist validated repairs to the monthly index")
    args = parser.parse_args()

    repairs = read_ledger(args.ledger)
    entries = load_index()
    updated, changed_fields = apply_repairs(entries, repairs)
    if changed_fields and args.apply:
        save_index(
            updated,
            reason="manual source-checked content repair 2026-10-04",
            actor="codex-manual-repair",
        )
        print(f"Applied {len(repairs)} reviewed article repairs ({changed_fields} fields changed).")
    elif changed_fields:
        print(f"Validated {len(repairs)} reviewed article repairs ({changed_fields} fields would change); no data written.")
    else:
        print(f"All {len(repairs)} reviewed article repairs are already applied; no data written.")


if __name__ == "__main__":
    main()
