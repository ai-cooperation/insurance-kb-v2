"""Validate and apply a reviewed, one-time content repair ledger."""
from __future__ import annotations

import re

ALLOWED_FIELDS = {"uid", "title", "summary", "source_excerpt"}
_HAN = re.compile(r"[\u3400-\u9fff]")
_HANGUL = re.compile(r"[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]")
_KANA = re.compile(r"[\u3040-\u30ff\u31f0-\u31ff]")


class RepairError(ValueError):
    """The repair ledger would violate a data-preservation invariant."""


def _has_han(value: str) -> bool:
    return bool(_HAN.search(value))


def _has_source_cjk_script(value: str) -> bool:
    """Recognize Korean/Japanese snippets that may also contain Han text."""
    return bool(_HANGUL.search(value) or _KANA.search(value))


def apply_repairs(entries: list[dict], repairs: list[dict]) -> tuple[list[dict], int]:
    """Apply reviewed fields only; preserve originals and reject ambiguous edits.

    Titles may only change from their untranslated original, or be identical to
    a repair already applied. A blank summary requires a source excerpt in the
    same repair. Existing summaries are only replaceable when they contain no
    Han characters (i.e. an untranslated source-language summary); Korean and
    Japanese snippets may contain Han alongside Hangul or kana. An existing
    translated CJK summary is never silently overwritten. Source excerpts are
    immutable once present.
    """
    by_uid = {}
    for row in entries:
        uid = row.get("uid") if isinstance(row, dict) else None
        if not isinstance(uid, str) or not uid or uid in by_uid:
            raise RepairError(f"invalid or duplicate article uid: {uid!r}")
        by_uid[uid] = row

    seen = set()
    updated = [dict(row) for row in entries]
    updated_by_uid = {row["uid"]: row for row in updated}
    changed_fields = 0

    for repair in repairs:
        if not isinstance(repair, dict):
            raise RepairError("each repair must be an object")
        uid = repair.get("uid")
        if not isinstance(uid, str) or not uid or uid in seen:
            raise RepairError(f"invalid or duplicate repair uid: {uid!r}")
        seen.add(uid)
        unknown = set(repair) - ALLOWED_FIELDS
        if unknown:
            raise RepairError(f"unsupported fields for {uid}: {sorted(unknown)}")
        if uid not in updated_by_uid:
            raise RepairError(f"repair references unknown article uid: {uid}")
        row = updated_by_uid[uid]

        title = repair.get("title")
        if not isinstance(title, str) or not title.strip():
            raise RepairError(f"missing translated title for {uid}")
        if title != row.get("title"):
            source_title = row.get("title_en") or row.get("title", "")
            if row.get("title") != source_title:
                raise RepairError(f"refusing to overwrite an existing title for {uid}")
            if title == source_title:
                raise RepairError(f"repair does not translate the title for {uid}")
            row["title"] = title
            changed_fields += 1

        excerpt = repair.get("source_excerpt")
        if "source_excerpt" in repair:
            if not isinstance(excerpt, str) or not excerpt.strip():
                raise RepairError(f"empty source excerpt for {uid}")
            current_excerpt = row.get("source_excerpt") or ""
            if current_excerpt and current_excerpt != excerpt:
                raise RepairError(f"refusing to replace existing source excerpt for {uid}")
            if not current_excerpt:
                row["source_excerpt"] = excerpt
                changed_fields += 1

        if "summary" in repair:
            summary = repair["summary"]
            if not isinstance(summary, str) or not summary.strip():
                raise RepairError(f"empty repaired summary for {uid}")
            current_summary = row.get("summary") or ""
            if current_summary != summary:
                if (_has_han(current_summary)
                        and not _has_source_cjk_script(current_summary)):
                    raise RepairError(f"refusing to overwrite an existing CJK summary for {uid}")
                if not current_summary and not excerpt:
                    raise RepairError(f"blank summary requires a verified source excerpt for {uid}")
                if not _has_han(summary):
                    raise RepairError(f"repaired summary is not translated for {uid}")
                row["summary"] = summary
                changed_fields += 1

    return updated, changed_fields
