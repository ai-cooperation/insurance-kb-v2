"""News source configurations for Insurance KB v2."""

from urllib.parse import quote


def _gnews(query, days=7, lang="en", country="US"):
    """Build Google News RSS search URL."""
    encoded = quote(f"{query} when:{days}d")
    return (
        f"https://news.google.com/rss/search?"
        f"q={encoded}&hl={lang}&gl={country}&ceid={country}:{lang}"
    )


def _src(id_, name, url, method="rss", region="全球", type_="新聞聚合"):
    """Build a source dict."""
    return {
        "id": id_,
        "name": name,
        "url": url,
        "method": method,
        "region": region,
        "type": type_,
    }


# ---------------------------------------------------------------------------
# 34 existing GNews RSS sources
# ---------------------------------------------------------------------------
_GNEWS_EXISTING = [
    _src("gnews_insurance_asia", "保險亞太",
         _gnews("insurance asia pacific"), region="亞太"),
    _src("gnews_insurance_global", "全球保險",
         _gnews("global insurance industry reinsurance")),
    _src("gnews_insurtech", "保險科技",
         _gnews("insurtech insurance technology digital")),
    _src("gnews_sg_companies_1", "新加坡保險公司 1",
         _gnews('"Great Eastern" OR "AIA Singapore" OR "Prudential Singapore"'),
         region="新加坡"),
    _src("gnews_sg_companies_2", "新加坡保險公司 2",
         _gnews('"HSBC Life Singapore" OR "Tokio Marine Singapore"'),
         region="新加坡"),
    _src("gnews_sg_regulator", "新加坡監管",
         _gnews("MAS Singapore insurance regulation"), region="新加坡"),
    _src("gnews_hk_companies_1", "香港保險公司 1",
         _gnews('"AIA Hong Kong" OR "Manulife Hong Kong"'), region="香港"),
    _src("gnews_hk_companies_2", "香港保險公司 2",
         _gnews('"HSBC Insurance" Hong Kong OR "FWD Hong Kong"'), region="香港"),
    _src("gnews_hk_regulator", "香港監管",
         _gnews("Hong Kong Insurance Authority regulation"), region="香港"),
    _src("gnews_hk_zh", "香港保險（中文）",
         _gnews("香港 保險 監管", lang="zh-Hant", country="HK"), region="香港"),
    _src("gnews_cn_companies_1", "中國保險公司 1",
         _gnews("中国平安 OR 中国人寿", lang="zh-Hans", country="CN"),
         region="中國"),
    _src("gnews_cn_companies_2", "中國保險公司 2",
         _gnews("中国人保 OR 太平洋保险", lang="zh-Hans", country="CN"),
         region="中國"),
    _src("gnews_cn_industry", "中國保險監管",
         _gnews("中国 保险 监管", lang="zh-Hans", country="CN"), region="中國"),
    _src("gnews_jp_companies_ja", "日本保險公司（日文）",
         _gnews("日本生命 OR 第一生命 OR 明治安田", lang="ja", country="JP"),
         region="日本"),
    _src("gnews_jp_companies_2", "日本保險公司 2",
         _gnews("朝日生命 OR 住友生命 OR 大同生命", lang="ja", country="JP"),
         region="日本"),
    _src("gnews_jp_en", "日本保險（英文）",
         _gnews('"Nippon Life" OR "Tokio Marine" OR "Sompo"'), region="日本"),
    _src("gnews_jp_industry", "日本保險產業",
         _gnews("保険 生命保険 損害保険", lang="ja", country="JP"),
         region="日本"),
    _src("gnews_jp_mini", "日本少額短期保險",
         _gnews("少額短期保険", lang="ja", country="JP"), region="日本"),
    _src("gnews_kr_companies_1", "韓國保險公司 1",
         _gnews("삼성생명 OR 한화생명 OR 교보생명", lang="ko", country="KR"),
         region="韓國"),
    _src("gnews_kr_companies_2", "韓國保險公司 2",
         _gnews("SK라이프 OR 동양생명", lang="ko", country="KR"),
         region="韓國"),
    _src("gnews_kr_en", "韓國保險（英文）",
         _gnews('"Samsung Life" OR "Hanwha Life" OR "Kyobo"'), region="韓國"),
    _src("gnews_kr_industry", "韓國保險產業",
         _gnews("보험 생명보험 손해보험", lang="ko", country="KR"),
         region="韓國"),
    _src("gnews_reinsurers", "全球再保公司",
         _gnews('"Swiss Re" OR "Munich Re" OR "Hannover Re" OR "SCOR"')),
    _src("gnews_consultants", "顧問公司",
         _gnews("McKinsey OR Deloitte OR EY OR KPMG insurance")),
    _src("gnews_ratings_1", "評級機構 1",
         _gnews('"AM Best" OR "Fitch Ratings" OR "Moody" insurance')),
    _src("gnews_ratings_2", "評級機構 2",
         _gnews('KBRA OR "Japan Credit Rating" insurance')),
    _src("gnews_wsj_insurance", "WSJ 保險",
         _gnews("site:wsj.com insurance"), type_="新聞媒體"),
    _src("gnews_bloomberg_insurance", "Bloomberg 保險",
         _gnews("site:bloomberg.com insurance"), type_="新聞媒體"),
    _src("gnews_nyt_insurance", "NYT 保險",
         _gnews("site:nytimes.com insurance"), type_="新聞媒體"),
    _src("gnews_sina_insurance", "新浪保險",
         _gnews("新浪 保险 OR 保險", lang="zh-Hans", country="CN"),
         region="中國", type_="新聞媒體"),
    _src("gnews_esg_insurance", "ESG 保險",
         _gnews("insurance ESG sustainability climate")),
    _src("gnews_hive_insurance", "Hive 保險",
         _gnews("Hive insurance services platform")),
    _src("gnews_neuroscience_insurance", "腦科學保險",
         _gnews("neuroscience OR brain health insurance")),
    _src("gnews_tw_insurance", "台灣保險",
         _gnews("台灣 保險 壽險 產險", lang="zh-TW", country="TW"),
         region="台灣"),
]

