/**
 * Biweekly Report — guided draft mode (Phase 4).
 *
 * Purpose: walk a VIP through producing a biweekly news roundup (template
 * `國際壽險商品與服務動態雙週報 #YYYYNN`) with minimal manual typing. The
 * MCP server fetches articles, ranks them, and proposes draft observation
 * sections; the VIP confirms or refines via chat; the server returns
 * final markdown for the chat to convert into docx locally.
 *
 * Key contrast with the research-session.ts flow:
 *   - Research = persistent, lands on /reports, three-way write (R2+D1+git)
 *   - Biweekly = ephemeral guidance, KV-only, output is markdown for the
 *     chat's own analysis tool to render to docx for download
 *
 * No D1, no R2, no git snapshot, no email. Pure ephemeral guidance.
 * 24h KV TTL — sessions auto-clean.
 *
 * Tool surface (4 functions):
 *   - startBiweeklyReport(topic_seed)        → grill 4-step todo
 *   - confirmBiweeklyScope(session_id, ...)  → auto-fill 一/二, propose 三 drafts
 *   - reviseBiweeklySection(...)             → regenerate one case/section
 *   - generateBiweeklyMarkdown(session_id)   → final assembled markdown
 */

import {
  type BiweeklyCase,
  type BiweeklyEntry,
  type BiweeklyScope,
  type BiweeklyState,
  type SessionState,
  getSession,
} from "./research-session";

const SESSION_TTL_SECONDS = 24 * 3600;

// GemGate endpoint — same as workers/src/chat.ts. Worker has no member-
// gated proxy for the LLM, just the shared key.
const GEMGATE_URL = "https://gemgate.cooperation.tw/api/llm/persistent/chat";
const GEMGATE_KEY = "gem-1e0d39aeddde83b390828cc31deb24fc";

// Articles are served from the public Pages CDN — biweekly reads from the
// same manifest the frontend uses. No D1 dependency.
const PAGES_ORIGIN = "https://insurance-kb.cooperation.tw";

// ─── Helpers ─────────────────────────────────────────────────────────────

function sessionKey(uid: string, sessionId: string): string {
  return `research_session:${uid}:${sessionId}`;
}

