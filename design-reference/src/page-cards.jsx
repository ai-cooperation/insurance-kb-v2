// Cards page — filters + responsive grid + expand modal

const ArticleModal = ({ article, onClose }) => {
  if (!article) return null;
  const a = article;
  return (
    <Modal open={!!a} onClose={onClose}>
      <div className="p-6 md:p-8">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge category={a.category} region={a.region} size="md" />
              <span className="text-[12px] font-mono text-slate-500 tabular-nums">{a.date}</span>
              <span className={`text-[12px] font-medium ${IMPORTANCE[a.importance].cls}`}>● 重要性：{IMPORTANCE[a.importance].zh}</span>
            </div>
            <h2 className="mt-4 text-[22px] md:text-[26px] font-semibold tracking-tight text-balance leading-tight">
              {a.title_zh}
            </h2>
            {a.title_en && <div className="mt-2 text-[14px] text-slate-500 dark:text-slate-400">{a.title_en}</div>}
          </div>
          <button onClick={onClose} className="shrink-0 p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500">
            <Icon name="x" className="w-5 h-5" />
          </button>
        </div>

        <p className="mt-6 text-[15.5px] leading-[1.75] text-slate-700 dark:text-slate-300 text-pretty">
          {a.summary} {a.summary}
        </p>

        <div className="mt-6">
          <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-2">關鍵字</div>
          <div className="flex flex-wrap gap-1.5">
            {a.tags.map(t => (
              <span key={t} className="inline-block px-2 py-0.5 rounded border border-slate-200 dark:border-slate-800 text-[12px] text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900">
                #{t}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="text-[13px] text-slate-500 dark:text-slate-400">
            來源：<span className="font-medium text-slate-700 dark:text-slate-200">{a.source}</span>
          </div>
          <Btn variant="primary">
            查看原文 <Icon name="ext" className="w-3.5 h-3.5" />
          </Btn>
        </div>
      </div>
    </Modal>
  );
};

const CardsPage = ({ openArticle }) => {
  const [cat, setCat] = React.useState('');
  const [region, setRegion] = React.useState('');
  const [q, setQ] = React.useState('');

  const filtered = React.useMemo(() => {
    return ARTICLES.filter(a => {
      if (cat && a.category !== cat) return false;
      if (region && a.region !== region) return false;
      if (q) {
        const hay = `${a.title_zh} ${a.title_en||''} ${a.summary} ${a.source} ${a.tags.join(' ')}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [cat, region, q]);

  const active = cat || region || q;

  return (
    <div className="flex-1 overflow-auto">
      {/* filter bar — sticky */}
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-slate-950/80 backdrop-blur border-b border-slate-200 dark:border-slate-900">
        <div className="px-4 md:px-6 py-3 flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[200px] relative">
            <Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜尋標題、摘要、關鍵字…"
              className="w-full h-9 pl-9 pr-3 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 ring-accent"
            />
          </div>
          <Select
            value={cat}
            onChange={setCat}
            placeholder="全部分類"
            className="w-[150px]"
            options={CATEGORIES.map(c => ({ value: c.id, label: c.zh }))}
          />
          <Select
            value={region}
            onChange={setRegion}
            placeholder="全部地區"
            className="w-[130px]"
            options={REGIONS.map(r => ({ value: r, label: r }))}
          />
          {active && (
            <Btn variant="ghost" size="md" onClick={() => { setCat(''); setRegion(''); setQ(''); }}>
              <Icon name="x" className="w-3.5 h-3.5" /> 清除篩選
            </Btn>
          )}
          <div className="ml-auto text-[12px] text-slate-500 dark:text-slate-400">
            共 <span className="font-mono font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{filtered.length}</span> / {ARTICLES.length} 篇
          </div>
        </div>

        {/* active chips */}
        {active && (
          <div className="px-4 md:px-6 pb-3 flex flex-wrap gap-1.5">
            {cat && (
              <Chip onRemove={() => setCat('')}>
                分類：{CATEGORIES.find(c => c.id === cat)?.zh}
              </Chip>
            )}
            {region && <Chip onRemove={() => setRegion('')}>地區：{region}</Chip>}
            {q && <Chip onRemove={() => setQ('')}>搜尋：「{q}」</Chip>}
          </div>
        )}
      </div>

      {/* grid */}
      <div className="px-4 md:px-6 py-6">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(a => <MiniCard key={a.id} a={a} onOpen={openArticle} />)}
          {filtered.length === 0 && <Empty title="找不到符合條件的卡片" sub="試著移除一些篩選條件，或換個關鍵字。" />}
        </div>
      </div>
    </div>
  );
};

const Chip = ({ children, onRemove }) => (
  <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
    {children}
    <button onClick={onRemove} className="p-0.5 hover:text-slate-900 dark:hover:text-white">
      <Icon name="x" className="w-3 h-3" />
    </button>
  </span>
);

Object.assign(window, { CardsPage, ArticleModal });
