/**
 * Reports page — wiki-tree pattern (matches hematology-kb's 疾病全貌).
 *
 * Layout:
 *   ┌─ left tree (240px, lg+ only)  ─┬─ right content (flex-1) ───────┐
 *   │   📖 V1 行銷策略研究            │                                 │
 *   │     ├─ V1 主報告（完整版）      │  <selected report content>      │
 *   │     ├─ ch01 研究總覽           │                                 │
 *   │     └─ ...                     │                                 │
 *   │   📖 V2 飛輪策略                │                                 │
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

interface ReportsPageProps {
  readonly apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  readonly hasFeature: (key: string) => boolean;
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

// ── Tree node (collapsible topic with chapter list) ────────────────────

interface TopicNodeProps {
  readonly topic: TopicMeta;
  readonly reports: readonly ReportMeta[];
  readonly activeId: string | null;
  readonly onSelect: (id: string) => void;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}

const TopicNode: React.FC<TopicNodeProps> = ({ topic, reports, activeId, onSelect, expanded, onToggle }) => {
  const iconName = topic.icon || 'book';
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
        <span className="text-[11px] text-slate-400">{topic.report_count ?? reports.length}</span>
      </button>
      {expanded && reports.length > 0 && (
        <div className="ml-5 border-l border-slate-200 dark:border-slate-800 pl-1 mt-0.5 space-y-0.5 pb-1">
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

export const ReportsPage: React.FC<ReportsPageProps> = ({ apiFetch, hasFeature }) => {
  const { topics, reports, loading, error, canView } = useReportsTree(apiFetch, hasFeature);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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

  // Initial selection: expand first topic + show its summary
  useEffect(() => {
    if (topics.length > 0 && !selectedTopicId && !selectedId) {
      setSelectedTopicId(topics[0].id);
      setExpanded(new Set(topics.map(t => t.id)));
    }
  }, [topics, selectedTopicId, selectedId]);

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

  const selectReport = (id: string) => {
    setSelectedId(id);
    setSelectedTopicId(null);
    setMobileTreeOpen(false);
  };

  const selectTopic = (id: string) => {
    setSelectedTopicId(id);
    setSelectedId(null);
    setExpanded(prev => new Set(prev).add(id));
  };

  // Tree component (rendered in both desktop sidebar + mobile drawer)
  const TreeContent: React.FC = () => (
    <div className="space-y-0.5 px-1.5 py-2">
      {loading && <div className="px-2 py-3 text-sm text-slate-400">載入中…</div>}
      {error && <div className="px-2 py-3 text-sm text-red-500">{error}</div>}
      {!loading && !error && topics.length === 0 && (
        <div className="px-2 py-3 text-sm text-slate-400">尚無報告主題</div>
      )}
      {topics.map(t => (
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
      {/* Orphans (reports without topic) */}
      {reportsByTopic.__orphan__ && reportsByTopic.__orphan__.length > 0 && (
        <div className="pt-2 mt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="px-2 mb-1 text-[10.5px] font-mono uppercase tracking-wider text-slate-400">未分類</div>
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
