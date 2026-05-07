// Data: categories, regions, wiki, chat sources
// Articles are now fetched from /data/articles.json via useArticles hook

import type { Category, CategoryColorTokens, ImportanceInfo, ChatHistoryItem } from './types';

export const CATEGORIES: readonly Category[] = [
  { id: 'regulation', zh: '監管動態', color: 'blue' },
  { id: 'product',    zh: '產品創新', color: 'green' },
  { id: 'market',     zh: '市場趨勢', color: 'amber' },
  { id: 'tech',       zh: '科技應用', color: 'purple' },
  { id: 'reinsurance',zh: '再保市場', color: 'red' },
  { id: 'esg',        zh: 'ESG永續', color: 'emerald' },
  { id: 'consumer',   zh: '消費者保護', color: 'orange' },
  { id: 'people',     zh: '人才與組織', color: 'slate' },
  { id: 'marketing',  zh: '行銷推廣', color: 'pink' },
];

export const CATEGORY_COLORS: Record<string, CategoryColorTokens> = {
  blue:    { bg: 'bg-blue-50 dark:bg-blue-500/10',       text: 'text-blue-700 dark:text-blue-300',     ring: 'ring-blue-200/70 dark:ring-blue-400/20',   dot: 'bg-blue-500',     border: 'hover:border-blue-400/60' },
  green:   { bg: 'bg-green-50 dark:bg-green-500/10',     text: 'text-green-700 dark:text-green-300',   ring: 'ring-green-200/70 dark:ring-green-400/20', dot: 'bg-green-500',    border: 'hover:border-green-400/60' },
  amber:   { bg: 'bg-amber-50 dark:bg-amber-500/10',     text: 'text-amber-700 dark:text-amber-300',   ring: 'ring-amber-200/70 dark:ring-amber-400/20', dot: 'bg-amber-500',    border: 'hover:border-amber-400/60' },
  purple:  { bg: 'bg-purple-50 dark:bg-purple-500/10',   text: 'text-purple-700 dark:text-purple-300', ring: 'ring-purple-200/70 dark:ring-purple-400/20',dot: 'bg-purple-500',  border: 'hover:border-purple-400/60' },
  red:     { bg: 'bg-red-50 dark:bg-red-500/10',         text: 'text-red-700 dark:text-red-300',       ring: 'ring-red-200/70 dark:ring-red-400/20',     dot: 'bg-red-500',      border: 'hover:border-red-400/60' },
  emerald: { bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-300',ring:'ring-emerald-200/70 dark:ring-emerald-400/20',dot:'bg-emerald-500',border: 'hover:border-emerald-400/60' },
  orange:  { bg: 'bg-orange-50 dark:bg-orange-500/10',   text: 'text-orange-700 dark:text-orange-300', ring: 'ring-orange-200/70 dark:ring-orange-400/20',dot: 'bg-orange-500',   border: 'hover:border-orange-400/60' },
  slate:   { bg: 'bg-slate-100 dark:bg-slate-500/15',    text: 'text-slate-700 dark:text-slate-300',   ring: 'ring-slate-200 dark:ring-slate-500/20',    dot: 'bg-slate-500',    border: 'hover:border-slate-400/60' },
  pink:    { bg: 'bg-pink-50 dark:bg-pink-500/10',       text: 'text-pink-700 dark:text-pink-300',     ring: 'ring-pink-200/70 dark:ring-pink-400/20',   dot: 'bg-pink-500',     border: 'hover:border-pink-400/60' },
};

export const REGIONS: readonly string[] = ['台灣','中國','香港','日本','韓國','新加坡','亞太','美國','歐洲','全球'];

export const IMPORTANCE: Record<string, ImportanceInfo> = {
  high: { zh: '高', cls: 'text-red-600 dark:text-red-400' },
  mid:  { zh: '中', cls: 'text-amber-600 dark:text-amber-400' },
  low:  { zh: '低', cls: 'text-slate-500 dark:text-slate-400' },
};

// Articles are fetched at runtime — see useArticles.ts
// Wiki data is fetched at runtime from /data/wiki.json — see Wiki.tsx

const CATEGORY_ICONS: Record<string, string> = {
  market: '\u{1F4C8}',
  regulation: '\u{1F4CB}',
  tech: '\u{1F52C}',
  esg: '\u{1F331}',
  reinsurance: '\u267B\uFE0F',
  consumer: '\u{1F6E1}',
  product: '\u{1F4E6}',
  people: '\u{1F465}',
  marketing: '\u{1F4E3}',
};

export function getCategoryIcon(id: string): string {
  return CATEGORY_ICONS[id] || '';
}

export const CHAT_HISTORY_SEED: readonly ChatHistoryItem[] = [
  { id: 'c1', title: '亞太再保費率走勢', date: '今天' },
  { id: 'c2', title: 'IFRS 17 CSM 計算範例', date: '昨天' },
  { id: 'c3', title: '香港 ESG 新規摘要', date: '4 月 12 日' },
  { id: 'c4', title: 'AI 理賠專案案例', date: '4 月 10 日' },
  { id: 'c5', title: '嵌入式保險市場規模', date: '4 月 8 日' },
];
