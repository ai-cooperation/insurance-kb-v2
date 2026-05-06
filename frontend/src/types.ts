export interface Category {
  readonly id: string;
  readonly zh: string;
  readonly color: string;
}

export interface CategoryColorTokens {
  readonly bg: string;
  readonly text: string;
  readonly ring: string;
  readonly dot: string;
  readonly border: string;
}

export interface Article {
  readonly id: string;
  readonly category: string;
  readonly region: string;
  readonly date: string;
  readonly importance: 'high' | 'mid' | 'low';
  readonly source: string;
  readonly title_zh: string;
  readonly title_en?: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly url: string;
}

export interface ImportanceInfo {
  readonly zh: string;
  readonly cls: string;
}

export interface WikiTreeNode {
  readonly id: string;
  readonly icon?: string;
  readonly zh: string;
  readonly children?: readonly WikiTreeChild[];
}

export interface WikiTreeChild {
  readonly id: string;
  readonly zh: string;
}

export interface WikiPageData {
  readonly title: string;
  readonly subtitle: string;
  readonly highlights: readonly string[];
  readonly timeline: readonly WikiTimelineEntry[];
  readonly analysis: string;
  readonly sources: readonly string[];
}

export interface WikiTimelineEntry {
  readonly date: string;
  readonly region: string;
  readonly event: string;
}

export interface ChatHistoryItem {
  readonly id: string;
  readonly title: string;
  readonly date: string;
}

export interface ChatMessage {
  readonly id: string;
  readonly role: 'user' | 'ai';
  readonly content: string;
  readonly streaming?: boolean;
  readonly citations?: readonly string[];
}

export interface NavItem {
  readonly id: string;
  readonly icon: string;
  readonly zh: string;
  readonly requiredFeature: string;
  readonly badge?: 'VIP' | 'NEW';
}

export interface TierLabelInfo {
  readonly zh: string;
  readonly badge: string;
}

export interface Tweaks {
  readonly accentH: number;
  readonly density: 'comfortable' | 'compact';
  readonly cardStyle: 'bordered' | 'elevated' | 'flat';
  readonly dark: boolean;
}

export type Route = 'home' | 'cards' | 'wiki' | 'chat' | 'reports' | 'mcp-setup';

export interface ReportMeta {
  readonly id: string;
  readonly title: string;
  readonly author_uid: string;
  readonly author_name: string | null;
  readonly author_email: string | null;
  readonly tags: readonly string[];
  readonly status: 'draft' | 'published' | 'archived';
  readonly source_session_id: string | null;
  readonly region: string | null;
  readonly category: string | null;
  readonly summary: string | null;
  readonly word_count: number;
  readonly finding_count: number;
  readonly view_count: number;
  readonly created_at: number;
  readonly updated_at: number;
  readonly r2_path: string;
  readonly topic_id: string | null;
  readonly sort_order: number;
}

export interface ReportDetail {
  readonly meta: ReportMeta;
  readonly content: string;
}

export interface TopicMeta {
  readonly id: string;
  readonly title: string;
  readonly summary: string | null;
  readonly icon: string | null;
  readonly sort_order: number;
  readonly created_at: number;
  readonly updated_at: number;
  readonly report_count?: number;
}

export type Tier = 'guest' | 'member' | 'vip';
