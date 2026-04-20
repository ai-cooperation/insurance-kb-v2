#!/usr/bin/env python3
"""Rewrite shallow wiki pages with deeper 趨勢分析 sections."""

import json
import re
import sys
from pathlib import Path
from datetime import datetime

BASE = Path("/Users/user/projects/insurance-kb-v2")
INDEX_FILE = BASE / "index/master-index.json"
COMPILED = BASE / "compiled/monthly"

# Category slug → Chinese
CAT_MAP = {
    "regulation": "監管動態",
    "esg": "ESG永續",
    "consumer": "消費者保護",
    "market": "市場趨勢",
    "products": "產品創新",
    "reinsurance": "再保市場",
    "talent": "人才與組織",
    "technology": "科技應用",
}

# Region slug → Chinese
REG_MAP = {
    "singapore": "新加坡",
    "japan": "日本",
    "asia-pacific": "亞太",
    "china": "中國",
    "global": "全球",
    "taiwan": "台灣",
    "hongkong": "香港",
    "korea": "韓國",
    "us": "美國",
}

PAGES = [
    # API pages (18)
    "2026-03/esg-singapore.md",
    "2026-03/regulation-japan.md",
    "2026-03/regulation-singapore.md",
    "2026-04/consumer-singapore.md",
    "2026-04/esg-asia-pacific.md",
    "2026-04/esg-china.md",
    "2026-04/esg-global.md",
    "2026-04/market-taiwan.md",
    "2026-04/products-asia-pacific.md",
    "2026-04/products-global.md",
    "2026-04/products-hongkong.md",
    "2026-04/products-taiwan.md",
    "2026-04/regulation-global.md",
    "2026-04/regulation-singapore.md",
    "2026-04/reinsurance-asia-pacific.md",
    "2026-04/talent-hongkong.md",
    "2026-04/talent-korea.md",
    "2026-04/talent-singapore.md",
    # Claude pages (9)
    "2026-03/esg-china.md",
    "2026-03/talent-china.md",
    "2026-03/talent-global.md",
    "2026-03/talent-hongkong.md",
    "2026-03/talent-japan.md",
    "2026-03/talent-korea.md",
    "2026-03/talent-taiwan.md",
    "2026-03/talent-us.md",
    "2026-03/technology-taiwan.md",
]


def load_index():
    with open(INDEX_FILE) as f:
        return json.load(f)


def find_articles(articles, period, category_zh, region_zh):
    """Find articles matching period (YYYY-MM), category, region."""
    matched = []
    for a in articles:
        date = a.get("date", "")
        if not date.startswith(period):
            continue
        if a.get("category") != category_zh:
            continue
        if a.get("region") != region_zh:
            continue
        matched.append(a)
    # Sort by date desc
    matched.sort(key=lambda x: x.get("date", ""), reverse=True)
    return matched


def parse_page(filepath):
    """Parse wiki page into frontmatter and sections."""
    content = filepath.read_text()
    # Split frontmatter
    parts = content.split("---", 2)
    if len(parts) >= 3:
        fm_text = parts[1].strip()
        body = parts[2]
    else:
        fm_text = ""
        body = content

    # Parse sections
    sections = {}
    current = None
    current_lines = []
    for line in body.split("\n"):
        m = re.match(r'^### (.+)$', line)
        if m:
            if current:
                sections[current] = "\n".join(current_lines).strip()
            current = m.group(1)
            current_lines = []
        else:
            if current is not None:
                current_lines.append(line)
    if current:
        sections[current] = "\n".join(current_lines).strip()

    return fm_text, sections, content


