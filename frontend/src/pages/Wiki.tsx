import React, { useState, useEffect } from 'react';
import { Icon } from '../components/Icon';
import { getCategoryIcon } from '../data';
import type { Article } from '../types';

// Types for wiki.json data
interface WikiTimeline {
  readonly date: string;
  readonly event: string;
}

interface WikiPageJson {
  readonly id: string;
  readonly category: string;
  readonly category_zh: string;
  readonly region: string;
  readonly period: string;
  readonly articles_count: number;
  readonly compiled_at: string;
  readonly model: string;
  readonly highlights: readonly string[];
  readonly timeline: readonly WikiTimeline[];
  readonly analysis: string;
  readonly cross_topic: string;
}

interface WikiTreeItem {
  readonly id: string;
  readonly zh: string;
  readonly period?: string;
  readonly regions: readonly { readonly id: string; readonly zh: string }[];
}

interface WikiData {
  readonly periods: readonly string[];
  readonly tree: readonly WikiTreeItem[];
  readonly pages: Record<string, WikiPageJson>;
}

// Tree sidebar node
const TreeNode: React.FC<{
  readonly node: WikiTreeItem;
  readonly activeId: string;
  readonly setActiveId: (id: string) => void;
  readonly expandedSet: Set<string>;
  readonly toggle: (id: string) => void;
}> = ({ node, activeId, setActiveId, expandedSet, toggle }) => {
  const expanded = expandedSet.has(node.id);
  return (
    <div>
      <button
        onClick={() => toggle(node.id)}
        className={`w-full flex items-center gap-1.5 px-2 h-8 rounded-md text-[13px] transition
          text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70`}
      >
        <Icon name={expanded ? 'chevD' : 'chevR'} className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className="text-sm leading-none">{getCategoryIcon(node.id)}</span>
        <span className="truncate">{node.zh}</span>
        <span className="ml-auto text-[11px] text-slate-400">{node.regions.length}</span>
      </button>
      {expanded && (
        <div className="ml-5 border-l border-slate-200 dark:border-slate-800 pl-1 mt-0.5 space-y-0.5">
          {node.regions.map(r => (
            <button
              key={r.id}
              onClick={() => setActiveId(r.id)}
              className={`w-full text-left px-2 h-7 rounded-md text-[12.5px] transition
                ${activeId === r.id ? 'bg-accent-soft text-accent font-medium' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70'}`}
            >
              {r.zh}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

interface WikiPageProps {
  readonly articles: readonly Article[];
  readonly openArticle: (a: Article) => void;
}

export const WikiPage: React.FC<WikiPageProps> = () => {
  const [wikiData, setWikiData] = useState<WikiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/data/wiki.json')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: WikiData) => {
        setWikiData(data);
        // Default: expand first category, select first region
        if (data.tree.length > 0) {
          const first = data.tree[0];
          setExpanded(new Set([first.id]));
          if (first.regions.length > 0) {
            setActiveId(first.regions[0].id);
          }
        }
        setLoading(false);
      })
      .catch(err => {
        console.warn('Failed to load wiki data:', err);
        setLoading(false);
      });
  }, []);

  const toggle = (id: string) => {
    const s = new Set(expanded);
    if (s.has(id)) s.delete(id); else s.add(id);
    setExpanded(s);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500">
        Loading wiki...
      </div>
    );
  }

  if (!wikiData) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500">
        Wiki data unavailable
      </div>
    );
  }

  const page = wikiData.pages[activeId];

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Tree sidebar */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-slate-200 dark:border-slate-900 bg-slate-50/50 dark:bg-slate-950/50">
        <div className="flex-1 overflow-auto px-2 pb-4 pt-2">
          {wikiData.periods.map(period => {
            const periodTree = wikiData.tree.filter(n => n.period === period);
            if (periodTree.length === 0) return null;
            return (
              <div key={period} className="mb-3">
                <div className="px-2 pt-2 pb-1 text-[10.5px] font-mono uppercase tracking-wider text-slate-500">{period}</div>
                <div className="space-y-0.5">
                  {periodTree.map(n => (
                    <TreeNode key={n.id} node={n} activeId={activeId} setActiveId={setActiveId} expandedSet={expanded} toggle={toggle} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {page ? (
          <article className="max-w-3xl mx-auto px-6 md:px-10 py-10">
            {/* breadcrumb */}
            <div className="text-[11.5px] font-mono uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              {page.category_zh} <Icon name="chevR" className="w-3 h-3" /> {page.region}
            </div>
            <h1 className="mt-2 text-[32px] md:text-[38px] font-semibold tracking-tight leading-tight text-balance">
              {page.category_zh}：{page.region} — {page.period}
            </h1>
            <p className="mt-3 text-[15px] text-slate-600 dark:text-slate-400 leading-relaxed">
              {page.articles_count} 篇文章蒸餾
            </p>

            {/* Highlights */}
            {page.highlights.length > 0 && (
              <section className="mt-10">
                <h2 className="text-[11.5px] font-mono uppercase tracking-wider text-slate-500 mb-3">本月重點</h2>
                <ol className="space-y-3">
                  {page.highlights.map((h, i) => (
                    <li key={i} className="flex gap-3 items-start">
                      <span className="mt-0.5 shrink-0 w-6 h-6 rounded-full bg-accent-soft text-accent flex items-center justify-center text-[11.5px] font-semibold font-mono tabular-nums">
                        {i + 1}
                      </span>
                      <span className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-200 text-pretty">{h}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {/* Timeline */}
            {page.timeline.length > 0 && (
              <section className="mt-10">
                <h2 className="text-[11.5px] font-mono uppercase tracking-wider text-slate-500 mb-3">時間線</h2>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                  <table className="w-full text-[13.5px]">
                    <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400">
                      <tr>
                        <th className="text-left font-medium px-4 py-2.5 w-[110px]">日期</th>
                        <th className="text-left font-medium px-4 py-2.5">事件</th>
                      </tr>
                    </thead>
                    <tbody>
                      {page.timeline.map((e, i) => (
                        <tr key={i} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/40">
                          <td className="px-4 py-2.5 font-mono tabular-nums text-slate-600 dark:text-slate-400">{e.date}</td>
                          <td className="px-4 py-2.5 text-slate-800 dark:text-slate-100">{e.event}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Analysis */}
            {page.analysis && (
              <section className="mt-10">
                <h2 className="text-[11.5px] font-mono uppercase tracking-wider text-slate-500 mb-3">趨勢分析</h2>
                <p className="text-[16px] leading-[1.85] text-slate-700 dark:text-slate-200 text-pretty">
                  {page.analysis}
                </p>
              </section>
            )}

            {/* Cross-topic */}
            {page.cross_topic && (
              <section className="mt-10">
                <h2 className="text-[11.5px] font-mono uppercase tracking-wider text-slate-500 mb-3">跨主題關聯</h2>
                <div className="text-[15px] leading-[1.85] text-slate-700 dark:text-slate-200 whitespace-pre-line text-pretty">
                  {page.cross_topic}
                </div>
              </section>
            )}

            <div className="mt-12 pt-6 border-t border-slate-200 dark:border-slate-900 text-[11.5px] font-mono uppercase tracking-wider text-slate-500">
              Distilled {page.compiled_at.slice(0, 10)} &middot; Model: {page.model}
            </div>
          </article>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-500 h-full">
            <p>Select a topic from the sidebar</p>
          </div>
        )}
      </div>
    </div>
  );
};
