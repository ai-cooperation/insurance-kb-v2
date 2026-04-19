"""RSS + HTTP crawler for Insurance KB v2. No Playwright."""

import hashlib
import json
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin

import feedparser
import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SEEN_PATH = DATA_DIR / "seen.json"

# Noise patterns: sponsorship-related content (insurance company name appears
# only as a sponsor, not as the subject of insurance news)
_NOISE_PATTERNS = re.compile(
    # Japanese sports (J-League, B.League, SV League)
    r"百年構想|J[123]リーグ|Jリーグ|SVリーグ|B\.?LEAGUE|"
    r"アントラーズ|レッズ|ガンバ|ホーリーホック|フロンターレ|"
    r"レイソル|グランパス|コンサドーレ|サンフレッチェ|"
    r"ヴィッセル|エスパルス|ベガルタ|アルビレックス|"
    r"ブレックス|ジェッツ|ブレイザーズ|サンバーズ|"
    r"vs\.\s*\S+\s*(第\d+節|試合)|ハイライト.*CHAMPIONSHIP|"
    r"サッカー.{0,10}(試合|結果|戦)|"
    r"バレーボール.{0,10}(試合|結果)|"
    # Korean sports (basketball, baseball, esports)
    r"역전승|꺾고.{0,5}(강|승)|4강\s*PO|플레이오프|"
    r"승\s*\d+패|連勝|女籃|男籃|冠軍戰.{0,5}(僅剩|勝)|"
    # Esports
    r"電子競技|esports?.{0,5}(defeat|win|lose)|e스포츠",
    re.IGNORECASE,
)


@dataclass
class CrawlResult:
    """Single crawled article."""

    source_id: str
    title: str
    url: str
    snippet: str = ""
    published: str = ""
    uid: str = field(default="")

    def __post_init__(self):
        if not self.uid:
            self.uid = hashlib.md5(self.url.encode()).hexdigest()[:12]


# ---------------------------------------------------------------------------
# Deduplicator
# ---------------------------------------------------------------------------
class Deduplicator:
    """Track seen UIDs via data/seen.json."""

    def __init__(self, path: Path = SEEN_PATH):
        self._path = path
        self._seen: set = set()
        self._load()

    def _load(self):
        if self._path.exists():
            try:
                data = json.loads(self._path.read_text(encoding="utf-8"))
                self._seen = set(data)
            except (json.JSONDecodeError, TypeError):
                self._seen = set()

    def save(self):
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(
            json.dumps(sorted(self._seen), ensure_ascii=False),
            encoding="utf-8",
        )

    def is_new(self, uid: str) -> bool:
        return uid not in self._seen

    def mark(self, uid: str):
        self._seen.add(uid)

    def filter_new(self, results: list) -> list:
        """Return only unseen results and mark them."""
        new = [r for r in results if self.is_new(r.uid)]
        for r in new:
            self.mark(r.uid)
        return new


# ---------------------------------------------------------------------------
# RSS crawling
# ---------------------------------------------------------------------------
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    )
}


def resolve_gnews_urls(results: list, max_resolve: int = 200) -> list:
    """Batch-resolve Google News redirect URLs after crawl.

    Only resolves up to max_resolve URLs per run to avoid timeout.
    Returns new list with resolved URLs.
    """
    try:
        from googlenewsdecoder import new_decoderv1
    except ImportError:
        logger.info("googlenewsdecoder not installed, skipping URL resolution")
        return results

    gnews = [(i, r) for i, r in enumerate(results)
             if "news.google.com/rss/articles" in r.url]
    if not gnews:
        return results

    to_resolve = gnews[:max_resolve]
    logger.info("Resolving %d/%d GNews URLs...", len(to_resolve), len(gnews))

    resolved = 0
    updated = list(results)
    for i, r in to_resolve:
        try:
            result = new_decoderv1(r.url, interval=1)
            if result.get("status"):
                updated[i] = CrawlResult(
                    source_id=r.source_id,
                    title=r.title,
                    url=result["decoded_url"],
                    snippet=r.snippet,
                    published=r.published,
                    uid=r.uid,
                )
                resolved += 1
        except Exception:
            pass

    logger.info("Resolved %d/%d GNews URLs", resolved, len(to_resolve))
    return updated


