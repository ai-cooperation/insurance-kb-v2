"""LLM calls for knowledge distillation, provider-aware (OpenAI SDK).

2026-07-31: GitHub Models is retiring (scheduled brownouts already broke
the crawl translation pipeline for 3 days). Groq promoted to primary
here too — the monthly distill fires 8/1 and would have crashed on the
dying endpoint. GitHub kept as secondary until final shutdown.
"""

from __future__ import annotations

import os
from typing import Any

import openai

# Distillation wants quality long-form zh output (low volume). kimi-k2
# is a non-reasoning heavyweight with strong Chinese prose; gpt-oss-120b
# last among Groq slots because its reasoning eats the output budget.
DISTILL_PROVIDERS = [
    # Gemini free tier first (2026-08-01, user decision): distill is
    # ~81 calls/month with very long prompts — low request count, huge
    # context, exactly the Gemini free quota shape. Groq free tier
    # can't serve it (413 per-request caps on qwen/gpt-oss; llama TPD
    # eaten by daily translation). Uses Gemini's OpenAI-compat endpoint,
    # model IDs filtered by runtime discovery like every provider.
    ("gemini", "https://generativelanguage.googleapis.com/v1beta/openai/",
     ("GEMINI_API_KEY",), [
        # From the live catalog (2026-08-01): 2.x generation is gated for
        # new keys (404/zero-quota). "-latest" aliases are Google's own
        # anti-rot mechanism — they track the current generation, so this
        # list should never rot again. Explicit IDs as belt-and-braces.
        "gemini-flash-latest",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3.1-flash-lite",
    ]),
    ("groq", "https://api.groq.com/openai/v1", ("GROQ_API_KEY",), [
        # Verified against live API 2026-08-01: kimi-k2 / qwen3-32b 404.
        # Maverick first for distill: strongest long-form of the
        # available non-reasoning Groq models, separate daily quota from
        # the crawl translator's llama-3.3.
        # Live-verified IDs. qwen3.6 first for distill: strongest zh
        # long-form on the current catalog, separate quota from the
        # crawl translator's llama-3.3.
        "qwen/qwen3.6-27b",
        "llama-3.3-70b-versatile",
        "openai/gpt-oss-120b",
    ]),
    ("github-models", "https://models.inference.ai.azure.com",
     ("MODELS_PAT", "GITHUB_TOKEN"), [
        "gpt-4.1",
        "gpt-4o",
        "DeepSeek-V3-0324",
        "Llama-3.3-70B-Instruct",
    ]),
]


# Updated by _call_with_cascade on each successful call; consumed by
# distill.py for the wiki frontmatter `model:` line. (Replaced the old
# static MODEL constant — under a cascade the actual model varies.)
LAST_MODEL_USED = "provider-cascade"


def _build_slots() -> list:
    """Flatten DISTILL_PROVIDERS into [(label, client, model), ...],
    filtered against each provider's live /models list (hardcoded IDs
    rot — see classifier._filter_available)."""
    from src.classifier import _filter_available

    slots = []
    for name, base_url, env_vars, models in DISTILL_PROVIDERS:
        key = next((os.environ[v] for v in env_vars if os.environ.get(v)), "")
        if not key:
            continue
        client = openai.OpenAI(base_url=base_url, api_key=key)
        for model in _filter_available(client, models, name):
            slots.append((f"{name}/{model}", client, model))
    if not slots:
        raise RuntimeError(
            "No distill provider available — set GROQ_API_KEY or MODELS_PAT"
        )
    return slots


