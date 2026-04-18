import React from 'react';
import { Icon } from './Icon';

interface SelectOption {
  readonly value: string;
  readonly label: string;
}

interface SelectProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly SelectOption[];
  readonly placeholder: string;
  readonly className?: string;
}

export const Select: React.FC<SelectProps> = ({ value, onChange, options, placeholder, className = '' }) => (
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
