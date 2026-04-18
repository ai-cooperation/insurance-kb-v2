// Main app — routing, theme, tweaks wiring

const DEFAULT_TWEAKS = /*EDITMODE-BEGIN*/{
  "accentH": 172,
  "density": "comfortable",
  "cardStyle": "bordered",
  "dark": false
}/*EDITMODE-END*/;

const App = () => {
  const [route, setRoute] = React.useState(() => localStorage.getItem('ikb_route') || 'home');
  const [tier, setTier] = React.useState(() => localStorage.getItem('ikb_tier') || 'vip'); // default to VIP so the demo shows everything
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [article, setArticle] = React.useState(null);
  const [tweaks, setTweaks] = React.useState(DEFAULT_TWEAKS);
  const [tweaksShown, setTweaksShown] = React.useState(false);

  // persist
  React.useEffect(() => localStorage.setItem('ikb_route', route), [route]);
  React.useEffect(() => localStorage.setItem('ikb_tier', tier), [tier]);

  // Force route back to public if insufficient tier
  React.useEffect(() => {
    const needed = NAV.find(n => n.id === route)?.req;
    if (needed === 'member' && tier === 'guest') setRoute('home');
    if (needed === 'vip' && tier !== 'vip') setRoute('home');
  }, [route, tier]);

  // Dark mode
  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', !!tweaks.dark);
  }, [tweaks.dark]);

  // Accent
  React.useEffect(() => {
    document.documentElement.style.setProperty('--accent-h', tweaks.accentH);
  }, [tweaks.accentH]);

  // Tweaks host wiring
  React.useEffect(() => {
    const listener = (e) => {
      if (!e.data) return;
      if (e.data.type === '__activate_edit_mode') setTweaksShown(true);
      if (e.data.type === '__deactivate_edit_mode') setTweaksShown(false);
    };
    window.addEventListener('message', listener);
    try { window.parent?.postMessage({ type: '__edit_mode_available' }, '*'); } catch {}
    return () => window.removeEventListener('message', listener);
  }, []);

  const openArticle = (a) => setArticle(a);

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
        {route === 'home'  && <HomePage  setRoute={setRoute} setTier={setTier} openArticle={openArticle} />}
        {route === 'cards' && <CardsPage openArticle={openArticle} />}
        {route === 'wiki'  && <WikiPage  openArticle={openArticle} />}
        {route === 'chat'  && <ChatPage  openArticle={openArticle} />}
      </main>

      <ArticleModal article={article} onClose={() => setArticle(null)} />

      <TweaksPanel show={tweaksShown} setShow={setTweaksShown} tweaks={tweaks} setTweaks={setTweaks} />
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
