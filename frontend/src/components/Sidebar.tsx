import React from 'react';
import { Icon } from './Icon';
import type { Route, Tier, NavItem, TierLabelInfo } from '../types';
import type { AuthUser } from '../useAuth';

export const NAV: readonly NavItem[] = [
  { id: 'home',  icon: 'home',  zh: '首頁',    req: 'public' },
  { id: 'cards', icon: 'cards', zh: '卡片',    req: 'public' },
  { id: 'wiki',  icon: 'book',  zh: '知識 Wiki', req: 'member' },
  { id: 'chat',  icon: 'chat',  zh: 'AI Chat',  req: 'vip' },
];

export const TIER_LABEL: Record<Tier, TierLabelInfo> = {
  guest:  { zh: '訪客模式',   badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  member: { zh: '會員',       badge: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' },
  vip:    { zh: 'VIP',        badge: 'bg-accent-soft text-accent' },
};

interface SidebarProps {
  readonly open: boolean;
  readonly route: Route;
  readonly setRoute: (r: Route) => void;
  readonly tier: Tier;
  readonly collapsed: boolean;
  readonly setCollapsed: (c: boolean) => void;
  readonly user: AuthUser | null;
  readonly onLogin: () => void;
  readonly onLogout: () => void;
}

const canAccess = (req: NavItem['req'], tier: Tier): boolean =>
  req === 'public' ||
  (req === 'member' && (tier === 'member' || tier === 'vip')) ||
  (req === 'vip' && tier === 'vip');

export const Sidebar: React.FC<SidebarProps> = ({ open, route, setRoute, tier, collapsed, setCollapsed, user, onLogin, onLogout }) => (
  <aside
    className={`shrink-0 h-full border-r border-slate-200 dark:border-slate-900 bg-slate-50/60 dark:bg-slate-950/70 backdrop-blur flex flex-col transition-all duration-300 ease-out ${collapsed ? 'w-[68px]' : 'w-60'} ${open ? '' : 'hidden lg:flex'}`}
  >
    {/* brand */}
    <div className="h-14 flex items-center px-4 border-b border-slate-200 dark:border-slate-900">
      <div className="w-8 h-8 rounded-lg bg-accent text-white flex items-center justify-center font-bold text-sm shrink-0">保</div>
      {!collapsed && (
        <div className="ml-2.5 min-w-0">
          <div className="text-[13px] font-semibold truncate">保險知識庫</div>
          <div className="text-[10.5px] text-slate-500 dark:text-slate-400 uppercase tracking-wider">Insurance KB</div>
        </div>
      )}
    </div>

    {/* nav */}
    <nav className="flex-1 py-3 px-2 space-y-0.5">
      {NAV.map(item => {
        const active = route === item.id;
        const locked = !canAccess(item.req, tier);
        return (
          <button
            key={item.id}
            onClick={() => {
              if (locked && item.req === 'member') {
                onLogin();
              } else if (!locked) {
                setRoute(item.id as Route);
              }
            }}
            title={collapsed ? item.zh : undefined}
            className={`w-full flex items-center gap-2.5 px-2.5 h-9 rounded-md text-[13.5px] transition
              ${active ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm ring-1 ring-slate-200 dark:ring-slate-800' : 'text-slate-600 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-900/50 hover:text-slate-900 dark:hover:text-slate-200'}
              ${locked ? 'opacity-50' : ''}`}
          >
            <Icon name={item.icon} className="w-[18px] h-[18px] shrink-0" />
            {!collapsed && <span className="truncate flex-1 text-left">{item.zh}</span>}
            {!collapsed && locked && <Icon name="lock" className="w-3.5 h-3.5 text-slate-400" />}
            {!collapsed && item.id === 'chat' && !locked && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-accent text-white">VIP</span>
            )}
          </button>
        );
      })}
    </nav>

    {/* bottom: collapse + user */}
    <div className="border-t border-slate-200 dark:border-slate-900 p-2 space-y-1">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="hidden lg:flex w-full items-center gap-2.5 px-2.5 h-9 rounded-md text-[13px] text-slate-500 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-900 hover:text-slate-900 dark:hover:text-slate-100"
        title={collapsed ? '展開' : '收合'}
      >
        <Icon name={collapsed ? 'chevR' : 'chevL'} className="w-4 h-4" />
        {!collapsed && <span>收合側欄</span>}
      </button>
      <div className={`flex items-center gap-2.5 px-2 py-2 rounded-md bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 ${collapsed ? 'justify-center' : ''}`}>
        {user ? (
          <>
            {user.picture ? (
              <img src={user.picture} alt="" className="w-7 h-7 rounded-full shrink-0" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center text-accent text-xs font-bold shrink-0">
                {user.name.charAt(0).toUpperCase()}
              </div>
            )}
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium truncate">{user.name}</div>
                <div className="flex items-center gap-1.5">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${TIER_LABEL[tier].badge}`}>
                    {TIER_LABEL[tier].zh}
                  </span>
                  <button onClick={onLogout} className="text-[10px] text-slate-400 hover:text-red-500 transition">登出</button>
                </div>
              </div>
            )}
          </>
        ) : (
          <button
            onClick={onLogin}
            className={`flex items-center gap-2 text-[12.5px] font-medium text-accent hover:underline ${collapsed ? '' : 'w-full'}`}
          >
            <Icon name="user" className="w-4 h-4 shrink-0" />
            {!collapsed && <span>Google 登入</span>}
          </button>
        )}
      </div>
    </div>
  </aside>
);
