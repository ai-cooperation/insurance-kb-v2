import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar, NAV } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { TweaksPanel } from './components/TweaksPanel';
import { HomePage } from './pages/Home';
import { CardsPage, ArticleModal } from './pages/Cards';
import { WikiPage } from './pages/Wiki';
import { ChatPage } from './pages/Chat';
import { ReportsPage } from './pages/Reports';
import { useArticles } from './useArticles';
import { useAuth } from './useAuth';
import type { Route, Tweaks, Article } from './types';

const DEFAULT_TWEAKS: Tweaks = {
  accentH: 172,
  density: 'comfortable',
  cardStyle: 'bordered',
  dark: false,
};

const ComingSoon: React.FC<{ title: string; hint: string }> = ({ title, hint }) => (
  <div className="flex-1 flex items-center justify-center p-8">
    <div className="max-w-md text-center">
      <div className="text-2xl font-semibold mb-2">{title}</div>
      <div className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{hint}</div>
      <div className="mt-6 inline-block text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">即將推出</div>
    </div>
  </div>
);

export const App: React.FC = () => {
  const [route, setRoute] = useState<Route>(() => (localStorage.getItem('ikb_route') as Route) || 'home');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [article, setArticle] = useState<Article | null>(null);
  const [tweaks, setTweaks] = useState<Tweaks>(DEFAULT_TWEAKS);
  const [tweaksShown, setTweaksShown] = useState(false);
  const { articles, loading } = useArticles();
  const auth = useAuth();

  // persist route
  useEffect(() => { localStorage.setItem('ikb_route', route); }, [route]);

  // Force route back to home if user lacks the required feature for current
  // nav. Runs whenever route or auth.features change (e.g. logout, tier
  // downgrade, admin revoke).
  useEffect(() => {
    const needed = NAV.find(n => n.id === route)?.requiredFeature;
    if (needed && !auth.hasFeature(needed)) setRoute('home');
  }, [route, auth.tier, auth.hasFeature]);

  // Dark mode
  useEffect(() => {
    document.documentElement.classList.toggle('dark', !!tweaks.dark);
  }, [tweaks.dark]);

  // Accent
  useEffect(() => {
    document.documentElement.style.setProperty('--accent-h', String(tweaks.accentH));
  }, [tweaks.accentH]);

  // Tweaks host wiring
  useEffect(() => {
    const listener = (e: MessageEvent) => {
      if (!e.data) return;
      if (e.data.type === '__activate_edit_mode') setTweaksShown(true);
      if (e.data.type === '__deactivate_edit_mode') setTweaksShown(false);
    };
    window.addEventListener('message', listener);
    try { window.parent?.postMessage({ type: '__edit_mode_available' }, '*'); } catch { /* ignore */ }
    return () => window.removeEventListener('message', listener);
  }, []);

  const openArticle = useCallback((a: Article) => setArticle(a), []);

  return (
    <div data-density={tweaks.density} data-cardstyle={tweaks.cardStyle} className="h-screen w-screen flex overflow-hidden bg-white dark:bg-slate-950">
      <Sidebar
        open={sidebarOpen}
        route={route}
        setRoute={(r) => { setRoute(r); setSidebarOpen(false); }}
        tier={auth.tier}
        hasFeature={auth.hasFeature}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
        user={auth.user}
        onLogin={auth.login}
        onLogout={auth.logout}
      />
      <main className="flex-1 flex flex-col min-w-0" data-screen-label={`0${['home','cards','wiki','reports','chat','mcp-setup'].indexOf(route)+1} ${route}`}>
        <Topbar
          route={route}
          setRoute={setRoute}
          tier={auth.tier}
          dark={tweaks.dark}
          setDark={(d) => setTweaks(t => ({ ...t, dark: d }))}
          onMenu={() => setSidebarOpen(!sidebarOpen)}
          onOpenTweaks={() => setTweaksShown(true)}
          user={auth.user}
          onLogin={auth.login}
          onLogout={auth.logout}
        />
        {route === 'home'      && <HomePage  articles={articles} loading={loading} setRoute={setRoute} setTier={() => {}} onLogin={auth.login} openArticle={openArticle} />}
        {route === 'cards'     && <CardsPage articles={articles} loading={loading} openArticle={openArticle} />}
        {route === 'wiki'      && <WikiPage  articles={articles} openArticle={openArticle} />}
        {route === 'chat'      && <ChatPage  articles={articles} openArticle={openArticle} apiFetch={auth.apiFetch} />}
        {route === 'reports'   && <ReportsPage apiFetch={auth.apiFetch} hasFeature={auth.hasFeature} />}
        {route === 'mcp-setup' && <ComingSoon title="MCP 連線" hint="Phase 3 將上線：用 claude.ai connector 把 Insurance KB 接到你的 AI，協助商品設計團隊做研究調查。" />}
      </main>

      <ArticleModal article={article} onClose={() => setArticle(null)} />

      <TweaksPanel show={tweaksShown} setShow={setTweaksShown} tweaks={tweaks} setTweaks={setTweaks} />
    </div>
  );
};
