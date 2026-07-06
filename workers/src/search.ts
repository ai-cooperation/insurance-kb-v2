/**
 * Keyword search over article index stored in KV.
 * Scoring: title match x3, original-title (title_en) match x3,
 * category match x2, summary match x1.
 *
 * title_en carries the untranslated original headline (Korean/Japanese/
 * English). Indexing it lets queries in the source language ("라이나")
 * or in the original English brand name ("Lina") hit articles whose zh
 * title uses the canonical translation — the zh-only index broke that
 * chain whenever translation and query disagreed (2026-07-06 fix).
 */

export interface Article {
  title: string;
  title_en?: string;
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

/**
 * Query-side company aliases: Korean company name → canonical rendering
 * used in zh titles. Bridges queries in Korean to articles whose source
 * was English/Chinese and therefore contain no Hangul at all (e.g. a
 * Lina Life press release crawled from an English feed). Canonical
 * renderings must stay in sync with the standard table in
 * src/classifier.py (_KR_NAME_MAP / _LLM_SYSTEM).
 * All values lowercase — they are matched against lowercased fields.
 */
const QUERY_ALIASES: Record<string, string[]> = {
  "라이나생명": ["lina人壽"],
  "라이나손해보험": ["lina損害保險"],
  "라이나": ["lina"],
  "アフラック": ["aflac"],
  "メットライフ": ["大都會人壽"],
  "マニュライフ": ["宏利人壽"],
  "プルデンシャル": ["保德信生命"],
  "ジブラルタ": ["直布羅陀生命"],
  "ライフネット": ["lifenet"],
  "かんぽ": ["郵政生命"],
  // AXA is legitimately dual-named: 安盛 (official zh, dominant in HK
  // articles) vs AXA (Latin, used in KR/JP renderings). Bridge both ways
  // instead of rewriting either — both names are correct.
  "アクサ": ["axa", "安盛"],
  "axa": ["安盛"],
  "安盛": ["axa"],
  "삼성생명": ["三星人壽"],
  "한화생명": ["韓華人壽"],
  "교보생명": ["教保人壽"],
  "신한라이프": ["新韓人壽"],
  "동양생명": ["東洋人壽"],
  "미래에셋생명": ["未來資產人壽"],
  "흥국생명": ["興國人壽"],
  "농협생명": ["農協人壽"],
  "메트라이프": ["大都會人壽"],
  "하나생명": ["hana人壽"],
  "하나손해보험": ["hana損保", "hana損害保險"],
  "삼성화재": ["三星火災"],
  "현대해상": ["現代海上"],
  "메리츠화재": ["meritz火災"],
  "흥국화재": ["興國火災"],
  "롯데손해보험": ["樂天損保"],
  "카카오페이손해보험": ["kakaopay損"],
  "푸본현대생명": ["富邦現代人壽"],
  "KB라이프": ["kb人壽"],
  "KB손해보험": ["kb損保", "kb損害保險"],
  "DB손해보험": ["db損保", "db損害保險"],
  "iM라이프": ["im人壽"],
};

/** A term plus its alias expansions — a field matches if ANY member appears. */
function expandTerm(term: string): string[] {
  const expansions = [term];
  for (const [korean, aliases] of Object.entries(QUERY_ALIASES)) {
    if (term.includes(korean.toLowerCase())) {
      expansions.push(...aliases);
    }
  }
  return expansions;
}

function fieldMatches(field: string, termGroup: string[]): boolean {
  return termGroup.some((t) => field.includes(t));
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

  const termGroups = terms.map(expandTerm);
  const scored: SearchResult[] = [];

  for (const article of articles) {
    if (article.filter) {
      continue;
    }

    let score = 0;
    const titleLower = (article.title || "").toLowerCase();
    const titleEnLower = (article.title_en || "").toLowerCase();
    const categoryLower = (article.category || "").toLowerCase();
    const summaryLower = (article.summary || "").toLowerCase();

    for (const group of termGroups) {
      if (fieldMatches(titleLower, group)) {
        score += 3;
      }
      if (fieldMatches(titleEnLower, group)) {
        score += 3;
      }
      if (fieldMatches(categoryLower, group)) {
        score += 2;
      }
      if (fieldMatches(summaryLower, group)) {
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
