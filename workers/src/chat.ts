/**
 * Wiki-first RAG chat with session context persistence.
 *
 * Flow:
 * 1. Classify question → category + region (or reuse from session)
 * 2. Load matching wiki pages → primary knowledge source
 * 3. Search articles filtered by category+region → supplementary details
 * 4. LLM answers based on wiki + articles, with wiki page links
 * 5. Store category/region in session for follow-up context
 */

import { type Article, loadArticles, searchArticles } from "./search";
import { getMessages, saveMessage, type Message } from "./sessions";

const MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";
const WIKI_URL = "https://insurance-kb.cooperation.tw/data/wiki.json";
const WIKI_BASE = "https://insurance-kb.cooperation.tw";

const SYSTEM_PROMPT = `你是保險產業知識庫助手。你的知識來源是下方提供的「Wiki 分析」和「相關文章」。

回答規則：
1. 以 Wiki 分析為主要依據，這是經過專家整理的產業知識
2. 用相關文章的具體事件和數據補充細節
3. 引用 Wiki 時標注【Wiki: 主題/地區】，引用文章時標注 [編號]
4. 絕對不要編造資料中沒有的資訊
5. 用繁體中文回答，語調專業但易懂
6. 回答完畢後，換行寫「\\n建議探討方向：」然後列出 3 個與當前主題相關的深入問題
7. 如果知識庫資料不足，直接說明並建議換個角度提問`;

// ── Question classifier ──────────────────────────────────────────

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  regulation: ["監管", "法規", "規管", "regulation", "compliance", "金管會", "保監", "FSA", "MAS", "IRDAI", "IFRS", "solvency", "罰款", "牌照", "審查"],
  technology: ["科技", "AI", "人工智能", "數位", "digital", "blockchain", "區塊鏈", "fintech", "insurtech", "cyber", "自動化", "機器學習"],
  market: ["市場", "市佔", "保費", "營收", "併購", "M&A", "IPO", "業績", "成長", "market", "premium", "growth", "股價", "財報"],
  products: ["產品", "保單", "保障", "理賠", "嵌入式", "微保險", "product", "coverage", "embedded", "推出", "上市"],
  reinsurance: ["再保", "巨災", "catastrophe", "reinsurance", "cat bond", "ILS", "Swiss Re", "Munich Re", "費率"],
  esg: ["ESG", "永續", "氣候", "碳排", "climate", "sustainability", "TCFD", "淨零", "綠色"],
  consumer: ["消費者", "申訴", "詐欺", "fraud", "complaint", "理賠糾紛", "保戶", "投訴"],
  talent: ["人才", "任命", "CEO", "人事", "board", "appoint", "resign", "組織", "高管"],
};

const REGION_KEYWORDS: Record<string, string[]> = {
  "asia-pacific": ["亞太", "APAC", "東南亞", "Asia"],
  china: ["中國", "大陸", "China", "平安", "人壽", "太保", "人保"],
  hongkong: ["香港", "Hong Kong", "保監局"],
  japan: ["日本", "Japan", "東京海上", "Sompo", "Tokio Marine"],
  korea: ["韓國", "Korea", "Samsung Life", "三星", "韓華", "교보"],
  singapore: ["新加坡", "Singapore", "Singlife"],
  taiwan: ["台灣", "Taiwan", "壽險", "產險"],
  global: ["全球", "global", "international"],
  us: ["美國", "US", "NAIC"],
  europe: ["歐洲", "Europe", "EU"],
};

interface SessionContext {
  categories: string[];
  regions: string[];
}

function classifyQuestion(text: string): SessionContext {
  const lower = text.toLowerCase();
  const categories: string[] = [];
  const regions: string[] = [];

  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      categories.push(cat);
    }
  }
  for (const [reg, keywords] of Object.entries(REGION_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      regions.push(reg);
    }
  }

  if (categories.length === 0) categories.push("market");
  if (regions.length === 0) regions.push("global", "asia-pacific");

  return { categories, regions };
}

// ── Wiki loader ──────────────────────────────────────────────────

interface WikiPage {
  id: string;
  category: string;
  category_zh: string;
  region: string;
  period: string;
  highlights: string[];
  analysis: string;
  cross_topic: string;
}

interface WikiData {
  periods: string[];
  pages: Record<string, WikiPage>;
}

