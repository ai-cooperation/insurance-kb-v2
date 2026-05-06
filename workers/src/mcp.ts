/**
 * MCP (Model Context Protocol) endpoint for Insurance KB v3.
 *
 * Transport: claude.ai uses Streamable HTTP (POST + JSON response). We support
 * both Streamable HTTP and HTTP+SSE. Auth via Bearer mcp_xxx token in URL
 * ?token= or Authorization header.
 *
 * Phase 3 tools (read-only):
 *   list_articles, search_articles, list_reports, get_report, get_wiki,
 *   web_search
 *
 * Phase 4 adds (research session + create):
 *   start_research_session, confirm_scope, add_finding, list_findings,
 *   generate_outline, finalize_report
 *
 * Adapted from agent-kb/server/src/mcp.ts (transport + JSON-RPC scaffolding
 * is identical; tools are V2-specific).
 */

import type { Context } from "hono";

import type { FirebaseUser } from "./auth-firebase";
import { hasFeatures } from "./auth-firebase";
import { loadArticles, searchArticles, type Article } from "./search";
import { getReportContent, getReportMeta, listReports } from "./reports-store";
import {
  addFindingToSession,
  confirmSessionScope,
  finalizeSession,
  generateSessionOutline,
  getSession,
  listSessionFindings,
  startResearchSession,
} from "./research-session";
import { createReport } from "./reports-store";
import { notifyTelegramNewReport } from "./reports-store";

interface Bindings {
  KV: KVNamespace;
  REPORTS_DB: D1Database;
  REPORTS_BUCKET: R2Bucket;
  CORS_ORIGIN: string;
  HUB_PROJECT_ID: string;
  KB_PROJECT_ID: string;
  TG_BOT_TOKEN?: string;
  TG_CHAT_ID?: string;
}

// ─── MCP Protocol Types ───────────────────────────────────────────

interface JSONRPCRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: unknown;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

// ─── Tool definitions ──────────────────────────────────────────────

