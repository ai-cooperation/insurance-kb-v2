import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar, NAV } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { TweaksPanel } from './components/TweaksPanel';
import { HomePage } from './pages/Home';
import { CardsPage, ArticleModal } from './pages/Cards';
import { WikiPage } from './pages/Wiki';
import { ChatPage } from './pages/Chat';
import { ReportsPage } from './pages/Reports';
import { McpSetupPage } from './pages/McpSetup';
import { useArticles } from './useArticles';
import { useAuth } from './useAuth';
import type { Route, Tweaks, Article } from './types';

const DEFAULT_TWEAKS: Tweaks = {
  accentH: 172,
  density: 'comfortable',
  cardStyle: 'bordered',
  dark: false,
};


// URL → route + optional report id parser. Supports deep links like
// /reports/<id>, /cards, /wiki, /chat, /mcp-setup. Falls back to localStorage
// then 'home'. Called on mount + on popstate (browser back/forward).
function parseLocation(): { route: Route; reportId: string | null } {
  const path = window.location.pathname;
  if (path.startsWith('/reports')) {
    const m = path.match(/^\/reports\/([^/?#]+)/);
    return { route: 'reports', reportId: m ? m[1] : null };
  }
  if (path.startsWith('/cards'))     return { route: 'cards',     reportId: null };
  if (path.startsWith('/wiki'))      return { route: 'wiki',      reportId: null };
  if (path.startsWith('/chat'))      return { route: 'chat',      reportId: null };
  if (path.startsWith('/mcp-setup')) return { route: 'mcp-setup', reportId: null };
  if (path === '/' || path === '')   return { route: 'home', reportId: null };
  // Unknown path: try localStorage, else home
  const ls = localStorage.getItem('ikb_route') as Route | null;
  return { route: ls || 'home', reportId: null };
}

export const App: React.FC = () => {
  const initial = parseLocation();
  const [route, setRouteState] = useState<Route>(initial.route);
  const [initialReportId, setInitialReportId] = useState<string | null>(initial.reportId);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [article, setArticle] = useState<Article | null>(null);
  const [tweaks, setTweaks] = useState<Tweaks>(DEFAULT_TWEAKS);
  const [tweaksShown, setTweaksShown] = useState(false);
  const store = useArticles();
  const { articles, loading, manifest, loadedMonths, fetchingMore, loadOlderMonths, loadAllMonths } = store;
  const auth = useAuth();

  // Wrap setRoute so nav changes also update URL (enables share + back button).
  const setRoute = useCallback((r: Route) => {
    setRouteState(r);
    // Clear deep-link report id when switching nav routes (not when same route)
    setInitialReportId(null);
    const url = r === 'home' ? '/' : `/${r}`;
    if (window.location.pathname !== url) {
      window.history.pushState({}, '', url);
    }
  }, []);

  // Browser back/forward — re-parse URL and sync state.
  useEffect(() => {
    const onPop = () => {
      const next = parseLocation();
      setRouteState(next.route);
      setInitialReportId(next.reportId);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // persist route
  useEffect(() => { localStorage.setItem('ikb_route', route); }, [route]);

  // Force route back to home if user lacks the required feature for current
  // nav. Runs whenever route or auth.features change (e.g. logout, tier
  // downgrade, admin revoke).
  //
  // IMPORTANT: wait for `auth.loading` to finish before applying the gate.
  // Otherwise a deep link like `/reports/<id>` hits this effect while auth
  // is still hydrating (hasFeature returns false) and bounces the user to
  // `/`, losing the report id from initial state.
  useEffect(() => {
    if (auth.loading) return;
    const needed = NAV.find(n => n.id === route)?.requiredFeature;
    if (needed && !auth.hasFeature(needed)) setRoute('home');
  }, [route, auth.loading, auth.tier, auth.hasFeature, setRoute]);

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
        {route === 'cards'     && (
          <CardsPage
            articles={articles}
            loading={loading}
            openArticle={openArticle}
            totalAvailable={manifest?.total_visible}
            loadedMonthCount={loadedMonths.size}
            totalMonthCount={manifest?.months.length}
            fetchingMore={fetchingMore}
            loadOlderMonths={loadOlderMonths}
            loadAllMonths={loadAllMonths}
          />
        )}
        {route === 'wiki'      && <WikiPage  articles={articles} openArticle={openArticle} />}
        {route === 'chat'      && <ChatPage  articles={articles} openArticle={openArticle} apiFetch={auth.apiFetch} />}
        {route === 'reports'   && <ReportsPage apiFetch={auth.apiFetch} hasFeature={auth.hasFeature} initialReportId={initialReportId} />}
        {route === 'mcp-setup' && <McpSetupPage apiFetch={auth.apiFetch} hasFeature={auth.hasFeature} />}
      </main>

      <ArticleModal article={article} onClose={() => setArticle(null)} />

      <TweaksPanel show={tweaksShown} setShow={setTweaksShown} tweaks={tweaks} setTweaks={setTweaks} />
    </div>
  );
};
