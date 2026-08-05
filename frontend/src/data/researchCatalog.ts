/**
 * Research catalog — categorizes existing topics by main-axis category.
 *
 * Live data still comes from /api/topics + /api/reports. This catalog only adds:
 *   1. Category groupings (6 main-axis)
 *   2. Topic → category assignment
 *
 * 2026-05-13: Tier 1 + Tier 2 batch sweep — 10 new topics added across 4 cats.
 *   cat_product: 健康險商品專題 → 保險商品專題 (broader, includes life products)
 *   cat_special: 特定族群與疾病 → 特定族群、專科與疾病保險 (adds 牙科/眼科/罕病/心理/生育力)
 */

export type PlannedKind = 'topic' | 'report-in-topic';

export interface PlannedItem {
  readonly kind: PlannedKind;
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly clustered_from?: readonly string[];
  readonly priority: number;
  readonly parent_topic_id?: string;
  readonly tags?: readonly string[];
}

export interface ResearchCategory {
  readonly id: string;
  readonly title: string;
  readonly icon: string;
  readonly description: string;
  readonly live_topic_ids: readonly string[];
  readonly planned: readonly PlannedItem[];
}

export const RESEARCH_CATALOG: readonly ResearchCategory[] = [
  // ── 1. 亞洲健康險地理市場 ────────────────────────────────────────────
  {
    id: 'cat_geo',
    title: '亞洲健康險地理市場',
    icon: 'book',
    description: '亞洲各市場健康險研究系列（含跨市場總結）',
    live_topic_ids: ['topic_health_ecosystem_2026'],
    planned: [],
  },

  // ── 2. 保險商品專題（健康險 + 壽險）────────────────────────────────
  {
    id: 'cat_product',
    title: '保險商品專題',
    icon: 'book',
    description: '健康險主商品（重疾/實支/癌症/三高）+ 壽險商品（年金/利變型）+ 微保險/跨境/穿戴定價',
    live_topic_ids: [
      'topic_chronic_disease_2026',
      'topic_critical_illness_2026',
      'topic_cancer_insurance_2026',
      'topic_indemnity_medical_2026',
      'topic_pcl_health_2026',
      'topic_micro_insurance_2026',
      'topic_cross_border_health_2026',
      'topic_wearable_underwriting_2026',
      'topic_annuity_retirement_2026',
      'topic_investment_linked_2026',
    ],
    planned: [],
  },

  // ── 3. 健康促進、服務通路、AI、嵌入式 ──────────────────────────────
  {
    id: 'cat_service',
    title: '健康管理服務 / 通路',
    icon: 'book',
    description: '外溢保單、數位通路、亞健康平台、慢病管理、醫療直付、AI 核保、嵌入式保險',
    live_topic_ids: [
      'topic_global_vitality_2026',
      'topic_digital_channel_2026',
      'topic_cashless_medical_2026',
      'topic_chronic_digital_2026',
      'topic_wellness_platform_2026',
      'topic_ai_underwriting_2026',
      'topic_embedded_insurance_2026',
    ],
    planned: [],
  },

  // ── 4. 高齡保障與長照 ────────────────────────────────────────────────
  {
    id: 'cat_aging',
    title: '高齡保障與長照',
    icon: 'book',
    description: '高齡商品、銀髮經濟、長照（亞洲/歐洲）、失智檢測、失能扶助',
    live_topic_ids: [
      'topic_dementia_insurance_2026',
      'topic_senior_protection_2026',
      'topic_ltc_asia_2026',
      'topic_ltc_industry_2026',
      'topic_ltc_europe_2026',
      'topic_silver_economy_2026',
      'topic_disability_evolve_2026',
    ],
    planned: [],
  },

  // ── 5. 特定族群、專科與疾病保險 ─────────────────────────────────────
  {
    id: 'cat_special',
    title: '特定族群、專科與疾病保險',
    icon: 'book',
    description: '基因檢測、婦幼/兒童、罕病/孤兒藥、心理健康、牙科、眼科、生育力等專科與利基商品',
    live_topic_ids: [
      'topic_genetic_insurance_2026',
      'topic_maternal_child_2026',
      'topic_mental_health_2026',
      'topic_rare_disease_2026',
      'topic_dental_asia_2026',
      'topic_fertility_2026',
      'topic_vision_asia_2026',
    ],
    planned: [],
  },

  // ── 6. 客群分群（新加 2026-05-13）─────────────────────────────────
  {
    id: 'cat_demographic',
    title: '客群分群',
    icon: 'book',
    description: '高資產 HNW、Gig Economy、青壯年 Millennials/Gen Z、移工/跨境勞工、LGBTQ+/多元家庭',
    live_topic_ids: [
      'topic_hnw_insurance_2026',
      'topic_gig_economy_2026',
      'topic_millennials_2026',
      'topic_migrant_worker_2026',
      'topic_lgbtq_insurance_2026',
    ],
    planned: [],
  },

  // ── 7. 策略與競品 / 監管 ─────────────────────────────────────
  {
    id: 'cat_strategy',
    title: '策略與競品',
    icon: 'book',
    description: 'V1/V2 行銷策略、新光人壽、南山策略、IFRS 17 對亞洲健康險的影響、亞洲壽險 IPO',
    live_topic_ids: [
      'topic_v1_marketing',
      'topic_v2_flywheel',
      'topic_shinkon_2026',
      'topic_ifrs17_health_2026',
      'topic_insurance_ipo_2026',
    ],
    planned: [],
  },
] as const;

/**
 * Reverse lookup — given a topic_id, find its category.
 */
export function findCategoryForTopic(topicId: string): ResearchCategory | undefined {
  return RESEARCH_CATALOG.find(c => c.live_topic_ids.includes(topicId));
}

export const CATALOG_STATS = {
  total_categories: RESEARCH_CATALOG.length,
  total_live_topics: RESEARCH_CATALOG.reduce((sum, c) => sum + c.live_topic_ids.length, 0),
  total_planned_items: RESEARCH_CATALOG.reduce((sum, c) => sum + c.planned.length, 0),
} as const;
