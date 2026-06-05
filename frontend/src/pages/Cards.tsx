import React, { useState, useMemo, useEffect, useRef, useLayoutEffect } from 'react';
import { List, type RowComponentProps } from 'react-window';
import { Icon } from '../components/Icon';
import { Badge } from '../components/Badge';
import { Btn } from '../components/Button';
import { Select } from '../components/Select';
import { Modal } from '../components/Modal';
import { Empty } from '../components/Empty';
import { MiniCard } from './Home';
import { CATEGORIES, REGIONS, IMPORTANCE } from '../data';
import type { Article } from '../types';

interface ArticleModalProps {
  readonly article: Article | null;
  readonly onClose: () => void;
}

export const ArticleModal: React.FC<ArticleModalProps> = ({ article, onClose }) => {
  if (!article) return null;
  const a = article;
  return (
    <Modal open={!!a} onClose={onClose}>
      <div className="p-6 md:p-8">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge category={a.category} region={a.region} size="md" />
              <span className="text-[12px] font-mono text-slate-500 tabular-nums">{a.date}</span>
              <span className={`text-[12px] font-medium ${IMPORTANCE[a.importance].cls}`}>● 重要性：{IMPORTANCE[a.importance].zh}</span>
            </div>
            <h2 className="mt-4 text-[22px] md:text-[26px] font-semibold tracking-tight text-balance leading-tight">
              {a.title_zh}
            </h2>
            {a.title_en && <div className="mt-2 text-[14px] text-slate-500 dark:text-slate-400">{a.title_en}</div>}
          </div>
          <button onClick={onClose} className="shrink-0 p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500">
            <Icon name="x" className="w-5 h-5" />
          </button>
        </div>

        <p className="mt-6 text-[15.5px] leading-[1.75] text-slate-700 dark:text-slate-300 text-pretty">
          {a.summary} {a.summary}
        </p>

        <div className="mt-6">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-2">關鍵字</div>
          <div className="flex flex-wrap gap-1.5">
            {a.tags.map(t => (
              <span key={t} className="inline-block px-2 py-0.5 rounded border border-slate-200 dark:border-slate-800 text-[12px] text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900">
                #{t}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="text-[13px] text-slate-500 dark:text-slate-400">
            來源：<span className="font-medium text-slate-700 dark:text-slate-200">{a.source}</span>
          </div>
          <a href={a.url} target="_blank" rel="noopener noreferrer">
            <Btn variant="primary">
              查看原文 <Icon name="ext" className="w-3.5 h-3.5" />
            </Btn>
          </a>
        </div>
      </div>
    </Modal>
  );
};

const Chip: React.FC<{ readonly children: React.ReactNode; readonly onRemove: () => void }> = ({ children, onRemove }) => (
  <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
    {children}
    <button onClick={onRemove} className="p-0.5 hover:text-slate-900 dark:hover:text-white">
      <Icon name="x" className="w-3 h-3" />
    </button>
  </span>
);

interface CardsPageProps {
  readonly articles: readonly Article[];
  readonly loading: boolean;
  readonly openArticle: (a: Article) => void;
  // Lazy-load controls from useArticles. Cards triggers loadOlderMonths
  // when the user scrolls deep, and loadAllMonths when they enter a
  // filter / search query that needs the full archive.
  readonly totalAvailable?: number;
  readonly loadedMonthCount?: number;
  readonly totalMonthCount?: number;
  readonly fetchingMore?: boolean;
  readonly loadOlderMonths?: (count: number) => Promise<void>;
  readonly loadAllMonths?: () => Promise<void>;
}

/** Responsive column count to match the prior `grid-cols-1 md:grid-cols-2 xl:grid-cols-3` layout. */
function useResponsiveCols(): number {
  const get = () => {
    if (typeof window === 'undefined') return 3;
    if (window.matchMedia('(min-width: 1280px)').matches) return 3;
    if (window.matchMedia('(min-width: 768px)').matches) return 2;
    return 1;
  };
  const [cols, setCols] = useState(get);
  useEffect(() => {
    const handler = () => setCols(get());
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return cols;
}

/** Available viewport height for the virtualized list, minus the sticky filter bar. */
function useAvailableHeight(ref: React.RefObject<HTMLDivElement>): number {
  const [height, setHeight] = useState(() =>
    typeof window === 'undefined' ? 600 : Math.max(window.innerHeight - 200, 400)
  );
  useLayoutEffect(() => {
    const update = () => {
      const top = ref.current?.getBoundingClientRect().top ?? 200;
      setHeight(Math.max(window.innerHeight - top - 16, 400));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [ref]);
  return height;
}

/** Row of N cards rendered inside the virtualized list. */
type CardsRowProps = {
  readonly rows: readonly (readonly Article[])[];
  readonly cols: number;
  readonly openArticle: (a: Article) => void;
};

function CardsRow({ index, style, rows, cols, openArticle }: RowComponentProps<CardsRowProps>): React.ReactElement {
  const row = rows[index] ?? [];
  const colsClass =
    cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3';
  return (
    <div style={style} className="px-4 md:px-6">
      <div className={`grid ${colsClass} gap-4 pb-4`}>
        {row.map((a) => (
          <MiniCard key={a.id} a={a} onOpen={openArticle} />
        ))}
      </div>
    </div>
  );
}

export const CardsPage: React.FC<CardsPageProps> = ({
  articles,
  loading,
  openArticle,
  totalAvailable,
  loadedMonthCount,
  totalMonthCount,
  fetchingMore,
  loadOlderMonths,
  loadAllMonths,
}) => {
  const [cat, setCat] = useState('');
  const [region, setRegion] = useState('');
  const [q, setQ] = useState('');

  // When the user activates any filter or search, ensure the full archive
  // is available so results are not silently truncated to "loaded months
  // only". Browse-without-filter stays on the lazy 1-month default.
  const filterActive = cat || region || q;
  useEffect(() => {
    if (filterActive && loadAllMonths) {
      void loadAllMonths();
    }
  }, [filterActive, loadAllMonths]);

  const filtered = useMemo(() => {
    return articles.filter((a) => {
      if (cat && a.category !== cat) return false;
      if (region && a.region !== region) return false;
      if (q) {
        const hay = `${a.title_zh} ${a.title_en || ''} ${a.summary} ${a.source} ${a.tags.join(' ')}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [articles, cat, region, q]);

  const cols = useResponsiveCols();
  const rows = useMemo(() => {
    const out: Article[][] = [];
    for (let i = 0; i < filtered.length; i += cols) {
      out.push(filtered.slice(i, i + cols));
    }
    return out;
  }, [filtered, cols]);

  const listContainerRef = useRef<HTMLDivElement>(null);
  const listHeight = useAvailableHeight(listContainerRef);
  // MiniCard internal heights vary slightly with content; pick a generous
  // pixel size that accommodates the longest natural layout without
  // clipping. Sub-pixel-perfect packing is not worth the complexity here.
  const rowHeight = 252;

  const active = cat || region || q;
  const browsingFullArchive = loadedMonthCount === totalMonthCount;
  const counterTotal = totalAvailable ?? articles.length;

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* filter bar — sticky */}
      <div className="z-10 bg-white/80 dark:bg-slate-950/80 backdrop-blur border-b border-slate-200 dark:border-slate-900">
        <div className="px-4 md:px-6 py-3 flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[200px] relative">
            <Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜尋標題、摘要、關鍵字…"
              className="w-full h-9 pl-9 pr-3 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 ring-accent"
            />
          </div>
          <Select
            value={cat}
            onChange={setCat}
            placeholder="全部分類"
            className="w-[150px]"
            options={CATEGORIES.map((c) => ({ value: c.id, label: c.zh }))}
          />
          <Select
            value={region}
            onChange={setRegion}
            placeholder="全部地區"
            className="w-[130px]"
            options={REGIONS.map((r) => ({ value: r, label: r }))}
          />
          {active && (
            <Btn variant="ghost" size="md" onClick={() => { setCat(''); setRegion(''); setQ(''); }}>
              <Icon name="x" className="w-3.5 h-3.5" /> 清除篩選
            </Btn>
          )}
          <div className="ml-auto text-[12px] text-slate-500 dark:text-slate-400 flex items-center gap-2">
            {fetchingMore && (
              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <Icon name="sparkle" className="w-3 h-3 animate-pulse" /> 載入更多月份…
              </span>
            )}
            <span>
              共{' '}
              <span className="font-mono font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                {filtered.length}
              </span>
              {' / '}{counterTotal} 篇
              {!browsingFullArchive && loadedMonthCount !== undefined && totalMonthCount !== undefined && (
                <span className="ml-1 text-slate-400">（已載入 {loadedMonthCount}/{totalMonthCount} 月）</span>
              )}
            </span>
          </div>
        </div>

        {/* active chips */}
        {active && (
          <div className="px-4 md:px-6 pb-3 flex flex-wrap gap-1.5">
            {cat && <Chip onRemove={() => setCat('')}>分類：{CATEGORIES.find((c) => c.id === cat)?.zh}</Chip>}
            {region && <Chip onRemove={() => setRegion('')}>地區：{region}</Chip>}
            {q && <Chip onRemove={() => setQ('')}>搜尋：「{q}」</Chip>}
          </div>
        )}
      </div>

      {/* virtualized rows */}
      <div ref={listContainerRef} className="flex-1 pt-6">
        {loading && <div className="text-center py-12 text-slate-500">載入中…</div>}
        {!loading && filtered.length === 0 && (
          <div className="px-4 md:px-6">
            <Empty title="找不到符合條件的卡片" sub="試著移除一些篩選條件，或換個關鍵字。" />
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <List
            rowCount={rows.length}
            rowHeight={rowHeight}
            rowComponent={CardsRow}
            rowProps={{ rows, cols, openArticle }}
            style={{ height: listHeight }}
            overscanCount={2}
            onRowsRendered={(visible) => {
              // Prefetch the next month chunk once the user nears the bottom
              // of the loaded set. Browsing without filters relies on this
              // for "endless scroll" UX without forcing an upfront load.
              if (
                !active &&
                loadOlderMonths &&
                !browsingFullArchive &&
                rows.length > 0 &&
                visible.stopIndex >= rows.length - 5
              ) {
                void loadOlderMonths(1);
              }
            }}
          />
        )}
      </div>
    </div>
  );
};
