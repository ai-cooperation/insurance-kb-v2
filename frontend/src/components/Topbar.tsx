import React from 'react';
import { Icon } from './Icon';
import { TIER_LABEL } from './Sidebar';
import type { Route, Tier } from '../types';

interface TopbarProps {
  readonly route: Route;
  readonly setRoute: (r: Route) => void;
  readonly tier: Tier;
  readonly setTier: (t: Tier) => void;
  readonly dark: boolean;
  readonly setDark: (d: boolean) => void;
  readonly onMenu: () => void;
  readonly onOpenTweaks: () => void;
}

const titles: Record<Route, { zh: string; sub: string }> = {
  home:  { zh: '首頁', sub: '今日精選' },
  cards: { zh: '卡片', sub: '所有來源與分類' },
  wiki:  { zh: '知識 Wiki', sub: '每月蒸餾主題' },
  chat:  { zh: 'AI Chat', sub: '基於 12,596 篇文章' },
};

export const Topbar: React.FC<TopbarProps> = ({ route, tier, setTier, dark, setDark, onMenu }) => {
  const t = titles[route];
  return (
    <header className="h-14 shrink-0 flex items-center gap-3 px-4 md:px-6 border-b border-slate-200 dark:border-slate-900 bg-white/70 dark:bg-slate-950/70 backdrop-blur sticky top-0 z-20">
      <button onClick={onMenu} className="lg:hidden p-1.5 -ml-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800">
        <Icon name="menu" className="w-5 h-5" />
      </button>
      <div className="min-w-0">
        <div className="text-[15px] font-semibold leading-none">{t.zh}</div>
        <div className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-1">{t.sub}</div>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        {/* Tier switcher — demo affordance */}
        <div className="hidden md:flex items-center gap-0.5 p-0.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 mr-1.5">
          {(['guest','member','vip'] as const).map(tierKey => (
            <button
              key={tierKey}
              onClick={() => setTier(tierKey)}
              className={`px-2.5 h-7 text-[11.5px] font-medium rounded transition ${tier === tierKey ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
              title={`切換為 ${TIER_LABEL[tierKey].zh}（Demo）`}
            >
              {TIER_LABEL[tierKey].zh}
            </button>
          ))}
        </div>

        <button
          onClick={() => setDark(!dark)}
          className="w-9 h-9 flex items-center justify-center rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700"
          title={dark ? '切換淺色' : '切換深色'}
        >
          <Icon name={dark ? 'sun' : 'moon'} className="w-[18px] h-[18px]" />
        </button>
      </div>
    </header>
  );
};
