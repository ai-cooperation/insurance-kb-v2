"""Rule-based classifier + LLM for Chinese title/summary."""

import json
import logging
import os
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
    "  KB라이프 / KB Life → KB人壽\n"
    "  NH농협생명 → NH農協人壽\n"
    "  흥국생명 → 興國人壽\n"
    "  ABL생명 → ABL 人壽\n"
    "  메트라이프생명 / MetLife → 大都會人壽\n"
    "  미래에셋생명 → 未來資產人壽\n"
    "  DB생명 → DB人壽\n"
    "  라이나생명 / Lina Life → Lina人壽（Chubb 旗下；絕不音譯為萊茵／萊納／麗娜／賴納）\n"
    "  라이나손해보험 → Lina損害保險\n"
    "  라이나원 → Lina One\n"
    "  하나생명 → Hana人壽（Hana 金融旗下；勿與韓華 한화 混淆）\n"
    "  하나손해보험 / 하나손보 → Hana損保\n"
    "  푸본현대생명 → 富邦現代人壽\n"
    "  AIA생명 → AIA人壽（勿用 AIA生命）\n"
    "  카카오페이손해보험 → KakaoPay損保（KakaoPay 連寫不加空格）\n"
    "  메리츠화재 → Meritz火災\n"
    "  iM라이프 → iM人壽\n"
    "韓國金融機構：「우리」當公司名是音譯 Woori（友利），不要譯為「我們」「我國」：\n"
    "  우리금융 / Woori Financial → 友利金融\n"
    "  우리은행 / Woori Bank → 友利銀行\n"
    "日本保險公司：漢字社名（日本生命、第一生命、住友生命、明治安田生命、"
    "太陽生命、大同生命、東京海上）保留原漢字，「生命」不要改成「人壽」。"
    "片假名社名必須用下表，不要自行音譯：\n"
    "  アフラック → Aflac生命（絕不譯為友利／友邦／安聯／大都會／亞福）\n"
    "  メットライフ生命 → 大都會人壽\n"
    "  マニュライフ生命 → 宏利人壽\n"
    "  アクサ生命 → 安盛人壽\n"
    "  プルデンシャル生命 → 保德信生命（美系；英系 Prudential plc 才譯保誠）\n"
    "  ジブラルタ生命 → 直布羅陀生命\n"
    "  ライフネット生命 → Lifenet生命\n"
    "  ソニー生命 → 索尼生命\n"
    "  かんぽ生命 → 郵政生命\n"
    "  T&Dフィナンシャル生命 → T&D金融生命\n"
    "規則：標題與摘要中所有保險公司名一律使用上述標準中文譯名，"
    "不要保留英文，不要混用「生命」「Life」與「人壽」。"
    "拉丁字母公司名與「人壽／損保／火災」之間不加空格"
    "（KB人壽、ABL人壽、Hana人壽，不是 KB 人壽）。\n"
    "英文社名對照（重要，勿混淆）：\n"
    "  Great Eastern → 大東方（新加坡大東方；**絕不譯為宏利**）\n"
    "  Manulife → 宏利人壽（只有 Manulife/マニュライフ 才是宏利）\n\n"
    "【韓文徹底翻譯規則】（重要，避免漏字）\n"
    "輸出的 title_zh / summary_zh **絕對不能含有任何 Hangul 韓文字符**"
    "（가-힯 範圍）。若遇到不確定如何翻譯的詞，依下列規則處理：\n"
    "- **韓國人名**：一律音譯為繁體中文（如 신창재→申昌宰、강형욱→姜亨旭）。"
    "  若無把握音譯，至少先抓姓氏漢字（金/李/朴/崔/鄭/姜/趙/尹/張/林...），"
    "  名字部分音譯。**不要保留原文 Hangul**。\n"
    "- **韓國商品/服務名**：意譯為繁體中文，加引號標示（如 달리자→「奔馳」、"
    "  하는쑥쑥→「茁壯成長」、실손24→「實損24」）。**不要保留原文**。\n"
    "- **韓國公司名**：用上方標準譯名表；不在表中的用音譯 + 加註原文（如"
    "  애큐온캐피탈→Acuon Capital）。\n"
    "- **無法判斷的韓文詞**：先用語境推測中文意思，最差情況用音譯。"
    "  **任何時候都不能讓 Hangul 字符直接出現在輸出中**。\n\n"
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
    ("처브라이프생명", "Chubb人壽"),
    ("동양생명", "東洋人壽"),
    ("삼성생명", "三星人壽"),
    ("한화생명", "韓華人壽"),
    ("신한라이프", "新韓人壽"),
    ("신한생명", "新韓人壽"),
    ("교보생명", "教保人壽"),
    ("농협생명", "農協人壽"),
    ("흥국생명", "興國人壽"),
    # Lina (Chubb Korea) — spaced variants first, bare form as fallback
    ("라이나손해보험", "Lina損害保險"),
    ("라이나 손해보험", "Lina損害保險"),
    ("라이나손보", "Lina損保"),
    ("라이나생명", "Lina人壽"),
    ("라이나 생명", "Lina人壽"),
    ("라이나원", "Lina One"),
    ("라이나", "Lina"),
    ("AIA생명", "AIA人壽"),
    ("푸본현대생명", "富邦現代人壽"),
    ("카카오페이손해보험", "KakaoPay損害保險"),
    ("카카오페이손보", "KakaoPay損保"),
    ("KB라이프", "KB人壽"),
    ("KB생명", "KB人壽"),
    ("DB생명", "DB人壽"),
    ("ABL생명", "ABL人壽"),
    ("우리금융지주", "友利金融控股"),
    ("우리금융그룹", "友利金融集團"),
    ("우리금융", "友利金融"),
    ("우리은행", "友利銀行"),
    # Loss insurance / general insurance subsidiaries
    ("하나손해보험", "Hana損保"),
    ("하나손보", "Hana損保"),
    ("하나생명", "Hana人壽"),
    ("KB손해보험", "KB損保"),
    ("KB손보", "KB損保"),
    ("삼성화재", "三星火災"),
    ("현대해상", "現代海上"),
    ("DB손해보험", "DB損保"),
    ("DB손보", "DB損保"),
    ("메리츠화재", "Meritz火災"),
    ("흥국화재", "興國火災"),
    ("롯데손해보험", "樂天損保"),
    ("롯데손보", "樂天損保"),
    # Product / service names (KR specific brands frequently leaking)
    ("하는쑥쑥어린이보장보험", "「茁壯成長」兒童保障保險"),
    ("하는쑥쑥", "「茁壯成長」"),
    ("쑥쑥", "茁壯成長"),
    ("실손24", "實損24"),
    ("실손", "實損"),
    # Korean financial executives commonly named in industry news
    ("신창재", "申昌宰"),
    ("신중현", "申中現"),
    ("강형욱", "姜亨旭"),
    ("임종룡", "林鍾龍"),
    # Korean media / institutions sometimes leaking
    ("조선일보", "朝鮮日報"),
    ("서울경제신문", "首爾經濟新聞"),
    ("IT조선", "IT 朝鮮"),
    ("애큐온캐피탈", "Acuon Capital"),
    ("젠스타메이트", "Genstar Mate"),
    # Insurance industry terms (Korean → Chinese standard)
    ("유배당보험", "有分紅保險"),
    ("유배당", "有分紅"),
    ("역마진", "利差損"),
    ("맞춤형", "客製化"),
    ("손해율", "損失率"),
    ("손해보험", "損害保險"),
    ("손보업계", "損保業界"),
    ("풋옵션", "賣權"),
    ("전세자금", "傳貰資金"),
    ("방카슈랑스", "Bancassurance（銀行保險）"),
    ("저축은행", "儲蓄銀行"),
    ("금감원", "金融監督院"),
    ("예보", "預金保險"),
    # Product / campaign / activity names
    ("광화문글판", "光化門詩板"),
    ("더 레이스 교보로런", "The Race 教保 Run"),
    ("교보로런", "教保 Run"),
    ("완소데이", "完美日"),
    ("귀국편", "回國篇"),
    ("볼파크", "Ballpark"),
    ("달리자", "達利者"),
    ("쪽방촌", "貧民窟"),
    # Common compound substrings (after longer matches above already applied)
    ("iM라이프", "iM人壽"),
    ("교보생", "教保人壽"),
    ("하나人壽", "Hana人壽"),  # repair previous partial-translate
    ("하나", "Hana"),  # fallback if standalone (after compound forms matched above)
    # Common partial-translation leaks (context: KR insurance industry)
    ("우리WON", "友利WON"),
    ("우리", "友利"),
    ("보험주", "保險股"),
    ("보험", "保險"),
    ("애널픽", "分析師精選"),
    ("본업", "本業"),
    ("관심", "關注"),
    # Chinese mistranslation → standard
    ("三星生命", "三星人壽"),
    ("三星生機", "三星人壽"),
    ("三星生保", "三星人壽"),
    ("韓華生命", "韓華人壽"),
    ("新韓生命", "新韓人壽"),
    ("教保生命", "教保人壽"),
    ("東洋生命", "東洋人壽"),
    ("興國生命", "興國人壽"),
    ("興國生推", "興國人壽推"),  # LLM truncation; safe: 興國生命 already replaced above
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
    ("ABL生命", "ABL人壽"),
    ("KB生命", "KB人壽"),
    ("DB生命", "DB人壽"),
    ("農協生命", "農協人壽"),
    # 2026-07-06 sweep: company-name splits found by scanning title_en
    # (original) vs title (zh) across the whole corpus. Same company was
    # rendered differently per article, breaking substring search.
    # Lina (라이나생명, Chubb Korea) — LLM freestyled 4+ phonetic renderings
    ("萊納損害保險", "Lina損害保險"),
    ("萊茵人壽", "Lina人壽"),
    ("萊茵生命", "Lina人壽"),
    ("萊納人壽", "Lina人壽"),
    ("萊納生命", "Lina人壽"),
    ("賴納人壽", "Lina人壽"),
    ("賴納生命", "Lina人壽"),
    ("麗娜人壽", "Lina人壽"),
    ("麗娜生命", "Lina人壽"),
    ("萊茵全盛", "Lina全盛"),  # 라이나전성기재단 Lina 全盛期基金會
    ("Lina 人壽", "Lina人壽"),
    # Hanwha (한화생명) phonetic slips
    ("漢華生命", "韓華人壽"),
    ("漢華人壽", "韓華人壽"),
    ("漢華金融", "韓華金融"),
    ("漢華損保", "韓華損保"),
    ("漢華火災", "韓華損保"),
    ("華漢生命", "韓華人壽"),
    ("韓化生命", "韓華人壽"),
    ("Hanwha生命", "韓華人壽"),
    # Shinhan (신한라이프) phonetic slips
    ("申韓人壽", "新韓人壽"),
    ("信韓人壽", "新韓人壽"),
    # Hana (하나생명) — 韓亞 is Hana Financial's zh name but map standard is Hana
    ("韓亞人壽", "Hana人壽"),
    # Kyobo (교보생명) slip
    ("光華人壽", "教保人壽"),
    # Suffix / brand-token unification
    ("AIA生命", "AIA人壽"),
    ("富邦現代生命", "富邦現代人壽"),
    ("Kakao Pay損", "KakaoPay損"),
    ("美利茲火災", "Meritz火災"),
    ("美利茲", "Meritz"),
    ("iM Life", "iM人壽"),
    # JP katakana-name companies (2026-07-06 sweep, same method): kanji
    # company names pass through translation intact, but katakana names
    # forced the LLM to invent a rendering per article. Unconditional
    # repairs only — ambiguous tokens (美國友邦保險 could be genuine AIA,
    # 萬通人壽 genuine MassMutual, 保誠生命 genuine UK Prudential) are
    # handled conditionally in fix_company_names.py gated on title_en.
    ("アフラック生命", "Aflac生命"),
    ("アフラック", "Aflac"),
    # 2026-07 Aflac breach news burst spawned fresh transliterations
    # (caught by name_consistency baseline scan). Unambiguous ones here;
    # ambiguous (美亞=AIG China JV, 美國運通=Amex, 安聯=Allianz) stay
    # conditional in fix_company_names.py.
    ("阿弗萊克", "Aflac"),
    ("阿弗拉克", "Aflac"),
    ("亞克蘭生命", "Aflac生命"),
    ("亞克蘭", "Aflac"),
    ("メットライフ生命", "大都會人壽"),
    ("メットライフ", "大都會人壽"),
    ("アクサ生命", "安盛人壽"),
    ("アクサ損害保険", "安盛損保"),
    ("アクサ", "安盛"),
    ("友利生命", "Aflac生命"),  # Woori has NO life arm; 25/25 verified Aflac
    ("亞弗拉克生命", "Aflac生命"),
    ("亞弗拉克", "Aflac"),
    ("亞福生命", "Aflac生命"),
    ("亞福萊克", "Aflac"),
    ("大都會生命", "大都會人壽"),
    ("梅特萊夫人壽", "大都會人壽"),
    ("住友人壽", "住友生命"),
    ("明治安田人壽", "明治安田生命"),
    ("大同人壽", "大同生命"),
    ("索尼人壽", "索尼生命"),
    ("Sony生命", "索尼生命"),
    ("宏利生命", "宏利人壽"),
    ("萬裕生命", "宏利人壽"),
    ("普徵人壽", "保德信生命"),
    ("普勒登夏生命", "保德信生命"),
    ("普爾登夏爾生命", "保德信生命"),
    ("Lifenet人壽", "Lifenet生命"),
    ("日本郵政人壽", "郵政生命"),  # かんぽ生命; India's 郵政人壽 (PLI) untouched
    # Spacing normalization — search is plain substring matching, so
    # "KB 人壽" (old map output) breaks a "KB人壽" query and vice versa
    ("KB 人壽", "KB人壽"),
    ("ABL 人壽", "ABL人壽"),
    ("DB 人壽", "DB人壽"),
    ("NH 農協人壽", "NH農協人壽"),
    ("Hana 人壽", "Hana人壽"),
    ("Hana 損保", "Hana損保"),
    ("KB 損保", "KB損保"),
    ("DB 損保", "DB損保"),
    ("Meritz 火災", "Meritz火災"),
    ("Chubb 人壽", "Chubb人壽"),
]

