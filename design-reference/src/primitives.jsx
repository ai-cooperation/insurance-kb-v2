// Small reusable primitives: icons, badges, buttons, stat card, etc.

const Icon = ({ name, className = 'w-4 h-4', strokeWidth = 1.75 }) => {
  const paths = {
    menu:    <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>,
    home:    <><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></>,
    cards:   <><rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="14" y="4" width="7" height="7" rx="1.5"/><rect x="3" y="13" width="7" height="7" rx="1.5"/><rect x="14" y="13" width="7" height="7" rx="1.5"/></>,
    book:    <><path d="M4 4h10a4 4 0 0 1 4 4v13H8a4 4 0 0 1-4-4V4z"/><path d="M4 17h14"/></>,
    chat:    <><path d="M4 5h16v11H9l-4 4v-4H4z"/></>,
    sparkle: <><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/><path d="M19 14l.9 2.4L22 17l-2.1.6L19 20l-.9-2.4L16 17l2.1-.6z"/></>,
    search:  <><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16" y2="16"/></>,
    filter:  <><path d="M4 5h16l-6 8v5l-4 2v-7z"/></>,
    x:       <><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></>,
    chevL:   <><polyline points="15 6 9 12 15 18"/></>,
    chevR:   <><polyline points="9 6 15 12 9 18"/></>,
    chevD:   <><polyline points="6 9 12 15 18 9"/></>,
    sun:     <><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.9" y1="4.9" x2="6.3" y2="6.3"/><line x1="17.7" y1="17.7" x2="19.1" y2="19.1"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.9" y1="19.1" x2="6.3" y2="17.7"/><line x1="17.7" y1="6.3" x2="19.1" y2="4.9"/></>,
    moon:    <><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></>,
    ext:     <><path d="M14 4h6v6"/><line x1="10" y1="14" x2="20" y2="4"/><path d="M20 14v6H4V4h6"/></>,
    send:    <><path d="M4 12l16-8-6 16-2-7-8-1z"/></>,
    plus:    <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    lock:    <><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></>,
    star:    <><path d="M12 3l2.9 6 6.6.9-4.8 4.6 1.2 6.6L12 18l-5.9 3.1 1.2-6.6L2.5 9.9 9.1 9z"/></>,
    user:    <><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></>,
    google:  <><path d="M21 12a9 9 0 1 1-2.6-6.3" /><path d="M21 4v5h-5"/></>,
    slider:  <><line x1="4" y1="7" x2="20" y2="7"/><circle cx="9" cy="7" r="2.2"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="15" cy="17" r="2.2"/></>,
    glove:   <><path d="M4 8h16v12H4z"/><path d="M8 8V4h8v4"/></>,
    globe:   <><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/></>,
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
         strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {paths[name] || null}
    </svg>
  );
};

const Badge = ({ category, region, size = 'sm' }) => {
  const cat = CATEGORIES.find(c => c.id === category);
  if (!cat) return null;
  const c = CATEGORY_COLORS[cat.color];
  const pad = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md font-medium ${pad} ${c.bg} ${c.text} ring-1 ${c.ring}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {cat.zh}
      {region && <span className="opacity-60 pl-1 border-l border-current/20 ml-1">{region}</span>}
    </span>
  );
};

const Btn = ({ variant = 'primary', size = 'md', className = '', ...rest }) => {
  const sizes = {
    sm: 'h-8 px-3 text-xs',
    md: 'h-9 px-3.5 text-sm',
    lg: 'h-11 px-5 text-[15px]',
  };
  const variants = {
    primary: 'bg-accent text-white hover:brightness-110 active:brightness-95 shadow-sm',
    ghost:   'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/70',
    outline: 'border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700',
    subtle:  'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700/70',
  };
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-md font-medium transition focus:outline-none focus-visible:ring-2 ring-accent ${sizes[size]} ${variants[variant]} ${className}`}
      {...rest}
    />
  );
};

const Select = ({ value, onChange, options, placeholder, className = '' }) => (
  <div className={`relative ${className}`}>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="appearance-none h-9 w-full pl-3 pr-8 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 ring-accent focus:border-transparent cursor-pointer"
    >
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
    <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400">
      <Icon name="chevD" className="w-4 h-4" />
    </div>
  </div>
);

const StatCard = ({ label, value, delta, icon }) => (
  <div className="relative overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
    <div className="flex items-start justify-between">
      <div>
        <div className="text-[13px] font-medium text-slate-500 dark:text-slate-400">{label}</div>
        <div className="mt-1 text-[32px] font-semibold tracking-tight tabular-nums">{value}</div>
        {delta && <div className="mt-1 text-xs text-accent font-medium">{delta}</div>}
      </div>
      <div className="w-9 h-9 rounded-lg bg-accent-soft text-accent flex items-center justify-center">
        <Icon name={icon} className="w-4 h-4" />
      </div>
    </div>
    {/* decorative sparkline */}
    <svg viewBox="0 0 120 30" className="absolute bottom-2 right-2 w-24 h-7 opacity-50" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M2 22 L15 18 L28 20 L41 12 L54 15 L67 8 L80 11 L93 5 L106 9 L118 4" className="text-accent" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  </div>
);

// Placeholder block — striped SVG with monospace caption
const Placeholder = ({ label, className = '', ratio = '16/9' }) => (
  <div className={`relative w-full rounded-lg overflow-hidden border border-dashed border-slate-300 dark:border-slate-700 ${className}`} style={{ aspectRatio: ratio }}>
    <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
      <defs>
        <pattern id="stripes" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="6" className="text-slate-200 dark:text-slate-800"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#stripes)" className="text-slate-100 dark:text-slate-900" />
    </svg>
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="px-2 py-1 rounded bg-white/85 dark:bg-slate-900/85 text-[11px] font-mono text-slate-500 dark:text-slate-400">
        {label}
      </div>
    </div>
  </div>
);

// Modal / drawer shell
const Modal = ({ open, onClose, children, maxWidth = 'max-w-2xl' }) => {
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" />
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full ${maxWidth} max-h-[85vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-2xl anim-in`}
      >
        {children}
      </div>
    </div>
  );
};

// Compact "no results" empty state
const Empty = ({ title, sub }) => (
  <div className="col-span-full flex flex-col items-center justify-center py-16 text-center">
    <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
      <Icon name="search" className="w-5 h-5 text-slate-400" />
    </div>
    <div className="font-medium text-slate-700 dark:text-slate-200">{title}</div>
    <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">{sub}</div>
  </div>
);

Object.assign(window, { Icon, Badge, Btn, Select, StatCard, Placeholder, Modal, Empty });
