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

const INDEX_KV_KEY = "articles:index";

export async function loadArticles(kv: KVNamespace): Promise<Article[]> {
  const cached = await kv.get(INDEX_KV_KEY, "json");
  if (cached && Array.isArray(cached)) {
    return cached as Article[];
  }
  return [];
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
