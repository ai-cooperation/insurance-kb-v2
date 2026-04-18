import React from 'react';
import { CATEGORIES, CATEGORY_COLORS } from '../data';

interface BadgeProps {
  readonly category: string;
  readonly region?: string;
  readonly size?: 'sm' | 'md';
}

export const Badge: React.FC<BadgeProps> = ({ category, region, size = 'sm' }) => {
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