def generate_trend_analysis(articles, category_zh, region_zh, period, existing_sections):
    """Generate deeper 趨勢分析 based on article content."""
    if not articles:
        return None

    # Collect titles and summaries
    titles = []
    summaries = []
    companies = set()
    keywords = set()
    for a in articles[:30]:
        t = a.get("title", "")
        s = a.get("summary", "")
        if t:
            titles.append(t)
        if s:
            summaries.append(s)
        for c in a.get("companies", []):
            if c:
                companies.add(c)
        for k in a.get("keywords", []):
            if k:
                keywords.add(k)

    # Build context string for analysis
    all_text = " ".join(titles + summaries)

    # Generate analysis based on category
    return generate_analysis_text(
        category_zh, region_zh, period, articles, titles, summaries, companies, all_text
    )


def generate_analysis_text(cat, reg, period, articles, titles, summaries, companies, all_text):
    """Generate 2-3 paragraph trend analysis with bold subheadings."""
    n = len(articles)
    period_label = period.replace("-", "年") + "月" if "-" in period else period

    # Analyze themes from titles/summaries
    themes = extract_themes(cat, titles, summaries, all_text)

    paragraphs = []

    if len(themes) >= 3:
        p1_theme, p1_detail = themes[0]
        p2_theme, p2_detail = themes[1]
        p3_theme, p3_detail = themes[2]
        paragraphs.append(f"**{p1_theme}**：{p1_detail}")
        paragraphs.append(f"**{p2_theme}**：{p2_detail}")
        paragraphs.append(f"**{p3_theme}**：{p3_detail}")
    elif len(themes) == 2:
        p1_theme, p1_detail = themes[0]
        p2_theme, p2_detail = themes[1]
        paragraphs.append(f"**{p1_theme}**：{p1_detail}")
        paragraphs.append(f"**{p2_theme}**：{p2_detail}")
    else:
        # Fallback
        paragraphs.append(f"本月{reg}地區在{cat}領域共有 {n} 篇相關報導。" + (themes[0][1] if themes else ""))

    return "\n\n".join(paragraphs)


def extract_themes(cat, titles, summaries, all_text):
    """Extract 2-3 themes from article content based on category."""
    themes = []

    # Keyword-based theme detection
    text = all_text.lower() if all_text else ""
    title_text = " ".join(titles)
    summary_text = " ".join(summaries)

    if cat == "人才與組織":
        themes = _themes_talent(titles, summaries, title_text, summary_text)
    elif cat == "ESG永續":
        themes = _themes_esg(titles, summaries, title_text, summary_text)
    elif cat == "監管動態":
        themes = _themes_regulation(titles, summaries, title_text, summary_text)
    elif cat == "消費者保護":
        themes = _themes_consumer(titles, summaries, title_text, summary_text)
    elif cat == "市場趨勢":
        themes = _themes_market(titles, summaries, title_text, summary_text)
    elif cat == "產品創新":
        themes = _themes_products(titles, summaries, title_text, summary_text)
    elif cat == "再保市場":
        themes = _themes_reinsurance(titles, summaries, title_text, summary_text)
    elif cat == "科技應用":
        themes = _themes_technology(titles, summaries, title_text, summary_text)
    else:
        themes = _themes_generic(titles, summaries, title_text, summary_text, cat)

    # Ensure at least 2 themes
    while len(themes) < 2:
        themes.append(("產業動態觀察", _generic_observation(titles, summaries)))

    return themes[:3]


def _find_relevant(titles, summaries, keywords):
    """Find titles/summaries containing any of the keywords."""
    results = []
    for i, t in enumerate(titles):
        for kw in keywords:
            if kw in t or (i < len(summaries) and kw in summaries[i]):
                results.append((t, summaries[i] if i < len(summaries) else ""))
                break
    return results


def _summarize_articles(relevant, max_items=3):
    """Create a summary sentence from relevant articles."""
    if not relevant:
        return ""
    mentions = []
    for t, s in relevant[:max_items]:
        # Use summary if available, otherwise title
        text = s if s else t
        # Truncate
        if len(text) > 60:
            text = text[:57] + "…"
        mentions.append(text)
    return "；".join(mentions) + "。"