let _wikiCache: WikiData | null = null;
let _wikiCacheTime = 0;

async function loadWiki(): Promise<WikiData | null> {
  const now = Date.now();
  if (_wikiCache && now - _wikiCacheTime < 10 * 60 * 1000) return _wikiCache;
  try {
    const resp = await fetch(WIKI_URL);
    if (!resp.ok) return _wikiCache;
    _wikiCache = (await resp.json()) as WikiData;
    _wikiCacheTime = now;
    return _wikiCache;
  } catch {
    return _wikiCache;
  }
}

function findRelevantWikis(
  wiki: WikiData,
  ctx: SessionContext,
): WikiPage[] {
  const pages: WikiPage[] = [];
  const seen = new Set<string>();
  const periods = [...wiki.periods].sort().reverse();

  for (const period of periods) {
    for (const cat of ctx.categories) {
      for (const reg of ctx.regions) {
        const id = `${period}/${cat}-${reg}`;
        if (wiki.pages[id] && !seen.has(id)) {
          pages.push(wiki.pages[id]);
          seen.add(id);
        }
      }
    }
    if (pages.length >= 3) break;
  }
  return pages;
}

function formatWikiContext(pages: WikiPage[]): string {
  if (pages.length === 0) return "";

  return pages
    .map((p) => {
      const highlights = p.highlights?.length
        ? p.highlights.map((h) => `• ${h}`).join("\n")
        : "";
      const analysis = p.analysis || "";
      return (
        `【${p.category_zh} / ${p.region} / ${p.period}】\n` +
        `${highlights}\n` +
        `${analysis}\n` +
        `→ 完整分析：${WIKI_BASE}/#wiki (${p.id})`
      );
    })
    .join("\n\n---\n\n");
}

// ── Chat handler ─────────────────────────────────────────────────

interface ChatRequest {
  message: string;
  session_id?: string;
}

interface ChatResponse {
  answer: string;
  sources: Array<{ title: string; url: string; category: string }>;
  suggestions: string[];
  wiki_refs: Array<{ id: string; label: string }>;
  session_id: string;
  model: string;
}

function buildArticleContext(articles: Article[]): string {
  if (articles.length === 0) return "";
  return articles
    .map(
      (a, i) =>
        `[${i + 1}] ${a.title} (${a.date}, ${a.source})\n摘要: ${a.summary || "無"}`,
    )
    .join("\n\n");
}

function extractSuggestions(answer: string): { clean: string; suggestions: string[] } {
  const match = answer.match(/建議探討方向[：:]\s*\n?([\s\S]*?)$/);
  if (match) {
    const items = match[1]
      .split(/\n/)
      .map((l) => l.replace(/^\d+[\.\)、]\s*/, "").replace(/^\*+\s*/, "").replace(/^-\s*/, "").trim())
      .filter((l) => l.length > 5 && l.length < 100);
    if (items.length >= 2) {
      return { clean: answer.slice(0, match.index).trim(), suggestions: items.slice(0, 3) };
    }
  }
  return { clean: answer, suggestions: [] };
}