const TOOLS = [
  // ── Articles (insurance industry news, 19,000+ pieces) ────────────
  {
    name: "list_articles",
    description:
      "列出保險新聞 / list insurance articles / browse news / recent insurance news。" +
      "列出近期的保險業新聞文章（含中文標題、摘要、來源、日期、分類、地區）。" +
      "可指定天數、分類、地區過濾。新聞來自 Insurance KB 每天兩次自動爬蟲，" +
      "涵蓋台灣 / 日本 / 韓國 / 香港 / 東南亞等市場。",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "近 N 天（預設 30）" },
        limit: { type: "number", description: "最多回幾筆（預設 30，上限 100）" },
        category: { type: "string", description: "分類過濾（例：商品 / 保費 / 理賠 / 通路 / 法規）" },
        region: { type: "string", description: "地區過濾（例：TW / JP / KR / HK / SEA）" },
      },
    },
  },
  {
    name: "search_articles",
    description:
      "搜尋保險新聞 / search insurance articles / find news on topic。" +
      "用關鍵字搜尋全部 articles.json（19000+ 篇）。" +
      "Score = title*3 + category*2 + summary*1。回傳最相關的 N 筆，含 url 可點開原始來源。" +
      "**做研究蒐集 finding 時這是主力**：找出後用 add_finding 累積到 session（必須附 source_url）。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "查詢關鍵字（中英文皆可）" },
        limit: { type: "number", description: "最多回幾筆（預設 10，上限 50）" },
      },
      required: ["query"],
    },
  },

  // ── Reports (research reports, both admin-curated and VIP-MCP-created) ──
  {
    name: "list_reports",
    description:
      "列出研究報告 / list research reports / browse reports / 看歷史報告。" +
      "列出 Insurance KB 的研究報告：產業研究、商品分析、市場觀察、雙週報等。" +
      "做新研究前先看歷史報告，避免重複工作 + 找延伸主題。",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "最多回幾筆（預設 30，上限 100）" },
        category: { type: "string", description: "分類過濾（例：商品分析 / 市場觀察 / 雙週報）" },
      },
    },
  },
  {
    name: "get_report",
    description:
      "讀取研究報告 / get report / read report / fetch report content。" +
      "讀取某份研究報告的完整 markdown 內容 + meta（標題、作者、字數、引用數、創建日期）。" +
      "報告含原作者引用的 source URL，做新研究時可參考上一份做了什麼結論。",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "報告 ID（從 list_reports 拿到）" },
      },
      required: ["id"],
    },
  },

  // ── Wiki (monthly / quarterly distillation) ──────────────────────
  {
    name: "get_wiki",
    description:
      "讀取月度蒸餾 / get wiki / read monthly distillation / 看 X 月有什麼。" +
      "讀取月度 / 季度的保險業 wiki — 是 LLM 對該月所有新聞蒸餾後的主題彙整，" +
      "適合快速掌握某個月主要事件 / 趨勢。比一篇篇讀新聞快。",
    inputSchema: {
      type: "object",
      properties: {
        month: { type: "string", description: "YYYY-MM 格式（例：2026-04）" },
      },
      required: ["month"],
    },
  },

  // ── Web (external proxied search) ──────────────────────────────
  {
    name: "web_search",
    description:
      "外部網路搜尋 / web search / google / 找網路上的資料。" +
      "透過 Worker 代理搜尋外部資料（DuckDuckGo HTML scrape）。" +
      "**用於 articles.json 沒有的東西**：競品官網公告、政府法規、國際趨勢報告等。" +
      "結果含 url + snippet，做為 finding 來源時用 add_finding 帶上 source_url。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "查詢關鍵字" },
        limit: { type: "number", description: "最多回幾筆（預設 8，上限 20）" },
      },
      required: ["query"],
    },
  },

  // ── Research Session (Phase 4 — grill-mode style report drafting) ─
  {
    name: "start_research_session",
    description:
      "啟動研究 session / start research / 開始寫報告 / 我想做某主題研究。" +
      "用戶說「我想做 X 主題的研究」就先呼叫這個。Server 回 5 步 todo（範圍/地區/時間/讀者/深度），" +
      "**chat 必須一步步引導用戶選擇（grill-mode 風格：列選項 + pros/cons + 推薦預設 + 等用戶選）**，" +
      "不要自己決定範圍直接開始查。",
    inputSchema: {
      type: "object",
      properties: {
        topic_seed: { type: "string", description: "用戶提的主題（自由文字）" },
      },
      required: ["topic_seed"],
    },
  },
  {
    name: "confirm_scope",
    description:
      "鎖定研究範圍 / confirm scope / 範圍定了開始查資料。" +
      "用戶把 5 步選完後呼叫這個，Server 會回研究計畫 todo（要查哪些資料、用哪些工具、預期蒐集多少 finding）。" +
      "之後 chat 照 todo 開始 search_articles / get_report / web_search 蒐集證據。",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "從 start_research_session 拿到的 ID" },
        decisions: {
          type: "object",
          description: "用戶 5 步的選擇",
          properties: {
            scope: { type: "string", description: "範圍（A 商品本身 / B 市場趨勢 / C 競品 / D 法規 / E 全部）" },
            region: { type: "string", description: "地區（A TW / B 亞洲 / C 全球）" },
            timeframe: { type: "string", description: "時間（A 30 天 / B 90 天 / C 1 年）" },
            audience: { type: "string", description: "讀者（A 商品設計 / B 高階主管 / C 業務培訓）" },
            depth: { type: "string", description: "深度（A 雙週報 ~5p / B 月報 ~15p / C 完整 ~30p）" },
          },
        },
      },
      required: ["session_id", "decisions"],
    },
  },
  {
    name: "add_finding",
    description:
      "累積證據 / add finding / record source / 記下這條來源。" +
      "**核心溯源工具**：每蒐集到一條值得寫進報告的事實 / 數據 / 競品案例 / 公司動態 / 法規消息，" +
      "都呼叫這個。Server 維護 session draft state（24h KV，不污染 chat context）。" +
      "**source_url 強制必填**：不能寫「我訓練資料記得 X」這種。" +
      "「事實型句子（量化數字、競品名、公司動態、新聞）必須對應一個 finding」。" +
      "report 上架時 server 會自動把 findings 整成 ## 參考資料 section 附在末尾，" +
      "報告內文用 [^N] 引用。",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        type: {
          type: "string",
          enum: ["news_quote", "report_quote", "wiki_quote", "web_quote", "observation", "cross_market_pattern"],
          description: "證據類型",
        },
        content: { type: "string", description: "具體事實 / 引文（簡短，1-3 句）" },
        source_url: { type: "string", description: "**必填**：來源 URL（articles 來自其 url 欄位、reports 用 /reports/<id>、wiki 用 /wiki/YYYY-MM、web 用實際網址）" },
        source_title: { type: "string", description: "來源標題（讓未來讀者快速判斷）" },
        source_date: { type: "string", description: "來源日期 YYYY-MM-DD（如已知）" },
      },
      required: ["session_id", "type", "content", "source_url"],
    },
  },
  {
    name: "list_findings",
    description:
      "看當前 session 累積了什麼 / list findings / show what we have so far。" +
      "在蒐集中途叫一下，避免重複加 finding 或漏掉某類證據。",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "generate_outline",
    description:
      "從 findings 生大綱 / generate outline / propose structure。" +
      "蒐集到一定量（建議 8-15 個 findings）後叫這個，server 根據 findings 產建議大綱。" +
      "**chat 一定要跟用戶討論大綱再改**，不要直接寫報告。",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "finalize_report",
    description:
      "上架報告 / finalize report / publish。" +
      "用戶確認大綱後 chat 寫完整 markdown，呼叫這個上架。" +
      "Server：(1) 自動把 findings 整成 ## 參考資料 section 附在末尾；" +
      "(2) 寫 D1 + R2 雙存；(3) TG 通知 admin；(4) 回傳公開連結。" +
      "需要 create_report feature（VIP 專屬）。",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        title: { type: "string", description: "報告標題" },
        markdown: { type: "string", description: "完整 markdown 內容（內文用 [^1] [^2] 引用 findings）" },
        tags: { type: "array", items: { type: "string" } },
        category: { type: "string", description: "分類：商品分析 / 市場觀察 / 雙週報 / 競品比較" },
        region: { type: "string", description: "地區：TW / JP / KR / HK / SEA / GLOBAL" },
        summary: { type: "string", description: "短摘要（list 顯示用，2-3 句）" },
      },
      required: ["session_id", "title", "markdown"],
    },
  },
];

