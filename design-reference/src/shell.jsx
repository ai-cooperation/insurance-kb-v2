// App shell: sidebar + top bar

const NAV = [
  { id: 'home',  icon: 'home',  zh: '首頁',    req: 'public' },
  { id: 'cards', icon: 'cards', zh: '卡片',    req: 'member' },
  { id: 'wiki',  icon: 'book',  zh: '知識 Wiki', req: 'member' },
  { id: 'chat',  icon: 'chat',  zh: 'AI Chat',  req: 'vip' },
];

const TIER_LABEL = {
  guest:  { zh: '訪客模式',   badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  member: { zh: '會員',       badge: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' },
  vip:    { zh: 'VIP',        badge: 'bg-accent-soft text-accent' },
};

const Sidebar = ({ open, route, setRoute, tier, collapsed, setCollapsed }) => {
  const canAccess = (req) => req === 'public' || (req === 'member' && (tier === 'member' || tier === 'vip')) || (req === 'vip' && tier === 'vip');
  return (
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
          const locked = !canAccess(item.req);
          return (
            <button
              key={item.id}
              onClick={() => !locked && setRoute(item.id)}
              title={collapsed ? item.zh : undefined}
              className={`w-full flex items-center gap-2.5 px-2.5 h-9 rounded-md text-[13.5px] transition
                ${active ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm ring-1 ring-slate-200 dark:ring-slate-800' : 'text-slate-600 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-900/50 hover:text-slate-900 dark:hover:text-slate-200'}
                ${locked ? 'opacity-50 cursor-not-allowed' : ''}`}
              disabled={locked}
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

      {/* bottom: collapse + tier */}
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
          <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-slate-500">
            <Icon name="user" className="w-4 h-4" />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium truncate">{tier === 'guest' ? '未登入' : 'Claire Wu'}</div>
              <div className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${TIER_LABEL[tier].badge}`}>
                {TIER_LABEL[tier].zh}
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

const Topbar = ({ route, setRoute, tier, setTier, dark, setDark, onMenu, onOpenTweaks }) => {
  const titles = {
    home:  { zh: '首頁', sub: '今日精選' },
    cards: { zh: '卡片', sub: '所有來源與分類' },
    wiki:  { zh: '知識 Wiki', sub: '每月蒸餾主題' },
    chat:  { zh: 'AI Chat', sub: '基於 12,596 篇文章' },
  };
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
          {['guest','member','vip'].map(t => (
            <button
              key={t}
              onClick={() => setTier(t)}
              className={`px-2.5 h-7 text-[11.5px] font-medium rounded transition ${tier === t ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
              title={`切換為 ${TIER_LABEL[t].zh}（Demo）`}
            >
              {TIER_LABEL[t].zh}
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

Object.assign(window, { Sidebar, Topbar, NAV, TIER_LABEL });
