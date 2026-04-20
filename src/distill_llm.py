"""LLM calls for knowledge distillation using GitHub Models API (OpenAI SDK)."""

from __future__ import annotations

import os
from typing import Any

import openai


def get_client() -> openai.OpenAI:
    """Return OpenAI client configured for GitHub Models API."""
    token = os.environ.get("MODELS_PAT") or os.environ.get("GITHUB_TOKEN")
    if not token:
        raise RuntimeError("MODELS_PAT or GITHUB_TOKEN environment variable is required")
    return openai.OpenAI(
        base_url="https://models.inference.ai.azure.com",
        api_key=token,
    )


# Distillation uses higher-quality models (low volume, quality matters)
DISTILL_MODELS = [
    "gpt-4.1",            # best balance of quality and speed
    "gpt-4o",             # fallback
    "DeepSeek-V3-0324",   # strong open-source alternative
    "Llama-3.3-70B-Instruct",
]
MODEL = os.environ.get("DISTILL_MODEL", DISTILL_MODELS[0])


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

    client = get_client()
    return _call_with_cascade(
        client,
        system="你是保險產業知識庫編輯，專長將大量新聞文章整理成結構化月度報告。",
        user=prompt,
        max_tokens=4000,
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

    client = get_client()
    return _call_with_cascade(
        client,
        system="你是保險產業知識庫總編輯，專長季度趨勢綜合分析。",
        user=prompt,
        max_tokens=4000,
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

    client = get_client()
    return _call_with_cascade(
        client,
        system="你是保險產業知識庫主編，專長年度產業趨勢綜合分析與前瞻。",
        user=prompt,
        max_tokens=5000,
    )


def _call_with_cascade(
    client: openai.OpenAI,
    system: str,
    user: str,
    max_tokens: int = 4000,
) -> str:
    """Call LLM with model cascade — rotate on 429 daily limit."""
    import logging
    logger = logging.getLogger(__name__)

    for model in DISTILL_MODELS:
        try:
            logger.info("Distill using model: %s", model)
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=0.3,
                max_tokens=max_tokens,
            )
            return response.choices[0].message.content or ""
        except Exception as exc:
            exc_str = str(exc)
            if "429" in exc_str and "86400" in exc_str:
                logger.warning("Daily limit on %s, trying next model", model)
                continue
            if "413" in exc_str or "tokens_limit" in exc_str:
                logger.warning("Token limit on %s, trying next model", model)
                continue
            raise
    raise RuntimeError("All distill models exhausted (daily limits)")


MAX_ARTICLES_PER_PROMPT = 50


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