// ─── Tool handlers ────────────────────────────────────────────────

function withinDays(dateStr: string, days: number): boolean {
  if (!dateStr) return false;
  const t = Date.parse(dateStr);
  if (isNaN(t)) return false;
  return Date.now() - t <= days * 24 * 3600 * 1000;
}

async function handleListArticles(
  args: { days?: number; limit?: number; category?: string; region?: string },
): Promise<{ count: number; articles: Article[] }> {
  const days = args.days ?? 30;
  const limit = Math.min(args.limit ?? 30, 100);
  const all = await loadArticles();

  let filtered = all.filter((a) => withinDays(a.date, days));
  if (args.category) {
    const c = args.category.toLowerCase();
    filtered = filtered.filter((a) => (a.category || "").toLowerCase().includes(c));
  }
  if (args.region) {
    const r = args.region.toLowerCase();
    filtered = filtered.filter((a) => (a.region || "").toLowerCase().includes(r));
  }
  filtered.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return { count: filtered.length, articles: filtered.slice(0, limit) };
}

async function handleSearchArticles(args: { query: string; limit?: number }) {
  const limit = Math.min(args.limit ?? 10, 50);
  const all = await loadArticles();
  const results = searchArticles(all, args.query, limit);
  return {
    query: args.query,
    count: results.length,
    results: results.map((r) => ({ ...r.article, score: r.score })),
  };
}

