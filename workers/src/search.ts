/**
 * Keyword search over article index stored in KV.
 * Scoring: title match x3, category match x2, summary match x1.
 */

export interface Article {
  title: string;
  date: string;
  source: string;
  source_url?: string;
  url?: string;
  summary?: string;
  category?: string;
  region?: string;
  filter?: string;
}

export interface SearchResult {
  article: Article;
  score: number;
}

const ARTICLES_URL = "https://insurance-kb.cooperation.tw/data/articles.json";

// In-memory cache (lives for the duration of the Worker instance, ~30s-5min)
let _cachedArticles: Article[] | null = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function loadArticles(): Promise<Article[]> {
  const now = Date.now();
  if (_cachedArticles && now - _cacheTime < CACHE_TTL_MS) {
    return _cachedArticles;
  }

  try {
    const resp = await fetch(ARTICLES_URL);
    if (!resp.ok) return _cachedArticles || [];
    const data = (await resp.json()) as Article[];
    _cachedArticles = data.filter((a) => !a.filter);
    _cacheTime = now;
    return _cachedArticles;
  } catch {
    return _cachedArticles || [];
  }
}

export function searchArticles(
  articles: Article[],
  query: string,
  topN: number = 10,
): SearchResult[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return [];
  }

  const scored: SearchResult[] = [];

  for (const article of articles) {
    if (article.filter) {
      continue;
    }

    let score = 0;
    const titleLower = (article.title || "").toLowerCase();
    const categoryLower = (article.category || "").toLowerCase();
    const summaryLower = (article.summary || "").toLowerCase();

    for (const term of terms) {
      if (titleLower.includes(term)) {
        score += 3;
      }
      if (categoryLower.includes(term)) {
        score += 2;
      }
      if (summaryLower.includes(term)) {
        score += 1;
      }
    }

    if (score > 0) {
      scored.push({ article, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}
