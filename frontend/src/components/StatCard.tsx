import React from 'react';
import { Icon } from './Icon';

interface StatCardProps {
  readonly label: string;
  readonly value: string;
  readonly delta?: string;
  readonly icon: string;
}

export const StatCard: React.FC<StatCardProps> = ({ label, value, delta, icon }) => (
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