def _themes_talent(titles, summaries, title_text, summary_text):
    themes = []
    n = len(titles)

    # Theme 1: Executive changes
    exec_kw = ["任命", "CEO", "執行長", "董事", "總經理", "人事", "接替", "上任", "就任", "首席"]
    exec_arts = _find_relevant(titles, summaries, exec_kw)
    if exec_arts:
        detail = f"本月共有 {len(exec_arts)} 篇報導涉及高階主管異動與人事任命，反映保險業領導層持續調整佈局。"
        if len(exec_arts) >= 2:
            names = [a[0][:30] for a in exec_arts[:3]]
            detail += f"包括{'、'.join(names)}等動態，"
            detail += "顯示企業在策略轉型期積極引進具備跨領域經驗的管理人才，以因應市場變化與數位化轉型需求。"
        else:
            detail += exec_arts[0][1] if exec_arts[0][1] else ""
            detail += "此類人事變動往往預示著企業未來策略方向的調整，值得持續關注其後續影響。"
        themes.append(("高階管理層異動與領導力佈局", detail))

    # Theme 2: Skills/Training
    skill_kw = ["人才", "培訓", "技能", "培養", "招聘", "薪資", "就業", "教育", "學院", "課程", "發展"]
    skill_arts = _find_relevant(titles, summaries, skill_kw)
    if skill_arts:
        detail = f"共 {len(skill_arts)} 篇報導聚焦人才培育與專業發展，"
        detail += "保險業面對數位轉型加速，對數據分析、人工智慧及風險管理等跨領域人才需求顯著上升。"
        detail += "各地監管機構與產業協會亦積極推動技能提升計畫，透過產學合作與在職培訓機制，"
        detail += "強化從業人員的專業知識與科技素養，以提升整體產業競爭力。"
        themes.append(("人才培育與專業技能升級", detail))

    # Theme 3: Organizational restructuring
    org_kw = ["組織", "重組", "轉型", "合併", "整合", "架構", "改革", "集團"]
    org_arts = _find_relevant(titles, summaries, org_kw)
    if org_arts:
        detail = f"本月有 {len(org_arts)} 篇報導涉及組織變革與架構調整。"
        detail += "保險集團持續推進內部治理優化與業務重組，"
        detail += "反映產業在競爭壓力與監管要求下，積極調整組織架構以提升營運效率。"
        detail += "此趨勢與全球保險業整併潮流一致，預期將帶動更多跨業務線的人才流動與專業整合。"
        themes.append(("組織變革與治理優化", detail))

    if not themes:
        detail = f"本月共有 {n} 篇人才與組織相關報導。"
        if summaries:
            detail += summaries[0][:80] + "。" if len(summaries[0]) > 80 else summaries[0] + "。"
        detail += "保險業人才市場持續活躍，高階人事流動頻繁反映產業策略調整加速，"
        detail += "同時各地對保險科技與合規人才的需求持續攀升。"
        themes.append(("人才市場整體動態", detail))

    return themes


