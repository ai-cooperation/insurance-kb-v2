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
  readonly req: 'public' | 'member' | 'vip';
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

export type Route = 'home' | 'cards' | 'wiki' | 'chat';
export type Tier = 'guest' | 'member' | 'vip';