function generateSessionId(): string {
  return "bw_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

async function writeSession(kv: KVNamespace, state: SessionState): Promise<void> {
  state.updated_at = Math.floor(Date.now() / 1000);
  await kv.put(sessionKey(state.uid, state.session_id), JSON.stringify(state), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
}

/** Number of days between two YYYY-MM-DD strings (b - a). */
function daysBetween(a: string, b: string): number {
  const ms = Date.parse(b) - Date.parse(a);
  return Math.round(ms / 86400000);
}

/** Subtract N days from a YYYY-MM-DD string. */
function shiftDate(date: string, deltaDays: number): string {
  const t = Date.parse(date) + deltaDays * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Compute the biweekly issue number for the period ending on `endDate`.
 *
 * Heuristic matches the reference template (#202604 covers 2026/02/10 -
 * 2026/02/23, which spans ISO weeks 7-8): issue = ceil(ISO week / 2).
 */
function isoWeek(dateStr: string): number {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function suggestIssueNumber(endDate: string): string {
  const w = isoWeek(endDate);
  const issue = Math.ceil(w / 2);
  const year = endDate.slice(0, 4);
  return `${year}${String(issue).padStart(2, "0")}`;
}

/** Today as YYYY-MM-DD in Asia/Taipei. */
function todayTaipei(): string {
  // Date.now() is not available in the workflow harness, but production
  // workers have it; this is plain runtime code so it's fine here.
  const now = new Date();
  const tpe = new Date(now.getTime() + 8 * 3600 * 1000);
  return tpe.toISOString().slice(0, 10);
}

// ─── Tool 1: startBiweeklyReport ─────────────────────────────────────────

export async function startBiweeklyReport(
  kv: KVNamespace,
  uid: string,
  email: string,
  topic_seed: string,
) {
  const session_id = generateSessionId();
  const now = Math.floor(Date.now() / 1000);

  const today = todayTaipei();
  const defaultEnd = today;
  const defaultStart = shiftDate(today, -13);  // 14-day window (inclusive)
  const defaultIssue = suggestIssueNumber(defaultEnd);

  const state: SessionState = {
    session_id,
    uid,
    email,
    topic_seed,
    status: "created",
    report_type: "biweekly",
    created_at: now,
    updated_at: now,
    scope_decisions: null,
    findings: [],
    outline_md: null,
    finalized_report_id: null,
    biweekly_state: null,
  };
  await writeSession(kv, state);

  return {
    session_id,
    report_type: "biweekly",
    topic_seed,
    next_step:
      "請一步一步問用戶下面 4 件事（grill mode，不要 4 步擠一次）。" +
      "每步列選項 + 推薦預設 + 等用戶選後才下一步。用戶選完 4 步呼叫 confirm_biweekly_scope。",
    framework: [
      {
        step: 1,
        title: "期間",
        question: `預設「最近 14 天」(${defaultStart} ~ ${defaultEnd})，期號 #${defaultIssue}。`,
        options: [
          { id: "A", label: "接受預設" },
          { id: "B", label: "自訂日期區間（請說 start_date 跟 end_date）" },
          { id: "C", label: "改期號（補做舊期，請說期號跟對應日期）" },
        ],
        recommended: "A",
        rationale: "預設涵蓋最近兩週新聞，是雙週報慣例",
        defaults: {
          period_start: defaultStart,
          period_end: defaultEnd,
          issue_number: defaultIssue,
        },
      },
      {
        step: 2,
        title: "範圍類別",
        question: "要納入哪幾類新聞？",
        options: [
          { id: "A", label: "產品創新 + 監管動態 + 市場趨勢（預設 3 類）" },
          { id: "B", label: "上述 + ESG永續 + 科技應用 + 再保市場（6 類）" },
          { id: "C", label: "全部 9 類（含人才/消費/行銷推廣）" },
        ],
        recommended: "A",
        rationale: "預設 3 類已涵蓋雙週報核心關注；若該期 ESG / 科技動態多再用 B",
      },
      {
        step: 3,
        title: "區域偏重",
        question: "選哪些市場資料優先？",
        options: [
          { id: "A", label: "亞太優先（亞洲文章 70%，全球補 30%）" },
          { id: "B", label: "全球均等" },
          { id: "C", label: "限定特定區（請說『只看 US+KR+TW』之類）" },
        ],
        recommended: "A",
        rationale: "亞太市場跟台灣最相關，可借鏡度高",
      },
      {
        step: 4,
        title: "觀察重點案例數",
        question: "三、要做幾個案例深入分析？",
        options: [
          { id: "A", label: "3 個（標準）" },
          { id: "B", label: "2 個" },
          { id: "C", label: "4 個（內容多時用）" },
        ],
        recommended: "A",
        rationale: "3 個案例平均分配版面，與既往雙週報慣例相同",
      },
    ],
    after:
      "用戶答完 4 步呼叫 confirm_biweekly_scope(session_id, decisions={period_start, period_end, issue_number, categories[], region_focus, region_specific[], case_count})。" +
      "若 step1=A 直接帶 defaults 進 decisions。",
  };
}

// ─── LLM helpers ─────────────────────────────────────────────────────────

/**
 * Call GemGate (ACP) for one chat completion. Returns the text payload.
 * Throws on transport / parse failure so caller can decide whether to
 * fall back or surface the error.
 */
async function llmChat(
  systemPrompt: string,
  userPrompt: string,
  temperature = 0.4,
): Promise<string> {
  const resp = await fetch(GEMGATE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GEMGATE_KEY}`,
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature,
    }),
  });
  if (!resp.ok) {
    throw new Error(`LLM call failed: HTTP ${resp.status}`);
  }
  const data = (await resp.json()) as any;
  const text = data?.choices?.[0]?.message?.content;
  if (!text || typeof text !== "string") {
    throw new Error("LLM returned no content");
  }
  return text;
}

/**
 * Pull a JSON object out of an LLM response that may be wrapped in
 * ```json fences or have surrounding prose. Returns null if nothing
 * parseable was found.
 */
function extractJson<T>(text: string): T | null {
  // Try fenced block first
  const fence = text.match(/```(?:json)?\s*\n([\s\S]+?)\n```/);
  const raw = fence ? fence[1] : text;
  // Find first { ... } that parses
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const slice = raw.slice(start, end + 1);
  try {
    return JSON.parse(slice) as T;
  } catch {
    return null;
  }
}

// ─── Article fetching (manifest + month files) ──────────────────────────

/**
 * Fetch all articles whose date falls in [start, end] from the public
 * Pages manifest. Loads only the month files that overlap the window.
 */
async function fetchArticlesInRange(
  start: string,
  end: string,
): Promise<BiweeklyEntry[]> {
  // Months that overlap [start, end]
  const months = monthsBetween(start, end);
  const fetches = months.map(async (month) => {
    const url = `${PAGES_ORIGIN}/data/articles-${month}.json`;
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data = (await resp.json()) as any[];
    return data
      .filter((a) => a.date >= start && a.date <= end)
      .map<BiweeklyEntry>((a) => ({
        uid: a.uid,
        title: a.title || "",
        title_en: a.title_en,
        summary: a.summary || "",
        source: a.source || "",
        source_url: a.source_url || "",
        date: a.date || "",
        category: a.category || "",
        region: a.region || "",
      }));
  });
  const groups = await Promise.all(fetches);
  return groups.flat();
}

function monthsBetween(start: string, end: string): string[] {
  // Enumerate YYYY-MM keys covering both endpoints.
  const out: string[] = [];
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  const cursor = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1));
  while (cursor <= e) {
    out.push(
      `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`,
    );
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

// ─── Tool 2: confirmBiweeklyScope ────────────────────────────────────────

export interface BiweeklyDecisions {
  period_start: string;
  period_end: string;
  issue_number: string;
  categories: string[];
  region_focus: "asia_priority" | "global_even" | "specific";
  region_specific?: string[];
  case_count: number;
}

export async function confirmBiweeklyScope(
  kv: KVNamespace,
  uid: string,
  session_id: string,
  decisions: BiweeklyDecisions,
) {
  const state = await getSession(kv, uid, session_id);
  if (!state) throw new Error(`session ${session_id} 不存在或已過期 (TTL 24h)`);
  if (state.report_type !== "biweekly") {
    throw new Error(
      `session ${session_id} 不是 biweekly 模式 — 請用對應的 confirm_scope`,
    );
  }

  const scope: BiweeklyScope = {
    period_start: decisions.period_start,
    period_end: decisions.period_end,
    issue_number: decisions.issue_number,
    categories: decisions.categories,
    region_focus: decisions.region_focus,
    region_specific: decisions.region_specific ?? [],
    case_count: Math.max(2, Math.min(4, decisions.case_count || 3)),
  };

  // Pull every article in the period across all categories the user picked.
  const pool = await fetchArticlesInRange(scope.period_start, scope.period_end);
  if (pool.length === 0) {
    throw new Error(
      `這個期間 (${scope.period_start} ~ ${scope.period_end}) 抓不到文章。確認日期是否正確，或改 period。`,
    );
  }

  // Server-side filter by user's category whitelist + region focus weighting.
  const categorySet = new Set(scope.categories);
  const filtered = pool.filter((a) => !categorySet.size || categorySet.has(a.category));

  // Bucket for LLM ranking: section 1 (商品/服務) vs section 2 (議題).
  const DYN = new Set(["產品創新", "行銷推廣"]);
  const ISS = new Set(["監管動態", "市場趨勢", "科技應用", "ESG永續", "再保市場"]);
  const dynPool = filtered.filter((a) => DYN.has(a.category));
  const issPool = filtered.filter((a) => ISS.has(a.category));

  // Rank with LLM. Build a compact list — uid + title + summary first 80 chars.
  // LLM picks top N. Fallback: deterministic by date desc + region priority.
  const dynPicked = await rankAndPick(
    dynPool,
    5,
    "section1_dynamics",
    "新商品 / 新服務 / 新行銷活動",
    scope,
  );
  const issPicked = await rankAndPick(
    issPool,
    3,
    "section2_issues",
    "監管 / 市場結構 / 技術趨勢",
    scope,
  );

  // Pick `case_count` cases from section 1 picks (most material to dig into).
  const caseCandidates = dynPicked.slice(0, scope.case_count);
  const cases: BiweeklyCase[] = [];
  for (const entry of caseCandidates) {
    const draft = await draftObservationCase(entry, scope);
    cases.push({
      case_name: shortenTitle(entry.title),
      entry,
      context: draft.context,
      features: draft.features,
      insight: draft.insight,
    });
  }

  const biweekly_state: BiweeklyState = {
    scope,
    section1_dynamics: dynPicked,
    section2_issues: issPicked,
    section3_cases: cases,
  };

  state.biweekly_state = biweekly_state;
  state.status = "scope_confirmed";
  state.scope_decisions = {
    scope: "biweekly",
    region: scope.region_focus,
    timeframe: `${scope.period_start} ~ ${scope.period_end}`,
    audience: "biweekly_subscribers",
    depth: "biweekly",
  };
  await writeSession(kv, state);

  return {
    session_id,
    scope,
    section1_count: dynPicked.length,
    section2_count: issPicked.length,
    section3_count: cases.length,
    section1_dynamics: dynPicked.map((e) => ({
      uid: e.uid,
      source: e.source,
      title: e.title,
      date: e.date,
      url: e.source_url,
    })),
    section2_issues: issPicked.map((e) => ({
      uid: e.uid,
      source: e.source,
      title: e.title,
      date: e.date,
      url: e.source_url,
    })),
    section3_cases: cases.map((c) => ({
      case_name: c.case_name,
      uid: c.entry.uid,
      context_draft: c.context,
      features_draft: c.features,
      insight_draft: c.insight,
    })),
    next_step:
      "把 section1 / section2 / 三個案例三段草稿列給用戶 review。" +
      "用戶想換案例或改某段 → revise_biweekly_section(case_name, section, hint)。" +
      "用戶說『OK 組稿』→ generate_biweekly_markdown(session_id)。",
  };
}

/** Trim a title down to ~16 chars for case heading display. */
function shortenTitle(t: string): string {
  if (t.length <= 20) return t;
  return t.slice(0, 18) + "…";
}

/**
 * Ask the LLM to pick the top N articles from a pool. Falls back to
 * date-desc selection if the LLM call or parse fails — biweekly mustn't
 * hard-fail on transient ACP issues.
 */
async function rankAndPick(
  pool: BiweeklyEntry[],
  target: number,
  bucket: string,
  bucketDesc: string,
  scope: BiweeklyScope,
): Promise<BiweeklyEntry[]> {
  if (pool.length === 0) return [];
  if (pool.length <= target) return pool;

  const regionHint =
    scope.region_focus === "asia_priority"
      ? "亞洲地區優先（台/日/韓/港/星馬越泰）"
      : scope.region_focus === "specific" && scope.region_specific.length > 0
      ? `限定地區：${scope.region_specific.join(", ")}`
      : "全球均等";

  // Compact pool listing — uid + region + source + title + summary preview.
  const list = pool
    .map(
      (a, i) =>
        `${i + 1}. uid=${a.uid} [${a.region}|${a.source}|${a.date}] ${a.title.slice(0, 80)}`,
    )
    .join("\n");

  const systemPrompt =
    "你是雙週報資深編輯。從給定文章池選出最具代表性的若干篇，輸出 JSON。";
  const userPrompt = `從以下文章池選 ${target} 篇放進雙週報的「${bucketDesc}」section（${bucket}）。

判準：
- 商品/服務/監管/議題的代表性（不要選邊邊角角小新聞）
- 跨地區覆蓋（不要全集中一家公司）
- ${regionHint}
- 期間：${scope.period_start} ~ ${scope.period_end}

文章池（${pool.length} 篇）：
${list}

請選 ${target} 篇 uid。**僅輸出 JSON**，格式：
\`\`\`json
{ "picked_uids": ["<uid1>", "<uid2>", ...] }
\`\`\``;

  try {
    const text = await llmChat(systemPrompt, userPrompt, 0.3);
    const parsed = extractJson<{ picked_uids: string[] }>(text);
    if (parsed?.picked_uids?.length) {
      const byUid = new Map(pool.map((a) => [a.uid, a]));
      const picks = parsed.picked_uids
        .map((u) => byUid.get(u))
        .filter((x): x is BiweeklyEntry => !!x)
        .slice(0, target);
      if (picks.length >= Math.min(target, 1)) return picks;
    }
  } catch {
    // Fall through to deterministic fallback.
  }

  // Fallback: sort by date desc, prefer region match.
  const score = (a: BiweeklyEntry) => {
    const dateScore = Date.parse(a.date) || 0;
    const regionScore =
      scope.region_focus === "asia_priority"
        ? ["台灣", "日本", "韓國", "香港", "新加坡", "泰國", "越南", "馬來西亞"].includes(a.region)
          ? 1e12
          : 0
        : 0;
    return dateScore + regionScore;
  };
  return [...pool].sort((a, b) => score(b) - score(a)).slice(0, target);
}

/**
 * Draft the three observation sections for one case via LLM.
 *
 * Output schema enforced:
 *   { context: string, features: string (markdown bullets), insight: string }
 *
 * Fallback on LLM failure: synthesize a stub from the article summary so
 * the user at least has something to refine, with a clear marker that
 * it needs revision.
 */
async function draftObservationCase(
  entry: BiweeklyEntry,
  scope: BiweeklyScope,
): Promise<{ context: string; features: string; insight: string }> {
  const systemPrompt =
    "你是雙週報編輯，為一則新聞撰寫「觀察重點」三段。" +
    "風格學術 + 商業評論，繁體中文。" +
    "不要編造未在原文出現的具體數字或產品名 — 若不確定就用『據報導』『相關研究顯示』等模糊措辭。";

  const userPrompt = `為以下新聞撰寫雙週報「觀察重點」三段：

來源：${entry.source}（${entry.region}）
日期：${entry.date}
標題（中文）：${entry.title}
${entry.title_en ? `標題（原文）：${entry.title_en}` : ""}
摘要：${entry.summary}
URL：${entry.source_url}

期別：#${scope.issue_number}（${scope.period_start} ~ ${scope.period_end}）

請寫：
1. context：推出背景與市場意義（2-3 句，描述為什麼推、市場/監管背景、對該公司戰略意義）
2. features：主要產品/服務特色（4-6 個 bullet，每個 1-2 句，用 markdown - 列點）
3. insight：對台灣壽險業之啟示（2 段，類比台灣現況 + 可借鏡的方向 + 提示風險或在地化調整）

**僅輸出 JSON**：
\`\`\`json
{
  "context": "...",
  "features": "- ...\\n- ...\\n- ...",
  "insight": "..."
}
\`\`\``;

  try {
    const text = await llmChat(systemPrompt, userPrompt, 0.5);
    const parsed = extractJson<{
      context: string;
      features: string;
      insight: string;
    }>(text);
    if (parsed?.context && parsed?.features && parsed?.insight) {
      return parsed;
    }
  } catch {
    // Fall through to stub.
  }
  return {
    context:
      `【草稿待補】${entry.title} — ${entry.summary.slice(0, 60)}（請用 revise_biweekly_section 重生此段）`,
    features: `- 【待補】請用 revise_biweekly_section 重生`,
    insight: `【草稿待補】類比台灣壽險市場的啟示（請用 revise_biweekly_section 重生此段）`,
  };
}

// ─── Tool 3: reviseBiweeklySection ───────────────────────────────────────

export type BiweeklySectionType = "context" | "features" | "insight";

export async function reviseBiweeklySection(
  kv: KVNamespace,
  uid: string,
  args: {
    session_id: string;
    case_name: string;
    section: BiweeklySectionType;
    hint: string;
  },
) {
  const state = await getSession(kv, uid, args.session_id);
  if (!state) throw new Error(`session ${args.session_id} 不存在或已過期`);
  if (state.report_type !== "biweekly" || !state.biweekly_state) {
    throw new Error(`session ${args.session_id} 不是 biweekly 模式 或未 confirm_scope`);
  }

  const bw = state.biweekly_state;
  const caseIdx = bw.section3_cases.findIndex((c) => c.case_name === args.case_name);
  if (caseIdx < 0) {
    throw new Error(
      `case "${args.case_name}" 不在當前 session — 可選: ${bw.section3_cases.map((c) => c.case_name).join(" / ")}`,
    );
  }
  const c = bw.section3_cases[caseIdx];

  const sectionLabel = {
    context: "推出背景與市場意義",
    features: "主要產品/服務特色",
    insight: "對台灣壽險業之啟示",
  }[args.section];

  const existing = c[args.section];

  const systemPrompt =
    "你是雙週報編輯，依用戶 hint 改寫指定段落。" +
    "保持原段落功能與長度範圍。" +
    "不要編造未在來源出現的具體數字 — 若 hint 要求量化但來源沒給，用『據報導』替代。";

  const userPrompt = `案例：${c.case_name}（${c.entry.source}，${c.entry.region}，${c.entry.date}）
原文摘要：${c.entry.summary}
URL：${c.entry.source_url}

段落類型：${sectionLabel}（${args.section}）
原本內容：
${existing}

用戶 hint（要求調整的方向）：
${args.hint}

請依 hint 重寫此段。
- context 段：2-3 句
- features 段：4-6 個 markdown bullet
- insight 段：2 段

**僅輸出 JSON**：
\`\`\`json
{ "revised": "..." }
\`\`\``;

  const text = await llmChat(systemPrompt, userPrompt, 0.5);
  const parsed = extractJson<{ revised: string }>(text);
  if (!parsed?.revised) {
    throw new Error("LLM 沒回合法的 revised 段落 — 請換 hint 重試");
  }

  // Replace section atomically in nested state.
  bw.section3_cases = bw.section3_cases.map((cc, i) =>
    i === caseIdx ? { ...cc, [args.section]: parsed.revised } : cc,
  );
  state.biweekly_state = bw;
  await writeSession(kv, state);

  return {
    session_id: args.session_id,
    case_name: c.case_name,
    section: args.section,
    revised: parsed.revised,
    next_step: "用戶可繼續改其他段，或說「OK 組稿」呼叫 generate_biweekly_markdown。",
  };
}

// ─── Tool 4: generateBiweeklyMarkdown ───────────────────────────────────

const DOCX_TEMPLATE_URL = `${PAGES_ORIGIN}/templates/biweekly-template.docx`;

/** Compose the final biweekly markdown ready for chat-side docx conversion. */
export async function generateBiweeklyMarkdown(
  kv: KVNamespace,
  uid: string,
  session_id: string,
) {
  const state = await getSession(kv, uid, session_id);
  if (!state) throw new Error(`session ${session_id} 不存在或已過期`);
  if (state.report_type !== "biweekly" || !state.biweekly_state) {
    throw new Error(`session ${session_id} 不是 biweekly 或未 confirm_scope`);
  }
  const bw = state.biweekly_state;

  const title = `國際壽險商品與服務動態雙週報 #${bw.scope.issue_number}`;
  const subtitle = `（${bw.scope.period_start.replace(/-/g, "/")} – ${bw.scope.period_end.replace(/-/g, "/")}）`;

  const section1Rows = bw.section1_dynamics.map((e) => formatTableRow(e));
  const section2Rows = bw.section2_issues.map((e) => formatTableRow(e));

  const cases = bw.section3_cases
    .map(
      (c, i) =>
        `### ${i + 1}. ${c.case_name}\n\n` +
        `**推出背景與市場意義**\n\n${c.context}\n\n` +
        `**主要產品特色**\n\n${c.features}\n\n` +
        `**對台灣壽險業之啟示**\n\n${c.insight}\n`,
    )
    .join("\n");

  // Footnote-style reference list at the end.
  const allEntries = [...bw.section1_dynamics, ...bw.section2_issues, ...bw.section3_cases.map((c) => c.entry)];
  const uniqEntries = Array.from(new Map(allEntries.map((e) => [e.uid, e])).values());
  const refs = uniqEntries
    .map((e, i) => `[${i + 1}] ${e.source} — ${e.title} (${e.date}) — ${e.source_url}`)
    .join("\n");

  const markdown = `# ${title}
${subtitle}

## 一、國際壽險商品與服務動態

| 來源 | 標題（原文／中文） | 原文重點摘要 | 超連結 |
|------|--------------------|-------------|--------|
${section1Rows.join("\n")}

## 二、保險業議題

| 來源 | 標題（原文／中文） | 原文重點摘要 | 超連結 |
|------|--------------------|-------------|--------|
${section2Rows.join("\n")}

## 三、觀察重點

${cases}

## 參考資料

${refs}
`;

  state.outline_md = markdown;
  state.status = "drafting";
  await writeSession(kv, state);

  return {
    session_id,
    title,
    issue_number: bw.scope.issue_number,
    markdown,
    docx_template_url: DOCX_TEMPLATE_URL,
    docx_conversion_hint:
      "Chat 端用 analysis tool 跑 python-docx：fetch DOCX_TEMPLATE_URL 作 template，" +
      "用 markdown 填入。template 已含字型 / 表格樣式 / 頁首頁尾。" +
      "輸出檔名建議：`國際壽險商品與服務動態雙週報 #${issue_number}.docx`。" +
      "完成後直接給用戶下載連結，不要再叫任何 MCP 工具（biweekly 流程結束）。",
    next_step: "Chat 把 markdown 轉成 docx 給用戶下載。Session 24h 後自動清掉。",
  };
}

/** One table row for section 一 / 二. Escapes `|` and newlines. */
function formatTableRow(e: BiweeklyEntry): string {
  const source = mdEscape(e.source);
  const titleCell = e.title_en
    ? `${mdEscape(e.title_en)} ／ ${mdEscape(e.title)}`
    : mdEscape(e.title);
  const summary = mdEscape(e.summary).slice(0, 200);
  const link = e.source_url ? `[原文](${e.source_url})` : "—";
  return `| ${source} | ${titleCell} | ${summary} | ${link} |`;
}

function mdEscape(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