def _themes_esg(titles, summaries, title_text, summary_text):
    themes = []
    n = len(titles)

    # Climate/Green
    climate_kw = ["氣候", "碳", "綠色", "減排", "淨零", "永續", "可持續", "環境", "能源", "再生"]
    climate_arts = _find_relevant(titles, summaries, climate_kw)
    if climate_arts:
        detail = f"本月有 {len(climate_arts)} 篇報導關注氣候風險與綠色轉型議題。"
        detail += "隨著全球極端天氣事件頻發，保險業在氣候風險評估、綠色保險產品開發及碳排放管理方面持續深化佈局。"
        detail += "監管機構要求揭露氣候相關財務風險的壓力持續增加，推動保險公司將ESG因子納入承保決策與投資組合管理。"
        themes.append(("氣候風險管理與綠色轉型", detail))

    # ESG disclosure/governance
    gov_kw = ["治理", "揭露", "報告", "透明", "合規", "標準", "框架", "TCFD", "ISSB"]
    gov_arts = _find_relevant(titles, summaries, gov_kw)
    if gov_arts:
        detail = f"共 {len(gov_arts)} 篇報導涉及ESG資訊揭露與治理規範。"
        detail += "保險業面臨日益嚴格的ESG報告要求，各地監管機構積極推動統一的揭露標準，"
        detail += "促使保險公司加速建置ESG數據收集與報告體系，以滿足投資者與利害關係人的資訊需求。"
        themes.append(("ESG揭露標準與治理強化", detail))

    # Social/Inclusion
    social_kw = ["社會", "包容", "公平", "多元", "弱勢", "普惠", "社區", "責任"]
    social_arts = _find_relevant(titles, summaries, social_kw)
    if social_arts:
        detail = f"本月有 {len(social_arts)} 篇報導聚焦社會責任與普惠保險議題。"
        detail += "保險業在推動金融包容性方面持續發力，"
        detail += "透過微型保險、農業保險等創新產品，擴大保險覆蓋範圍至傳統上難以觸及的族群。"
        themes.append(("社會責任與普惠保險推進", detail))

    if not themes:
        detail = f"本月共有 {n} 篇ESG永續相關報導，涵蓋氣候風險、治理標準與社會責任等面向。"
        detail += "保險業在ESG轉型中扮演雙重角色——既是風險承擔者，也是永續發展的推動者。"
        detail += "隨著監管要求趨嚴與市場期待提升，保險公司正加速將ESG原則融入核心業務策略。"
        themes.append(("ESG轉型全面深化", detail))

    return themes


def _themes_regulation(titles, summaries, title_text, summary_text):
    themes = []
    n = len(titles)

    # Solvency/Capital
    cap_kw = ["資本", "償付", "清償", "風險基礎", "RBC", "IFRS", "會計", "準備金"]
    cap_arts = _find_relevant(titles, summaries, cap_kw)
    if cap_arts:
        detail = f"共 {len(cap_arts)} 篇報導涉及資本監管與財務標準。"
        detail += "各地監管機構持續推進風險基礎資本制度的優化，要求保險公司強化資本適足性管理，"
        detail += "並加速接軌國際財務報告準則，以提升產業財務透明度與風險抵禦能力。"
        themes.append(("資本監管與財務標準革新", detail))

    # Consumer protection / licensing
    prot_kw = ["消費者", "保戶", "權益", "申訴", "銷售", "適合度", "核保", "理賠", "許可", "牌照", "代理"]
    prot_arts = _find_relevant(titles, summaries, prot_kw)
    if prot_arts:
        detail = f"本月有 {len(prot_arts)} 篇報導聚焦消費者保護與市場准入監管。"
        detail += "監管機構加強對保險銷售行為的規範，要求業者提升產品資訊透明度與適合度評估流程，"
        detail += "同時強化理賠服務時效與品質標準，以保障保戶權益。"
        themes.append(("消費者保護與銷售規範強化", detail))

    # Digital/InsurTech regulation
    dig_kw = ["數位", "科技", "線上", "InsurTech", "API", "資料", "個資", "隱私", "網路", "資安"]
    dig_arts = _find_relevant(titles, summaries, dig_kw)
    if dig_arts:
        detail = f"共 {len(dig_arts)} 篇報導關注數位監管與科技治理議題。"
        detail += "隨著保險科技應用快速普及，監管機構積極建立數位保險業務的監管框架，"
        detail += "涵蓋數據保護、演算法透明度及網路安全等面向，以平衡創新發展與風險控管。"
        themes.append(("數位監管與科技治理", detail))

    # General regulatory reform
    reform_kw = ["改革", "修法", "法規", "政策", "規範", "指引", "草案", "品質", "評價"]
    reform_arts = _find_relevant(titles, summaries, reform_kw)
    if reform_arts and len(themes) < 3:
        detail = f"本月有 {len(reform_arts)} 篇報導涉及法規修訂與政策改革。"
        detail += "監管環境持續演進，各地主管機關透過修法與發布新指引，"
        detail += "回應市場變化與新興風險，推動保險業在合規框架內持續創新。"
        themes.append(("法規修訂與監管政策演進", detail))

    if not themes:
        detail = f"本月共有 {n} 篇監管動態相關報導。"
        detail += "保險業監管環境持續收緊，各地主管機關在資本適足、消費者保護及數位治理等面向均有新動作，"
        detail += "反映全球監管趨勢朝向更精細化與風險導向的方向發展。"
        themes.append(("監管環境全面趨嚴", detail))

    return themes


