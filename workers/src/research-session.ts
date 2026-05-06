/**
 * Research Session — KV-backed state machine for grill-mode style report drafting.
 *
 * Storage: KV with TTL = 24 hours. Keys:
 *   research_session:{uid}:{session_id}       → SessionState JSON
 *   research_session:{uid}:index              → Array<{session_id, title, status, updated}>
 *
 * State transitions:
 *   created → scope_confirmed → drafting → finalized | abandoned
 *
 * 24h TTL means abandoned sessions auto-clean. User can run `start_research_session`
 * again any time. We do NOT persist beyond 24h to keep KV small.
 */

const SESSION_TTL_SECONDS = 24 * 3600;
const MAX_FINDINGS_PER_SESSION = 100;

export interface Finding {
  id: number;                  // 1-indexed within session
  type:
    | "news_quote"
    | "report_quote"
    | "wiki_quote"
    | "web_quote"
    | "observation"
    | "cross_market_pattern";
  content: string;
  source_url: string;
  source_title?: string;
  source_date?: string;
  added_at: number;
}

export interface ScopeDecisions {
  scope?: string;
  region?: string;
  timeframe?: string;
  audience?: string;
  depth?: string;
}

export interface SessionState {
  session_id: string;
  uid: string;
  email: string;
  topic_seed: string;
  status: "created" | "scope_confirmed" | "drafting" | "finalized" | "abandoned";
  created_at: number;
  updated_at: number;
  scope_decisions: ScopeDecisions | null;
  findings: Finding[];
  outline_md: string | null;
  finalized_report_id: string | null;
}

function sessionKey(uid: string, sessionId: string): string {
  return `research_session:${uid}:${sessionId}`;
}

