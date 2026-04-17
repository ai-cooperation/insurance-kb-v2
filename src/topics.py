"""Topic category and region mappings."""

CATEGORY_MAP = {
    "監管動態": "regulation",
    "產品創新": "products",
    "市場趨勢": "market",
    "科技應用": "technology",
    "再保市場": "reinsurance",
    "ESG永續": "esg",
    "消費者保護": "consumer",
    "人才與組織": "talent",
}

REGION_MAP = {
    "台灣": "taiwan",
    "中國": "china",
    "香港": "hongkong",
    "日本": "japan",
    "韓國": "korea",
    "新加坡": "singapore",
    "亞太": "asia-pacific",
    "美國": "us",
    "歐洲": "europe",
    "全球": "global",
}

CATEGORY_REVERSE = {v: k for k, v in CATEGORY_MAP.items()}
REGION_REVERSE = {v: k for k, v in REGION_MAP.items()}