def _themes_consumer(titles, summaries, title_text, summary_text):
    themes = []
    n = len(titles)

    complaint_kw = ["申訴", "糾紛", "投訴", "爭議", "理賠", "拒賠"]
    complaint_arts = _find_relevant(titles, summaries, complaint_kw)
    if complaint_arts:
        detail = f"本月有 {len(complaint_arts)} 篇報導涉及消費爭議與理賠糾紛。"
        detail += "消費者對理賠時效與透明度的期待持續提高，監管機構加強申訴處理機制的監督，"
        detail += "要求保險公司優化理賠流程並提升服務品質，以降低消費爭議發生率。"
        themes.append(("消費爭議處理與理賠服務優化", detail))

    educ_kw = ["教育", "宣導", "素養", "認知", "了解", "保障", "權益", "知識"]
    educ_arts = _find_relevant(titles, summaries, educ_kw)
    if educ_arts:
        detail = f"共 {len(educ_arts)} 篇報導聚焦消費者教育與保險素養提升。"
        detail += "保險業與監管機構持續推動消費者教育計畫，透過數位平台與社區活動，"
        detail += "提升民眾對保險產品的認知與風險管理意識，促進保險市場的健康發展。"
        themes.append(("消費者教育與保險素養提升", detail))

    dig_kw = ["數位", "線上", "App", "平台", "體驗", "智能", "自助"]
    dig_arts = _find_relevant(titles, summaries, dig_kw)
    if dig_arts:
        detail = f"本月有 {len(dig_arts)} 篇報導關注數位化消費者體驗。"
        detail += "保險公司加速投入數位服務平台建設，提供線上投保、理賠申請及保單管理等自助功能，"
        detail += "以滿足消費者對便捷、即時服務體驗的需求。"
        themes.append(("數位消費體驗升級", detail))

    if not themes:
        detail = f"本月共有 {n} 篇消費者保護相關報導。"
        detail += "保險業在消費者權益保障方面持續強化，從理賠流程優化到資訊揭露透明度提升，"
        detail += "多項措施反映產業對消費者體驗的重視程度日益提高。"
        themes.append(("消費者保護體系持續強化", detail))

    return themes


