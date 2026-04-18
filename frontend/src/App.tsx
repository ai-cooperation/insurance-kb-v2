import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar, NAV } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { TweaksPanel } from './components/TweaksPanel';
import { HomePage } from './pages/Home';
import { CardsPage, ArticleModal } from './pages/Cards';
import { WikiPage } from './pages/Wiki';
import { ChatPage } from './pages/Chat';
import { useArticles } from './useArticles';
import type { Route, Tier, Tweaks, Article } from './types';

const DEFAULT_TWEAKS: Tweaks = {
  accentH: 172,
  density: 'comfortable',
  cardStyle: 'bordered',
  dark: false,
};

export const App: React.FC = () => {
  const [route, setRoute] = useState<Route>(() => (localStorage.getItem('ikb_route') as Route) || 'home');
  const [tier, setTier] = useState<Tier>(() => (localStorage.getItem('ikb_tier') as Tier) || 'vip');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [article, setArticle] = useState<Article | null>(null);
  const [tweaks, setTweaks] = useState<Tweaks>(DEFAULT_TWEAKS);
  const [tweaksShown, setTweaksShown] = useState(false);
  const { articles, loading } = useArticles();

  // persist
  useEffect(() => { localStorage.setItem('ikb_route', route); }, [route]);
  useEffect(() => { localStorage.setItem('ikb_tier', tier); }, [tier]);

  // Force route back to public if insufficient tier
  useEffect(() => {
    const needed = NAV.find(n => n.id === route)?.req;
    if (needed === 'member' && tier === 'guest') setRoute('home');
    if (needed === 'vip' && tier !== 'vip') setRoute('home');
  }, [route, tier]);

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
        tier={tier}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
      />
      <main className="flex-1 flex flex-col min-w-0" data-screen-label={`0${['home','cards','wiki','chat'].indexOf(route)+1} ${route}`}>
        <Topbar
          route={route}
          setRoute={setRoute}
          tier={tier}
          setTier={setTier}
          dark={tweaks.dark}
          setDark={(d) => setTweaks(t => ({ ...t, dark: d }))}
          onMenu={() => setSidebarOpen(!sidebarOpen)}
          onOpenTweaks={() => setTweaksShown(true)}
        />
        {route === 'home'  && <HomePage  articles={articles} loading={loading} setRoute={setRoute} setTier={setTier} openArticle={openArticle} />}
        {route === 'cards' && <CardsPage articles={articles} loading={loading} openArticle={openArticle} />}
        {route === 'wiki'  && <WikiPage  articles={articles} openArticle={openArticle} />}
        {route === 'chat'  && <ChatPage  articles={articles} openArticle={openArticle} />}
      </main>

      <ArticleModal article={article} onClose={() => setArticle(null)} />

      <TweaksPanel show={tweaksShown} setShow={setTweaksShown} tweaks={tweaks} setTweaks={setTweaks} />
    </div>
  );
};
