"""Two synthetic translations through real Cloud fallback; no article/D1 writes."""
import argparse
import json
import logging
import os
import re
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import requests

from src import classifier
from src.vertex_translation import VertexTranslationClient


def validate(client):
    calls = []
    original = client.create

    def recorded(**kwargs):
        result = original(**kwargs)
        calls.append({"model": result.model, "http_status": 200, "usage": vars(result.usage)})
        return result

    def unavailable(**kwargs):
        response = requests.Response()
        response.status_code = 429
        raise requests.HTTPError("Synthetic primary 429; no external primary request", response=response)

    primary = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=unavailable)))
    # Synthetic facts are deliberately not production articles or source URLs.
    articles = [{"uid": "synthetic-en", "title": "Synthetic insurance report: claims fell 12 percent",
                 "snippet": "Synthetic for testing only. An insurer reported that claims fell 12 percent."},
                {"uid": "synthetic-ja", "title": "架空の保険会社が台北に支店を開設",
                 "snippet": "Synthetic for testing only. A fictional insurer opened a branch in Taipei."}]
    slots = [("synthetic-primary/model", primary, "model"), (f"vertex/{client.model}", client, client.model)]
    with patch.object(classifier, "_build_cascade", return_value=slots), patch.object(client, "create", side_effect=recorded):
        rows = classifier.classify_llm_batch(articles, batch_size=1, delay=0)
    checks = {
        "two_cloud_calls": len(calls) == 2,
        "both_titles_chinese": all(re.search(r"[\u3400-\u9fff]", r.get("title_zh", "")) for r in rows),
        "both_summaries_chinese": all(re.search(r"[\u3400-\u9fff]", r.get("summary_zh", "")) for r in rows),
        "both_completed": all(r["_translation_state"] == {"title": "completed", "summary": "completed"} for r in rows),
        "quantity_preserved": bool(re.search(r"12|百分之十二", rows[0].get("title_zh", "") + rows[0].get("summary_zh", ""))),
        "location_preserved": "台北" in rows[1].get("title_zh", "") + rows[1].get("summary_zh", ""),
        "no_unstated_context": not any(term in " ".join(r.get("summary_zh", "") for r in rows)
                                      for term in ("跨國業務", "市場佈局", "監管審批")),
        "synthetic_title_preserved": any(term in rows[0].get("title_zh", "")
                                         for term in ("合成", "模擬", "虛構", "測試")),
        "fictional_insurer_preserved": any(term in rows[1].get("title_zh", "")
                                           for term in ("虛構", "假想", "架空", "模擬", "虛擬")),
    }
    return {"synthetic_input": True, "project": client.project, "checks": checks,
            "cloud_calls": calls, "translations": rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    client = VertexTranslationClient(project=os.environ.get("VERTEX_PROJECT_ID", ""),
        model=os.environ.get("VERTEX_MODEL") or "gemini-3.5-flash-lite")
    report = validate(client)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "translations"}, ensure_ascii=False))
    if not all(report["checks"].values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
