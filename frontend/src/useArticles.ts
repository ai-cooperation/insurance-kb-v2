// Fetch and transform articles from /data/articles.json (master-index.json)
// Maps backend Chinese keys to frontend English keys

import { useState, useEffect } from 'react';
import type { Article } from './types';

/** Backend master-index.json entry shape */
interface RawEntry {
  readonly uid: string;
  readonly title: string;
  readonly title_en: string;
  readonly date: string;
  readonly source: string;
  readonly source_url: string;
  readonly category: string;
  readonly region: string;
  readonly importance: string;
  readonly summary: string;
  readonly filter?: string;
}

const CATEGORY_MAP: Record<string, string> = {
  '監管動態': 'regulation',
  '產品創新': 'product',
  '市場趨勢': 'market',
  '科技應用': 'tech',
  '再保市場': 'reinsurance',
  'ESG永續': 'esg',
  '消費者保護': 'consumer',
  '人才與組織': 'people',
};

const IMPORTANCE_MAP: Record<string, 'high' | 'mid' | 'low'> = {
  '高': 'high',
  'high': 'high',
  '中': 'mid',
  'medium': 'mid',
  'mid': 'mid',
  '低': 'low',
  'low': 'low',
};

/** Strip HTML entities and tags from RSS snippets */
function cleanText(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function toArticle(raw: RawEntry, idx: number): Article {
  return {
    id: raw.uid || `idx-${idx}`,
    category: CATEGORY_MAP[raw.category] || 'market',
    region: raw.region || '全球',
    date: raw.date || '',
    importance: IMPORTANCE_MAP[raw.importance] || 'mid',
    source: raw.source || '',
    title_zh: cleanText(raw.title) || '',
    title_en: cleanText(raw.title_en) || '',
    summary: cleanText(raw.summary) || '',
    tags: [],
    url: raw.source_url || '#',
  };
}

export interface ArticleStore {
  readonly articles: readonly Article[];
  readonly loading: boolean;
  readonly error: string | null;
}

export function useArticles(): ArticleStore {
  const [articles, setArticles] = useState<readonly Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/data/articles.json')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((raw: RawEntry[]) => {
        if (cancelled) return;
        const mapped = raw
          .filter(e => !e.filter)
          .map((e, i) => toArticle(e, i));
        setArticles(mapped);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        console.warn('Failed to load articles, using empty list:', err);
        setError(err.message);
        setArticles([]);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  return { articles, loading, error };
}
