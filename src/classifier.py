"""Rule-based classifier + LLM for Chinese title/summary."""

import json
import logging
import time

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Category rules: keyword -> category
# ---------------------------------------------------------------------------
CATEGORY_RULES = {
    "監管動態": [
        "regulation", "regulatory", "regulator", "compliance",
        "監管", "法規", "規管", "MAS", "HKIA", "FSA", "IRDAI", "監理",
    ],
    "科技應用": [
        "insurtech", "digital", "AI", "blockchain", "cyber", "fintech",
        "科技", "數位", "数字", "人工智能", "區塊鏈", "网络",
    ],
    "市場趨勢": [
        "market", "growth", "revenue", "premium", "profit", "earnings",
        "市場", "營收", "保費", "利潤", "業績", "市场",
    ],
    "產品創新": [
        "product", "launch", "policy", "coverage", "plan", "rider",
        "產品", "保單", "保障", "附約", "方案", "产品",
    ],
    "再保市場": [
        "reinsurance", "reinsurer", "catastrophe", "cat bond",
        "再保", "巨災", "天災",
    ],
    "ESG永續": [
        "ESG", "sustainability", "climate", "green", "carbon",
        "永續", "氣候", "綠色", "碳排", "可持续",
    ],
    "消費者保護": [
        "consumer", "complaint", "dispute", "claim", "fraud",
        "消費者", "理賠", "申訴", "爭議", "詐欺", "mis-selling",
    ],
    "人才與組織": [
        "talent", "hiring", "workforce", "CEO", "appoint",
        "人才", "任命", "人事", "招聘", "board", "executive",
    ],
}

# ---------------------------------------------------------------------------
# Region detection from keywords
# ---------------------------------------------------------------------------
REGION_MAP = {
    "新加坡": ["singapore", "新加坡", "MAS", "SGX"],
    "香港": ["hong kong", "香港", "HKIA", "港"],
    "中國": [
        "china", "中国", "中國", "平安", "人寿", "人壽",
        "太平洋", "人保",
    ],
    "日本": [
        "japan", "日本", "生命", "損保", "損害保険",
        "Tokio Marine", "Sompo", "Nippon",
    ],
    "韓國": [
        "korea", "韓國", "한국", "삼성", "한화", "교보",
        "Samsung Life", "Hanwha",
    ],
    "台灣": ["taiwan", "台灣", "台湾", "壽險", "產險"],
    "亞太": ["asia", "ASEAN", "亞太", "亚太", "pacific"],
    "歐洲": ["europe", "EU", "Solvency", "歐洲", "欧洲"],
    "美國": ["US", "United States", "美國", "美国", "NAIC"],
    "全球": ["global", "world", "international", "全球"],
}

# ---------------------------------------------------------------------------
# Importance scoring keywords
# ---------------------------------------------------------------------------
_HIGH_KEYWORDS = [
    "regulation", "監管", "law", "法", "crisis", "bankrupt",
    "M&A", "併購", "收購", "IPO", "record",
]
_LOW_KEYWORDS = [
    "opinion", "blog", "podcast", "webinar", "newsletter",
]


def classify_rule(article: dict) -> dict:
    """Add category, region, importance to an article dict (immutable)."""
    title_lower = (
        article.get("title", "") + " " + article.get("snippet", "")
    ).lower()

    # Category
    category = "市場趨勢"  # default
    for cat, keywords in CATEGORY_RULES.items():
        if any(kw.lower() in title_lower for kw in keywords):
            category = cat
            break

    # Region (prefer source region, fall back to keyword detection)
    region = article.get("region", "")
    if not region:
        for reg, keywords in REGION_MAP.items():
            if any(kw.lower() in title_lower for kw in keywords):
                region = reg
                break
        if not region:
            region = "全球"

    # Importance
    importance = "中"
    if any(kw.lower() in title_lower for kw in _HIGH_KEYWORDS):
        importance = "高"
    elif any(kw.lower() in title_lower for kw in _LOW_KEYWORDS):
        importance = "低"

    return {
        **article,
        "category": category,
        "region": region,
        "importance": importance,
    }


# ---------------------------------------------------------------------------
# LLM batch classification (Chinese title + summary via GitHub Models)
# ---------------------------------------------------------------------------
_LLM_SYSTEM = (
    "你是保險產業翻譯助手。將以下新聞標題翻譯為繁體中文，並生成 100 字中文摘要。\n"
    "輸出 JSON array，每個元素包含 title_zh 和 summary_zh。\n"
    "只輸出 JSON，不要加任何其他文字。"
)


def _build_llm_prompt(articles: list) -> str:
    """Build the user prompt for a batch of articles."""
    lines = ["文章列表："]
    for i, art in enumerate(articles, 1):
        source = art.get("source_id", "unknown")
        snippet = art.get("snippet", "")[:200]
        lines.append(f"{i}. {art['title']} - {source} - {snippet}")
    return "\n".join(lines)


def classify_llm_batch(
    articles: list,
    api_key: str,
    batch_size: int = 10,
    delay: float = 3.0,
) -> list:
    """Call GitHub Models GPT-4o-mini for Chinese title + summary.

    Returns new list of article dicts with title_zh and summary_zh added.
    """
    try:
        from openai import OpenAI
    except ImportError:
        logger.error("openai package not installed, skipping LLM classification")
        return articles

    client = OpenAI(
        base_url="https://models.inference.ai.azure.com",
        api_key=api_key,
    )

    updated = []
    for start in range(0, len(articles), batch_size):
        batch = articles[start : start + batch_size]
        prompt = _build_llm_prompt(batch)
        logger.info(
            "LLM batch %d-%d / %d",
            start + 1, start + len(batch), len(articles),
        )

        try:
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": _LLM_SYSTEM},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,
                max_tokens=2000,
            )
            text = response.choices[0].message.content.strip()
            # Strip markdown code fences if present
            if text.startswith("```"):
                text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

            translations = json.loads(text)
            for i, art in enumerate(batch):
                if i < len(translations):
                    t = translations[i]
                    updated.append({
                        **art,
                        "title_zh": t.get("title_zh", ""),
                        "summary_zh": t.get("summary_zh", ""),
                    })
                else:
                    updated.append(art)
        except Exception as exc:
            logger.warning("LLM batch failed: %s", exc)
            updated.extend(batch)

        if start + batch_size < len(articles):
            time.sleep(delay)

    return updated
