#!/usr/bin/env python3
"""
Seed import — V1 + V2 marketing research reports → D1 + R2.

Mode C (per user 2026-05-06):
  - 2 main reports (V1 full-report.md + V2 full-report-v2.md)
  - 26 chapter attachments (V1 ch01-ch20 + V2 ch01-ch06)
  - Main reports get a "## 章節附件" section appended with /reports/{id} links
  - Skip V1 prep docs (00-research-plan, 01-source-inventory, etc.)

Output: writes SQL + R2 commands to /tmp/seed-{sql,r2.sh}, prints next-step
commands. Caller runs them.
"""
from __future__ import annotations

import json
import re
import secrets
import sys
import time
from pathlib import Path

ROOT = Path("/Users/user/projects/insurance-kb-v2/reference/reports-seed/保險行銷策略研究 2026")
V1_DIR = ROOT / "V1-完整研究報告"
V2_DIR = ROOT / "V2-飛輪策略報告"

ALAN_UID = "OcgDedo0Avc3d73oOezhsNlSxKv1"
ALAN_NAME = "陳重光 (seed import)"
ALAN_EMAIL = "alan.chen75@gmail.com"

# Chapter → company / region mapping for V1
V1_CHAPTER_META: dict[str, dict] = {
    "ch01-research-overview":            {"title": "研究總覽",                      "region": "ASIA", "category": "綜述"},
    "ch02-market-overview":              {"title": "亞洲保險市場概況",              "region": "ASIA", "category": "市場觀察"},
    "ch03-cathay-life":                  {"title": "國泰人壽 — 案例分析",            "region": "TW",   "category": "競品案例"},
    "ch04-fubon-life":                   {"title": "富邦人壽 — 案例分析",            "region": "TW",   "category": "競品案例"},
    "ch05-shinkon-life":                 {"title": "新光人壽 — 案例分析",            "region": "TW",   "category": "競品案例"},
    "ch06-taiwan-life":                  {"title": "台灣人壽 — 案例分析",            "region": "TW",   "category": "競品案例"},
    "ch07-daiichi-life":                 {"title": "第一生命（日本）— 案例分析",    "region": "JP",   "category": "競品案例"},
    "ch08-sompo":                        {"title": "SOMPO（日本）— 案例分析",       "region": "JP",   "category": "競品案例"},
    "ch09-aia":                          {"title": "AIA 友邦（香港）— 案例分析",     "region": "HK",   "category": "競品案例"},
    "ch10-fwd":                          {"title": "FWD 富衛（香港）— 案例分析",     "region": "HK",   "category": "競品案例"},
    "ch11-prudential":                   {"title": "保誠 Prudential（香港）— 案例分析", "region": "HK", "category": "競品案例"},
    "ch12-org-rd-comparison":            {"title": "組織與研發比較",                "region": "ASIA", "category": "比較分析"},
    "ch13-customer-journey-comparison":  {"title": "客戶旅程比較",                  "region": "ASIA", "category": "比較分析"},
    "ch14-health-ecosystem-comparison":  {"title": "健康生態圈比較",                "region": "ASIA", "category": "比較分析"},
    "ch15-channel-comparison":           {"title": "通路比較",                      "region": "ASIA", "category": "比較分析"},
    "ch16-marketing-calendar-comparison":{"title": "行銷行事曆比較",                "region": "ASIA", "category": "比較分析"},
    "ch17-rd-loop-comparison":           {"title": "研發迴路比較",                  "region": "ASIA", "category": "比較分析"},
    "ch18-credit-rating-analysis":       {"title": "信用評等分析",                  "region": "ASIA", "category": "財務分析"},
    "ch19-ipo-case-studies":             {"title": "IPO 案例研究",                  "region": "ASIA", "category": "財務分析"},
    "ch20-strategic-implications":       {"title": "策略含義與建議",                "region": "ASIA", "category": "策略建議"},
}

V2_CHAPTER_META: dict[str, dict] = {
    "ch01-flywheel-model":               {"title": "飛輪模型 — 行銷策略框架",         "region": "ASIA", "category": "策略框架"},
    "ch02-five-cases":                   {"title": "五個飛輪案例",                  "region": "ASIA", "category": "競品案例"},
    "ch03-marketing-drives-rd":          {"title": "行銷驅動研發",                  "region": "ASIA", "category": "策略分析"},
    "ch04-health-ecosystem-as-product":  {"title": "健康生態圈作為產品",            "region": "ASIA", "category": "商品策略"},
    "ch05-marketing-spins-flywheel":     {"title": "行銷如何驅動飛輪轉動",          "region": "ASIA", "category": "策略分析"},
    "ch06-action-plan":                  {"title": "行動計畫與落地建議",            "region": "ASIA", "category": "策略建議"},
}

