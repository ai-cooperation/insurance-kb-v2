// Data: categories, regions, articles, wiki, chat sources
// TODO: Replace ARTICLES with fetch("/data/articles.json") when backend is ready

import type { Category, CategoryColorTokens, Article, ImportanceInfo, WikiTreeNode, WikiPageData, ChatHistoryItem } from './types';

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

export const ARTICLES: readonly Article[] = [
  {
    id: 'a1',
    category: 'people', region: '亞太', date: '2026-04-17', importance: 'mid',
    source: 'Coverager',
    title_zh: 'Zurich 任命亞太區數位新主管',
    title_en: 'Zurich taps new digital lead for Asia Pacific',
    summary: 'Zurich 宣布任命 Lisa Tan 接任亞太區數位轉型負責人，將主導跨國理賠自動化與通路整合。新任主管在新加坡與香港皆有逾十年的經驗。',
    tags: ['Zurich', '人事任命', '數位轉型', 'APAC'],
    url: '#'
  },
  {
    id: 'a2',
    category: 'regulation', region: '台灣', date: '2026-04-15', importance: 'high',
    source: '經濟日報',
    title_zh: '金管會公布壽險業 Q1 CSM 數據',
    title_en: 'FSC releases Q1 CSM data for Taiwan life insurers',
    summary: '金管會保險局公布第一季合約服務邊際（CSM）數據，六大壽險公司合計 CSM 餘額較去年同期成長 7.2%，新契約利源改善明顯。',
    tags: ['金管會', 'IFRS 17', 'CSM', '壽險'],
    url: '#'
  },
  {
    id: 'a3',
    category: 'reinsurance', region: '全球', date: '2026-04-14', importance: 'high',
    source: 'Swiss Re',
    title_zh: 'Swiss Re 發布 2025 年報',
    title_en: 'Swiss Re publishes Annual Report 2025',
    summary: 'Swiss Re 公布全年稅後淨利 37 億美元，P&C 再保合約費率在 1/1 續約週期平均上漲 3.8%，並重申 2026 年 ROE 目標 14%。',
    tags: ['Swiss Re', '年報', '再保費率', 'ROE'],
    url: '#'
  },
  {
    id: 'a4',
    category: 'market', region: '亞太', date: '2026-04-13', importance: 'mid',
    source: 'InsuranceAsia News',
    title_zh: '東南亞數位保險滲透率突破 15%',
    title_en: 'Southeast Asia digital insurance penetration crosses 15%',
    summary: '根據 InsuranceAsia News 最新調查，印尼、越南與菲律賓的數位保險保費佔比首度突破 15%，嵌入式保險與微保險為主要驅動力。',
    tags: ['數位保險', '東南亞', '嵌入式保險'],
    url: '#'
  },
  {
    id: 'a5',
    category: 'people', region: '韓國', date: '2026-04-12', importance: 'mid',
    source: 'Korea Times',
    title_zh: 'Samsung Life 任命新 CEO',
    title_en: 'Samsung Life names new CEO',
    summary: 'Samsung Life 董事會批准任命 Park Jong-moon 為新任執行長，原任集團策略室負責人。新任 CEO 將聚焦海外佈局與數位通路。',
    tags: ['Samsung Life', '韓國', 'CEO'],
    url: '#'
  },
  {
    id: 'a6',
    category: 'esg', region: '香港', date: '2026-04-11', importance: 'high',
    source: 'HKIA',
    title_zh: '香港保監局加強 ESG 披露要求',
    title_en: 'HKIA tightens ESG disclosure for insurers',
    summary: '香港保險業監管局發布新版 ESG 指引，要求授權保險人自 2027 年起按 ISSB S2 揭露氣候相關財務資訊，並納入情境分析。',
    tags: ['ESG', 'ISSB', '氣候風險', '香港'],
    url: '#'
  },
  {
    id: 'a7',
    category: 'tech', region: '日本', date: '2026-04-10', importance: 'mid',
    source: 'Nikkei Asia',
    title_zh: '東京海上推出 AI 車險理賠系統',
    title_en: 'Tokio Marine launches AI-driven motor claims system',
    summary: '東京海上與 NTT Data 合作推出新一代 AI 車險理賠平台，能在 90 秒內完成初步定損，預計 2026 年底前覆蓋全日本分支機構。',
    tags: ['AI', '車險', '理賠自動化', '東京海上'],
    url: '#'
  },
  {
    id: 'a8',
    category: 'product', region: '新加坡', date: '2026-04-09', importance: 'mid',
    source: 'Asia Insurance Review',
    title_zh: 'Singlife 推出長壽風險年金新產品',
    title_en: 'Singlife unveils longevity-linked annuity product',
    summary: 'Singlife 發布與長壽指數連動的年金產品，提供 75 歲後加碼給付。首月預約銷售突破 3 億新幣，反映亞洲高齡化市場需求。',
    tags: ['年金', '長壽風險', 'Singlife'],
    url: '#'
  },
  {
    id: 'a9',
    category: 'consumer', region: '美國', date: '2026-04-08', importance: 'mid',
    source: 'Insurance Journal',
    title_zh: 'NAIC 發布消費者 AI 保護模範法',
    title_en: 'NAIC releases model law on AI consumer protection',
    summary: '全美保險監理官協會（NAIC）通過 AI 使用模範法，要求保險公司在核保與理賠中揭露 AI 決策依據，並提供消費者申訴管道。',
    tags: ['NAIC', 'AI 治理', '消費者保護'],
    url: '#'
  },
  {
    id: 'a10',
    category: 'regulation', region: '中國', date: '2026-04-07', importance: 'mid',
    source: '金融時報',
    title_zh: '國家金融監督管理總局發布償付能力第三代',
    title_en: 'NFRA rolls out C-ROSS Phase III solvency rules',
    summary: '中國國家金融監督管理總局正式發布償付能力監管規則（C-ROSS）第三代，調整權益類資產風險因子，並引入氣候壓力測試。',
    tags: ['C-ROSS', '償付能力', '中國'],
    url: '#'
  },
  {
    id: 'a11',
    category: 'market', region: '歐洲', date: '2026-04-06', importance: 'mid',
    source: 'Reuters',
    title_zh: '歐洲壽險 Q1 保費較去年持平',
    title_en: 'European life premiums flat YoY in Q1',
    summary: '根據 Insurance Europe 初步統計，歐洲主要市場第一季壽險保費較去年同期持平，法國與義大利年金商品推動投資型商品回溫。',
    tags: ['歐洲', '壽險', '年金'],
    url: '#'
  },
  {
    id: 'a12',
    category: 'tech', region: '全球', date: '2026-04-05', importance: 'low',
    source: 'Coverager',
    title_zh: 'Lemonade 公布 Claims GPT 第四代',
    title_en: 'Lemonade unveils Claims GPT v4',
    summary: 'Lemonade 釋出第四代理賠大語言模型，宣稱在詐欺偵測召回率較前代提升 18%。公司計畫將同一模型授權給歐洲夥伴。',
    tags: ['Lemonade', 'LLM', '詐欺偵測'],
    url: '#'
  },
];

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