def distill_monthly(
    articles: list[dict[str, Any]],
    category: str,
    region: str,
    period: str,
) -> str:
    """Generate a monthly wiki page from a set of articles.

    Args:
        articles: List of article dicts with title, date, source, source_url, summary.
        category: Category slug (e.g. "regulation").
        region: Region slug (e.g. "taiwan").
        period: YYYY-MM string.

    Returns:
        Markdown content for the monthly wiki.
    """
    shown = min(len(articles), MAX_ARTICLES_PER_PROMPT)
    article_block = _format_articles_for_prompt(articles)

    prompt = f"""你是保險產業知識庫的編輯。請根據以下 {shown} 篇文章（總共 {len(articles)} 篇），
撰寫 {period} 月份「{category}」主題、「{region}」地區的月度知識彙整。

## 文章資料
{article_block}

## 輸出格式（嚴格遵守）

### 本月重點
- 3-5 個重點摘要

### 時間線
按日期排列的重要事件

### 趨勢分析
分析本月趨勢走向、與上月對比

### 跨主題關聯
與其他主題或地區的關聯性分析

### 來源文章索引
| # | 日期 | 標題 | 來源 | 連結 |
|---|------|------|------|------|
（列出上方提供的文章，每篇都要有原始 URL）

### 知識缺口
本月可能遺漏或資料不足的面向

## 規則
1. 用繁體中文撰寫
2. 來源文章索引必須包含每一篇文章的原始 URL，不可省略
3. 不要編造文章中沒有的資訊
4. 保持專業客觀的語調"""

    return _call_with_cascade(
        system="你是保險產業知識庫編輯，專長將大量新聞文章整理成結構化月度報告。",
        user=prompt,
        max_tokens=8000,
        required_markers=MONTHLY_SECTIONS,
    )


def distill_quarterly(
    monthly_wikis: list[dict[str, str]],
    period: str,
) -> str:
    """Synthesize a quarterly overview from 3 monthly wikis.

    Args:
        monthly_wikis: List of dicts with 'month' and 'content' keys.
        period: YYYY-QN string (e.g. "2026-Q1").

    Returns:
        Markdown content for the quarterly overview.
    """
    wikis_block = "\n\n".join(
        f"## {w['month']} 月度報告\n{w['content']}" for w in monthly_wikis
    )

    prompt = f"""你是保險產業知識庫的總編輯。請根據以下 {len(monthly_wikis)} 個月的月度報告，
撰寫 {period} 季度綜合報告。

{wikis_block}

## 輸出格式

### 季度總覽
本季最重要的 5-7 個趨勢與事件

### 月度演進
各月重點如何串聯、演進

### 重大趨勢
跨月份的結構性趨勢

### 政策與監管變化
本季重要的監管動態彙整

### 市場數據摘要
重要數據點與統計

### 下季展望
基於本季趨勢的前瞻分析

### 知識缺口彙整
三個月累積的資料缺口

## 規則
1. 用繁體中文撰寫
2. 引用具體月份和來源
3. 不要編造資料"""

    return _call_with_cascade(
        system="你是保險產業知識庫總編輯，專長季度趨勢綜合分析。",
        user=prompt,
        max_tokens=8000,
        required_markers=["季度總覽", "重大趨勢", "下季展望"],
    )


def distill_annual(
    quarterly_wikis: list[dict[str, str]],
    year: str,
) -> str:
    """Synthesize an annual overview from 4 quarterly wikis.

    Args:
        quarterly_wikis: List of dicts with 'quarter' and 'content' keys.
        year: YYYY string.

    Returns:
        Markdown content for the annual overview.
    """
    wikis_block = "\n\n".join(
        f"## {w['quarter']} 季度報告\n{w['content']}" for w in quarterly_wikis
    )

    prompt = f"""你是保險產業知識庫的主編。請根據以下 {len(quarterly_wikis)} 個季度報告，
撰寫 {year} 年度綜合報告。

{wikis_block}

## 輸出格式

### 年度總覽
{year} 年保險產業最重要的 10 個趨勢與事件

### 季度演進脈絡
四個季度的主要發展如何串聯

### 結構性變化
年度層面的產業結構變化

### 監管政策總結
全年重要監管動態

### 科技與創新
全年重要科技應用與產品創新

### 市場格局變化
市場版圖、併購、新進者

### 年度關鍵數據
重要統計與指標

### 未來展望
基於全年趨勢的中長期展望

## 規則
1. 用繁體中文撰寫
2. 引用具體季度和來源
3. 不要編造資料
4. 保持宏觀視角"""

    return _call_with_cascade(
        system="你是保險產業知識庫主編，專長年度產業趨勢綜合分析與前瞻。",
        user=prompt,
        max_tokens=8000,
        required_markers=["年度總覽", "未來展望"],
    )


# 2026-08-02 audit finding: max_tokens=4000 systematically truncated wiki
# tails across ALL provider generations — gpt-4.1 (2026-05/06) lost the
# final 知識缺口 section on 62 pages; Gemini 3.x thinking models burned
# most of the budget on reasoning, leaving ~1,500-char bodies missing
# 3-5 sections (2026-07, 74/81 pages defective, zero alerts). Two fixes:
# max_tokens 8000, and a structure-invariant gate below (missing section
# = slot failure = rotate), so truncation can never again ship silently.


