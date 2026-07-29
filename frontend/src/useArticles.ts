// Article loading hook backed by the monthly partition manifest.
//
// On mount the hook fetches `articles-manifest.json` (small index of all
// months) and the newest month file. Older months are loaded on demand
// via `loadMonth` / `loadOlderMonths`. Loaded month payloads are cached
// in IndexedDB so a returning user gets articles instantly while the
// network revalidates in the background.
//
// Public shape stays backward-compatible: `articles` is the union of all
// loaded months mapped to the frontend `Article` type. `loading` covers
// the initial manifest + newest month fetch. New fields expose lazy
// loading controls so the Cards / search UI can opt into archive
// without forcing every page to download the full payload.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Article } from './types';

/** Backend per-month file entry shape (matches build_frontend_data.py). */
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
}

interface ManifestMonth {
  readonly month: string;          // YYYY-MM
  readonly file: string;           // e.g. articles-2026-06.json
  readonly count: number;
  readonly size_kb: number;
  readonly newest: string;         // YYYY-MM-DD
  readonly oldest: string;         // YYYY-MM-DD
}

interface ManifestV2 {
  readonly version: 2;
  readonly newest_date: string;
  readonly total_visible: number;
  readonly months: readonly ManifestMonth[];   // newest-first
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
  '行銷推廣': 'marketing',
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

function cleanText(s: string | undefined | null): string {
  if (!s) return '';
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanSummary(summary: string, title: string): string {
  const cleaned = cleanText(summary);
  if (!cleaned || cleaned.length < 20) return '';
  if (title && cleaned.startsWith(title.slice(0, 30))) return '';
  return cleaned;
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
    summary: cleanSummary(raw.summary, raw.title),
    tags: [],
    url: raw.source_url || '#',
  };
}

// ─── IndexedDB cache (minimal inline helper) ────────────────────────────
//
// One object store keyed by `articles:{month}` holding the parsed
// RawEntry[]. Manifest version lives at `manifest:version` so we can
// invalidate stale entries when the backend changes shape. Cache is
// fire-and-forget — failures fall back to a network fetch.

const DB_NAME = 'insurance-kb-cache';
const DB_VERSION = 1;
const STORE = 'months';

let dbPromise: Promise<IDBDatabase | null> | null = null;
function openDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDB();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function idbClearStaleMonths(activeMonths: Set<string>): Promise<void> {
  const db = await openDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const keysReq = store.getAllKeys();
      keysReq.onsuccess = () => {
        const keys = (keysReq.result as IDBValidKey[]) ?? [];
        for (const key of keys) {
          if (typeof key !== 'string' || !key.startsWith('articles:')) continue;
          const month = key.slice('articles:'.length);
          if (!activeMonths.has(month)) {
            store.delete(key);
          }
        }
        resolve();
      };
      keysReq.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

// ─── Month fetch with cache-first + network revalidate ─────────────────
//
// `cache: 'no-cache'` forces conditional revalidation (ETag 304 when
// unchanged) instead of the browser's heuristic freshness. Without it the
// background "revalidate" could be answered by the browser's own stale
// HTTP cache, the length check then saw no difference, and the view
// stayed pinned to an old day indefinitely (stuck-at-2026-07-24 incident).

async function fetchMonth(
  file: string,
  onFresh?: (fresh: RawEntry[]) => void
): Promise<RawEntry[]> {
  const cacheKey = `articles:${file.replace(/^articles-|\.json$/g, '')}`;

  // Cache lookup first — returns instantly if present.
  const cached = await idbGet<RawEntry[]>(cacheKey);
  if (cached) {
    // Background revalidate: always refresh the cache, and surface the
    // fresh payload to the caller so the CURRENT view updates too (the
    // old code only wrote IndexedDB, so users saw stale data until the
    // next full visit).
    void (async () => {
      try {
        const resp = await fetch(`/data/${file}`, { cache: 'no-cache' });
        if (!resp.ok) return;
        const fresh = (await resp.json()) as RawEntry[];
        await idbPut(cacheKey, fresh);
        const changed =
          fresh.length !== cached.length ||
          fresh[0]?.uid !== cached[0]?.uid;
        if (changed && onFresh) onFresh(fresh);
      } catch {
        /* network down / refresh later */
      }
    })();
    return cached;
  }

  // Cache miss: fetch + populate.
  const resp = await fetch(`/data/${file}`, { cache: 'no-cache' });
  if (!resp.ok) throw new Error(`${file} HTTP ${resp.status}`);
  const data = (await resp.json()) as RawEntry[];
  void idbPut(cacheKey, data);
  return data;
}

// ─── Hook ───────────────────────────────────────────────────────────────

export interface ArticleStore {
  /** All articles from the months loaded so far, sorted newest-first. */
  readonly articles: readonly Article[];
  /** True while the initial manifest + newest month are loading. */
  readonly loading: boolean;
  /** Last fetch error, if any. */
  readonly error: string | null;
  /** Parsed manifest (null until first fetch resolves). */
  readonly manifest: ManifestV2 | null;
  /** Months that have been loaded into `articles`. */
  readonly loadedMonths: ReadonlySet<string>;
  /** True while at least one month fetch is in flight. */
  readonly fetchingMore: boolean;
  /** Request a specific month. No-op if already loaded or in flight. */
  readonly loadMonth: (month: string) => Promise<void>;
  /** Convenience: load the next N older unloaded months. */
  readonly loadOlderMonths: (count: number) => Promise<void>;
  /** Load every month in the manifest (used by full-corpus search). */
  readonly loadAllMonths: () => Promise<void>;
}

function mapMonthToArticles(raw: readonly RawEntry[]): Article[] {
  return raw
    .map((e, i) => toArticle(e, i))
    .filter((a) => a.title_zh.length >= 10);
}

function mergeArticles(prev: readonly Article[], add: readonly Article[]): Article[] {
  // De-dupe by id, preserving the latest seen version; sort newest-first.
  const byId = new Map<string, Article>();
  for (const a of prev) byId.set(a.id, a);
  for (const a of add) byId.set(a.id, a);
  return Array.from(byId.values()).sort((a, b) => b.date.localeCompare(a.date));
}

export function useArticles(): ArticleStore {
  const [manifest, setManifest] = useState<ManifestV2 | null>(null);
  const [articles, setArticles] = useState<readonly Article[]>([]);
  const [loadedMonths, setLoadedMonths] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );
  const [loading, setLoading] = useState(true);
  const [fetchingMore, setFetchingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dedupe concurrent loadMonth calls. Map<month, Promise> survives
  // re-renders via ref so callers from any render share the same in-flight.
  const inFlight = useRef(new Map<string, Promise<void>>());
  // Track loadedMonths via ref to avoid stale closures inside loadMonth.
  const loadedMonthsRef = useRef<Set<string>>(new Set());

  const loadMonth = useCallback(async (month: string): Promise<void> => {
    if (loadedMonthsRef.current.has(month)) return;
    const existing = inFlight.current.get(month);
    if (existing) return existing;

    const file = `articles-${month}.json`;
    setFetchingMore(true);
    const work = (async () => {
      try {
        const raw = await fetchMonth(file, (fresh) => {
          // Background revalidation delivered newer data for this month —
          // merge it into the live view immediately.
          setArticles((prev) => mergeArticles(prev, mapMonthToArticles(fresh)));
        });
        const mapped = mapMonthToArticles(raw);
        loadedMonthsRef.current.add(month);
        setLoadedMonths(new Set(loadedMonthsRef.current));
        setArticles((prev) => mergeArticles(prev, mapped));
      } catch (err) {
        setError((err as Error).message);
      } finally {
        inFlight.current.delete(month);
        if (inFlight.current.size === 0) setFetchingMore(false);
      }
    })();
    inFlight.current.set(month, work);
    return work;
  }, []);

  const loadOlderMonths = useCallback(
    async (count: number): Promise<void> => {
      if (!manifest || count <= 0) return;
      const queue = manifest.months
        .map((m) => m.month)
        .filter((m) => !loadedMonthsRef.current.has(m))
        .slice(0, count);
      // Sequential — keeps memory peak modest and lets early results render.
      for (const month of queue) {
        await loadMonth(month);
      }
    },
    [manifest, loadMonth]
  );

  const loadAllMonths = useCallback(async (): Promise<void> => {
    if (!manifest) return;
    const queue = manifest.months
      .map((m) => m.month)
      .filter((m) => !loadedMonthsRef.current.has(m));
    // Parallel by default — 115+ months serially would dominate the
    // search UX on cold cache. The browser caps concurrent connections
    // per origin (~6 in Chromium) so excess requests queue naturally;
    // we don't need to chunk further. fetchMonth itself dedupes via
    // inFlight if the same month is requested twice.
    await Promise.all(queue.map((month) => loadMonth(month)));
  }, [manifest, loadMonth]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const resp = await fetch('/data/articles-manifest.json', {
          cache: 'no-cache',
        });
        if (!resp.ok) throw new Error(`manifest HTTP ${resp.status}`);
        const m = (await resp.json()) as ManifestV2;
        if (cancelled) return;
        setManifest(m);

        // Drop any cached month files that no longer exist in the new
        // manifest (e.g. emptied via full reclassify). Fire-and-forget.
        void idbClearStaleMonths(new Set(m.months.map((mm) => mm.month)));

        if (m.months.length === 0) {
          setLoading(false);
          return;
        }
        await loadMonth(m.months[0].month);
        if (cancelled) return;
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Bootstrap once. loadMonth is stable (deps: []), so omitting it from
    // deps does not produce stale closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    articles,
    loading,
    error,
    manifest,
    loadedMonths,
    fetchingMore,
    loadMonth,
    loadOlderMonths,
    loadAllMonths,
  };
}
