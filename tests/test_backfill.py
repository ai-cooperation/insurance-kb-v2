from urllib.parse import parse_qs, urlsplit

import pytest

from src.crawler import CrawlResult, Deduplicator, crawl_all, validate_date_range
from src.sources import with_gnews_lookback


def test_with_gnews_lookback_rewrites_query_without_mutating_sources():
    sources = [
        {
            "id": "gnews",
            "method": "rss",
            "url": (
                "https://news.google.com/rss/search?"
                "q=insurance+when%3A7d&hl=en&gl=US&ceid=US%3Aen"
            ),
        },
        {"id": "direct", "method": "rss", "url": "https://example.com/feed.xml"},
    ]

    widened = with_gnews_lookback(sources, 14)

    query = parse_qs(urlsplit(widened[0]["url"]).query)
    assert query["q"] == ["insurance when:14d"]
    assert query["ceid"] == ["US:en"]
    assert widened[1] == sources[1]
    assert widened is not sources
    assert widened[0] is not sources[0]
    assert "when%3A7d" in sources[0]["url"]


@pytest.mark.parametrize("days", [0, 91, True])
def test_with_gnews_lookback_rejects_unsafe_windows(days):
    with pytest.raises(ValueError):
        with_gnews_lookback([], days)


def test_crawl_all_filters_backfill_range_before_marking_seen(monkeypatch, tmp_path):
    results = [
        CrawlResult("sample", "before", "https://example.com/before", published="2026-09-01"),
        CrawlResult("sample", "inside", "https://example.com/inside", published="2026-09-05"),
        CrawlResult("sample", "after", "https://example.com/after", published="2026-09-11"),
        CrawlResult("sample", "unknown", "https://example.com/unknown", published=""),
    ]
    monkeypatch.setattr("src.crawler.crawl_source", lambda source: results)
    dedup = Deduplicator(tmp_path / "seen.json")

    actual = crawl_all(
        [{"id": "sample", "method": "rss"}],
        dedup=dedup,
        delay=0,
        published_from="2026-09-02",
        published_to="2026-09-10",
    )

    assert [item.title for item in actual] == ["inside"]
    assert dedup.is_new(results[0].uid)
    assert not dedup.is_new(results[1].uid)
    assert dedup.is_new(results[2].uid)
    assert dedup.is_new(results[3].uid)


@pytest.mark.parametrize(
    ("start", "end"),
    [
        ("2026-09-10", "2026-09-02"),
        ("2026-09-xx", "2026-09-10"),
        ("", "2026-09-10"),
        ("2026-09-02", ""),
    ],
)
def test_validate_date_range_rejects_invalid_or_partial_ranges(start, end):
    with pytest.raises(ValueError):
        validate_date_range(start, end)


def test_validate_date_range_accepts_absent_or_ordered_range():
    assert validate_date_range(None, None) == (None, None)
    assert validate_date_range("2026-09-02", "2026-09-10") == (
        "2026-09-02",
        "2026-09-10",
    )
