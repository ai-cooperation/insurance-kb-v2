import React from 'react';
import { Icon } from './Icon';

interface EmptyProps {
  readonly title: string;
  readonly sub: string;
}

export const Empty: React.FC<EmptyProps> = ({ title, sub }) => (
  <div className="col-span-full flex flex-col items-center justify-center py-16 text-center">
    <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
      <Icon name="search" className="w-5 h-5 text-slate-400" />
    </div>
    <div className="font-medium text-slate-700 dark:text-slate-200">{title}</div>
    <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">{sub}</div>
  </div>
);