# ---------------------------------------------------------------------------
# Entity-name consistency watchlist — consumed by src/name_consistency.py.
# (original-name pattern matched against title_en, accepted zh tokens that
# must appear in the translated title+summary). Alert-only: ambiguous
# renderings (宏利 = genuine Manulife elsewhere) mean repairs stay manual
# via fix_company_names.py conditional rules. Keep in sync with the
# standard table in _LLM_SYSTEM above; every past incident company is
# listed (Lina, Aflac, Great Eastern→宏利 ...).
_ENTITY_WATCHLIST = [
    (r"라이나|[Ll]ina Life", ("Lina",)),
    (r"삼성생명", ("三星人壽",)),
    (r"한화생명", ("韓華人壽",)),
    (r"교보생명", ("教保人壽",)),
    (r"신한라이프|신한생명", ("新韓人壽",)),
    (r"동양생명", ("東洋人壽",)),
    (r"미래에셋생명", ("未來資產人壽",)),
    (r"흥국생명", ("興國人壽",)),
    (r"KB라이프|KB생명", ("KB人壽",)),
    (r"하나생명", ("Hana人壽",)),
    (r"하나손해보험|하나손보", ("Hana損",)),
    (r"농협생명", ("農協人壽",)),
    (r"ABL생명", ("ABL人壽",)),
    (r"アフラック|Aflac", ("Aflac",)),
    (r"メットライフ|MetLife", ("大都會人壽",)),
    (r"マニュライフ|[Mm]anulife", ("宏利",)),
    (r"アクサ", ("安盛", "AXA")),
    (r"プルデンシャル", ("保德信", "保誠")),
    (r"ジブラルタ", ("直布羅陀",)),
    (r"ライフネット", ("Lifenet",)),
    (r"ソニー生命", ("索尼生命",)),
    (r"[Gg]reat [Ee]astern|GREAT EASTERN", ("大東方",)),
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
    """Parse LLM response as JSON array. Returns None on failure.

    Strips code fences, and falls back to extracting the outermost
    [...] span — reasoning models (gpt-oss family) wrap the array in
    prose preamble that plain json.loads chokes on.
    """
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()
    for candidate in (text,):
        try:
            result = json.loads(candidate)
            if isinstance(result, list):
                return result
            logger.warning("LLM returned non-array JSON: %s", type(result))
            return None
        except json.JSONDecodeError:
            pass
    # Fallback: outermost array span
    lo, hi = text.find("["), text.rfind("]")
    if lo != -1 and hi > lo:
        try:
            result = json.loads(text[lo : hi + 1])
            if isinstance(result, list):
                return result
        except json.JSONDecodeError:
            pass
    logger.warning("JSON parse failed | len=%d | text[:100]=%s", len(text), text[:100])
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


# Provider-aware translation cascade.
#
# 2026-07-31: GitHub Models entered scheduled retirement brownouts — the
# legacy azure endpoint returns 401 "Server Error" and models.github.ai
# answers "github_models_retirement_brownout". Three days of green runs
# shipped untranslated titles (14 -> 50 -> 119/day) because the old code
# only rotated on 429-with-daily-marker; 401 fell through to "log and
# keep originals". Groq (the original provider; GROQ_API_KEY still in
# repo secrets) is restored as primary, GitHub Models kept as secondary
# until final shutdown. ANY per-batch exception now advances the
# cascade, and a failure-rate alarm goes to Telegram — silent Phase 3
# death is the exact failure class pipeline-invariant-testing rule 5
# exists for.
#
# Model notes: gpt-4.1-nano was removed earlier for ignoring Korean
# naming rules; unknown Groq model IDs rotate harmlessly on 404.
TRANSLATE_PROVIDERS = [
    ("groq", "https://api.groq.com/openai/v1", "GROQ_API_KEY", [
        # llama first: gpt-oss-120b is a reasoning model — with a 10-article
        # batch its reasoning ate the whole max_tokens budget and returned
        # EMPTY content (9/9 parse failures on 2026-07-31 first live run).
        "llama-3.3-70b-versatile",
        "moonshotai/kimi-k2-instruct",
        "qwen/qwen3-32b",
        "openai/gpt-oss-120b",
    ]),
    ("github-models", "https://models.inference.ai.azure.com", "MODELS_PAT", [
        "gpt-4.1-mini",
        "gpt-4o-mini",
        "gpt-4.1",
        "gpt-4o",
        "Llama-3.3-70B-Instruct",
    ]),
]

# Alert when this fraction of batches fail — a dying provider must page
# us, not ship raw Korean titles behind a green run.
_PHASE3_ALARM_THRESHOLD = 0.2


def _send_phase3_alarm(message: str) -> None:
    """Best-effort Telegram alert (same env contract as the other detectors)."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "")
    topic_id = os.environ.get("TELEGRAM_TOPIC_ID", "")
    if not token or not chat_id:
        return
    try:
        import requests as _rq
        payload = {"chat_id": chat_id, "text": message}
        if topic_id:
            payload["message_thread_id"] = topic_id
        _rq.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            data=payload, timeout=15,
        )
    except Exception as exc:  # noqa: BLE001 — alarm must never kill the pipeline
        logger.warning("Phase 3 alarm send failed: %s", exc)


def _build_cascade(fallback_github_key: str = "") -> list:
    """Flatten TRANSLATE_PROVIDERS into [(label, client, model), ...] for
    every provider whose key is available."""
    from openai import OpenAI

    slots = []
    for name, base_url, env_var, models in TRANSLATE_PROVIDERS:
        key = os.environ.get(env_var, "")
        if not key and name == "github-models":
            key = fallback_github_key  # legacy run.py passes MODELS_PAT as arg
        if not key:
            logger.info("Provider %s skipped (no %s)", name, env_var)
            continue
        client = OpenAI(base_url=base_url, api_key=key)
        for model in models:
            slots.append((f"{name}/{model}", client, model))
    return slots


def classify_llm_batch(
    articles: list,
    api_key: str = "",
    batch_size: int = 10,
    delay: float = 3.0,
) -> list:
    """Translate titles to Chinese via the provider cascade.

    Any exception on a batch advances to the next (provider, model) slot
    and retries the same batch there. JSON-parse failures keep originals
    but do NOT advance (bad output != dead provider). When all slots are
    exhausted, remaining articles stay untranslated and the failure-rate
    alarm fires.
    """
    try:
        slots = _build_cascade(api_key)
    except ImportError:
        logger.error("openai package not installed, skipping LLM classification")
        return articles
    if not slots:
        logger.error("No translation provider available (no API keys)")
        _send_phase3_alarm("[Insurance KB] 翻譯 Phase 3 無可用 provider（API key 全缺）")
        return articles

    slot_idx = 0
    label, client, model = slots[slot_idx]
    logger.info("Translation cascade: %d slots, starting with %s", len(slots), label)

    updated = []
    total_batches = 0
    failed_batches = 0

    for start in range(0, len(articles), batch_size):
        batch = articles[start : start + batch_size]
        prompt = _build_llm_prompt(batch)
        total_batches += 1
        logger.info(
            "LLM batch %d-%d / %d [%s]",
            start + 1, start + len(batch), len(articles), label,
        )

        translated = False
        while slot_idx < len(slots):
            label, client, model = slots[slot_idx]
            try:
                response = client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": _LLM_SYSTEM},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.3,
                    # Reasoning models spend tokens thinking before the
                    # array; 2000 returned EMPTY content on gpt-oss-120b.
                    max_tokens=4000,
                )
                text = (response.choices[0].message.content or "").strip()
                translations = _parse_llm_json(text)
                if translations is not None:
                    updated.extend(_merge_llm_results(batch, translations))
                    translated = True
                    break
                # Unparseable/empty output is a slot-level defect for this
                # prompt shape (reasoning-format models) — advance and
                # retry the same batch on the next slot.
                logger.warning(
                    "Unusable output on %s for batch %d-%d — rotating",
                    label, start + 1, start + len(batch),
                )
                slot_idx += 1
            except Exception as exc:
                logger.warning("Batch failed on %s: %s — rotating", label, exc)
                slot_idx += 1

        if not translated:
            # Cascade fully exhausted — keep the rest untranslated.
            logger.error(
                "All %d cascade slots exhausted at batch %d-%d. "
                "Remaining articles untranslated.",
                len(slots), start + 1, start + len(batch),
            )
            updated.extend(batch)
            updated.extend(articles[start + batch_size :])
            failed_batches += 1 + max(
                0, (len(articles) - start - batch_size + batch_size - 1) // batch_size
            )
            total_batches = (len(articles) + batch_size - 1) // batch_size
            break

        if start + batch_size < len(articles):
            time.sleep(delay)

    if total_batches and failed_batches / total_batches > _PHASE3_ALARM_THRESHOLD:
        msg = (
            "[Insurance KB] 翻譯失敗率告警\n"
            f"本輪 {failed_batches}/{total_batches} 個 batch 失敗"
            f"（cascade 用到第 {min(slot_idx + 1, len(slots))}/{len(slots)} 槽）。\n"
            "受影響文章以原文標題入庫，修好後用 reclassify 補譯。"
        )
        logger.error(msg)
        _send_phase3_alarm(msg)

    return updated
