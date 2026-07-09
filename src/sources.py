"""News source configurations for Insurance KB v2."""

from urllib.parse import quote


def _gnews(query, days=7, lang="en", country="US"):
    """Build Google News RSS search URL."""
    encoded = quote(f"{query} when:{days}d")
    return (
        f"https://news.google.com/rss/search?"
        f"q={encoded}&hl={lang}&gl={country}&ceid={country}:{lang}"
    )


def _src(id_, name, url, method="rss", region="全球", type_="新聞聚合", **extra):
    """Build a source dict.

    extra: optional per-source crawler tuning, consumed by crawler.py —
      timeout           request timeout seconds (default 15; slow origins
                        like mainland-China sites need 25+)
      min_title_len     anchor-text length floor for crawl_http (default
                        20; CJK press-release titles can run shorter)
      url_must_contain  substring an article URL must contain; when set it
                        REPLACES the generic _is_article_url heuristic for
                        crawl_http (curated whitelist beats guessing, and
                        the heuristic's '/about' skip false-positives on
                        newsrooms under /about-us/)
      max_items         crawl_http cap per run (listing pages are
                        newest-first; prevents first-crawl archive floods
                        being ingested with today's date)
      days              lookback window for crawl_json (default 45)
    """
    return {
        "id": id_,
        "name": name,
        "url": url,
        "method": method,
        "region": region,
        "type": type_,
        **extra,
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
         _gnews('"HSBC Life Singapore" OR "Tokio Marine Singapore" '
                'OR "Manulife Singapore" OR "FWD Singapore"'),
         region="新加坡"),
    _src("gnews_sg_companies_3", "新加坡保險公司 3",
         _gnews('"Singlife" OR "NTUC Income" OR "China Life Singapore"'),
         region="新加坡"),
    _src("gnews_sg_regulator", "新加坡監管",
         _gnews("MAS Singapore insurance regulation"), region="新加坡"),
    _src("gnews_hk_companies_1", "香港保險公司 1",
         _gnews('"AIA Hong Kong" OR "Manulife Hong Kong" OR "Prudential Hong Kong"'),
         region="香港"),
    _src("gnews_hk_companies_2", "香港保險公司 2",
         _gnews('"HSBC Insurance" Hong Kong OR "FWD Hong Kong" '
                'OR "Sun Life Hong Kong" OR "AXA Hong Kong"'),
         region="香港"),
    _src("gnews_hk_companies_3", "香港保險公司 3",
         _gnews('"China Taiping" Hong Kong OR "BOC Life" '
                'OR "中銀人壽" OR "中國人壽香港"', lang="zh-Hant", country="HK"),
         region="香港"),
    _src("gnews_hk_companies_4", "香港保險公司 4 (CTF / FTLife / new entrants)",
         _gnews('"CTF Life" OR "周大福人壽" OR "FTLife" '
                'OR "Chow Tai Fook Life" OR "中保人壽" OR "NCB Life" '
                'OR "Bowtie" Hong Kong OR "Blue Hong Kong"',
                days=30),
         region="香港", type_="保險公司"),
    _src("gnews_hk_regulator", "香港監管",
         _gnews("Hong Kong Insurance Authority regulation"), region="香港"),
    _src("gnews_hk_zh", "香港保險（中文）",
         _gnews("香港 保險 監管", lang="zh-Hant", country="HK"), region="香港"),
    _src("gnews_cn_companies_1", "中國保險公司 1",
         _gnews("中国平安 OR 中国人寿 OR 新华保险", lang="zh-Hans", country="CN"),
         region="中國"),
    _src("gnews_cn_companies_2", "中國保險公司 2",
         _gnews("中国人保 OR 太平洋保险 OR 太平人寿 OR 友邦中国",
                lang="zh-Hans", country="CN"),
         region="中國"),
    _src("gnews_cn_companies_3", "中國保險公司 3",
         _gnews("泰康人寿 OR 阳光保险 OR 富德生命人寿 OR 工银安盛",
                lang="zh-Hans", country="CN"),
         region="中國"),
    _src("gnews_cn_industry", "中國保險監管",
         _gnews("中国 保险 监管", lang="zh-Hans", country="CN"), region="中國"),
    _src("gnews_jp_companies_ja", "日本保險公司（日文）",
         _gnews("日本生命 OR 第一生命 OR 明治安田生命", lang="ja", country="JP"),
         region="日本"),
    _src("gnews_jp_companies_2", "日本保險公司 2",
         _gnews("朝日生命 OR 住友生命 OR 大同生命 OR 太陽生命 OR T&D",
                lang="ja", country="JP"),
         region="日本"),
    _src("gnews_jp_companies_3", "日本保險公司 3 (外資)",
         _gnews("アフラック OR メットライフ生命 OR マニュライフ生命 OR アクサ生命",
                lang="ja", country="JP"),
         region="日本"),
    _src("gnews_jp_en", "日本保險（英文）",
         _gnews('"Nippon Life" OR "Tokio Marine" OR "Sompo" '
                'OR "Aflac Japan" OR "MS&AD"'), region="日本"),
    _src("gnews_jp_industry", "日本保險產業",
         _gnews("保険 生命保険 損害保険", lang="ja", country="JP"),
         region="日本"),
    _src("gnews_jp_mini", "日本少額短期保險",
         _gnews("少額短期保険", lang="ja", country="JP"), region="日本"),
    _src("gnews_kr_companies_1", "韓國保險公司 1",
         _gnews("삼성생명 OR 한화생명 OR 교보생명", lang="ko", country="KR"),
         region="韓國"),
    _src("gnews_kr_companies_2", "韓國保險公司 2",
         _gnews("신한라이프 OR 동양생명 OR NH농협생명 OR KB라이프 OR 흥국생명",
                lang="ko", country="KR"),
         region="韓國"),
    _src("gnews_kr_companies_3", "韓國保險公司 3 (中型/外資)",
         _gnews("미래에셋생명 OR 메트라이프 OR ABL생명 OR DB생명",
                lang="ko", country="KR"),
         region="韓國"),
    _src("gnews_kr_en", "韓國保險（英文）",
         _gnews('"Samsung Life" OR "Hanwha Life" OR "Kyobo" '
                'OR "Shinhan Life" OR "NH NongHyup"'), region="韓國"),
    _src("gnews_kr_digital", "韓國數位保險/子品牌",
         _gnews("라이프플래닛 OR 토스인슈어런스 OR 카카오페이손해보험 "
                "OR 캐롯손해보험 OR 하나손해보험",
                lang="ko", country="KR"),
         region="韓國", type_="保險公司"),
    _src("gnews_kr_industry", "韓國保險產業",
         _gnews("보험 생명보험 손해보험", lang="ko", country="KR"),
         region="韓國"),
    _src("gnews_reinsurers", "全球再保公司",
         _gnews('"Swiss Re" OR "Munich Re" OR "Hannover Re" OR "SCOR reinsurance"')),
    # US lifers — per-carrier queries (not broad OR). GNews RSS caps each
    # search at ~100 results ranked by recency × relevance; a broad OR
    # query over 5+ carriers saturates on high-frequency news and pushes
    # tail PR launches (MassMutual "Wellness Offerings" 2026-05-19, which
    # contains the Living Well Rider) off the bottom even at days=30.
    # Per-carrier queries each get their own top-100 → low-volume PR
    # preserved.
    #
    # Window policy after backfill (measured weekly volumes 2026-06-04):
    # - days=30 PERMANENT for low-volume carriers (<5/wk) — sparse PR
    #   would miss the 7d window otherwise
    # - days=7 daily for high-volume carriers (≥5/wk) — saves quota /
    #   crawl time without losing recall
    _src("gnews_us_massmutual", "MassMutual",
         _gnews('"MassMutual" insurance OR annuity OR life',
                days=30),   # 1.4/wk — sparse, keep wide
         region="美國", type_="保險公司"),
    _src("gnews_us_northwestern_mutual", "Northwestern Mutual",
         _gnews('"Northwestern Mutual" insurance OR annuity OR life'),
         region="美國", type_="保險公司"),
    _src("gnews_us_nyl", "New York Life",
         _gnews('"New York Life" insurance OR annuity'),
         region="美國", type_="保險公司"),
    _src("gnews_us_metlife", "MetLife",
         _gnews('"MetLife" insurance OR annuity'),
         region="美國", type_="保險公司"),
    _src("gnews_us_prudential", "Prudential Financial (US)",
         _gnews('"Prudential Financial" insurance OR annuity OR retirement'),
         region="美國", type_="保險公司"),
    _src("gnews_us_pacific_life", "Pacific Life",
         _gnews('"Pacific Life" insurance OR annuity'),
         region="美國", type_="保險公司"),
    _src("gnews_us_lincoln", "Lincoln Financial",
         _gnews('"Lincoln Financial" insurance OR annuity'),
         region="美國", type_="保險公司"),
    _src("gnews_us_john_hancock", "John Hancock",
         _gnews('"John Hancock" insurance OR annuity OR life'),
         region="美國", type_="保險公司"),
    _src("gnews_us_guardian", "Guardian Life",
         _gnews('"Guardian Life" insurance',
                days=30),   # 4.2/wk — sparse, keep wide
         region="美國", type_="保險公司"),
    _src("gnews_us_tiaa", "TIAA",
         _gnews('"TIAA" insurance OR annuity OR retirement'),
         region="美國", type_="保險公司"),
    _src("gnews_us_mutual_omaha", "Mutual of Omaha",
         _gnews('"Mutual of Omaha" insurance',
                days=30),   # 2.8/wk — sparse, keep wide
         region="美國", type_="保險公司"),
    _src("gnews_consultants", "顧問公司",
         _gnews("McKinsey OR Deloitte OR EY OR KPMG insurance")),
    _src("gnews_ratings_1", "評級機構 1",
         _gnews('"AM Best" OR "Fitch Ratings" OR "Moody" insurance')),
    _src("gnews_ratings_2", "評級機構 2",
         _gnews('KBRA OR "Japan Credit Rating" insurance')),
    # Narrowed: site: queries returned too much noise (90%+ unrelated)
    _src("gnews_wsj_insurance", "WSJ 保險",
         _gnews('"insurance" "insurer" OR "underwriting" site:wsj.com'),
         type_="新聞媒體"),
    _src("gnews_bloomberg_insurance", "Bloomberg 保險",
         _gnews('"insurance" "insurer" OR "reinsurance" site:bloomberg.com'),
         type_="新聞媒體"),
    # Removed: gnews_nyt_insurance — consistently low relevance to insurance
    _src("gnews_sina_insurance", "新浪保險",
         _gnews("新浪 保险 OR 保險", lang="zh-Hans", country="CN"),
         region="中國", type_="新聞媒體"),
    _src("gnews_esg_insurance", "ESG 保險",
         _gnews("insurance ESG sustainability climate")),
    _src("gnews_product_launch_en", "壽險商品發表（英文）",
         _gnews('insurance "launches" OR "introduces" OR "rolls out" '
                '"new product" OR "new rider" OR "new plan" life',
                days=14),
         type_="新聞媒體"),
    _src("gnews_product_launch_zh", "壽險商品發表（中文）",
         _gnews('"推出新" OR "上市" OR "發表" 保險 商品 OR 保單',
                days=14, lang="zh-TW", country="TW"),
         type_="新聞媒體"),
    _src("gnews_hive_insurance", "Hive 保險",
         _gnews("Hive insurance services platform")),
    # Removed: gnews_neuroscience_insurance — 99% brain health articles, not insurance
    _src("gnews_tw_insurance", "台灣保險",
         _gnews("台灣 保險 壽險 產險", lang="zh-TW", country="TW"),
         region="台灣"),
]

