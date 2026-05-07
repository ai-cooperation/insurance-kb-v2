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
        "regulation", "regulatory", "regulator", "compliance", "solvency",
        "supervision", "penalty", "fine", "sanction", "license", "licence",
        "監管", "法規", "規管", "MAS", "HKIA", "FSA", "IRDAI", "監理",
        "金管會", "保監局", "銀保監", "C-ROSS", "IFRS 17", "RBC",
    ],
    "科技應用": [
        "insurtech", "digital", "AI", "blockchain", "cyber", "fintech",
        "automation", "machine learning", "cloud", "API", "platform",
        "telematics", "IoT", "chatbot", "robo", "parametric",
        "科技", "數位", "数字", "人工智能", "區塊鏈", "网络", "自動化",
    ],
    "市場趨勢": [
        "market share", "growth rate", "premium volume", "penetration",
        "M&A", "merger", "acquisition", "IPO", "listing",
        "市場", "營收", "保費", "利潤", "業績", "市场", "併購", "收購",
    ],
    "產品創新": [
        "product", "launch", "coverage", "rider", "embedded insurance",
        "microinsurance", "parametric", "usage-based", "on-demand",
        "產品", "保單", "保障", "附約", "方案", "产品", "嵌入式", "微保險",
    ],
    "再保市場": [
        "reinsurance", "reinsurer", "retrocession", "catastrophe", "cat bond",
        "ILS", "sidecar", "renewal", "treaty", "facultative",
        "再保", "巨災", "天災", "分保",
    ],
    "ESG永續": [
        "ESG", "sustainability", "climate", "green", "carbon", "TCFD",
        "net zero", "biodiversity", "social", "governance", "ISSB",
        "永續", "氣候", "綠色", "碳排", "可持续", "淨零",
    ],
    "消費者保護": [
        "consumer", "complaint", "dispute", "claims handling", "fraud",
        "policyholder", "misselling", "transparency", "disclosure",
        "消費者", "理賠", "申訴", "爭議", "詐欺", "mis-selling", "保戶",
    ],
    "人才與組織": [
        "talent", "hiring", "workforce", "CEO", "appoint", "resign",
        "leadership", "culture", "diversity", "training",
        "人才", "任命", "人事", "招聘", "board", "executive", "總經理",
    ],
    "行銷推廣": [
        # contests / customer engagement campaigns
        "徵文", "徵稿", "徵件", "比賽", "選拔", "攝影", "短影片",
        "공모", "백일장", "캠페인",
        # branding / sponsorship / advertising
        "贊助", "冠名", "代言", "廣告", "TVC", "KOL",
        "sponsor", "sponsorship", "advertising", "commercial", "campaign",
        # CSR / community / donation marketing
        "公益捐贈", "捐贈儀式", "愛心捐", "公益活動", "志工", "志願",
        "donation ceremony", "CSR campaign",
        # PR events / launches as marketing event
        "記者會", "發表會", "路演", "成立紀念",
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

    # Category — score each category, pick highest
    scores = {}
    for cat, keywords in CATEGORY_RULES.items():
        score = sum(1 for kw in keywords if kw.lower() in title_lower)
        if score > 0:
            scores[cat] = score
    if scores:
        category = max(scores, key=scores.get)
    else:
        category = "市場趨勢"  # default only when zero keywords match

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
# LLM batch classification (Chinese title + summary via Groq API)
# ---------------------------------------------------------------------------
_CATEGORIES = [
    "監管動態", "科技應用", "市場趨勢", "產品創新",
    "再保市場", "ESG永續", "消費者保護", "人才與組織",
    "行銷推廣",
]

_LLM_SYSTEM = (
    "你是保險產業分析師。對每篇新聞做三件事：\n"
    "1. 將標題翻譯為繁體中文（title_zh）\n"
    "2. 用繁體中文寫 80 字摘要（summary_zh）\n"
    "3. 分類（category）：從以下 9 類選 1\n"
    "   - 監管動態：法規、監管機構政策、罰款、牌照、IFRS 17、RBC\n"
    "   - 科技應用：InsurTech、AI、區塊鏈、數位轉型、平台、自動化\n"
    "   - 市場趨勢：保費成長、市佔率、併購、IPO、業績、財報\n"
    "   - 產品創新：新產品上市、保障範圍、嵌入式保險、微保險、UBI\n"
    "   - 再保市場：再保險、巨災債券、ILS、續約條件\n"
    "   - ESG永續：氣候風險、碳排、TCFD、永續投資、淨零\n"
    "   - 消費者保護：理賠糾紛、申訴、詐欺、銷售不當、資訊揭露\n"
    "   - 人才與組織：高管任命、人事異動、企業文化、DEI\n"
    "   - 行銷推廣：純行銷與品牌活動，重點不在商品本身。包含：\n"
    "     * 客戶徵文／攝影／短影片比賽（例：教保人壽『孫愛故事徵文』）\n"
    "     * 品牌活動／選拔大會／家庭代表選拔（不是新商品上市）\n"
    "     * 體育／文化／教育贊助（贊助繪本、馬拉松、棒球隊）\n"
    "     * CSR 公益捐贈儀式、愛心捐款活動（非投資型 ESG）\n"
    "     * 廣告爭議、品牌混淆爭議、代言人爭議\n"
    "     * 記者會、發表會、路演（活動本身為主，非介紹商品）\n"
    "4. 重要性（importance）：高/中/低\n"
    "   - 高：重大政策、法規變革、大型併購、破產、危機\n"
    "   - 中：業績報告、產品發佈、會議摘要\n"
    "   - 低：評論、部落格、活動預告\n\n"
    "【術語標準化規則】（必須嚴格遵守）\n"
    "韓國壽險公司：韓文「생명」結尾的公司一律譯為「人壽」（不要譯為「生命」）。"
    "標準對照如下，輸出時請完全一致：\n"
    "  삼성생명 / Samsung Life → 三星人壽\n"
    "  한화생명 / Hanwha Life → 韓華人壽\n"
    "  교보생명 / Kyobo Life → 教保人壽\n"
    "  신한라이프 / Shinhan Life → 新韓人壽\n"
    "  동양생명 / Tongyang Life → 東洋人壽\n"
    "  KB라이프 / KB Life → KB 人壽\n"
    "  NH농협생명 → NH 農協人壽\n"
    "  흥국생명 → 興國人壽\n"
    "  ABL생명 → ABL 人壽\n"
    "  메트라이프생명 / MetLife → 大都會人壽\n"
    "  미래에셋생명 → 未來資產人壽\n"
    "  DB생명 → DB 人壽\n"
    "韓國金融機構：「우리」當公司名是音譯 Woori（友利），不要譯為「我們」「我國」：\n"
    "  우리금융 / Woori Financial → 友利金融\n"
    "  우리은행 / Woori Bank → 友利銀行\n"
    "規則：標題與摘要中所有保險公司名一律使用上述標準中文譯名，"
    "不要保留英文，不要混用「生命」「Life」與「人壽」。\n\n"
    "【行銷推廣 vs 其他類別 邊界規則】（重要，避免誤分）\n"
    "標題或內容同時涉及商品與活動時，依「主軸」判斷：\n"
    "- 主軸是商品（保障內容、費率、目標客群、給付）→ 產品創新\n"
    "  例：『推出家庭健康保險，舉辦選拔大會』→ 產品創新（活動是配套）\n"
    "- 主軸是活動本身（徵文、贊助、CSR、品牌形象）→ 行銷推廣\n"
    "  例：『教保人壽舉辦孫愛故事徵文』→ 行銷推廣（沒講具體商品）\n"
    "- 主軸是高管／組織人事 → 人才與組織（即使涉及 CMO 任命也歸這）\n"
    "- 主軸是綠能投資、ESG 框架、TCFD 揭露 → ESG永續\n"
    "  CSR 捐錢買繪本／贊助小學種樹 → 行銷推廣（不是投資型 ESG）\n"
    "- 主軸是業績、保費、市佔、財報 → 市場趨勢\n\n"
    "【體育新聞判定】（重要）\n"
    "若標題或內容涉及以下，category 一律填「無關」：\n"
    "- 韓國職業籃球（프로농구、KBL、WKBL）、챔프전（冠軍賽）、통합우승（合併冠軍）"
    "  — 例：「KB vs 三星人壽 챔프전」「프로농구 MVP」屬體育新聞，"
    "  即使提到保險公司名（KB/三星/韓華）也是運動贊助隊伍\n"
    "- 棒球聯賽、職棒球員 MVP、馬拉松、UBA、輪椅籃球公益賽\n"
    "- 公司贊助的體育活動、運動會、引退賽\n\n"
    "輸出 JSON array，每個元素含 title_zh, summary_zh, category, importance。\n"
    "如果文章與保險商品/業務/監管/市場完全無關（體育、娛樂、純 CSR 捐款），"
    "category 填 \"無關\"。\n"
    "只輸出 JSON，不加任何其他文字。"
)


# ---------------------------------------------------------------------------
# Post-processing: enforce Korean naming standards regardless of LLM output
# (LLMs in cascade are inconsistent; this regex layer guarantees consistency.)
# ---------------------------------------------------------------------------
import re as _re_mod

_KR_NAME_MAP = [
    # Korean → Chinese standard (longer/more-specific first)
    ("NH농협생명", "NH農協人壽"),
    ("미래에셋생명", "未來資產人壽"),
    ("메트라이프생명", "大都會人壽"),
    ("처브라이프생명", "Chubb 人壽"),
    ("동양생명", "東洋人壽"),
    ("삼성생명", "三星人壽"),
    ("한화생명", "韓華人壽"),
    ("신한라이프", "新韓人壽"),
    ("신한생명", "新韓人壽"),
    ("교보생명", "教保人壽"),
    ("농협생명", "農協人壽"),
    ("흥국생명", "興國人壽"),
    ("KB라이프", "KB 人壽"),
    ("KB생명", "KB 人壽"),
    ("DB생명", "DB 人壽"),
    ("ABL생명", "ABL 人壽"),
    ("우리금융지주", "友利金融控股"),
    ("우리금융그룹", "友利金融集團"),
    ("우리금융", "友利金融"),
    ("우리은행", "友利銀行"),
    # Chinese mistranslation → standard
    ("三星生命", "三星人壽"),
    ("三星生機", "三星人壽"),
    ("三星生保", "三星人壽"),
    ("韓華生命", "韓華人壽"),
    ("新韓生命", "新韓人壽"),
    ("教保生命", "教保人壽"),
    ("東洋生命", "東洋人壽"),
    ("興國生命", "興國人壽"),
    ("MetLife生命", "大都會人壽"),
    ("MetLife壽險", "大都會人壽"),
    ("MetLife", "大都會人壽"),
    ("Hanwha Life", "韓華人壽"),
    ("Shinhan Life", "新韓人壽"),
    ("Samsung Life", "三星人壽"),
    ("KB Life", "KB 人壽"),
    ("我國金融銀行", "友利金融"),
    ("我國金融", "友利金融"),
    ("我們金融", "友利金融"),
    ("ABL生命", "ABL 人壽"),
    ("KB生命", "KB 人壽"),
    ("DB生命", "DB 人壽"),
    ("農協生命", "農協人壽"),
]

_SPORTS_RX = _re_mod.compile(
    r"챔프전|WKBL|프로농구|통합우승|"
    r"冠軍賽|連續兩次冠軍|連勝兩次冠軍|女子籃球|完勝冠軍賽|冠軍之戰|"
    r"擊敗三星(?:人壽|生命|生機|生保)|朴智秀"
)


def _normalize_kr_names(text: str) -> str:
    """Apply Korean naming standardization (post-LLM, B layer)."""
    if not text:
        return text
    for old, new in _KR_NAME_MAP:
        text = text.replace(old, new)
    return text


def _detect_kr_sports(*texts: str) -> bool:
    """Catch KBL/WKBL leaks the LLM didn't tag as 無關."""
    return any(_SPORTS_RX.search(t) for t in texts if t)


def _parse_llm_json(text: str):
    """Parse LLM response as JSON array, stripping code fences. Returns None on failure."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()
    try:
        result = json.loads(text)
        if isinstance(result, list):
            return result
        logger.warning("LLM returned non-array JSON: %s", type(result))
        return None
    except json.JSONDecodeError as exc:
        logger.warning("JSON parse error: %s | text[:100]=%s", exc, text[:100])
        return None


def _build_llm_prompt(articles: list) -> str:
    """Build the user prompt for a batch of articles."""
    lines = ["文章列表："]
    for i, art in enumerate(articles, 1):
        source = art.get("source_id", "unknown")
        snippet = art.get("snippet", "")[:200]
        title = art.get("title_en") or art.get("title", "")
        lines.append(f"{i}. {title} - {source} - {snippet}")
    return "\n".join(lines)


def _merge_llm_results(batch: list, translations: list) -> list:
    """Merge LLM classification results into article dicts."""
    valid_cats = set(_CATEGORIES)
    merged = []
    for i, art in enumerate(batch):
        if i < len(translations):
            t = translations[i]
            llm_cat = t.get("category", "")
            llm_imp = t.get("importance", "")
            # Mark irrelevant articles for filtering
            filter_reason = ""
            if llm_cat == "無關":
                filter_reason = "irrelevant"
                llm_cat = art.get("category", "市場趨勢")
            elif llm_cat not in valid_cats:
                llm_cat = art.get("category", "市場趨勢")
            # Normalize importance
            imp_map = {"高": "高", "中": "中", "低": "低"}
            importance = imp_map.get(llm_imp, art.get("importance", "中"))

            # B layer: enforce Korean naming standards on LLM output
            title_zh = _normalize_kr_names(t.get("title_zh", ""))
            summary_zh = _normalize_kr_names(t.get("summary_zh", ""))

            # C layer: catch KBL/WKBL sports leaks the LLM didn't tag
            if not filter_reason:
                src_title = art.get("title", "") or ""
                if _detect_kr_sports(title_zh, src_title):
                    filter_reason = "noise_sports"

            merged.append({
                **art,
                "title_zh": title_zh,
                "summary_zh": summary_zh,
                "category": llm_cat,
                "importance": importance,
                "filter": filter_reason,
            })
        else:
            merged.append(art)
    return merged


# Model cascade for translation — each model has 150 req/day independent quota.
# On 429 (daily limit), automatically rotate to next model.
# Removed gpt-4.1-nano: nano was too inconsistent on Korean naming standards
# and sports-leak detection (the cheapest tier ignored prompt rules); paying
# the modest extra cost of mini-as-default buys far better instruction following.
TRANSLATE_MODELS = [
    "gpt-4.1-mini",       # default — good quality, fast, good instruction following
    "gpt-4o-mini",        # proven reliable
    "gpt-4.1",            # higher quality
    "gpt-4o",             # high quality
    "Llama-3.3-70B-Instruct",  # open source fallback
]


def classify_llm_batch(
    articles: list,
    api_key: str,
    batch_size: int = 10,
    delay: float = 3.0,
) -> list:
    """Translate titles to Chinese via GitHub Models API with model cascade.

    Automatically rotates to next model on 429 (daily rate limit).
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

    models = list(TRANSLATE_MODELS)
    model_idx = 0
    current_model = models[model_idx]
    logger.info("Starting with model: %s", current_model)

    updated = []
    for start in range(0, len(articles), batch_size):
        batch = articles[start : start + batch_size]
        prompt = _build_llm_prompt(batch)
        logger.info(
            "LLM batch %d-%d / %d [%s]",
            start + 1, start + len(batch), len(articles), current_model,
        )

        try:
            response = client.chat.completions.create(
                model=current_model,
                messages=[
                    {"role": "system", "content": _LLM_SYSTEM},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,
                max_tokens=2000,
            )
            text = response.choices[0].message.content.strip()
            translations = _parse_llm_json(text)
            if translations is not None:
                updated.extend(_merge_llm_results(batch, translations))
            else:
                logger.warning("JSON parse failed, keeping originals for batch %d-%d",
                               start + 1, start + len(batch))
                updated.extend(batch)
        except Exception as exc:
            exc_str = str(exc)
            if "429" in exc_str and "86400" in exc_str:
                # Daily limit hit — rotate to next model
                model_idx += 1
                if model_idx < len(models):
                    current_model = models[model_idx]
                    logger.warning(
                        "Daily limit on %s, rotating to %s",
                        models[model_idx - 1], current_model,
                    )
                    # Retry this batch with new model
                    try:
                        response = client.chat.completions.create(
                            model=current_model,
                            messages=[
                                {"role": "system", "content": _LLM_SYSTEM},
                                {"role": "user", "content": prompt},
                            ],
                            temperature=0.3,
                            max_tokens=2000,
                        )
                        text = response.choices[0].message.content.strip()
                        translations = _parse_llm_json(text)
                        if translations is not None:
                            updated.extend(_merge_llm_results(batch, translations))
                        else:
                            updated.extend(batch)
                    except Exception as retry_exc:
                        logger.warning("Retry with %s also failed: %s", current_model, retry_exc)
                        updated.extend(batch)
                else:
                    logger.error("All models exhausted. Remaining articles untranslated.")
                    updated.extend(batch)
                    updated.extend(articles[start + batch_size :])
                    break
            else:
                logger.warning("LLM batch failed: %s", exc)
                updated.extend(batch)

        if start + batch_size < len(articles):
            time.sleep(delay)

    return updated
