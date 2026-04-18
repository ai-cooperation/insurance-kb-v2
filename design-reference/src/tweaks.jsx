// Tweaks panel — dev-time design controls

const TweaksPanel = ({ show, setShow, tweaks, setTweaks }) => {
  if (!show) return null;

  const update = (patch) => {
    const next = { ...tweaks, ...patch };
    setTweaks(next);
    try {
      window.parent?.postMessage({ type: '__edit_mode_set_keys', edits: patch }, '*');
    } catch {}
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[280px] rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-2xl anim-in overflow-hidden">
      <div className="flex items-center justify-between px-4 h-10 border-b border-slate-200 dark:border-slate-800">
        <div className="text-[12px] font-semibold font-mono uppercase tracking-wider">Tweaks</div>
        <button onClick={() => setShow(false)} className="text-slate-500 hover:text-slate-900 dark:hover:text-white">
          <Icon name="x" className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Accent hue */}
        <div>
          <div className="flex items-center justify-between text-[11.5px] mb-1.5">
            <label className="font-medium text-slate-700 dark:text-slate-200">主色調</label>
            <span className="font-mono text-slate-500">H {tweaks.accentH}°</span>
          </div>
          <input
            type="range" min="0" max="360" step="1"
            value={tweaks.accentH}
            onChange={(e) => update({ accentH: Number(e.target.value) })}
            className="w-full accent-teal-600"
            style={{
              background: 'linear-gradient(90deg,hsl(0 85% 45%),hsl(60 85% 45%),hsl(120 85% 45%),hsl(180 85% 45%),hsl(240 85% 45%),hsl(300 85% 45%),hsl(360 85% 45%))',
              height: 6, borderRadius: 999,
            }}
          />
          <div className="mt-2 flex gap-1.5">
            {[ { n: 'Teal', h: 172 }, { n: 'Indigo', h: 245 }, { n: 'Rose', h: 345 }, { n: 'Amber', h: 40 }, { n: 'Slate', h: 215 } ].map(c => (
              <button key={c.n} onClick={() => update({ accentH: c.h })} title={c.n}
                className={`w-6 h-6 rounded-md ring-1 ring-slate-200 dark:ring-slate-700 ${tweaks.accentH === c.h ? 'outline outline-2 outline-offset-1 outline-slate-900 dark:outline-white' : ''}`}
                style={{ background: `hsl(${c.h} 85% 33%)` }}
              />
            ))}
          </div>
        </div>

        {/* Density */}
        <div>
          <div className="text-[11.5px] font-medium text-slate-700 dark:text-slate-200 mb-1.5">密度</div>
          <div className="flex p-0.5 rounded-md bg-slate-100 dark:bg-slate-900">
            {['comfortable','compact'].map(d => (
              <button key={d} onClick={() => update({ density: d })}
                className={`flex-1 h-7 text-[11.5px] font-medium rounded transition ${tweaks.density === d ? 'bg-white dark:bg-slate-800 shadow-sm' : 'text-slate-500'}`}>
                {d === 'comfortable' ? '寬鬆' : '緊湊'}
              </button>
            ))}
          </div>
        </div>

        {/* Card style */}
        <div>
          <div className="text-[11.5px] font-medium text-slate-700 dark:text-slate-200 mb-1.5">卡片樣式</div>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { id: 'bordered', zh: '描邊' },
              { id: 'elevated', zh: '陰影' },
              { id: 'flat', zh: '平面' },
            ].map(o => (
              <button key={o.id} onClick={() => update({ cardStyle: o.id })}
                className={`h-8 text-[11.5px] rounded-md border transition ${tweaks.cardStyle === o.id ? 'border-accent text-accent bg-accent-soft' : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300'}`}>
                {o.zh}
              </button>
            ))}
          </div>
        </div>

        {/* Dark mode */}
        <div className="flex items-center justify-between">
          <label className="text-[11.5px] font-medium text-slate-700 dark:text-slate-200">深色模式</label>
          <button
            onClick={() => update({ dark: !tweaks.dark })}
            className={`relative w-10 h-5.5 h-6 rounded-full transition ${tweaks.dark ? 'bg-accent' : 'bg-slate-300 dark:bg-slate-700'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition ${tweaks.dark ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>
      </div>
    </div>
  );
};

window.TweaksPanel = TweaksPanel;