# ---------------------------------------------------------------------------
# Asia life-insurance company expansion (2026-04-25)
# Strategy: list specific life-insurer brand names so noise from financial
# holding groups (TW), property insurers, and CSR/sports content stays low.
# Cross-checked with current LLM classifier — sports/CSR will be tagged
# noise_sports/noise_unrelated downstream. Review effectiveness after 1 week.
# ---------------------------------------------------------------------------
_GNEWS_ASIA_LIFE = [
    _src("gnews_tw_lifers", "台灣壽險公司 1",
         _gnews('"國泰人壽" OR "富邦人壽" OR "南山人壽" OR "新光人壽" '
                'OR "中國信託人壽" OR "台灣人壽" OR "三商美邦人壽" '
                'OR "全球人壽" OR "遠雄人壽"',
                lang="zh-TW", country="TW"),
         region="台灣", type_="保險公司"),
    _src("gnews_tw_lifers_2", "台灣壽險公司 2 (外資/中型)",
         _gnews('"保誠人壽" OR "安聯人壽" OR "法國巴黎人壽" '
                'OR "元大人壽" OR "宏泰人壽"',
                lang="zh-TW", country="TW"),
         region="台灣", type_="保險公司"),
    _src("gnews_in_lifers", "印度壽險公司 1",
         _gnews('"LIC" OR "Life Insurance Corporation of India" '
                'OR "HDFC Life" OR "ICICI Prudential" OR "SBI Life"',
                lang="en", country="IN"),
         region="印度", type_="保險公司"),
    _src("gnews_in_lifers_2", "印度壽險公司 2",
         _gnews('"Max Life" OR "Bajaj Allianz Life" OR "Tata AIA Life" '
                'OR "Aditya Birla Sun Life" OR "Reliance Nippon Life" '
                'OR "PNB MetLife" OR "Kotak Life"',
                lang="en", country="IN"),
         region="印度", type_="保險公司"),
    _src("gnews_in_industry", "印度保險產業",
         _gnews("India life insurance IRDAI premium", lang="en", country="IN"),
         region="印度"),
    # SE Asia: local-language + 30d window. After 1-week observation (~04-25→05-03):
    # - VN tightened: "Bao Viet" alone caught the conglomerate's non-life-insurer
    #   subsidiaries (travel, banking) → 62% filter rate. Now require "Life" or
    #   "Nhân thọ" (Vietnamese for "life insurance").
    # - MY tightened: "Etiqa" alone matched Malay common words / news → 86% filter
    #   rate (mostly local politics, accidents). Now require "Etiqa Life/Insurance".
    #   Also switched MY to lang=en since Malaysian English insurance press is
    #   denser than Malay-language insurance coverage.
    _src("gnews_id_lifers", "印尼壽險公司",
         _gnews('"AIA Indonesia" OR "AIA Financial" '
                'OR "Allianz Life Indonesia" OR "Prudential Indonesia" '
                'OR "AXA Mandiri" OR "Manulife Indonesia" '
                'OR "FWD Indonesia" OR "Sun Life Indonesia" OR "Sequis"',
                days=30, lang="id", country="ID"),
         region="印尼", type_="保險公司"),
    _src("gnews_th_lifers", "泰國壽險公司",
         _gnews('"AIA Thailand" OR "Muang Thai Life" OR "Thai Life Insurance" '
                'OR "Allianz Ayudhya" OR "Prudential Thai" OR "FWD Thai" '
                'OR "Krungthai-AXA" OR "Bangkok Life"',
                days=30, lang="th", country="TH"),
         region="泰國", type_="保險公司"),
    _src("gnews_th_lifers_en", "泰國壽險（英文）",
         _gnews('"AIA Thailand" OR "Muang Thai Life" OR "Thai Life Insurance" '
                'OR "Allianz Ayudhya" OR "Prudential Thailand" OR "FWD Thailand" '
                'life insurance',
                days=30, lang="en", country="SG"),
         region="泰國", type_="保險公司"),
    _src("gnews_vn_lifers", "越南壽險公司",
         _gnews('"Bao Viet Life" OR "Bảo Việt Nhân thọ" OR "Manulife Vietnam" '
                'OR "AIA Vietnam" OR "Prudential Vietnam" OR "Dai-ichi Life Vietnam" '
                'OR "FWD Vietnam" OR "Sun Life Vietnam" OR "Hanwha Life Vietnam"',
                days=30, lang="vi", country="VN"),
         region="越南", type_="保險公司"),
    _src("gnews_ph_lifers", "菲律賓壽險公司",
         _gnews('"AIA Philippines" OR "Sun Life Philippines" OR "Pru Life UK" '
                'OR "Manulife Philippines" OR "AXA Philippines" '
                'OR "Insular Life" OR "FWD Philippines" OR "BPI-AIA"',
                days=30, lang="en", country="PH"),
         region="菲律賓", type_="保險公司"),
    _src("gnews_my_lifers", "馬來西亞壽險公司 1",
         _gnews('"AIA Malaysia" OR "Prudential Malaysia" '
                'OR "Etiqa Life" OR "Etiqa Insurance" '
                'OR "Allianz Life Malaysia" OR "Great Eastern Malaysia"',
                days=30, lang="en", country="MY"),
         region="馬來西亞", type_="保險公司"),
    _src("gnews_my_lifers_2", "馬來西亞壽險公司 2",
         _gnews('"Manulife Malaysia" OR "Sun Life Malaysia" '
                'OR "Hong Leong Assurance" OR "Zurich Malaysia" '
                'OR "Tokio Marine Malaysia"',
                days=30, lang="en", country="MY"),
         region="馬來西亞", type_="保險公司"),
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
# Official / direct RSS (non-GNews feeds; feedparser eats them as-is)
# ---------------------------------------------------------------------------
_OFFICIAL_RSS = [
    _src("hkia_rss", "香港保監局 RSS",
         "http://www.ia.org.hk/tc/rss/rss_news_tc.xml",
         region="香港", type_="監管機構"),
    # 2026-07-09 source expansion — direct media feeds. GNews only surfaces
    # a fraction of these outlets (100-item cap saturation): shinnihon 89
    # of ~260/mo, insnews ~21%, IB Asia misses 28%.
    _src("shinnihon_rss", "新日本保險新聞",
         "https://www.shinnihon-ins.co.jp/industry-news/feed/",
         region="日本", type_="新聞媒體"),
    # Feed pages hold 10 items each; peak days run 14-26 posts, so page 2
    # widens the window to 20 for the 2-3 crawls/day cadence.
    _src("shinnihon_rss_p2", "新日本保險新聞 p2",
         "https://www.shinnihon-ins.co.jp/industry-news/feed/?paged=2",
         region="日本", type_="新聞媒體"),
    _src("insnews_kr", "韓國保險新聞",
         "https://www.insnews.co.kr/rss/allArticle.xml",
         region="韓國", type_="新聞媒體"),
    _src("ib_asia", "Insurance Business Asia",
         "https://www.insurancebusinessmag.com/asia/rss/",
         region="亞太", type_="新聞媒體"),
]

# ---------------------------------------------------------------------------
# HTTP / JSON first-party sources (official newsrooms + media without RSS)
# ---------------------------------------------------------------------------
_HTTP_BACKUP = [
    _src("air_news", "Asia Insurance Review",
         "https://www.asiainsurancereview.com",
         method="http", region="亞太", type_="新聞媒體"),
    _src("lia_sg", "新加坡壽險公會",
         "https://www.lia.org.sg/news-room/",
         method="http", region="新加坡", type_="監管機構"),
    # 2026-07-09: canonical URL (old media-centre.html 302s here) + URL
    # whitelist — the listing page mixes in ~17 product/lifepedia links
    # that pass the generic filters. Official cadence is 1-2 releases/mo;
    # the 137-article spike in 2026-04 was the first-crawl backfill of
    # the full 2017-2026 archive, not normal yield.
    _src("greateastern", "Great Eastern",
         "https://www.greateasternlife.com/sg/en/about-us/media-centre/"
         "media-releases.html",
         method="http", region="新加坡", type_="保險公司",
         url_must_contain="media-centre/media-releases/", max_items=10),
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
    # 2026-07-09 source expansion — first-party newsrooms that media
    # coverage cites but KB had zero primary articles from.
    # Sumitomo: static listing, titles median 44 chars; floor lowered to
    # 18 because rate-revision notices run exactly 19 chars.
    _src("sumitomo_life", "住友生命官網",
         "https://www.sumitomolife.co.jp/news/newsrelease/",
         method="http", region="日本", type_="保險公司",
         min_title_len=18, url_must_contain="/news/"),
    # Nissay's listing page is JS-rendered; this JSON index is the data
    # source behind it (static, 2016-now). method="json" + days window
    # prevents first-run ingestion of 880+ archive items.
    _src("nissay_news", "日本生命官網",
         "https://www.nissay.co.jp/kaisha/news/json/index.json",
         method="json", region="日本", type_="保險公司"),
    # CPIC origin is China Unicom Shanghai, no global CDN: cold requests
    # measured 13.6-17.8s, so timeout raised. Batch-published (CMS date
    # can lag events by 1-3 months).
    _src("cpic_group", "中國太平洋保險官網",
         "https://www.cpic.com.cn/aboutUs/gsdt/rdxw/index.shtml",
         method="http", region="中國", type_="保險公司", timeout=25,
         url_must_contain="/c/"),
    _src("cpic_health", "太平洋健康險官網",
         "https://www.cpic.com.cn/jkx/gytbal/rdxw/",
         method="http", region="中國", type_="保險公司", timeout=25,
         url_must_contain="/c/"),
]

# ---------------------------------------------------------------------------
# Combined: 93 sources (85 as of 2026-07 + 8 source expansion 2026-07-09:
# shinnihon x2 / insnews / IB Asia direct RSS, sumitomo / cpic x2 http,
# nissay json)
# ---------------------------------------------------------------------------
SOURCES = _GNEWS_EXISTING + _GNEWS_NEW + _GNEWS_ASIA_LIFE + _OFFICIAL_RSS + _HTTP_BACKUP