def crawl_rss(source: dict) -> list:
    """Crawl an RSS feed and return CrawlResult list."""
    url = source["url"]
    source_id = source["id"]
    results = []
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        feed = feedparser.parse(resp.content)
        for entry in feed.entries:
            title = entry.get("title", "").strip()
            link = entry.get("link", "").strip()
            if not title or not link:
                continue
            if _NOISE_PATTERNS.search(title):
                continue
            snippet = _clean_html(
                entry.get("summary", entry.get("description", ""))
            )
            published = _parse_date(entry)
            results.append(
                CrawlResult(
                    source_id=source_id,
                    title=title,
                    url=link,
                    snippet=snippet[:500],
                    published=published,
                )
            )
    except requests.RequestException as exc:
        logger.warning("RSS crawl failed for %s: %s", source_id, exc)
    return results


# ---------------------------------------------------------------------------
# HTTP crawling
# ---------------------------------------------------------------------------
def _is_article_url(url: str) -> bool:
    """Heuristic: article URLs typically have date segments or long paths."""
    from urllib.parse import urlparse
    path = urlparse(url).path
    # Skip bare category/section pages, login, search, about, contact
    skip_patterns = (
        '/category/', '/tag/', '/author/', '/page/',
        '/login', '/register', '/search', '/about', '/contact',
        '/privacy', '/terms', '/subscribe', '/newsletter',
    )
    if any(p in path.lower() for p in skip_patterns):
        return False
    # Article URLs usually have 3+ path segments or contain digits (dates)
    segments = [s for s in path.split('/') if s]
    if len(segments) < 2 and not any(c.isdigit() for c in path):
        return False
    return True


# Navigation/boilerplate titles to reject
_NAV_TITLES = {
    'advanced search', 'newsletter', 'home', 'about', 'contact',
    'subscribe', 'login', 'register', 'search', 'archives',
    'supplements', 'conference dailies', 'privacy policy',
    'terms of use', 'terms and conditions', 'sitemap',
}


def crawl_http(source: dict) -> list:
    """Crawl a web page for links and titles."""
    url = source["url"]
    source_id = source["id"]
    results = []
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        encoding = resp.apparent_encoding or "utf-8"
        html = resp.content.decode(encoding, errors="replace")
        soup = BeautifulSoup(html, "lxml")

        seen_urls = set()
        for a_tag in soup.find_all("a", href=True):
            href = a_tag["href"].strip()
            if not href or href.startswith("#") or href.startswith("javascript"):
                continue
            full_url = urljoin(url, href)
            if full_url in seen_urls:
                continue
            title = a_tag.get_text(strip=True)
            if not title or len(title) < 20:
                continue
            if _NOISE_PATTERNS.search(title):
                continue
            # Skip navigation and boilerplate links
            if title.lower().strip() in _NAV_TITLES:
                continue
            if not _is_article_url(full_url):
                continue
            seen_urls.add(full_url)
            results.append(
                CrawlResult(
                    source_id=source_id,
                    title=title[:200],
                    url=full_url,
                )
            )
    except requests.RequestException as exc:
        logger.warning("HTTP crawl failed for %s: %s", source_id, exc)
    return results


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------
def crawl_source(source: dict) -> list:
    """Dispatch to the correct crawler based on source method."""
    method = source.get("method", "rss")
    if method == "rss":
        return crawl_rss(source)
    elif method == "http":
        return crawl_http(source)
    else:
        logger.warning("Unknown method '%s' for source %s", method, source["id"])
        return []


def crawl_all(
    sources: list,
    dedup: Optional[Deduplicator] = None,
    delay: float = 1.0,
) -> list:
    """Crawl all sources, deduplicate, return new articles."""
    if dedup is None:
        dedup = Deduplicator()

    all_results = []
    for i, source in enumerate(sources):
        logger.info(
            "[%d/%d] Crawling %s (%s)...",
            i + 1, len(sources), source["id"], source["method"],
        )
        raw = crawl_source(source)
        new = dedup.filter_new(raw)
        all_results.extend(new)
        logger.info("  -> %d new / %d total", len(new), len(raw))
        if i < len(sources) - 1:
            time.sleep(delay)

    dedup.save()
    logger.info("Crawl complete: %d new articles total", len(all_results))
    return all_results


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
_TAG_RE = re.compile(r"<[^>]+>")


def _clean_html(text: str) -> str:
    """Strip HTML tags from text."""
    return _TAG_RE.sub("", text).strip()


def _parse_date(entry) -> str:
    """Extract published date from feed entry as YYYY-MM-DD."""
    for attr in ("published_parsed", "updated_parsed"):
        parsed = getattr(entry, attr, None)
        if parsed:
            try:
                dt = datetime(*parsed[:6])
                return dt.strftime("%Y-%m-%d")
            except (TypeError, ValueError):
                pass
    return datetime.now().strftime("%Y-%m-%d")