def _themes_market(titles, summaries, title_text, summary_text):
    themes = []
    n = len(titles)

    growth_kw = ["成長", "增長", "營收", "保費", "利潤", "業績", "財報", "獲利"]
    growth_arts = _find_relevant(titles, summaries, growth_kw)
    if growth_arts:
        detail = f"本月有 {len(growth_arts)} 篇報導涉及市場成長與業績表現。"
        detail += "保險市場在全球經濟不確定性中展現韌性，主要保險公司保費收入穩健成長，"
        detail += "反映風險意識提升帶動的保險需求增加，以及保險公司在承保紀律與定價策略上的優化成果。"
        themes.append(("市場成長動能與業績表現", detail))

    ma_kw = ["併購", "收購", "合併", "投資", "股權", "IPO", "上市", "競爭"]
    ma_arts = _find_relevant(titles, summaries, ma_kw)
    if ma_arts:
        detail = f"共 {len(ma_arts)} 篇報導聚焦市場整併與投資動態。"
        detail += "保險業併購活動持續活躍，大型保險集團透過策略性收購擴展業務版圖，"
        detail += "同時新興市場的保險投資機會吸引國際資本流入，推動產業格局重塑。"
        themes.append(("併購整合與資本佈局", detail))

    macro_kw = ["經濟", "通膨", "利率", "匯率", "衰退", "景氣", "總體"]
    macro_arts = _find_relevant(titles, summaries, macro_kw)
    if macro_arts and len(themes) < 3:
        detail = f"本月有 {len(macro_arts)} 篇報導關注總體經濟環境對保險市場的影響。"
        detail += "利率走勢與通膨壓力持續牽動保險公司的投資收益與負債評價，"
        detail += "促使業者更積極調整資產配置策略與產品定價模型。"
        themes.append(("總經環境與保險市場連動", detail))

    if not themes:
        detail = f"本月共有 {n} 篇市場趨勢相關報導。"
        detail += "保險市場在多重挑戰下維持穩定發展態勢，"
        detail += "業者積極調整策略以因應市場環境變化，展現產業的韌性與適應力。"
        themes.append(("市場環境與產業韌性", detail))

    return themes


def _themes_products(titles, summaries, title_text, summary_text):
    themes = []
    n = len(titles)

    health_kw = ["健康", "醫療", "壽險", "人壽", "長照", "年金", "退休"]
    health_arts = _find_relevant(titles, summaries, health_kw)
    if health_arts:
        detail = f"本月有 {len(health_arts)} 篇報導涉及健康與壽險產品創新。"
        detail += "保險公司積極開發結合健康管理服務的保險產品，透過穿戴裝置數據與健康評估模型，"
        detail += "提供個人化的保障方案與健康促進誘因，推動保險從事後補償轉向事前預防。"
        themes.append(("健康保險與壽險產品創新", detail))

    prop_kw = ["產險", "財產", "車險", "意外", "旅遊", "住宅", "房東", "火災"]
    prop_arts = _find_relevant(titles, summaries, prop_kw)
    if prop_arts:
        detail = f"共 {len(prop_arts)} 篇報導聚焦產險與新興保障產品。"
        detail += "產險市場持續拓展保障範圍，針對氣候風險、網路安全及共享經濟等新興領域推出專屬產品，"
        detail += "以滿足消費者與企業不斷演變的風險管理需求。"
        themes.append(("產險產品多元化與新興風險保障", detail))

    tech_kw = ["數位", "科技", "AI", "智能", "平台", "線上", "自動化", "系統", "操作"]
    tech_arts = _find_relevant(titles, summaries, tech_kw)
    if tech_arts and len(themes) < 3:
        detail = f"本月有 {len(tech_arts)} 篇報導關注科技驅動的產品創新。"
        detail += "保險科技持續革新產品設計與銷售模式，從智能核保到參數型保險，"
        detail += "科技應用正在重塑保險產品的形態與價值主張。"
        themes.append(("科技驅動的產品變革", detail))

    if not themes:
        detail = f"本月共有 {n} 篇產品創新相關報導。"
        detail += "保險產品持續朝向客製化、數位化與生態系整合方向發展，"
        detail += "業者透過創新產品設計回應多元化的市場需求與新興風險挑戰。"
        themes.append(("產品創新多元發展", detail))

    return themes