async function handleListReports(
  db: D1Database,
  args: { limit?: number; category?: string },
) {
  const reports = await listReports(db, {
    limit: Math.min(args.limit ?? 30, 100),
    category: args.category,
  });
  return {
    count: reports.length,
    reports: reports.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      region: r.region,
      summary: r.summary,
      tags: r.tags,
      author_name: r.author_name,
      created_at: r.created_at,
      word_count: r.word_count,
      finding_count: r.finding_count,
    })),
  };
}

async function handleGetReport(
  db: D1Database,
  bucket: R2Bucket,
  args: { id: string },
) {
  const meta = await getReportMeta(db, args.id);
  if (!meta || meta.status === "archived") {
    throw new Error(`報告 ${args.id} 不存在`);
  }
  const content = await getReportContent(bucket, meta.r2_path);
  if (content === null) throw new Error("報告內容遺失，請聯絡管理員");
  return { meta, content };
}

async function handleGetWiki(args: { month: string }) {
  if (!/^\d{4}-\d{2}$/.test(args.month)) {
    throw new Error("month 必須是 YYYY-MM 格式");
  }
  const url = `https://insurance-kb.cooperation.tw/data/wiki.json`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`讀 wiki.json 失敗：${resp.status}`);
  const wiki = (await resp.json()) as Record<string, unknown>;
  const monthData = wiki[args.month] || wiki[`monthly/${args.month}`];
  if (!monthData) {
    return {
      month: args.month,
      found: false,
      hint: "該月沒有蒸餾結果。可用的月份請看 keys: " + Object.keys(wiki).slice(0, 12).join(", "),
    };
  }
  return { month: args.month, found: true, data: monthData };
}