def gen_id() -> str:
    today = time.strftime("%Y-%m-%d")
    return f"rpt_{today}_{secrets.token_hex(4)}"

def count_words(md: str) -> int:
    stripped = re.sub(r"```[\s\S]*?```", "", md)
    stripped = re.sub(r"[#*_>`\[\]()]", "", stripped)
    return len(stripped)

def sql_quote(s: str | None) -> str:
    if s is None:
        return "NULL"
    return "'" + s.replace("'", "''") + "'"

def main():
    reports: list[dict] = []
    r2_commands: list[str] = []
    now = int(time.time())

    # === V1 chapters ===
    v1_chapters: list[dict] = []
    for slug, meta in V1_CHAPTER_META.items():
        f = V1_DIR / f"{slug}.md"
        if not f.exists():
            print(f"WARN: {f} not found, skipping", file=sys.stderr)
            continue
        content = f.read_text(encoding="utf-8")
        rid = gen_id()
        title = f"V1 ch{slug.split('-')[0][2:].zfill(2)} {meta['title']}"  # e.g. "V1 ch11 保誠 Prudential — 案例分析"
        # actually simpler:
        ch_num = re.match(r"ch(\d+)", slug).group(1)
        title = f"V1 第 {ch_num} 章 — {meta['title']}"
        report = {
            "id": rid,
            "title": title,
            "tags": json.dumps(["V1", "保險行銷研究2026", meta["category"], meta["region"]], ensure_ascii=False),
            "region": meta["region"],
            "category": meta["category"],
            "summary": meta["title"] + " — V1 完整研究報告分章節",
            "content": content,
            "word_count": count_words(content),
            "parent": "V1",
        }
        reports.append(report)
        v1_chapters.append(report)
        r2_commands.append((rid, content))

    # === V2 chapters ===
    v2_chapters: list[dict] = []
    for slug, meta in V2_CHAPTER_META.items():
        f = V2_DIR / f"{slug}.md"
        if not f.exists():
            print(f"WARN: {f} not found, skipping", file=sys.stderr)
            continue
        content = f.read_text(encoding="utf-8")
        rid = gen_id()
        ch_num = re.match(r"ch(\d+)", slug).group(1)
        title = f"V2 第 {ch_num} 章 — {meta['title']}"
        report = {
            "id": rid,
            "title": title,
            "tags": json.dumps(["V2", "飛輪策略報告", meta["category"], meta["region"]], ensure_ascii=False),
            "region": meta["region"],
            "category": meta["category"],
            "summary": meta["title"] + " — V2 飛輪策略報告分章節",
            "content": content,
            "word_count": count_words(content),
            "parent": "V2",
        }
        reports.append(report)
        v2_chapters.append(report)
        r2_commands.append((rid, content))

    # === V1 main report ===
    v1_full = (V1_DIR / "full-report.md").read_text(encoding="utf-8")
    v1_main_id = gen_id()
    v1_appendix = ["\n\n---\n\n## 章節附件（單獨索引版）\n"]
    for ch in v1_chapters:
        v1_appendix.append(f"- [{ch['title']}](/reports/{ch['id']})")
    v1_main_content = v1_full + "\n".join(v1_appendix)
    reports.append({
        "id": v1_main_id,
        "title": "V1 — 亞洲主要保險公司行銷策略研究（完整版）",
        "tags": json.dumps(["V1", "保險行銷研究2026", "完整報告", "亞洲市場"], ensure_ascii=False),
        "region": "ASIA",
        "category": "完整研究報告",
        "summary": "9 家亞洲保險公司（台灣 4 + 日本 2 + 香港 3）行銷策略深度研究，含組織、研發、健康生態、通路、行銷行事曆比較。原為一上市保險公司同業對標研究。",
        "content": v1_main_content,
        "word_count": count_words(v1_main_content),
        "parent": None,
    })
    r2_commands.append((v1_main_id, v1_main_content))

    # === V2 main report ===
    v2_full = (V2_DIR / "full-report-v2.md").read_text(encoding="utf-8")
    v2_main_id = gen_id()
    v2_appendix = ["\n\n---\n\n## 章節附件（單獨索引版）\n"]
    for ch in v2_chapters:
        v2_appendix.append(f"- [{ch['title']}](/reports/{ch['id']})")
    v2_main_content = v2_full + "\n".join(v2_appendix)
    reports.append({
        "id": v2_main_id,
        "title": "V2 — 飛輪策略報告（V1 精簡升級版）",
        "tags": json.dumps(["V2", "飛輪策略報告", "完整報告", "策略框架"], ensure_ascii=False),
        "region": "ASIA",
        "category": "完整研究報告",
        "summary": "從 V1 完整研究萃取出的「行銷飛輪」策略框架。聚焦：行銷如何驅動研發、健康生態圈作為產品、五個飛輪案例、行動計畫。約 V1 的 1/3 篇幅，給高階主管讀。",
        "content": v2_main_content,
        "word_count": count_words(v2_main_content),
        "parent": None,
    })
    r2_commands.append((v2_main_id, v2_main_content))

    # === Generate SQL ===
    sql_lines = ["-- Seed import generated " + time.strftime("%Y-%m-%d %H:%M:%S"), ""]
    for r in reports:
        sql_lines.append(
            f"INSERT INTO reports (id, title, author_uid, author_name, author_email, "
            f"tags, status, source_session_id, region, category, summary, "
            f"word_count, finding_count, view_count, created_at, updated_at, r2_path) "
            f"VALUES ({sql_quote(r['id'])}, {sql_quote(r['title'])}, {sql_quote(ALAN_UID)}, "
            f"{sql_quote(ALAN_NAME)}, {sql_quote(ALAN_EMAIL)}, "
            f"{sql_quote(r['tags'])}, 'published', NULL, "
            f"{sql_quote(r['region'])}, {sql_quote(r['category'])}, {sql_quote(r['summary'])}, "
            f"{r['word_count']}, 0, 0, {now}, {now}, "
            f"{sql_quote('reports/' + r['id'] + '.md')});"
        )
        diff_summary = f"seed import ({r['word_count']} chars)"
        sql_lines.append(
            f"INSERT INTO reports_audit (report_id, action, actor_uid, actor_email, diff_summary, created_at) "
            f"VALUES ({sql_quote(r['id'])}, 'create', {sql_quote(ALAN_UID)}, {sql_quote(ALAN_EMAIL)}, "
            f"{sql_quote(diff_summary)}, {now});"
        )
    sql_path = Path("/tmp/seed-reports.sql")
    sql_path.write_text("\n".join(sql_lines) + "\n", encoding="utf-8")

    # === Generate R2 put commands (write content to temp files first) ===
    r2_dir = Path("/tmp/seed-r2-content")
    r2_dir.mkdir(exist_ok=True)
    bash_lines = ["#!/usr/bin/env bash", "set -e", "cd /Users/user/projects/insurance-kb-v2/workers", ""]
    for rid, content in r2_commands:
        cf = r2_dir / f"{rid}.md"
        cf.write_text(content, encoding="utf-8")
        bash_lines.append(
            f'echo "→ R2 put {rid}.md ({len(content)} bytes)"\n'
            f'npx wrangler r2 object put insurance-kb-reports/reports/{rid}.md '
            f'--file="{cf}" --content-type="text/markdown; charset=utf-8" --remote'
        )
    bash_lines.append("\necho '✅ All R2 uploads done'")
    bash_path = Path("/tmp/seed-r2-upload.sh")
    bash_path.write_text("\n".join(bash_lines) + "\n", encoding="utf-8")
    bash_path.chmod(0o755)

    print(f"\n✅ Generated {len(reports)} reports ({len(v1_chapters)} V1 ch + {len(v2_chapters)} V2 ch + 2 main)")
    print(f"   SQL:  {sql_path}  ({sql_path.stat().st_size} bytes, {len(reports)*2} statements)")
    print(f"   R2:   {bash_path}  ({len(r2_commands)} uploads)")
    print(f"\nNext steps:")
    print(f"  cd workers && npx wrangler d1 execute insurance-kb-reports --remote --file={sql_path}")
    print(f"  bash {bash_path}")

if __name__ == "__main__":
    main()