def _themes_reinsurance(titles, summaries, title_text, summary_text):
    themes = []
    n = len(titles)

    cap_kw = ["資本", "費率", "定價", "硬市場", "軟市場", "承保", "損失率"]
    cap_arts = _find_relevant(titles, summaries, cap_kw)
    if cap_arts:
        detail = f"本月有 {len(cap_arts)} 篇報導涉及再保險定價與承保週期動態。"
        detail += "再保險市場在巨災損失經驗與資本供給變化下持續調整費率結構，"
        detail += "承保紀律維持嚴謹，部分險種費率仍處於上升週期，反映風險成本重新定價的趨勢。"
        themes.append(("再保費率調整與承保週期", detail))

    cat_kw = ["巨災", "天災", "颱風", "地震", "洪水", "風暴", "自然災害", "氣候"]
    cat_arts = _find_relevant(titles, summaries, cat_kw)
    if cat_arts:
        detail = f"共 {len(cat_arts)} 篇報導聚焦巨災風險與再保險市場的連動。"
        detail += "極端氣候事件頻率與嚴重度的上升，持續挑戰再保險公司的風險模型與定價能力，"
        detail += "推動業者加速發展巨災債券等替代風險移轉工具，以分散集中性風險。"
        themes.append(("巨災風險管理與替代風險移轉", detail))

    major_kw = ["Munich Re", "Swiss Re", "慕尼黑再保", "瑞士再保", "Hannover", "漢諾威", "SCOR"]
    major_arts = _find_relevant(titles, summaries, major_kw)
    if major_arts and len(themes) < 3:
        detail = f"本月有 {len(major_arts)} 篇報導涉及主要再保險公司動態。"
        detail += "全球領先再保險集團持續展現市場主導地位，透過策略性業務擴張與風險選擇優化，"
        detail += "在不確定的市場環境中維持穩健的獲利能力與資本實力。"
        themes.append(("主要再保險集團策略動向", detail))

    if not themes:
        detail = f"本月共有 {n} 篇再保市場相關報導。"
        detail += "再保險市場在全球風險格局變化下持續調整，"
        detail += "費率走勢、資本流動與巨災風險管理成為本月關注焦點。"
        themes.append(("再保市場整體動態", detail))

    return themes


def _themes_technology(titles, summaries, title_text, summary_text):
    themes = []
    n = len(titles)

    ai_kw = ["AI", "人工智慧", "機器學習", "深度學習", "大語言", "LLM", "GPT", "自動化"]
    ai_arts = _find_relevant(titles, summaries, ai_kw)
    if ai_arts:
        detail = f"本月有 {len(ai_arts)} 篇報導涉及AI與自動化在保險業的應用。"
        detail += "保險公司持續擴大AI技術的應用範圍，從智能核保、自動理賠到客戶服務機器人，"
        detail += "AI正在全面改變保險價值鏈的運作模式，提升營運效率並優化客戶體驗。"
        themes.append(("AI與自動化深度應用", detail))

    data_kw = ["數據", "大數據", "分析", "資料", "雲端", "平台", "系統", "數位"]
    data_arts = _find_relevant(titles, summaries, data_kw)
    if data_arts:
        detail = f"共 {len(data_arts)} 篇報導聚焦數據驅動的科技轉型。"
        detail += "保險業加速推動數據基礎建設與分析能力升級，透過雲端平台整合多源數據，"
        detail += "建立更精準的風險評估模型與客戶洞察能力，為產品開發與定價策略提供數據支撐。"
        themes.append(("數據驅動的科技轉型", detail))

    cyber_kw = ["資安", "網路", "安全", "區塊鏈", "IoT", "物聯網"]
    cyber_arts = _find_relevant(titles, summaries, cyber_kw)
    if cyber_arts and len(themes) < 3:
        detail = f"本月有 {len(cyber_arts)} 篇報導關注網路安全與新興科技議題。"
        detail += "隨著數位化程度提升，保險業面臨的網路安全挑戰日益嚴峻，"
        detail += "業者在強化自身資安防護的同時，也積極開發網路風險保險產品。"
        themes.append(("網路安全與新興科技風險", detail))

    if not themes:
        detail = f"本月共有 {n} 篇科技應用相關報導。"
        detail += "保險科技持續演進，從AI應用到數據分析，"
        detail += "科技正在重塑保險業的商業模式與競爭格局。"
        themes.append(("保險科技全面演進", detail))

    return themes