async function handleWebSearch(args: { query: string; limit?: number }) {
  const limit = Math.min(args.limit ?? 8, 20);
  // DuckDuckGo HTML scrape — works without API key. Best effort.
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`;
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; InsuranceKB-MCP/1.0)" },
    });
    if (!resp.ok) {
      return { query: args.query, results: [], note: `DDG returned ${resp.status}` };
    }
    const html = await resp.text();
    // Extract result links (simple regex; not robust but works for common cases)
    const results: Array<{ title: string; url: string; snippet: string }> = [];
    const linkRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
    const snippetRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([^<]+)<\/a>/g;
    let m;
    const links: string[][] = [];
    while ((m = linkRe.exec(html)) !== null && links.length < limit) {
      links.push([m[1], m[2]]);
    }
    const snippets: string[] = [];
    while ((m = snippetRe.exec(html)) !== null && snippets.length < limit) {
      snippets.push(m[1]);
    }
    for (let i = 0; i < links.length; i++) {
      let url = links[i][0] || "";
      // DDG wraps in /l/?uddg= encoded URL — decode
      const um = url.match(/uddg=([^&]+)/);
      if (um) url = decodeURIComponent(um[1]);
      results.push({
        title: (links[i][1] || "").replace(/&amp;/g, "&").trim(),
        url,
        snippet: (snippets[i] || "").replace(/<[^>]+>/g, "").trim(),
      });
    }
    return { query: args.query, count: results.length, results };
  } catch (e: any) {
    return { query: args.query, results: [], error: String(e?.message || e) };
  }
}

// ─── Phase 4 research session handlers ───────────────────────────

async function handleStartSession(
  kv: KVNamespace,
  user: FirebaseUser,
  args: { topic_seed: string },
) {
  return await startResearchSession(kv, user.uid, user.email, args.topic_seed);
}

async function handleConfirmScope(
  kv: KVNamespace,
  user: FirebaseUser,
  args: { session_id: string; decisions: any },
) {
  return await confirmSessionScope(kv, user.uid, args.session_id, args.decisions);
}

async function handleAddFinding(
  kv: KVNamespace,
  user: FirebaseUser,
  args: any,
) {
  return await addFindingToSession(kv, user.uid, args);
}

async function handleListFindings(
  kv: KVNamespace,
  user: FirebaseUser,
  args: { session_id: string },
) {
  return await listSessionFindings(kv, user.uid, args.session_id);
}

async function handleGenerateOutline(
  kv: KVNamespace,
  user: FirebaseUser,
  args: { session_id: string },
) {
  return await generateSessionOutline(kv, user.uid, args.session_id);
}

async function handleFinalizeReport(
  env: Bindings,
  user: FirebaseUser,
  args: any,
) {
  if (!hasFeatures(user.features, ["create_report"])) {
    throw new Error("create_report feature required (VIP only)");
  }
  const session = await getSession(env.KV, user.uid, args.session_id);
  if (!session) throw new Error(`session ${args.session_id} 不存在或已過期`);
  if (session.findings.length === 0) {
    throw new Error("session 沒有任何 findings — 至少要加 1 個再上架");
  }

  // Auto-append 參考資料 from findings
  const referencesSection = renderReferencesSection(session.findings);
  const fullMarkdown = args.markdown.trimEnd() + "\n\n" + referencesSection;

  const meta = await createReport(env.REPORTS_DB, env.REPORTS_BUCKET, {
    title: args.title,
    markdown: fullMarkdown,
    tags: args.tags ?? [],
    category: args.category,
    region: args.region,
    summary: args.summary,
    source_session_id: args.session_id,
    finding_count: session.findings.length,
    status: "published",
    author_uid: user.uid,
    author_name: user.name,
    author_email: user.email,
  });

  await finalizeSession(env.KV, user.uid, args.session_id, meta.id);

  const publicUrl = `${env.CORS_ORIGIN}/reports/${meta.id}`;
  await notifyTelegramNewReport(env, meta, publicUrl);

  return { meta, url: publicUrl, finding_count: session.findings.length };
}

function renderReferencesSection(findings: Array<{
  type: string; content: string; source_url: string; source_title?: string; source_date?: string;
}>): string {
  const lines: string[] = ["## 參考資料", ""];
  findings.forEach((f, i) => {
    const num = i + 1;
    const date = f.source_date ? ` (${f.source_date})` : "";
    const title = f.source_title ? f.source_title : f.source_url;
    lines.push(`[^${num}]: [${title}](${f.source_url})${date} — ${f.type}: ${f.content}`);
  });
  return lines.join("\n");
}

// ─── JSON-RPC dispatcher ──────────────────────────────────────────

async function dispatch(
  req: JSONRPCRequest,
  user: FirebaseUser,
  env: Bindings,
): Promise<JSONRPCResponse> {
  try {
    if (req.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "insurance-kb", version: "0.3.0" },
          instructions: [
            "Insurance KB 是保險業界資訊知識庫，提供保險業新聞（articles，每天 2 次自動爬蟲）、",
            "月度蒸餾 Wiki、研究報告。VIP 用戶可透過 research session 工具產出新研究報告並上架。",
            "",
            "被問下列類型問題時，先用對應工具查 KB，不要憑訓練資料編造：",
            "- 「最近保險業有什麼新聞」「X 公司近況」 → list_articles / search_articles",
            "- 「某月有什麼大事」 → get_wiki",
            "- 「以前有沒有研究過 X」「找上次的報告」 → list_reports / get_report",
            "- 「網路上 X 怎麼說」 → web_search",
            "",
            "做研究調查（產出研究報告）的工作流：",
            "1. 用戶說「我想做 X 主題研究」 → 呼叫 start_research_session",
            "2. **一步步引導用戶決定 5 步範圍**（grill-mode：列選項 + 推薦 + 等用戶選），不要自己決定",
            "3. confirm_scope 鎖定後，照 server 回的 todo 用 search_articles / list_reports / web_search 蒐集",
            "4. **每段證據都呼叫 add_finding**（source_url 必填，不能瞎掰）",
            "5. 蒐集到 8-15 個 findings 後 generate_outline，跟用戶討論大綱",
            "6. 用戶確認大綱後寫 markdown 內文（用 [^1] [^2] 引用 findings）",
            "7. finalize_report 上架（需 create_report 權限，VIP 限定）",
            "",
            "找不到對應內容時誠實說「KB 沒這條紀錄」，不要編造。",
            "風格：簡潔直接，不重複問題，不寫拍馬屁開場，不主動延伸給未被要求的建議。",
          ].join("\n"),
        },
      };
    }
    if (req.method === "notifications/initialized") {
      return { jsonrpc: "2.0", id: req.id };
    }
    if (req.method === "tools/list") {
      return { jsonrpc: "2.0", id: req.id, result: { tools: TOOLS } };
    }
    if (req.method === "tools/call") {
      const params = req.params as { name: string; arguments?: Record<string, unknown> };
      const args = params.arguments || {};
      let result;
      switch (params.name) {
        case "list_articles":
          result = await handleListArticles(args as any);
          break;
        case "search_articles":
          result = await handleSearchArticles(args as any);
          break;
        case "list_reports":
          result = await handleListReports(env.REPORTS_DB, args as any);
          break;
        case "get_report":
          result = await handleGetReport(env.REPORTS_DB, env.REPORTS_BUCKET, args as any);
          break;
        case "get_wiki":
          result = await handleGetWiki(args as any);
          break;
        case "web_search":
          result = await handleWebSearch(args as any);
          break;
        // Phase 4 research session
        case "start_research_session":
          result = await handleStartSession(env.KV, user, args as any);
          break;
        case "confirm_scope":
          result = await handleConfirmScope(env.KV, user, args as any);
          break;
        case "add_finding":
          result = await handleAddFinding(env.KV, user, args as any);
          break;
        case "list_findings":
          result = await handleListFindings(env.KV, user, args as any);
          break;
        case "generate_outline":
          result = await handleGenerateOutline(env.KV, user, args as any);
          break;
        case "finalize_report":
          result = await handleFinalizeReport(env, user, args as any);
          break;
        default:
          throw new Error(`Unknown tool: ${params.name}`);
      }
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      };
    }
    return {
      jsonrpc: "2.0",
      id: req.id,
      error: { code: -32601, message: `Method not found: ${req.method}` },
    };
  } catch (e: any) {
    return {
      jsonrpc: "2.0",
      id: req.id,
      error: { code: -32603, message: String(e?.message || e) },
    };
  }
}

// ─── Hono handlers ────────────────────────────────────────────────

type Ctx = Context<{ Bindings: Bindings; Variables: { user: FirebaseUser } }>;

function requireMcpAuth(c: Ctx): Response | null {
  const user = c.get("user");
  if (!user || user.tier === "guest") {
    return c.json({ error: "Login required for MCP access" }, 401);
  }
  if (!user.features.has("*") && !user.features.has("use_mcp")) {
    return c.json({ error: "use_mcp feature required", tier: user.tier }, 403);
  }
  return null;
}

export async function handleMCPSSE(c: Ctx) {
  const guard = requireMcpAuth(c);
  if (guard) return guard;

  const origin = new URL(c.req.url).origin;
  const sessionId = crypto.randomUUID();
  const messagesUrl = `${origin}/mcp/sse?sessionId=${sessionId}`;
  const encoder = new TextEncoder();
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`event: endpoint\ndata: ${messagesUrl}\n\n`));
      heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          if (heartbeatInterval) clearInterval(heartbeatInterval);
        }
      }, 15_000);
    },
    cancel() {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function handleMCPRPC(c: Ctx) {
  const guard = requireMcpAuth(c);
  if (guard) return guard;
  const user = c.get("user");
  let body: JSONRPCRequest;
  try {
    body = (await c.req.json()) as JSONRPCRequest;
  } catch {
    return c.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      400,
    );
  }
  const resp = await dispatch(body, user, c.env);
  return c.json(resp);
}

export async function handleMCPManifest(c: Context<{ Bindings: Bindings }>) {
  return c.json({
    name: "insurance-kb",
    version: "0.3.0",
    description:
      "Insurance KB MCP — 保險業新聞 + 研究報告 + 月度蒸餾 + 研究會話協助。" +
      "供商品設計團隊透過 claude.ai 進行市場調查與報告產出。",
    tool_count: TOOLS.length,
    tools: TOOLS,
    transport: ["streamable-http", "http-sse"],
    auth: ["bearer-token-in-url-query"],
  });
}