def _extra_body(label: str, model: str) -> dict | None:
    """Provider-specific request extras.

    Reasoning models spend completion tokens on thinking before any
    visible output — gpt-oss proved it 2026-07-31 (empty content), the
    Gemini 3.x flash family re-proved it 2026-08-01 (truncated wikis).
    Both providers accept reasoning_effort on the OpenAI-compat surface.
    """
    if label.startswith("gemini/") or "gpt-oss" in model:
        return {"reasoning_effort": "low"}
    return None


def _call_with_cascade(
    system: str,
    user: str,
    max_tokens: int = 8000,
    required_markers: list[str] | None = None,
) -> str:
    """Call LLM through the provider cascade.

    ANY per-slot failure advances to the next slot — API error, empty
    output, or (new) missing required section markers. If no slot
    produces a fully structured output, fall back to the best attempt
    (most markers matched, then longest) rather than failing the page:
    a wiki missing one section beats no wiki, and the gate log makes
    the degradation visible instead of silent.
    """
    import logging
    logger = logging.getLogger(__name__)
    global LAST_MODEL_USED

    best_text = ""
    best_label = ""
    best_score: tuple[int, int] = (-1, -1)
    last_exc: Exception | None = None
    for label, client, model in _build_slots():
        try:
            logger.info("Distill using %s", label)
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=0.3,
                max_tokens=max_tokens,
                extra_body=_extra_body(label, model),
            )
            text = (response.choices[0].message.content or "").strip()
            if not text:
                logger.warning("Empty output from %s, trying next slot", label)
                continue
            missing = [m for m in (required_markers or []) if m not in text]
            if not missing:
                LAST_MODEL_USED = label
                return text
            score = (len(required_markers) - len(missing), len(text))
            if score > best_score:
                best_score, best_text, best_label = score, text, label
            logger.warning(
                "Structure gate: %s output missing %s (%d chars) — trying next slot",
                label, missing, len(text),
            )
        except Exception as exc:  # noqa: BLE001 — rotate on any provider error
            logger.warning("Distill failed on %s: %s — trying next slot",
                           label, str(exc)[:400])
            last_exc = exc
    if best_text:
        logger.warning(
            "Structure gate: no slot passed fully; keeping best attempt from %s "
            "(%d/%d markers)", best_label, best_score[0], len(required_markers or []),
        )
        LAST_MODEL_USED = best_label
        return best_text
    raise RuntimeError(f"All distill cascade slots exhausted (last: {last_exc})")


MAX_ARTICLES_PER_PROMPT = 50

# Section headings the monthly prompt mandates; the cascade's structure
# gate asserts every one appears in the output (invariant, not example —
# see rules/common/pipeline-invariant-testing.md #1).
MONTHLY_SECTIONS = [
    "本月重點",
    "時間線",
    "趨勢分析",
    "跨主題關聯",
    "來源文章索引",
    "知識缺口",
]


def _format_articles_for_prompt(articles: list[dict[str, Any]]) -> str:
    """Format article list into a text block for LLM prompt.

    If more than MAX_ARTICLES_PER_PROMPT, prioritize high-importance and
    most recent articles. Truncates summaries to keep prompt within limits.
    """
    # Sort: high importance first, then by date descending
    imp_order = {"高": 0, "high": 0, "中": 1, "medium": 1, "mid": 1, "低": 2, "low": 2}
    selected = sorted(
        articles,
        key=lambda a: (imp_order.get(a.get("importance", "中"), 1), -(a.get("date", "") or "").__hash__()),
    )[:MAX_ARTICLES_PER_PROMPT]

    # Re-sort by date for chronological output
    selected.sort(key=lambda a: a.get("date", ""))

    lines = []
    for i, art in enumerate(selected, 1):
        title = art.get("title", "無標題")[:100]
        date = art.get("date", "未知日期")
        source = art.get("source", "未知來源")
        source_url = art.get("source_url", art.get("url", "無連結"))
        summary = art.get("summary", "")[:100]
        lines.append(
            f"[{i}] {title}\n"
            f"    {date} | {source} | {source_url}\n"
            + (f"    {summary}\n" if summary else "")
        )
    return "\n".join(lines)