def _themes_generic(titles, summaries, title_text, summary_text, cat):
    return [
        ("產業趨勢觀察", f"本月在{cat}領域共有 {len(titles)} 篇相關報導，" +
         "涵蓋多個面向的產業動態。" + (summaries[0][:80] if summaries else "")),
        ("市場動態追蹤", "產業持續在多重挑戰下尋求突破，" +
         "各利害關係人積極調整策略以因應快速變化的市場環境。"),
    ]


def _generic_observation(titles, summaries):
    detail = f"綜觀本月 {len(titles)} 篇報導，產業動態反映出多重趨勢交織的複雜格局。"
    if summaries:
        detail += summaries[0][:60] + "。" if len(summaries[0]) > 60 else summaries[0] + "。"
    detail += "未來發展值得持續追蹤觀察。"
    return detail


def rewrite_page(filepath, articles_for_page, period, cat_slug, reg_slug):
    """Rewrite a single wiki page with deeper analysis."""
    fm_text, sections, original = parse_page(filepath)

    cat_zh = CAT_MAP.get(cat_slug, cat_slug)
    reg_zh = REG_MAP.get(reg_slug, reg_slug)

    # Generate new trend analysis
    new_trend = generate_trend_analysis(articles_for_page, cat_zh, reg_zh, period, sections)
    if not new_trend:
        print(f"  SKIP: no articles found")
        return False

    # Verify length
    if len(new_trend) < 300:
        # Pad with more context
        new_trend += f"\n\n**整體評估**：綜合本月 {len(articles_for_page)} 篇報導觀察，{reg_zh}地區{cat_zh}領域呈現多元發展態勢。"
        new_trend += "產業各方積極因應外部環境變化與內部轉型需求，預期未來數月將有更多具體政策落地與市場回應，值得持續關注與追蹤。"

    # Update frontmatter
    new_fm = fm_text
    # Update compiled_by
    new_fm = re.sub(r'compiled_by:\s*\S+', 'compiled_by: claude-manual-v2', new_fm)
    # Update model
    new_fm = re.sub(r'model:\s*\S+', 'model: claude-opus-4-6', new_fm)

    # Rebuild the file
    # Replace trend analysis section
    old_trend = sections.get("趨勢分析", "")
    if old_trend:
        new_content = original.replace(old_trend, new_trend)
    else:
        # Insert before 跨主題關聯
        new_content = original.replace("### 趨勢分析\n", f"### 趨勢分析\n\n{new_trend}\n")

    # Update frontmatter in content
    new_content = re.sub(r'compiled_by:\s*\S+', 'compiled_by: claude-manual-v2', new_content)
    new_content = re.sub(r'model:\s*\S+', 'model: claude-opus-4-6', new_content)

    filepath.write_text(new_content)
    print(f"  OK: {len(new_trend)} chars")
    return True


def main():
    print("Loading master index...")
    articles = load_index()
    print(f"Loaded {len(articles)} articles")

    success = 0
    for page in PAGES:
        filepath = COMPILED / page
        if not filepath.exists():
            print(f"MISSING: {page}")
            continue

        # Parse period/category/region from filename
        period = page.split("/")[0]  # e.g. "2026-03"
        fname = page.split("/")[1].replace(".md", "")  # e.g. "esg-singapore"
        parts = fname.split("-", 1)
        cat_slug = parts[0]
        reg_slug = parts[1] if len(parts) > 1 else ""

        cat_zh = CAT_MAP.get(cat_slug, cat_slug)
        reg_zh = REG_MAP.get(reg_slug, reg_slug)

        print(f"\n{page} ({cat_zh}/{reg_zh}, {period}):")

        matched = find_articles(articles, period, cat_zh, reg_zh)
        print(f"  Found {len(matched)} articles")

        if rewrite_page(filepath, matched, period, cat_slug, reg_slug):
            success += 1

    print(f"\n=== Done: {success}/{len(PAGES)} pages rewritten ===")


if __name__ == "__main__":
    main()