# ---------------------------------------------------------------------------
# 12 new GNews RSS (replacing old HTTP/Playwright sources)
# ---------------------------------------------------------------------------
_GNEWS_NEW = [
    _src("gnews_swissre", "Swiss Re",
         _gnews('"Swiss Re" insurance'), type_="再保公司"),
    _src("gnews_munichre", "Munich Re",
         _gnews('"Munich Re" insurance'), type_="再保公司"),
    _src("gnews_air", "Asia Insurance Review",
         _gnews("site:asiainsurancereview.com"), region="亞太",
         type_="新聞媒體"),
    _src("gnews_mas", "MAS 新加坡金管局",
         "https://news.google.com/rss/search?q=%22Monetary+Authority+of+"
         "Singapore%22+insurance+when%3A30d&hl=en&gl=SG&ceid=SG:en",
         region="新加坡", type_="監管機構"),
    _src("gnews_hkia", "香港保監局",
         "https://news.google.com/rss/search?q=site%3Aia.org.hk+"
         "when%3A30d&hl=zh-TW&gl=HK&ceid=HK:zh-Hant",
         region="香港", type_="監管機構"),
    _src("gnews_liaj", "日本生命保險協會",
         "https://news.google.com/rss/search?q=site%3Aseiho.or.jp+"
         "when%3A30d&hl=ja&gl=JP&ceid=JP:ja",
         region="日本", type_="監管機構"),
    _src("gnews_greateastern", "Great Eastern",
         "https://news.google.com/rss/search?q=%22Great+Eastern%22+"
         "insurance+Singapore+OR+Malaysia+when%3A30d&hl=en&gl=SG&ceid=SG:en",
         region="新加坡", type_="保險公司"),
    _src("gnews_pingan", "中國平安",
         _gnews("中国平安 保险", lang="zh-Hans", country="CN"),
         region="中國", type_="保險公司"),
    _src("gnews_sompo", "Sompo",
         _gnews('"Sompo" insurance'), region="日本", type_="保險公司"),
    _src("gnews_aia_hk", "AIA 香港",
         _gnews('"AIA" "Hong Kong" insurance'), region="香港",
         type_="保險公司"),
    _src("gnews_lia_sg", "新加坡壽險公會",
         "https://news.google.com/rss/search?q=site%3Alia.org.sg+"
         "when%3A90d&hl=en&gl=SG&ceid=SG:en",
         region="新加坡", type_="監管機構"),
    _src("gnews_hannover_re", "Hannover Re",
         _gnews('"Hannover Re" insurance reinsurance'), type_="再保公司"),
]

# ---------------------------------------------------------------------------
# 1 official RSS
# ---------------------------------------------------------------------------
_OFFICIAL_RSS = [
    _src("hkia_rss", "香港保監局 RSS",
         "http://www.ia.org.hk/tc/rss/rss_news_tc.xml",
         region="香港", type_="監管機構"),
]

# ---------------------------------------------------------------------------
# 8 HTTP backup sources
# ---------------------------------------------------------------------------
_HTTP_BACKUP = [
    _src("air_news", "Asia Insurance Review",
         "https://www.asiainsurancereview.com",
         method="http", region="亞太", type_="新聞媒體"),
    _src("lia_sg", "新加坡壽險公會",
         "https://www.lia.org.sg/news-room/",
         method="http", region="新加坡", type_="監管機構"),
    _src("greateastern", "Great Eastern",
         "https://www.greateasternlife.com/sg/en/about-us/media-centre.html",
         method="http", region="新加坡", type_="保險公司"),
    _src("aia_hk", "AIA 香港",
         "https://www.aia.com.hk/en/about-aia/media-centre.html",
         method="http", region="香港", type_="保險公司"),
    _src("pingan", "中國平安",
         "https://www.pingan.cn/news/index.shtml",
         method="http", region="中國", type_="保險公司"),
    _src("sompo_hd", "Sompo HD",
         "https://www.sompo-hd.com/en/news/",
         method="http", region="日本", type_="保險公司"),
    _src("munichre_news", "Munich Re",
         "https://www.munichre.com/en/company/media-relations/"
         "media-information-and-corporate-news.html",
         method="http", region="全球", type_="再保公司"),
    _src("mas_media", "MAS 新聞稿",
         "https://www.mas.gov.sg/news/media-releases",
         method="http", region="新加坡", type_="監管機構"),
]

# ---------------------------------------------------------------------------
# Combined list: 55 sources total
# ---------------------------------------------------------------------------
SOURCES = _GNEWS_EXISTING + _GNEWS_NEW + _OFFICIAL_RSS + _HTTP_BACKUP