function generateSessionId(): string {
  return "rs_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

async function writeSession(kv: KVNamespace, state: SessionState): Promise<void> {
  state.updated_at = Math.floor(Date.now() / 1000);
  await kv.put(sessionKey(state.uid, state.session_id), JSON.stringify(state), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
}

export async function getSession(
  kv: KVNamespace,
  uid: string,
  sessionId: string,
): Promise<SessionState | null> {
  const raw = await kv.get(sessionKey(uid, sessionId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionState;
  } catch {
    return null;
  }
}

export async function startResearchSession(
  kv: KVNamespace,
  uid: string,
  email: string,
  topic_seed: string,
) {
  const session_id = generateSessionId();
  const now = Math.floor(Date.now() / 1000);
  const state: SessionState = {
    session_id,
    uid,
    email,
    topic_seed,
    status: "created",
    created_at: now,
    updated_at: now,
    scope_decisions: null,
    findings: [],
    outline_md: null,
    finalized_report_id: null,
  };
  await writeSession(kv, state);

  return {
    session_id,
    topic_seed,
    next_step: "請一步步引導用戶決定以下 5 個範圍 (grill-mode 風格)：每步列選項+推薦+等用戶選後再下一步",
    framework: [
      {
        step: 1,
        title: "主題範圍",
        question: `針對「${topic_seed}」，你想聚焦在哪個面向？`,
        options: [
          { id: "A", label: "商品本身（規格/定價/承保條件）" },
          { id: "B", label: "市場趨勢（滲透率/客群/通路）" },
          { id: "C", label: "競品比較（其他公司怎麼做）" },
          { id: "D", label: "法規環境（監管/合規）" },
          { id: "E", label: "全部都要（綜合報告）" },
        ],
        recommended: "A+C",
        rationale: "商品設計團隊最常需要的是商品+競品的組合分析",
      },
      {
        step: 2,
        title: "地區範圍",
        question: "要看哪些市場？",
        options: [
          { id: "A", label: "台灣（深度）" },
          { id: "B", label: "亞洲（台灣 + 日韓港 + 東南亞）" },
          { id: "C", label: "全球（含歐美）" },
        ],
        recommended: "B",
        rationale: "亞洲市場資料最完整，且文化 / 法規與台灣相近，可借鏡度高",
      },
      {
        step: 3,
        title: "時間範圍",
        question: "要看多久的資料？",
        options: [
          { id: "A", label: "近 30 天（最新動態）" },
          { id: "B", label: "近 90 天（季度趨勢）" },
          { id: "C", label: "近 1 年（長期變化）" },
        ],
        recommended: "B",
        rationale: "90 天平衡時效與趨勢辨識度",
      },
      {
        step: 4,
        title: "目標讀者",
        question: "報告主要給誰看？",
        options: [
          { id: "A", label: "商品設計團隊（技術細節 + 設計建議）" },
          { id: "B", label: "高階主管（決策摘要 + 戰略含義）" },
          { id: "C", label: "業務培訓（話術 + 客戶常見問題）" },
        ],
        recommended: "A",
        rationale: "MCP 主要用戶就是商品設計團隊",
      },
      {
        step: 5,
        title: "報告深度",
        question: "需要多深的分析？",
        options: [
          { id: "A", label: "雙週報短版（~5 頁，重點摘要）" },
          { id: "B", label: "月報中版（~15 頁，含案例與圖表）" },
          { id: "C", label: "完整研究（30+ 頁，含完整方法論）" },
        ],
        recommended: "B",
        rationale: "中版深度足以做設計決策，又不會花過多時間",
      },
    ],
    after: "用戶選完 5 步後呼叫 confirm_scope(session_id, decisions)",
  };
}

export async function confirmSessionScope(
  kv: KVNamespace,
  uid: string,
  session_id: string,
  decisions: ScopeDecisions,
) {
  const state = await getSession(kv, uid, session_id);
  if (!state) throw new Error(`session ${session_id} 不存在或已過期 (TTL 24h)`);
  state.scope_decisions = decisions;
  state.status = "scope_confirmed";
  await writeSession(kv, state);

  // Generate research plan based on decisions.
  // Targets calibrated against actual production runs (not theoretical):
  //   - Shin Kong (Claude free, depth=C, single company)  → 16 findings
  //   - Japan    (Claude paid, depth=C, two companies)    → 15 findings
  //   - Both produced quality reports (~7K body chars)
  // Earlier target=20 caused chat to self-report "token tight" anxiety even
  // when output was fine. 15 is a realistic floor that chat actually hits.
  const findingTarget =
    decisions.depth === "A" ? 5 : decisions.depth === "C" ? 15 : 10;

  const queryHints: string[] = [];
  if (decisions.scope?.includes("A") || decisions.scope === "E") {
    queryHints.push(`search_articles("${state.topic_seed} 商品 規格")`);
  }
  if (decisions.scope?.includes("B") || decisions.scope === "E") {
    queryHints.push(`search_articles("${state.topic_seed} 市場 滲透率")`);
  }
  if (decisions.scope?.includes("C") || decisions.scope === "E") {
    queryHints.push(`search_articles("${state.topic_seed} 競品") + web_search("${state.topic_seed} 競品分析")`);
  }
  if (decisions.scope?.includes("D") || decisions.scope === "E") {
    queryHints.push(`search_articles("${state.topic_seed} 法規 監管")`);
  }

  return {
    session_id,
    status: "scope_confirmed",
    plan: {
      target_findings: findingTarget,
      query_hints: queryHints,
      todos: [
        `蒐集 2+ 篇 V2 內現存舊報告（用 list_reports 找相關 → get_report 讀全文 → 重點 add_finding）`,
        `搜尋近期保險業新聞（${decisions.timeframe === "A" ? "30 天" : decisions.timeframe === "C" ? "1 年" : "90 天"}）— ${queryHints.length} 個 query 角度`,
        `查 Wiki 月度蒸餾（get_wiki）— 通常含跨市場比較重點`,
        `補外部 web_search — 競品官網公告 / 政府法規公告 / 國際趨勢報告`,
        `每個事實 → add_finding(source_url 必填，不要瞎掰來源)`,
        `預計累積 ~${findingTarget} 個 findings 後 generate_outline 跟用戶討論結構`,
        `用戶確認 outline 後寫 markdown 內文（用 [^N] 引用 findings）`,
        `finalize_report 上架（需 create_report 權限，VIP 限定）`,
      ],
    },
  };
}

export async function addFindingToSession(
  kv: KVNamespace,
  uid: string,
  args: {
    session_id: string;
    type: Finding["type"];
    content: string;
    source_url: string;
    source_title?: string;
    source_date?: string;
  },
) {
  const state = await getSession(kv, uid, args.session_id);
  if (!state) throw new Error(`session ${args.session_id} 不存在或已過期 (TTL 24h)`);
  if (state.status === "finalized") {
    throw new Error("session 已 finalize，無法再加 finding");
  }

  // Source URL enforcement (server-side, not just MCP schema)
  if (!args.source_url || args.source_url.trim().length === 0) {
    throw new Error("source_url 必填，不可為空。如果沒來源就不要記成 finding");
  }
  if (!/^https?:\/\//.test(args.source_url) && !args.source_url.startsWith("/")) {
    throw new Error(
      "source_url 必須是 http(s) URL 或以 / 開頭的內部路徑（例：/reports/rpt_xxx）",
    );
  }
  if (state.findings.length >= MAX_FINDINGS_PER_SESSION) {
    throw new Error(`single session 最多 ${MAX_FINDINGS_PER_SESSION} findings`);
  }

  const finding: Finding = {
    id: state.findings.length + 1,
    type: args.type,
    content: args.content.trim(),
    source_url: args.source_url.trim(),
    source_title: args.source_title?.trim() || undefined,
    source_date: args.source_date?.trim() || undefined,
    added_at: Math.floor(Date.now() / 1000),
  };
  state.findings.push(finding);
  if (state.status === "scope_confirmed") state.status = "drafting";
  await writeSession(kv, state);

  return {
    session_id: args.session_id,
    finding_id: finding.id,
    total: state.findings.length,
    citation_hint: `內文用 [^${finding.id}] 引用此 finding`,
  };
}

export async function listSessionFindings(
  kv: KVNamespace,
  uid: string,
  session_id: string,
) {
  const state = await getSession(kv, uid, session_id);
  if (!state) throw new Error(`session ${session_id} 不存在或已過期 (TTL 24h)`);
  const byType: Record<string, number> = {};
  for (const f of state.findings) {
    byType[f.type] = (byType[f.type] || 0) + 1;
  }
  return {
    session_id,
    topic_seed: state.topic_seed,
    status: state.status,
    findings: state.findings,
    summary: { total: state.findings.length, by_type: byType },
  };
}

export async function generateSessionOutline(
  kv: KVNamespace,
  uid: string,
  session_id: string,
) {
  const state = await getSession(kv, uid, session_id);
  if (!state) throw new Error(`session ${session_id} 不存在或已過期 (TTL 24h)`);
  if (state.findings.length < 3) {
    throw new Error(
      `findings 太少（${state.findings.length}）— 至少需要 3 個才能生大綱。建議先 search_articles + add_finding`,
    );
  }

  // Group findings by type for outline structure suggestion
  const buckets: Record<string, Finding[]> = {
    market: [],   // news_quote, wiki_quote
    comp: [],     // cross_market_pattern, web_quote
    product: [],  // observation
    history: [],  // report_quote
  };
  for (const f of state.findings) {
    if (f.type === "news_quote" || f.type === "wiki_quote") buckets.market.push(f);
    else if (f.type === "cross_market_pattern" || f.type === "web_quote") buckets.comp.push(f);
    else if (f.type === "observation") buckets.product.push(f);
    else if (f.type === "report_quote") buckets.history.push(f);
  }

  const sections: Array<{ heading: string; finding_ids: number[]; hint: string }> = [];
  if (buckets.market.length > 0) {
    sections.push({
      heading: "## 市場概況",
      finding_ids: buckets.market.map((f) => f.id),
      hint: "用近期新聞 + wiki 蒸餾，呈現主要趨勢與量化指標",
    });
  }
  if (buckets.comp.length > 0) {
    sections.push({
      heading: "## 競品分析 / 跨市場參考",
      finding_ids: buckets.comp.map((f) => f.id),
      hint: "競品做了什麼、其他市場有什麼成功 / 失敗案例",
    });
  }
  if (buckets.product.length > 0) {
    sections.push({
      heading: "## 觀察與洞察",
      finding_ids: buckets.product.map((f) => f.id),
      hint: "從 findings 抽出 pattern / 推論",
    });
  }
  if (buckets.history.length > 0) {
    sections.push({
      heading: "## 歷史報告對照",
      finding_ids: buckets.history.map((f) => f.id),
      hint: "上次的研究說了什麼，這次有什麼新進展",
    });
  }
  sections.push({
    heading: "## 策略建議 / 給商品設計團隊的 takeaways",
    finding_ids: [],
    hint: "根據以上整合出可行動的建議（這段不直接 cite findings，是 chat 的論述）",
  });
  sections.push({
    heading: "## 風險與限制",
    finding_ids: [],
    hint: "明確指出資料的限制、可能偏誤、不確定處",
  });

  const outline_md = sections
    .map((s) => {
      const cites = s.finding_ids.length
        ? `（引用 finding ${s.finding_ids.map((i) => `[^${i}]`).join(" ")}）`
        : "";
      return `${s.heading} ${cites}\n  → ${s.hint}`;
    })
    .join("\n\n");

  state.outline_md = outline_md;
  await writeSession(kv, state);

  return {
    session_id,
    outline_md,
    sections,
    note:
      "**請跟用戶討論這份大綱，調整章節順序 / 增刪 sections 後再寫內文**。\n" +
      "寫內文時：每個量化數字 / 競品名 / 公司動態 / 新聞事件**必須**對應一個 [^N] 引用。" +
      "「我訓練資料記得 X」不算合法來源，要先 search_articles 或 web_search 找實際出處 → add_finding → 再用。",
  };
}

export async function finalizeSession(
  kv: KVNamespace,
  uid: string,
  session_id: string,
  reportId: string,
) {
  const state = await getSession(kv, uid, session_id);
  if (!state) return;
  state.status = "finalized";
  state.finalized_report_id = reportId;
  await writeSession(kv, state);
}
