/**
 * Reports list page (gated by view_reports feature).
 * Click a card → navigates to ReportDetail (state.selectedReportId).
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useReportsList, useReportDetail } from '../useReports';
import type { ReportMeta } from '../types';
import { Icon } from '../components/Icon';

interface ReportsPageProps {
  readonly apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  readonly hasFeature: (key: string) => boolean;
}

function formatDate(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const ReportCard: React.FC<{ report: ReportMeta; onOpen: () => void }> = ({ report, onOpen }) => (
  <button
    onClick={onOpen}
    className="text-left w-full p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-accent hover:shadow-md transition group"
  >
    <div className="flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {report.category && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-soft text-accent font-medium">
              {report.category}
            </span>
          )}
          {report.region && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
              {report.region}
            </span>
          )}
        </div>
        <h3 className="text-[15px] font-semibold leading-snug group-hover:text-accent transition mb-1.5 truncate">
          {report.title}
        </h3>
        {report.summary && (
          <p className="text-[12.5px] text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2">
            {report.summary}
          </p>
        )}
        <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-400 dark:text-slate-500">
          <span>{formatDate(report.created_at)}</span>
          <span>{report.word_count.toLocaleString()} 字</span>
          {report.finding_count > 0 && (
            <span>{report.finding_count} 引用</span>
          )}
          {report.author_name && (
            <span>· {report.author_name}</span>
          )}
        </div>
      </div>
    </div>
  </button>
);

const ReportDetailView: React.FC<{
  detailFetch: (id: string) => void;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  reportId: string;
  onBack: () => void;
}> = ({ apiFetch, reportId, onBack }) => {
  const { detail, loading, error } = useReportDetail(apiFetch, reportId);

  if (loading) {
    return <div className="p-8 text-slate-400">載入中…</div>;
  }
  if (error) {
    return (
      <div className="p-8">
        <button onClick={onBack} className="text-sm text-accent hover:underline mb-4">← 返回列表</button>
        <div className="text-red-500">載入失敗：{error}</div>
      </div>
    );
  }
  if (!detail) return null;

  const { meta, content } = detail;

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-4xl mx-auto p-6 print:p-0 print:max-w-none">
        {/* Toolbar (hidden on print) */}
        <div className="flex items-center gap-3 mb-4 print:hidden">
          <button onClick={onBack} className="text-sm text-slate-500 hover:text-accent flex items-center gap-1">
            <Icon name="chevL" className="w-4 h-4" />
            返回列表
          </button>
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => window.print()}
              className="text-xs px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:border-accent hover:text-accent transition"
              title="使用瀏覽器列印 → 另存為 PDF"
            >
              下載 PDF
            </button>
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
            {meta.tags.map((t) => (
              <span key={t} className="text-[11px] px-2 py-0.5 rounded bg-slate-50 dark:bg-slate-800/50 text-slate-500">
                #{t}
              </span>
            ))}
          </div>
          <h1 className="text-2xl font-bold leading-tight mb-2">{meta.title}</h1>
          <div className="flex items-center gap-3 text-[12px] text-slate-500 dark:text-slate-400">
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
          </div>
        </div>

        {/* Markdown body */}
        <article className="prose prose-slate dark:prose-invert max-w-none prose-headings:scroll-mt-16 prose-pre:bg-slate-900 prose-pre:text-slate-100">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </article>
      </div>
    </div>
  );
};

export const ReportsPage: React.FC<ReportsPageProps> = ({ apiFetch, hasFeature }) => {
  const { reports, loading, error, canView } = useReportsList(apiFetch, hasFeature);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  if (!canView) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md text-center text-slate-500">
          需要 <span className="font-mono">view_reports</span> 權限
        </div>
      </div>
    );
  }

  if (selectedId) {
    return (
      <ReportDetailView
        detailFetch={() => {}}
        apiFetch={apiFetch}
        reportId={selectedId}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-5xl mx-auto p-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold mb-1">研究報告</h1>
          <p className="text-[13px] text-slate-500">產業研究 / 商品分析 / 市場觀察</p>
        </div>

        {loading && <div className="text-slate-400 py-12 text-center">載入中…</div>}
        {error && <div className="text-red-500 py-4">{error}</div>}
        {!loading && !error && reports.length === 0 && (
          <div className="text-slate-400 py-12 text-center text-sm">
            尚無報告
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {reports.map((r) => (
            <ReportCard key={r.id} report={r} onOpen={() => setSelectedId(r.id)} />
          ))}
        </div>
      </div>
    </div>
  );
};
