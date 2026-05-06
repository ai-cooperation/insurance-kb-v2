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
 *   generate_outline, create_report (alias: finalize_report)
 *
 * Adapted from agent-kb/server/src/mcp.ts (transport + JSON-RPC scaffolding
 * is identical; tools are V2-specific).
 */

import type { Context } from "hono";

import type { FirebaseUser } from "./auth-firebase";
import { hasFeatures } from "./auth-firebase";
import { loadArticles, searchArticles, type Article } from "./search";
import {
  ensureTopic,
  getReportContent,
  getReportMeta,
  getTopic,
  listReports,
  listTopics as listTopicsStore,
} from "./reports-store";
import {
  addFindingToSession,
  confirmSessionScope,
  finalizeSession,
  generateSessionOutline,
  getSession,
  listSessionFindings,
  startResearchSession,
} from "./research-session";
import { createReport, notifyTelegramNewReport } from "./reports-store";

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
      "列出保險新聞 / 看最近新聞 / 撈最近 / 給我新聞 / list insurance articles / browse / recent news / news feed。\n" +
      "**Triggers**: 用戶說「最近有什麼」「列一下台灣 X 公司動態」「看看亞洲保險業」「過去 30 天」「有什麼新聞」「列保險業界動態」時叫。\n" +
      "**Don't use**: 用戶說具體關鍵字找事（「找跟 X 有關的」）→ 改用 search_articles；找網路上的東西 → web_search。\n" +
      "回傳近 N 天的保險業新聞（中標題/摘要/來源/日期/分類/地區），可按 region/category 過濾。資料每天 2 次自動爬蟲更新，涵蓋台/日/韓/港/東南亞。",
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
      "搜尋保險新聞 / 用關鍵字找新聞 / 找跟 X 有關的 / 撈 / search articles / find news on topic / lookup。\n" +
      "**Triggers**: 用戶提具體公司名/商品名/主題詞時（「新光的健康險」「IFRS17 影響」「Pulse 數位生態圈」）。做研究 (research session) 時是**蒐集 finding 的主力工具**。\n" +
      "**Don't use**: 想看「最近 N 天有什麼」沒指定關鍵字 → 用 list_articles；找的是公司官網/監管公告/國際趨勢（KB 不一定有）→ 用 web_search。\n" +
      "全文搜尋 19000+ 篇 articles，scoring=title*3+category*2+summary*1。每筆含 url 可開原始來源。Research session 中找到後**必須**用 add_finding 累積，並把 article.url 帶進 source_url。",
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
      "列出研究報告 / 看以前做過什麼 / 看歷史報告 / 看 Insurance KB 上有什麼研究 / list research reports / browse reports / show past research。\n" +
      "**Triggers**: 用戶說「以前研究過 X 嗎」「KB 上有什麼報告」「找之前的分析」「看一下既有研究」。**做新研究的第一步**（research session 中）— 先看歷史避免重複造輪子。\n" +
      "**Don't use**: 想找特定主題的舊報告 → 也用這個但帶 category；想看主題分組樹結構 → 用 list_topics。\n" +
      "回傳所有 published 報告 metadata（不含 markdown 全文，要用 get_report 拿）。可按 category 過濾。",
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
      "讀取研究報告全文 / 看某份報告詳細 / 給我報告內容 / get report / read report / fetch report content / open report。\n" +
      "**Triggers**: list_reports 找到某份覺得相關 → 用這個讀全文；用戶丟報告 ID 或 url（含 /reports/<id>) → 解析 ID 後讀取；做 research session 引用舊報告 → 讀全文後 add_finding 帶 source_url=`/reports/<id>`。\n" +
      "**Don't use**: 只想看一堆報告的標題清單 → list_reports；找的不是某份具體報告而是某月主題彙整 → get_wiki。\n" +
      "回傳 meta（含字數/引用數/閱讀次數/作者/分類）+ 完整 markdown 內容（含末尾「## 參考資料」section 跟所有 source URL）。",
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
      "讀取月度蒸餾 / 看 X 月有什麼大事 / 月報 / 季度 wiki / get monthly distillation / get wiki / monthly summary / what happened in X。\n" +
      "**Triggers**: 用戶說「2026 年 4 月有什麼大事」「上個月保險業」「3 月趨勢」。比 list_articles 高一階：已被 LLM 蒸餾成主題彙整，更精煉。\n" +
      "**Don't use**: 想看具體某篇新聞 → search_articles；想看主題長期演變（跨月）→ 連續 get_wiki 多個月份再對比；要找某公司動態 → search_articles 或 list_articles。\n" +
      "回傳該月的主題彙整 markdown（已含跨地區比較、重點 quote、推論）。data 可能 null（該月還沒蒸餾），不要硬撐。",
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
      "外部網路搜尋 / 上網查 / google 一下 / 找網路上有什麼說 / web search / google / DuckDuckGo / external search。\n" +
      "**Triggers**: KB 內找不到某主題（search_articles 0 hits 或太少）；用戶要監管公告/公司官網/國際趨勢/同業評論等 KB 沒爬的東西；想驗證某數據是否有外部 source。\n" +
      "**Don't use**: 找的內容是保險業新聞 → 先 search_articles（KB 已爬全亞洲主流媒體）；找某個既有報告 → list_reports；想看某月趨勢 → get_wiki。Web search 是兜底用，不該是第一選擇。\n" +
      "Worker 代理 DuckDuckGo HTML scrape — fragile 但免 API key。回傳 [{title, url, snippet}]。引用後 add_finding 必須帶實際 url（不是 ddg.gg 那層）。",
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
      "啟動研究 session / 開始做研究 / 開始寫報告 / 我想研究 X / 幫我做 X 主題的研究 / 我想做一份報告 / start research / kick off report / begin report drafting。\n" +
      "**Triggers (一定要先叫)**: 用戶說「幫我做 X 研究」「我想研究 X」「寫一份 X 報告」「分析一下 X」「幫我看 X 這個主題」「做個 X 商品評估」「我要寫 X 給商品設計團隊看」**不要直接 search 也不要直接寫**。\n" +
      "**Don't use**: 用戶只是問「最近有什麼 X 新聞」(→ list_articles)；用戶要找一個資料點不寫報告 (→ search_articles)；用戶要看舊報告 (→ list_reports)。\n" +
      "回傳 5 步 grill-me-first 引導框架（範圍/地區/時間/讀者/深度），每步含 A/B/C/.. 選項+推薦預設+rationale。**Chat 必須一步一步問用戶**，列選項 + 推薦 + 等用戶選後才下一步。用戶說「你決定」也不要自己決定，要再問「這個會直接影響蒐集方向，請選」。\n" +
      "Server-side state 存 KV TTL 24h。",
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
      "鎖定研究範圍 / 範圍定了 / 開始查資料 / 確認範圍 / confirm scope / lock scope / proceed with research。\n" +
      "**Triggers**: start_research_session 後用戶把 5 步全選完了（scope/region/timeframe/audience/depth 都有答）。\n" +
      "**Don't use**: 用戶還沒選完 5 步就呼叫 → server 會接受但 plan 會偏；再叫一次同 session_id 不會 reset 範圍（要新 session 重來）。\n" +
      "Server 回 research plan todo（要查哪些 source / 用哪些 tool / 預估 finding 數量），chat 照 todo 開始 search_articles / list_reports / get_wiki / web_search 蒐集證據。",
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
      "累積證據 / 記下這條來源 / 加 finding / 存進 session / record source / track citation / save evidence / cite this。\n" +
      "**核心溯源工具**。**Triggers**: research session 中每蒐到一條值得寫進報告的事實 / 數據 / 競品案例 / 公司動態 / 法規消息 / 跨市場觀察 / 你的觀察推論。Article search 結果中要引用、報告中要引用、web 結果中要引用 — 全部都先 add_finding 再寫。\n" +
      "**Don't use 前提**: 沒 source_url 不能叫 — server 會 reject。「我記得 X」「訓練資料說 X」**不算合法 source**，要先 search_articles 或 web_search 找到 URL 再叫。\n" +
      "**為什麼存 server**: 10+ findings 全塞 chat context 會排擠思考空間（每筆含 quote 可能 5K tokens）。Server-side draft state (24h KV TTL) 讓 chat 只看 finding ID 即可。\n" +
      "**Auto-publish**: report 上架（create_report）時，server 自動把所有 findings 整成「## 參考資料」section 附報告末尾，報告內文用 `[^N]` footnote 引用對應 finding。",
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
      "看當前 session 累積了什麼 / 看蒐集進度 / 我加了多少 / 看 finding 清單 / list findings / show evidence so far / review session。\n" +
      "**Triggers**: 蒐到一定量（5+）想 review 是否足夠 / 是否某類偏多某類缺；用戶問「目前蒐到什麼」「進度如何」；準備 generate_outline 前先看分類比例。\n" +
      "**Don't use**: 直接想生大綱 → generate_outline（內部會跑 list 邏輯）。\n" +
      "回 findings 全清單 + 按 type 分類統計（例：5 news_quote / 3 web_quote / 2 cross_market_pattern）。",
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
      "從 findings 生報告大綱 / 給我建議結構 / 建議章節 / propose structure / generate outline / suggest TOC。\n" +
      "**Triggers**: 蒐集到 8-15 個 findings 後（少於 3 會 reject）；用戶說「夠了開始寫」「列大綱」「給我結構」「來規劃章節」。\n" +
      "**Don't use**: findings 不夠（< 5）就硬叫 → 大綱會偏；只想看 findings 不要結構 → list_findings。\n" +
      "Server 把 findings 按 type 分桶（market/comp/product/history）→ 提建議 section 結構，每 section 標出引用哪些 finding ID。\n" +
      "**Chat 拿到大綱後不要直接寫報告**，要列給用戶確認/調整再開始寫內文（grill-mode 第二輪）。",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "create_report",
    description:
      "建立 / 上架研究報告 / 發布報告 / 完成這份報告 / publish report / create report / finalize / submit / ship report。\n" +
      "**Triggers**: 用戶看完大綱後同意，chat 寫完整 markdown 內文 → 上架；用戶說「上架」「發布」「完成」「存檔」「就這樣」。\n" +
      "**Don't use 前提**: session 沒任何 finding → server reject；topic_id 給了但不存在又沒 topic_title → reject（要補 topic_title 才能 auto-create）；用戶還在改大綱還沒寫內文。\n" +
      "**權限**: 要 create_report feature flag（VIP 預設有，member 要 admin per-user override 才有）。\n" +
      "**Server 行為**: (1) ensureTopic（如果 topic_id 不存在且有 topic_title 則自動建主題）;(2) auto-append「## 參考資料」section 從所有 findings 列 source URL;(3) D1 metadata + R2 markdown 雙寫;(4) TG 通知 admin（如果有設）;(5) 回傳 {meta, url} 含公開連結。\n" +
      "**Topic 歸屬**: 寫前先 list_topics 看現有主題 — 找得到合適的就用同 topic_id（sort_order 設下一個 chapter 編號 * 10）；找不到就建新主題（給 topic_id slug + topic_title + topic_summary，sort_order=0 表示這份是新主題的主報告）。",
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
        topic_id: {
          type: "string",
          description:
            "歸屬主題 ID（slug-like，例：topic_v1_marketing）。先用 list_topics 看現有主題；" +
            "新主題給 topic_id + topic_title 即可自動建立。不給的話報告會 orphan（不在主題樹裡顯示）。",
        },
        topic_title: {
          type: "string",
          description: "若 topic_id 不存在，用此 title 自動建主題（必填當新建主題時）",
        },
        topic_summary: {
          type: "string",
          description: "若新建主題，這段會顯示在主題頁頂端（建議寫 1-2 句概述）",
        },
        sort_order: {
          type: "number",
          description:
            "在主題內的排序：0 = 主報告（永遠最上）、10/20/30 = 章節依序、100 = 預設（章節）。" +
            "做研究 session 通常給 100 或具體章節編號 * 10。",
        },
      },
      required: ["session_id", "title", "markdown"],
    },
  },

  {
    name: "list_topics",
    description:
      "列出所有研究主題 / 看主題樹 / 看分類有什麼 / 既有主題清單 / list topics / show topic tree / browse research areas。\n" +
      "**Triggers**: create_report 前**強烈建議**先呼叫看現有主題能不能歸屬（避免主題碎片化）；用戶問「KB 上有什麼主題」「看一下分類」「列研究系列」。\n" +
      "**Don't use**: 想看某主題下的報告 → list_reports?topic_id=X 或 GET /api/topics/{id}（worker 端 only，MCP 沒包）；想看主題下單份報告 → get_report。\n" +
      "回傳所有主題 + 每主題的報告數。前端 sidebar tree 也是讀這個。",
    inputSchema: { type: "object", properties: {} },
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

  // Topic handling — auto-create if topic_id given but doesn't exist + topic_title provided
  if (args.topic_id) {
    const existing = await getTopic(env.REPORTS_DB, args.topic_id);
    if (!existing) {
      if (!args.topic_title) {
        throw new Error(
          `topic_id "${args.topic_id}" 不存在；補 topic_title 即可自動建立 (見 list_topics 看現有主題)`,
        );
      }
      await ensureTopic(env.REPORTS_DB, {
        id: args.topic_id,
        title: args.topic_title,
        summary: args.topic_summary,
      });
    }
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
    topic_id: args.topic_id,
    sort_order: typeof args.sort_order === "number" ? args.sort_order : 100,
  });

  await finalizeSession(env.KV, user.uid, args.session_id, meta.id);

  const publicUrl = `${env.CORS_ORIGIN}/reports/${meta.id}`;
  await notifyTelegramNewReport(env, meta, publicUrl);

  return { meta, url: publicUrl, finding_count: session.findings.length };
}

async function handleListTopicsTool(env: Bindings) {
  const topics = await listTopicsStore(env.REPORTS_DB);
  return { count: topics.length, topics };
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
            "7. create_report 上架（需 create_report feature，VIP 預設有）",
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
        case "create_report":
        case "finalize_report":  // legacy alias — keep accepting old name in case
                                 // any cached profile/skill still uses it
          result = await handleFinalizeReport(env, user, args as any);
          break;
        case "list_topics":
          result = await handleListTopicsTool(env);
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
