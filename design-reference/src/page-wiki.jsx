// Wiki page — tree sidebar + distilled content

const WikiTreeNode = ({ node, activeId, setActiveId, expandedSet, toggle }) => {
  const expanded = expandedSet.has(node.id);
  const hasKids = node.children?.length;
  return (
    <div>
      <button
        onClick={() => {
          if (hasKids) toggle(node.id);
          else setActiveId(node.id);
        }}
        className={`w-full flex items-center gap-1.5 px-2 h-8 rounded-md text-[13px] transition
          ${activeId === node.id && !hasKids ? 'bg-accent-soft text-accent font-medium' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70'}`}
      >
        {hasKids ? (
          <Icon name={expanded ? 'chevD' : 'chevR'} className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {node.icon && <span className="text-sm leading-none">{node.icon}</span>}
        <span className="truncate">{node.zh}</span>
      </button>
      {hasKids && expanded && (
        <div className="ml-5 border-l border-slate-200 dark:border-slate-800 pl-1 mt-0.5 space-y-0.5">
          {node.children.map(c => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className={`w-full text-left px-2 h-7 rounded-md text-[12.5px] transition
                ${activeId === c.id ? 'bg-accent-soft text-accent font-medium' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70'}`}
            >
              {c.zh}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const WikiPage = ({ openArticle }) => {
  const [activeId, setActiveId] = React.useState('market-apac');
  const [expanded, setExpanded] = React.useState(new Set(['market', 'regulation']));
  const [period, setPeriod] = React.useState('month');
  const [sourcesOpen, setSourcesOpen] = React.useState(true);

  const toggle = (id) => {
    const s = new Set(expanded);
    s.has(id) ? s.delete(id) : s.add(id);
    setExpanded(s);
  };

  const page = WIKI_PAGE;
  const sourceArticles = page.sources.map(id => ARTICLES.find(a => a.id === id)).filter(Boolean);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Tree sidebar */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-slate-200 dark:border-slate-900 bg-slate-50/50 dark:bg-slate-950/50">
        <div className="px-3 pt-4 pb-2 text-[10.5px] font-mono uppercase tracking-wider text-slate-500">主題</div>
        <div className="flex-1 overflow-auto px-2 pb-4 space-y-0.5">
          {WIKI_TREE.map(n => (
            <WikiTreeNode key={n.id} node={n} activeId={activeId} setActiveId={setActiveId} expandedSet={expanded} toggle={toggle} />
          ))}
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <article className="max-w-3xl mx-auto px-6 md:px-10 py-10">
          {/* breadcrumb */}
          <div className="text-[11.5px] font-mono uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            市場趨勢 <Icon name="chevR" className="w-3 h-3" /> 亞太
          </div>
          <h1 className="mt-2 text-[32px] md:text-[38px] font-semibold tracking-tight leading-tight text-balance">
            {page.title}
          </h1>
          <p className="mt-3 text-[15px] text-slate-600 dark:text-slate-400 leading-relaxed">
            {page.subtitle}
          </p>

          {/* Period switcher */}
          <div className="mt-6 inline-flex items-center p-0.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            {[
              { id: 'month', zh: '月度' },
              { id: 'quarter', zh: '季度' },
              { id: 'year', zh: '年度' },
            ].map(p => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={`px-3.5 h-7 text-[12px] font-medium rounded transition ${period === p.id ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}
              >
                {p.zh}
              </button>
            ))}
          </div>

          {/* Highlights */}
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

          {/* Timeline */}
          <section className="mt-10">
            <h2 className="text-[11.5px] font-mono uppercase tracking-wider text-slate-500 mb-3">時間線</h2>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              <table className="w-full text-[13.5px]">
                <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="text-left font-medium px-4 py-2.5 w-[110px]">日期</th>
                    <th className="text-left font-medium px-4 py-2.5 w-[100px]">地區</th>
                    <th className="text-left font-medium px-4 py-2.5">事件</th>
                  </tr>
                </thead>
                <tbody>
                  {page.timeline.map((e, i) => (
                    <tr key={i} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/40">
                      <td className="px-4 py-2.5 font-mono tabular-nums text-slate-600 dark:text-slate-400">{e.date}</td>
                      <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">{e.region}</td>
                      <td className="px-4 py-2.5 text-slate-800 dark:text-slate-100">{e.event}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Analysis */}
          <section className="mt-10">
            <h2 className="text-[11.5px] font-mono uppercase tracking-wider text-slate-500 mb-3">趨勢分析</h2>
            <p className="text-[16px] leading-[1.85] text-slate-700 dark:text-slate-200 text-pretty">
              {page.analysis}
            </p>
          </section>

          {/* Sources */}
          <section className="mt-10">
            <button
              onClick={() => setSourcesOpen(!sourcesOpen)}
              className="w-full flex items-center justify-between text-left"
            >
              <h2 className="text-[11.5px] font-mono uppercase tracking-wider text-slate-500">
                來源文章 · {sourceArticles.length}
              </h2>
              <Icon name={sourcesOpen ? 'chevD' : 'chevR'} className="w-4 h-4 text-slate-400" />
            </button>
            {sourcesOpen && (
              <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800">
                {sourceArticles.map(a => (
                  <button
                    key={a.id}
                    onClick={() => openArticle(a)}
                    className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-900/60"
                  >
                    <Badge category={a.category} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-medium truncate text-slate-800 dark:text-slate-100">{a.title_zh}</div>
                      <div className="text-[11.5px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {a.source} · {a.date}
                      </div>
                    </div>
                    <Icon name="chevR" className="w-4 h-4 text-slate-300" />
                  </button>
                ))}
              </div>
            )}
          </section>

          <div className="mt-12 pt-6 border-t border-slate-200 dark:border-slate-900 text-[11.5px] font-mono uppercase tracking-wider text-slate-500">
            Distilled 2026-04-15 04:00 UTC · Model: knowledge-distill-v3
          </div>
        </article>
      </div>
    </div>
  );
};

window.WikiPage = WikiPage;
