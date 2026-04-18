// Data: categories, regions, wiki, chat sources
// Articles are now fetched from /data/articles.json via useArticles hook

import type { Category, CategoryColorTokens, ImportanceInfo, WikiTreeNode, WikiPageData, ChatHistoryItem } from './types';

export const CATEGORIES: readonly Category[] = [
  { id: 'regulation', zh: '監管動態', color: 'blue' },
  { id: 'product',    zh: '產品創新', color: 'green' },
  { id: 'market',     zh: '市場趨勢', color: 'amber' },
  { id: 'tech',       zh: '科技應用', color: 'purple' },
  { id: 'reinsurance',zh: '再保市場', color: 'red' },
  { id: 'esg',        zh: 'ESG永續', color: 'emerald' },
  { id: 'consumer',   zh: '消費者保護', color: 'orange' },
  { id: 'people',     zh: '人才與組織', color: 'slate' },
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
};

export const REGIONS: readonly string[] = ['台灣','中國','香港','日本','韓國','新加坡','亞太','美國','歐洲','全球'];

export const IMPORTANCE: Record<string, ImportanceInfo> = {
  high: { zh: '高', cls: 'text-red-600 dark:text-red-400' },
  mid:  { zh: '中', cls: 'text-amber-600 dark:text-amber-400' },
  low:  { zh: '低', cls: 'text-slate-500 dark:text-slate-400' },
};

// Articles are fetched at runtime — see useArticles.ts

export const WIKI_TREE: readonly WikiTreeNode[] = [
  { id: 'market', icon: '\u{1F4C8}', zh: '市場趨勢', children: [
    { id: 'market-apac', zh: '亞太' },
    { id: 'market-global', zh: '全球' },
    { id: 'market-tw', zh: '台灣' },
  ]},
  { id: 'regulation', icon: '\u{1F4CB}', zh: '監管動態', children: [
    { id: 'reg-tw', zh: '台灣' },
    { id: 'reg-hk', zh: '香港' },
    { id: 'reg-cn', zh: '中國' },
  ]},
  { id: 'tech', icon: '\u{1F52C}', zh: '科技應用', children: [
    { id: 'tech-ai', zh: 'AI / LLM' },
    { id: 'tech-claims', zh: '理賠自動化' },
  ]},
  { id: 'esg', icon: '\u{1F331}', zh: 'ESG 永續', children: [
    { id: 'esg-climate', zh: '氣候風險' },
    { id: 'esg-disclosure', zh: '揭露' },
  ]},
  { id: 'reins', icon: '\u267B\uFE0F', zh: '再保市場', children: [
    { id: 'reins-rates', zh: '費率週期' },
  ]},
  { id: 'people', icon: '\u{1F465}', zh: '人才與組織', children: [
    { id: 'people-apac', zh: '亞太人事' },
  ]},
];

export const WIKI_PAGE: WikiPageData = {
  title: '市場趨勢：亞太 — 2026 年 4 月',
  subtitle: '基於 482 篇文章蒸餾，涵蓋 2026 年 3 月 15 日至 4 月 15 日。',
  highlights: [
    '東南亞數位保險保費佔比首度突破 15%，印尼與越南成長最快，嵌入式保險是主要推力。',
    '日本車險市場進入技術競賽期，東京海上、MS&AD 與 Sompo 均在本月公布 AI 理賠平台。',
    '韓國壽險業面臨新一波高層更替，Samsung Life、Kyobo 與 Hanwha 皆於本季迎接新任 CEO。',
    '香港保監局加強 ESG 揭露，與日本、新加坡的 ISSB S2 對齊進度一致。',
    '亞太再保市場 1/4 續約費率上漲 2–4%，巨災層級為主要漲幅來源。',
  ],
  timeline: [
    { date: '2026-04-17', region: '亞太',   event: 'Zurich 任命新數位負責人' },
    { date: '2026-04-13', region: '東南亞', event: '數位保險滲透率突破 15%' },
    { date: '2026-04-12', region: '韓國',   event: 'Samsung Life 任命新 CEO' },
    { date: '2026-04-11', region: '香港',   event: '保監局加強 ESG 披露' },
    { date: '2026-04-10', region: '日本',   event: '東京海上 AI 車險理賠上線' },
    { date: '2026-04-09', region: '新加坡', event: 'Singlife 發布長壽年金' },
  ],
  analysis: '亞太保險市場在 2026 年 4 月呈現三條清晰主線：第一是數位化從實驗階段走入規模化，表現為嵌入式保險的滲透率突破與 AI 理賠系統上線；第二是監管框架向 ISSB 氣候揭露收斂，香港、新加坡與日本同步推進；第三是人事更替集中發生於韓國與跨國公司的亞太區，顯示區域戰略重心正在重新配置。',
  sources: [
    'a4', 'a5', 'a6', 'a7', 'a8', 'a1'
  ],
};

export const CHAT_HISTORY_SEED: readonly ChatHistoryItem[] = [
  { id: 'c1', title: '亞太再保費率走勢', date: '今天' },
  { id: 'c2', title: 'IFRS 17 CSM 計算範例', date: '昨天' },
  { id: 'c3', title: '香港 ESG 新規摘要', date: '4 月 12 日' },
  { id: 'c4', title: 'AI 理賠專案案例', date: '4 月 10 日' },
  { id: 'c5', title: '嵌入式保險市場規模', date: '4 月 8 日' },
];
