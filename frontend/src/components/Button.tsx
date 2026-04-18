import React from 'react';

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: 'primary' | 'ghost' | 'outline' | 'subtle';
  readonly size?: 'sm' | 'md' | 'lg';
}

const sizes: Record<string, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-3.5 text-sm',
  lg: 'h-11 px-5 text-[15px]',
};

const variants: Record<string, string> = {
  primary: 'bg-accent text-white hover:brightness-110 active:brightness-95 shadow-sm',
  ghost:   'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/70',
  outline: 'border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700',
  subtle:  'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700/70',
};

export const Btn: React.FC<BtnProps> = ({ variant = 'primary', size = 'md', className = '', ...rest }) => (
  <button
    className={`inline-flex items-center gap-1.5 rounded-md font-medium transition focus:outline-none focus-visible:ring-2 ring-accent ${sizes[size]} ${variants[variant]} ${className}`}
    {...rest}
  />
);
