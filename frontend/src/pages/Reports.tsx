/**
 * Reports page — wiki-tree pattern (matches hematology-kb's 疾病全貌).
 *
 * Layout:
 *   ┌─ left tree (240px, lg+ only)  ─┬─ right content (flex-1) ───────┐
 *   │   V1 行銷策略研究               │                                 │
 *   │     ├─ V1 主報告（完整版）      │  <selected report content>      │
 *   │     ├─ ch01 研究總覽           │                                 │
 *   │     └─ ...                     │                                 │
 *   │   V2 飛輪策略                   │                                 │
 *   │     └─ ...                     │                                 │
 *   └────────────────────────────────┴─────────────────────────────────┘
 *
 * Mobile: tree collapses behind a "選擇報告" drawer trigger at top of content.
 */

import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useReportsTree, useReportDetail } from '../useReports';
import type { ReportMeta, TopicMeta } from '../types';
import { Icon } from '../components/Icon';
import { RESEARCH_CATALOG, type PlannedItem } from '../data/researchCatalog';

interface ReportsPageProps {
  readonly apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  readonly hasFeature: (key: string) => boolean;
  /** From URL deep link: /reports/<id> — selects this report on mount */
  readonly initialReportId?: string | null;
}

function formatDate(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Strip Pandoc/Quarto-specific markdown that doesn't render in web:
 *   - YAML frontmatter (--- ... ---) at top of file
 *   - \newpage / \pagebreak directives
 *   - Stray Pandoc raw blocks like ```{=latex} ... ```
 *
 * Idempotent — runs every render, cheap O(n) regex passes.
 */
function cleanupMarkdown(md: string): string {
  let out = md;
  // Strip leading YAML frontmatter (must be at very start, between --- fences)
  out = out.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  // Strip \newpage / \pagebreak as standalone lines (keep surrounding whitespace tidy)
  out = out.replace(/^\\(newpage|pagebreak)\s*$/gm, '');
  // Strip raw latex/html blocks Pandoc inserts
  out = out.replace(/```\{=\w+\}[\s\S]*?```/g, '');
  // Collapse 3+ blank lines into 2
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trimStart();
}

// ── Planned badge (規劃中 marker, ARIA-friendly text not emoji) ─────────

const PlannedBadge: React.FC<{ priority?: number }> = ({ priority }) => (
  <span
    className="text-[9.5px] font-semibold px-1.5 py-px rounded shrink-0
      bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400
      uppercase tracking-wider"
    aria-label="尚未產出"
  >
    {priority && priority <= 5 ? `P${priority}` : '規劃中'}
  </span>
);

// ── Tree node (collapsible topic with chapter list) ────────────────────

interface TopicNodeProps {
  readonly topic: TopicMeta;
  readonly reports: readonly ReportMeta[];
  /** Planned reports that belong inside this live topic (e.g. 印尼 inside 亞洲健康險生態圈) */
  readonly plannedReports?: readonly PlannedItem[];
  readonly activeId: string | null;
  readonly onSelect: (id: string) => void;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}

const TopicNode: React.FC<TopicNodeProps> = ({ topic, reports, plannedReports = [], activeId, onSelect, expanded, onToggle }) => {
  const iconName = topic.icon || 'book';
  const totalCount = reports.length + plannedReports.length;
  // Planned reports float to top (work-in-flight), sorted by priority asc.
  // Live reports below, keep sort_order asc (preserves editorial intent —
  // V1 chapters, 跨市場總結 sort=0 pinning, etc).
  const sortedPlanned = [...plannedReports].sort((a, b) => a.priority - b.priority);
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-2 h-9 rounded-md text-[13px] transition
          text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70"
      >
        <Icon name={expanded ? 'chevD' : 'chevR'} className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <Icon name={iconName} className="w-4 h-4 text-slate-500 shrink-0" />
        <span className="truncate text-left flex-1 font-medium">{topic.title}</span>
        <span className="text-[11px] text-slate-400">
          {reports.length}{plannedReports.length > 0 ? `+${plannedReports.length}` : ''}
        </span>
      </button>
      {expanded && totalCount > 0 && (
        <div className="ml-5 border-l border-slate-200 dark:border-slate-800 pl-1 mt-0.5 space-y-0.5 pb-1">
          {sortedPlanned.map(p => (
            <div
              key={p.id}
              title={p.summary}
              className="px-2 h-7 rounded-md text-[12.5px] flex items-center gap-1.5
                text-slate-400 dark:text-slate-500 cursor-not-allowed opacity-70"
              aria-disabled="true"
            >
              <span className="truncate flex-1">{p.title}</span>
              <PlannedBadge priority={p.priority} />
            </div>
          ))}
          {reports.map(r => (
            <button
              key={r.id}
              onClick={() => onSelect(r.id)}
              className={`w-full text-left px-2 h-7 rounded-md text-[12.5px] transition flex items-center gap-1.5
                ${activeId === r.id
                  ? 'bg-accent-soft text-accent font-medium'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70'}`}
            >
              {r.sort_order === 0 && (
                <Icon name="star" className="w-3 h-3 text-amber-500 shrink-0" />
              )}
              <span className="truncate">{r.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Planned topic node (no backing topic in DB yet) ─────────────────────

const PlannedTopicNode: React.FC<{ readonly item: PlannedItem }> = ({ item }) => (
  <div
    title={item.summary}
    className="w-full flex items-center gap-1.5 px-2 h-9 rounded-md text-[13px]
      text-slate-400 dark:text-slate-500 cursor-not-allowed opacity-70"
    aria-disabled="true"
  >
    <span className="w-3.5 h-3.5 shrink-0" />
    <Icon name="book" className="w-4 h-4 shrink-0" />
    <span className="truncate text-left flex-1">{item.title}</span>
    <PlannedBadge priority={item.priority} />
  </div>
);

// ── Category section header (collapsible) ──────────────────────────────

interface CategoryHeaderProps {
  readonly title: string;
  readonly liveCount: number;
  readonly plannedCount: number;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}

const CategoryHeader: React.FC<CategoryHeaderProps> = ({ title, liveCount, plannedCount, expanded, onToggle }) => (
  <button
    onClick={onToggle}
    className="w-full px-2 pt-3 pb-1 flex items-center gap-1.5 hover:bg-slate-100/50 dark:hover:bg-slate-800/30 rounded-md transition"
    aria-expanded={expanded}
  >
    <Icon name={expanded ? 'chevD' : 'chevR'} className="w-3 h-3 text-slate-400 shrink-0" />
    <span className="text-[10.5px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 flex-1 truncate text-left">
      {title}
    </span>
    <span className="text-[10px] text-slate-400 dark:text-slate-600 shrink-0 tabular-nums">
      {liveCount}/{liveCount + plannedCount}
    </span>
  </button>
);

// ── Detail (markdown render + print toolbar) ──────────────────────────

interface DetailProps {
  readonly apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  readonly reportId: string | null;
  readonly onOpenTree: () => void;
  readonly hasFeature: (key: string) => boolean;
}

const ReportDetailView: React.FC<DetailProps> = ({ apiFetch, reportId, onOpenTree, hasFeature }) => {
  const { detail, loading, error } = useReportDetail(apiFetch, reportId);
  const canDownload = hasFeature('download_reports');

  // Set document.title to the report title so browser print-to-PDF uses
  // the report name as the suggested filename (instead of "保險產業智能知識庫.pdf").
  // Reset to default site title when leaving the detail view.
  React.useEffect(() => {
    const original = document.title;
    if (detail?.meta?.title) {
      document.title = detail.meta.title;
    }
    return () => { document.title = original; };
  }, [detail?.meta?.title]);

  // Click-handler for [^N] footnote anchors — react-markdown renders them as
  // <a href="#user-content-fn-N">. Default browser behavior is fine, no extra work.

  if (!reportId) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-slate-400 text-sm">
        <div className="text-center">
          <Icon name="book" className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <div>從左側選擇一份報告開始閱讀</div>
        </div>
      </div>
    );
  }
  if (loading) return <div className="p-8 text-slate-400 text-sm">載入中…</div>;
  if (error) return <div className="p-8 text-red-500 text-sm">載入失敗：{error}</div>;
  if (!detail) return null;

  const { meta, content } = detail;

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-4xl mx-auto p-5 sm:p-6 print:p-0 print:max-w-none">
        {/* Toolbar (hidden on print) */}
        <div className="flex items-center gap-3 mb-4 print:hidden">
          <button
            onClick={onOpenTree}
            className="lg:hidden text-sm text-slate-500 hover:text-accent flex items-center gap-1"
            title="開啟報告選單"
          >
            <Icon name="menu" className="w-4 h-4" />
            報告列表
          </button>
          <div className="ml-auto flex gap-2">
            {canDownload && (
              <button
                onClick={() => window.print()}
                className="text-xs px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:border-accent hover:text-accent transition flex items-center gap-1.5"
                title="使用瀏覽器列印 → 另存為 PDF"
              >
                <Icon name="ext" className="w-3.5 h-3.5" />
                下載 PDF
              </button>
            )}
          </div>
        </div>

        {/* Meta header */}
        <div className="mb-6 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {meta.category && (
              <span className="text-[11px] px-2 py-0.5 rounded bg-accent-soft text-accent font-medium">
                {meta.category}
              </span>
            )}
            {meta.region && (
              <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                {meta.region}
              </span>
            )}
            {meta.tags.slice(0, 4).map(t => (
              <span key={t} className="text-[11px] px-2 py-0.5 rounded bg-slate-50 dark:bg-slate-800/50 text-slate-500">
                #{t}
              </span>
            ))}
          </div>
          <h1 className="text-xl sm:text-2xl font-bold leading-tight mb-2">{meta.title}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-500 dark:text-slate-400">
            {meta.author_name && <span>{meta.author_name}</span>}
            <span>·</span>
            <span>{formatDate(meta.created_at)}</span>
            {/* In-place updates (pipeline re-runs) are otherwise invisible —
                the reader sees the original date and cannot tell the content
                changed. Show it whenever it differs by more than a day. */}
            {meta.updated_at - meta.created_at > 86400 && (
              <>
                <span>·</span>
                <span className="text-emerald-600 dark:text-emerald-400">
                  更新於 {formatDate(meta.updated_at)}
                </span>
              </>
            )}
            <span>·</span>
            <span>{meta.word_count.toLocaleString()} 字</span>
            {meta.finding_count > 0 && (
              <>
                <span>·</span>
                <span>{meta.finding_count} 引用</span>
              </>
            )}
            {meta.view_count > 0 && (
              <>
                <span>·</span>
                <span>閱讀 {meta.view_count}</span>
              </>
            )}
          </div>
        </div>

        {/* Markdown body */}
        <article className="prose prose-slate dark:prose-invert max-w-none prose-headings:scroll-mt-16 prose-pre:bg-slate-900 prose-pre:text-slate-100">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleanupMarkdown(content)}</ReactMarkdown>
        </article>
      </div>
    </div>
  );
};

// ── Topic header (shown when topic selected but no specific report) ────

const TopicSummary: React.FC<{
  readonly topic: TopicMeta;
  readonly reports: readonly ReportMeta[];
  readonly onSelect: (id: string) => void;
}> = ({ topic, reports, onSelect }) => (
  <div className="flex-1 overflow-auto">
    <div className="max-w-3xl mx-auto p-5 sm:p-6">
      <div className="flex items-start gap-3 mb-4">
        <Icon name={topic.icon || 'book'} className="w-7 h-7 text-accent shrink-0 mt-1" />
        <div>
          <h1 className="text-xl sm:text-2xl font-bold leading-tight mb-1">{topic.title}</h1>
          <div className="text-[12px] text-slate-500">{reports.length} 份報告</div>
        </div>
      </div>
      {topic.summary && (
        <p className="text-[14px] text-slate-600 dark:text-slate-400 leading-relaxed mb-6">
          {topic.summary}
        </p>
      )}
      <h2 className="text-[13px] font-mono uppercase tracking-wider text-slate-500 mb-2">章節</h2>
      <div className="space-y-1.5">
        {reports.map(r => (
          <button
            key={r.id}
            onClick={() => onSelect(r.id)}
            className="w-full text-left p-3 rounded-md border border-slate-200 dark:border-slate-800 hover:border-accent hover:bg-accent-soft/30 transition group"
          >
            <div className="flex items-center gap-2">
              {r.sort_order === 0 && (
                <Icon name="star" className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              )}
              <span className="text-[14px] font-medium group-hover:text-accent transition">{r.title}</span>
            </div>
            {r.summary && (
              <div className="text-[12px] text-slate-500 mt-1 line-clamp-2 leading-relaxed">{r.summary}</div>
            )}
          </button>
        ))}
      </div>
    </div>
  </div>
);

// ── Main page ─────────────────────────────────────────────────────────

export const ReportsPage: React.FC<ReportsPageProps> = ({ apiFetch, hasFeature, initialReportId }) => {
  const { topics, reports, loading, error, canView } = useReportsTree(apiFetch, hasFeature);
  const [selectedId, setSelectedId] = useState<string | null>(initialReportId ?? null);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Category-level collapse state — all categories collapsed by default so
  // the nav stays short on first load; user clicks a category to expand.
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);

  // Group reports by topic_id
  const reportsByTopic = useMemo(() => {
    const map: Record<string, ReportMeta[]> = {};
    for (const r of reports) {
      const key = r.topic_id || '__orphan__';
      if (!map[key]) map[key] = [];
      map[key].push(r);
    }
    return map;
  }, [reports]);

  // Initial selection: if URL is /reports/<id>, that id wins (already set in
  // initial state). Otherwise show most-recent topic's summary in main pane.
  // Either way, leave the tree topics collapsed by default.
  useEffect(() => {
    if (topics.length > 0 && !selectedTopicId && !selectedId) {
      setSelectedTopicId(topics[0].id);
    }
  }, [topics, selectedTopicId, selectedId]);

  // React to deep-link changes (browser back/forward)
  useEffect(() => {
    if (initialReportId !== undefined && initialReportId !== null && initialReportId !== selectedId) {
      setSelectedId(initialReportId);
      setSelectedTopicId(null);
    }
  }, [initialReportId, selectedId]);

  if (!canView) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md text-center text-slate-500">
          <Icon name="lock" className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <div className="text-sm">需要 <span className="font-mono text-accent">view_reports</span> 權限才能瀏覽研究報告</div>
        </div>
      </div>
    );
  }

  const toggleTopic = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleCategory = (id: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectReport = (id: string) => {
    setSelectedId(id);
    setSelectedTopicId(null);
    setMobileTreeOpen(false);
    // Update URL so deep-link/share works + browser back button does the right thing
    const target = `/reports/${id}`;
    if (window.location.pathname !== target) {
      window.history.pushState({}, '', target);
    }
  };

  const selectTopic = (id: string) => {
    setSelectedTopicId(id);
    setSelectedId(null);
    setExpanded(prev => new Set(prev).add(id));
  };

  // Live topic_id → TopicMeta lookup (for catalog rendering)
  const topicById = useMemo(() => {
    const m: Record<string, TopicMeta> = {};
    for (const t of topics) m[t.id] = t;
    return m;
  }, [topics]);

  // Topic IDs already placed under a category in RESEARCH_CATALOG.
  // Any live topic not in this set falls through to the "未分類主題" section.
  const categorizedTopicIds = useMemo(
    () => new Set(RESEARCH_CATALOG.flatMap(c => c.live_topic_ids)),
    [],
  );
  const orphanTopics = useMemo(
    () => topics.filter(t => !categorizedTopicIds.has(t.id)),
    [topics, categorizedTopicIds],
  );

  // Compute "latest live report date" per category for ordering.
  // Categories with newer activity float to top; planned-only categories sink
  // to bottom in editorial order.
  const sortedCategories = useMemo(() => {
    const withMeta = RESEARCH_CATALOG.map((cat, editorialIdx) => {
      const liveReports = cat.live_topic_ids.flatMap(id => reportsByTopic[id] || []);
      const latestCreated = liveReports.reduce(
        (max, r) => Math.max(max, r.created_at || 0),
        0,
      );
      return { cat, latestCreated, editorialIdx };
    });
    // Sort: newer latestCreated first; if both 0 (planned-only), preserve editorial order.
    withMeta.sort((a, b) => {
      if (a.latestCreated !== b.latestCreated) return b.latestCreated - a.latestCreated;
      return a.editorialIdx - b.editorialIdx;
    });
    return withMeta.map(m => m.cat);
  }, [reportsByTopic]);

  // Tree component (rendered in both desktop sidebar + mobile drawer)
  const TreeContent: React.FC = () => (
    <div className="space-y-0.5 px-1.5 py-2">
      {loading && <div className="px-2 py-3 text-sm text-slate-400">載入中…</div>}
      {error && <div className="px-2 py-3 text-sm text-red-500">{error}</div>}
      {!loading && !error && topics.length === 0 && RESEARCH_CATALOG.length === 0 && (
        <div className="px-2 py-3 text-sm text-slate-400">尚無報告主題</div>
      )}

      {/* Catalog-driven categories — collapsed by default; ordered by newest live report.
          Inside each category: topic-level planned items first (work-in-flight),
          then live topics (sorted by newest report inside) */}
      {!loading && !error && sortedCategories.map(cat => {
        const liveTopicsInCat = cat.live_topic_ids
          .map(id => topicById[id])
          .filter((t): t is TopicMeta => !!t);
        // Sort live topics within category by newest report inside, desc
        const liveTopicsSorted = [...liveTopicsInCat].sort((a, b) => {
          const aLatest = (reportsByTopic[a.id] || []).reduce((m, r) => Math.max(m, r.created_at || 0), 0);
          const bLatest = (reportsByTopic[b.id] || []).reduce((m, r) => Math.max(m, r.created_at || 0), 0);
          return bLatest - aLatest;
        });
        const liveReportCount = liveTopicsInCat.reduce(
          (sum, t) => sum + (reportsByTopic[t.id]?.length ?? 0),
          0,
        );
        const reportInTopicPlanned = cat.planned.filter(p => p.kind === 'report-in-topic');
        const topicLevelPlanned = [...cat.planned.filter(p => p.kind === 'topic')]
          .sort((a, b) => a.priority - b.priority);
        const totalPlanned = cat.planned.length;
        const catExpanded = expandedCategories.has(cat.id);
        return (
          <div key={cat.id}>
            <CategoryHeader
              title={cat.title}
              liveCount={liveReportCount}
              plannedCount={totalPlanned}
              expanded={catExpanded}
              onToggle={() => toggleCategory(cat.id)}
            />
            {catExpanded && (
              <>
                {/* Topic-level planned first (work-in-flight floats up) */}
                {topicLevelPlanned.map(p => <PlannedTopicNode key={p.id} item={p} />)}
                {/* Then live topics, newest first */}
                {liveTopicsSorted.map(t => {
                  const plannedInThisTopic = reportInTopicPlanned.filter(p => p.parent_topic_id === t.id);
                  return (
                    <TopicNode
                      key={t.id}
                      topic={t}
                      reports={reportsByTopic[t.id] || []}
                      plannedReports={plannedInThisTopic}
                      activeId={selectedId}
                      onSelect={selectReport}
                      expanded={expanded.has(t.id)}
                      onToggle={() => {
                        if (!expanded.has(t.id)) selectTopic(t.id);
                        else toggleTopic(t.id);
                      }}
                    />
                  );
                })}
              </>
            )}
          </div>
        );
      })}

      {/* Live topics not yet assigned to any category */}
      {!loading && !error && orphanTopics.length > 0 && (
        <div>
          <CategoryHeader
            title="未分類主題"
            liveCount={orphanTopics.length}
            plannedCount={0}
            expanded={expandedCategories.has('__orphan_topics__')}
            onToggle={() => toggleCategory('__orphan_topics__')}
          />
          {expandedCategories.has('__orphan_topics__') && orphanTopics.map(t => (
            <TopicNode
              key={t.id}
              topic={t}
              reports={reportsByTopic[t.id] || []}
              activeId={selectedId}
              onSelect={selectReport}
              expanded={expanded.has(t.id)}
              onToggle={() => {
                if (!expanded.has(t.id)) selectTopic(t.id);
                else toggleTopic(t.id);
              }}
            />
          ))}
        </div>
      )}

      {/* Reports without topic — keep at very bottom */}
      {reportsByTopic.__orphan__ && reportsByTopic.__orphan__.length > 0 && (
        <div className="pt-2 mt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="px-2 mb-1 text-[10.5px] font-mono uppercase tracking-wider text-slate-400">未分類報告</div>
          {reportsByTopic.__orphan__.map(r => (
            <button
              key={r.id}
              onClick={() => selectReport(r.id)}
              className={`w-full text-left px-2 h-7 rounded-md text-[12.5px] transition
                ${selectedId === r.id
                  ? 'bg-accent-soft text-accent font-medium'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70'}`}
            >
              {r.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const selectedTopic = selectedTopicId ? topics.find(t => t.id === selectedTopicId) : null;

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Desktop tree (lg+) */}
      <aside className="hidden lg:flex shrink-0 w-64 border-r border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/40 overflow-y-auto flex-col">
        <div className="px-4 pt-4 pb-2 border-b border-slate-200 dark:border-slate-800">
          <div className="text-[15px] font-semibold">研究報告</div>
          <div className="text-[11px] text-slate-500 mt-0.5">產業 / 商品 / 市場</div>
        </div>
        <TreeContent />
      </aside>

      {/* Mobile drawer */}
      {mobileTreeOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileTreeOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-[80vw] max-w-xs bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 overflow-y-auto flex flex-col">
            <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b border-slate-200 dark:border-slate-800">
              <div>
                <div className="text-[15px] font-semibold">研究報告</div>
                <div className="text-[11px] text-slate-500 mt-0.5">產業 / 商品 / 市場</div>
              </div>
              <button
                onClick={() => setMobileTreeOpen(false)}
                className="p-1.5 -mr-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Icon name="x" className="w-4 h-4" />
              </button>
            </div>
            <TreeContent />
          </aside>
        </div>
      )}

      {/* Right content */}
      {selectedTopic && !selectedId ? (
        <TopicSummary
          topic={selectedTopic}
          reports={reportsByTopic[selectedTopic.id] || []}
          onSelect={selectReport}
        />
      ) : (
        <ReportDetailView
          apiFetch={apiFetch}
          reportId={selectedId}
          onOpenTree={() => setMobileTreeOpen(true)}
          hasFeature={hasFeature}
        />
      )}
    </div>
  );
};
