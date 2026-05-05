import React from 'react';
import { Icon } from './Icon';
import { TIER_LABEL } from './Sidebar';
import type { Route, Tier } from '../types';
import type { AuthUser } from '../useAuth';

interface TopbarProps {
  readonly route: Route;
  readonly setRoute: (r: Route) => void;
  readonly tier: Tier;
  readonly dark: boolean;
  readonly setDark: (d: boolean) => void;
  readonly onMenu: () => void;
  readonly onOpenTweaks: () => void;
  readonly user: AuthUser | null;
  readonly onLogin: () => void;
  readonly onLogout: () => void;
}

const titles: Record<Route, { zh: string; sub: string }> = {
  home:        { zh: '首頁',     sub: '今日精選' },
  cards:       { zh: '卡片',     sub: '所有來源與分類' },
  wiki:        { zh: '知識 Wiki', sub: '每月蒸餾主題' },
  reports:     { zh: '研究報告', sub: '產業 / 商品 / 市場分析' },
  chat:        { zh: 'AI Chat', sub: 'AI 知識問答' },
  'mcp-setup': { zh: 'MCP 連線', sub: '把 KB 接上你的 AI' },
};

export const Topbar: React.FC<TopbarProps> = ({ route, tier, dark, setDark, onMenu, user, onLogin, onLogout }) => {
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

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={() => setDark(!dark)}
          className="w-9 h-9 flex items-center justify-center rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700"
          title={dark ? '切換淺色' : '切換深色'}
        >
          <Icon name={dark ? 'sun' : 'moon'} className="w-[18px] h-[18px]" />
        </button>

        {user ? (
          <div className="flex items-center gap-2">
            <span className={`hidden sm:inline-block px-2 py-0.5 rounded text-[10px] font-medium ${TIER_LABEL[tier].badge}`}>
              {TIER_LABEL[tier].zh}
            </span>
            {user.picture ? (
              <img src={user.picture} alt="" className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent text-xs font-bold">
                {user.name.charAt(0).toUpperCase()}
              </div>
            )}
            <button onClick={onLogout} className="text-[11px] text-slate-400 hover:text-red-500">登出</button>
          </div>
        ) : (
          <button
            onClick={onLogin}
            className="flex items-center gap-1.5 px-3 h-8 rounded-md bg-accent text-white text-[13px] font-medium hover:opacity-90 transition"
          >
            <Icon name="user" className="w-4 h-4" />
            登入
          </button>
        )}
      </div>
    </header>
  );
};
