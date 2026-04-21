import React from 'react';
import { Icon } from '../components/Icon';
import { Badge } from '../components/Badge';
import { Btn } from '../components/Button';
import { StatCard } from '../components/StatCard';
import { CATEGORIES, IMPORTANCE } from '../data';
import type { Article, Route, Tier } from '../types';

interface MiniCardProps {
  readonly a: Article;
  readonly onOpen: (a: Article) => void;
}

export const MiniCard: React.FC<MiniCardProps> = ({ a, onOpen }) => {
  const cat = CATEGORIES.find(c => c.id === a.category);
  const c = cat ? (await_color(cat.color)) : undefined;
  return (
    <button
      onClick={() => onOpen(a)}
      className={`card-hover group relative text-left rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:shadow-md ${c?.border ?? ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <Badge category={a.category} region={a.region} />
        <span className="text-[11px] text-slate-400 font-mono tabular-nums">{a.date.slice(5)}</span>
      </div>
      <h3 className="mt-2.5 text-[15px] font-semibold leading-snug text-pretty text-slate-900 dark:text-slate-100">
        {a.title_zh}
      </h3>
      {a.title_en && (
        <div className="mt-1 text-[12px] text-slate-500 dark:text-slate-400 leading-snug line-clamp-1">{a.title_en}</div>
      )}
      <p className="mt-2.5 text-[13px] leading-relaxed text-slate-600 dark:text-slate-400 line-clamp-2">{a.summary}</p>
      <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
        <span className="text-[11px] text-slate-500 dark:text-slate-400">{a.source}</span>
        <span className={`text-[11px] font-medium ${IMPORTANCE[a.importance].cls}`}>
          ● 重要性：{IMPORTANCE[a.importance].zh}
        </span>
      </div>
    </button>
  );
};

// Helper to get category color tokens
import { CATEGORY_COLORS } from '../data';
function await_color(color: string) { return CATEGORY_COLORS[color]; }

interface HomePageProps {
  readonly articles: readonly Article[];
  readonly loading: boolean;
  readonly setRoute: (r: Route) => void;
  readonly setTier: (t: Tier) => void;
  readonly onLogin: () => void;
  readonly openArticle: (a: Article) => void;
}

export const HomePage: React.FC<HomePageProps> = ({ articles, loading, setRoute: _setRoute, setTier: _setTier, onLogin, openArticle }) => {
  const latestDate = articles.length > 0 ? articles[0].date : '';
  const latestArticles = articles.filter(a => a.date === latestDate);
  const todayArticles = latestArticles.slice(0, 12);

  return (
    <div className="flex-1 overflow-auto">
      {/* Hero */}
      <section className="relative">
        <div className="max-w-6xl mx-auto px-6 md:px-10 pt-14 pb-12">
          <div className="flex items-center gap-2 text-[11.5px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-[0.18em]">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse"/>
            Live &middot; 每日 06:00 更新
          </div>
          <h1 className="mt-4 font-semibold tracking-tight text-balance text-[44px] md:text-[56px] leading-[1.05]">
            保險產業
            <span className="text-accent">智能</span>
            知識庫
          </h1>
          <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-slate-600 dark:text-slate-300 text-pretty">
            全球 55 個保險新聞來源，AI 自動分類、摘要、每月蒸餾成知識 Wiki。
            一個入口，掌握監管、市場、科技與再保動態。
          </p>

          <div className="mt-7 flex flex-wrap gap-2.5">
            <Btn size="lg" onClick={() => { onLogin(); }}>
              <Icon name="google" className="w-4 h-4" /> 使用 Google 登入
            </Btn>
            <Btn size="lg" variant="outline" onClick={() => document.getElementById('today-grid')?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>
              瀏覽今日新聞 &darr;
            </Btn>
          </div>
        </div>

        {/* Stat bar */}
        <div className="max-w-6xl mx-auto px-6 md:px-10 pb-12">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label="累計文章" value={loading ? '…' : articles.length.toLocaleString()} delta="" icon="cards" />
            <StatCard label="今日新增" value={loading ? '…' : String(latestArticles.length)} delta="" icon="sparkle" />
            <StatCard label="資料來源" value="55" delta="覆蓋 10 個地區" icon="globe" />
          </div>
        </div>
      </section>

      {/* Today grid */}
      <section id="today-grid" className="max-w-6xl mx-auto px-6 md:px-10 pb-14">
        <div className="flex items-end justify-between mb-5">
          <div>
            <div className="text-[11.5px] font-mono uppercase tracking-wider text-slate-500">{articles.length > 0 ? articles[0].date : new Date().toISOString().slice(0, 10)}</div>
            <h2 className="mt-1 text-[22px] font-semibold tracking-tight">今日精選</h2>
          </div>
          <div className="text-[12.5px] text-slate-500 dark:text-slate-400">
            共 <span className="font-mono font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{todayArticles.length}</span> 篇
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {todayArticles.map(a => <MiniCard key={a.id} a={a} onOpen={openArticle} />)}
        </div>
      </section>

      {/* Category legend */}
      <section className="max-w-6xl mx-auto px-6 md:px-10 pb-14">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-6">
          <div className="text-[11.5px] font-mono uppercase tracking-wider text-slate-500 mb-3">Taxonomy</div>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map(c => (
              <Badge key={c.id} category={c.id} size="md" />
            ))}
          </div>
        </div>
      </section>

      {/* Lock CTA */}
      <section className="max-w-6xl mx-auto px-6 md:px-10 pb-20">
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-950 p-8 md:p-10">
          <div className="grid md:grid-cols-2 gap-10 items-center">
            <div>
              <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent bg-accent-soft px-2 py-1 rounded">
                <Icon name="lock" className="w-3.5 h-3.5" /> 會員解鎖
              </div>
              <h3 className="mt-3 text-[26px] font-semibold tracking-tight text-balance">
                登入解鎖全部功能
              </h3>
              <p className="mt-3 text-slate-600 dark:text-slate-300 leading-relaxed">
                用 Google 一鍵登入，瀏覽歷史卡片、訂閱知識 Wiki。申請 VIP 後可向 AI Chat 提問，取得附來源引用的回答。
              </p>
              <div className="mt-5 flex gap-2">
                <Btn size="lg" onClick={() => { onLogin(); }}>
                  <Icon name="google" className="w-4 h-4" /> Google 登入
                </Btn>
                <Btn size="lg" variant="ghost">申請 VIP</Btn>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { icon: 'cards',   title: '歷史卡片', sub: '12,596 篇',  req: '會員' },
                { icon: 'book',    title: '知識 Wiki', sub: '每月蒸餾',   req: '會員' },
                { icon: 'chat',    title: 'AI Chat',   sub: '含來源引用', req: 'VIP' },
              ].map(f => (
                <div key={f.title} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                  <div className="w-8 h-8 rounded-md bg-accent-soft text-accent flex items-center justify-center">
                    <Icon name={f.icon} className="w-4 h-4" />
                  </div>
                  <div className="mt-3 text-[13px] font-semibold">{f.title}</div>
                  <div className="text-[11.5px] text-slate-500 dark:text-slate-400">{f.sub}</div>
                  <div className="mt-2 inline-block text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    {f.req}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer className="max-w-6xl mx-auto px-6 md:px-10 pb-10 text-[11.5px] text-slate-500 dark:text-slate-500 font-mono uppercase tracking-wider flex items-center justify-between border-t border-slate-200 dark:border-slate-900 pt-6">
        <span>&copy; 2026 Insurance KB</span>
        <span>資料來源不代表本站觀點 &middot; Built with &#10084;&#65039;</span>
      </footer>
    </div>
  );
};