export async function handleChat(
  kv: KVNamespace,
  ai: Ai,
  email: string,
  body: ChatRequest,
): Promise<ChatResponse> {
  const { message, session_id } = body;

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    throw new Error("message is required");
  }

  // Step 1: Classify question — or reuse session context for follow-ups
  let ctx = classifyQuestion(message);

  // Load session context if follow-up — merge with new classification
  if (session_id) {
    const savedCtx = await kv.get(`ctx:${session_id}`, "json") as SessionContext | null;
    if (savedCtx) {
      const newCtx = classifyQuestion(message);
      const newHasSpecific = !(
        newCtx.categories.length === 1 && newCtx.categories[0] === "market" &&
        newCtx.regions.length === 2 && newCtx.regions[0] === "global"
      );
      if (newHasSpecific) {
        // New question has specific keywords — use new classification but add session regions
        ctx = {
          categories: [...new Set([...newCtx.categories, ...savedCtx.categories])],
          regions: [...new Set([...newCtx.regions, ...savedCtx.regions])],
        };
      } else {
        // Generic follow-up — fully reuse session context
        ctx = savedCtx;
      }
    }
  }

  // Step 2: Load matching wiki pages
  const wiki = await loadWiki();
  const wikiPages = wiki ? findRelevantWikis(wiki, ctx) : [];
  const wikiContext = formatWikiContext(wikiPages);

  // Step 3: Search articles filtered by category+region first
  const allArticles = await loadArticles();
  // Filter to matching category+region for better relevance
  const filtered = allArticles.filter((a) => {
    const catMap: Record<string, string> = {
      "監管動態": "regulation", "科技應用": "technology", "市場趨勢": "market",
      "產品創新": "products", "再保市場": "reinsurance", "ESG永續": "esg",
      "消費者保護": "consumer", "人才與組織": "talent",
    };
    const artCat = catMap[a.category || ""] || "";
    const artReg = a.region || "";

    const catMatch = ctx.categories.some((c) => c === artCat);
    const regMatch = ctx.regions.some((r) => {
      const regionZh: Record<string, string> = {
        "asia-pacific": "亞太", china: "中國", hongkong: "香港", japan: "日本",
        korea: "韓國", singapore: "新加坡", taiwan: "台灣", global: "全球",
        us: "美國", europe: "歐洲",
      };
      return artReg === regionZh[r];
    });
    return catMatch || regMatch;
  });

  // Search within filtered set, fallback to all if too few results
  let results = searchArticles(filtered, message, TOP_K);
  if (results.length < 3) {
    results = searchArticles(allArticles, message, TOP_K);
  }
  const contextArticles = results.map((r) => r.article);
  const articleContext = buildArticleContext(contextArticles);

  // Step 4: Build prompt
  const msgs: Array<{ role: string; content: string }> = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  // Add conversation history (last 4 exchanges)
  if (session_id) {
    const prevMessages = await getMessages(kv, session_id);
    for (const m of prevMessages.slice(-8)) {
      msgs.push({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      });
    }
  }

  let context = "";
  if (wikiContext) context += `=== Wiki 知識庫分析 ===\n${wikiContext}\n\n`;
  if (articleContext) context += `=== 相關新聞文章 ===\n${articleContext}`;
  if (!context) context = "（知識庫中未找到與此問題直接相關的資料）";

  msgs.push({
    role: "user",
    content: `以下是知識庫的參考資料：\n\n${context}\n\n---\n使用者問題：${message}`,
  });

  // Step 5: Call LLM with fallback
  let rawAnswer = "";
  const models = [
    "@cf/qwen/qwen3-30b-a3b-fp8",
    "@cf/meta/llama-3.1-8b-instruct",
  ];
  for (const model of models) {
    try {
      const aiResponse = (await ai.run(model as any, {
        messages: msgs,
        max_tokens: 1500,
        temperature: 0.3,
      })) as any;
      rawAnswer = aiResponse?.response || "";
      if (rawAnswer && rawAnswer.length > 20) break;
    } catch (e) {
      // Try next model
      continue;
    }
  }
  if (!rawAnswer) rawAnswer = "抱歉，無法生成回答。請稍後再試。";

  // Extract suggestions
  const { clean, suggestions } = extractSuggestions(rawAnswer);
  const finalSuggestions = suggestions.length > 0 ? suggestions : [
    `${wikiPages[0]?.category_zh || "保險"}在${wikiPages[0]?.region || "亞太"}的最新發展`,
    `比較不同地區的${wikiPages[0]?.category_zh || "保險"}趨勢`,
    "相關的監管政策變化與影響",
  ];

  // Build sources + wiki refs
  const sources = contextArticles.map((a) => ({
    title: a.title,
    url: a.source_url || a.url || "",
    category: a.category || "",
  }));

  const wiki_refs = wikiPages.map((p) => ({
    id: p.id,
    label: `${p.category_zh} / ${p.region} / ${p.period}`,
  }));

  // Save session
  const userMsg: Message = {
    role: "user", content: message, created_at: new Date().toISOString(),
  };
  const { session_id: sid } = await saveMessage(kv, email, session_id || null, userMsg);

  // Save session context for follow-ups
  await kv.put(`ctx:${sid}`, JSON.stringify(ctx), { expirationTtl: 3600 });

  const assistantMsg: Message = {
    role: "assistant", content: clean, sources, model: MODEL,
    created_at: new Date().toISOString(),
  };
  await saveMessage(kv, email, sid, assistantMsg);

  return { answer: clean, sources, suggestions: finalSuggestions, wiki_refs, session_id: sid, model: MODEL };
}

const TOP_K = 5;
