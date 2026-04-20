/**
 * RAG chat handler: wiki-first + article-supplement.
 *
 * Flow:
 * 1. Classify user question → category + region
 * 2. Load matching wiki pages (pre-synthesized knowledge)
 * 3. Search articles for specific details (keyword match)
 * 4. Build context = wiki analysis + article specifics
 * 5. LLM answers based on rich context
 */

import { type Article, loadArticles, searchArticles } from "./search";
import { getMessages, saveMessage, type Message } from "./sessions";

const MODEL = "@cf/meta/llama-3.1-8b-instruct";
const WIKI_URL = "https://insurance-kb.cooperation.tw/data/wiki.json";

const SYSTEM_PROMPT =
  "你是保險產業知識庫助手。你的知識來自下方的「Wiki 分析」和「相關文章」。\n\n" +
  "規則：\n" +
  "1. 優先引用 Wiki 分析的趨勢和觀點，這是經過整理的專業知識\n" +
  "2. 用相關文章補充具體事件和數據\n" +
  "3. 絕對不要編造 Wiki 和文章中沒有的資訊\n" +
  "4. 如果資料不足，誠實說明\n" +
  "5. 用繁體中文回答\n" +
  "6. 回答完畢後，換行寫「建議探討方向：」然後列出 3 個相關問題";

const TOP_K = 5;

// ── Question classifier ──────────────────────────────────────────

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  regulation: ["監管", "法規", "規管", "regulation", "compliance", "金管會", "保監", "FSA", "MAS", "IRDAI", "IFRS", "solvency"],
  tech: ["科技", "AI", "人工智能", "數位", "digital", "blockchain", "區塊鏈", "fintech", "insurtech", "cyber", "自動化"],
  market: ["市場", "市佔", "保費", "營收", "併購", "M&A", "IPO", "業績", "成長", "market", "premium", "growth"],
  product: ["產品", "保單", "保障", "理賠", "嵌入式", "微保險", "product", "coverage", "embedded"],
  reinsurance: ["再保", "巨災", "catastrophe", "reinsurance", "cat bond", "ILS", "Swiss Re", "Munich Re"],
  esg: ["ESG", "永續", "氣候", "碳排", "climate", "sustainability", "TCFD", "淨零"],
  consumer: ["消費者", "申訴", "詐欺", "fraud", "complaint", "理賠糾紛", "保戶"],
  people: ["人才", "任命", "CEO", "人事", "board", "appoint", "resign", "組織"],
};

const REGION_KEYWORDS: Record<string, string[]> = {
  "asia-pacific": ["亞太", "APAC", "Asia Pacific", "東南亞"],
  china: ["中國", "大陸", "China", "平安", "人壽", "太保"],
  hongkong: ["香港", "Hong Kong", "保監局"],
  japan: ["日本", "Japan", "東京海上", "Sompo", "Tokio Marine", "生命保険"],
  korea: ["韓國", "Korea", "Samsung Life", "삼성", "한화"],
  singapore: ["新加坡", "Singapore", "MAS", "Singlife"],
  taiwan: ["台灣", "Taiwan", "金管會", "壽險", "產險"],
  global: ["全球", "global", "international", "world"],
  us: ["美國", "US", "United States", "NAIC"],
  europe: ["歐洲", "Europe", "EU", "Solvency"],
};

function classifyQuestion(text: string): { categories: string[]; regions: string[] } {
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

  // Default to broad if nothing matched
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
  timeline: { date: string; event: string }[];
  analysis: string;
  cross_topic: string;
}

interface WikiData {
  periods: string[];
  tree: any[];
  pages: Record<string, WikiPage>;
}

let _wikiCache: WikiData | null = null;
let _wikiCacheTime = 0;

async function loadWiki(): Promise<WikiData | null> {
  const now = Date.now();
  if (_wikiCache && now - _wikiCacheTime < 10 * 60 * 1000) {
    return _wikiCache;
  }
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
  categories: string[],
  regions: string[],
): WikiPage[] {
  const pages: WikiPage[] = [];
  const seen = new Set<string>();

  // Latest period first
  const periods = [...wiki.periods].sort().reverse();

  for (const period of periods) {
    for (const cat of categories) {
      for (const reg of regions) {
        const id = `${period}/${cat}-${reg}`;
        if (wiki.pages[id] && !seen.has(id)) {
          pages.push(wiki.pages[id]);
          seen.add(id);
        }
      }
    }
    if (pages.length >= 3) break; // Max 3 wiki pages
  }

  return pages;
}

function formatWikiContext(pages: WikiPage[]): string {
  if (pages.length === 0) return "";

  return pages
    .map((p) => {
      const highlights = p.highlights?.length
        ? "重點：\n" + p.highlights.map((h) => `• ${h}`).join("\n")
        : "";
      const analysis = p.analysis ? `\n分析：${p.analysis}` : "";
      return `【${p.category_zh} / ${p.region} / ${p.period}】\n${highlights}${analysis}`;
    })
    .join("\n\n");
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
  const patterns = [
    /建議探討方向[：:]\s*\n?([\s\S]*?)$/,
    /(?:\d\.\s*.+\n?){3,}$/,
  ];

  for (const pat of patterns) {
    const match = answer.match(pat);
    if (match) {
      const sugText = match[1] || match[0];
      const items = sugText
        .split(/\n/)
        .map((l) => l.replace(/^\d+[\.\)、]\s*/, "").replace(/^\*+\s*/, "").trim())
        .filter((l) => l.length > 5 && l.length < 100);
      if (items.length >= 2) {
        const clean = answer.slice(0, match.index).trim();
        return { clean, suggestions: items.slice(0, 3) };
      }
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

  // Step 1: Classify question
  const { categories, regions } = classifyQuestion(message);

  // Step 2: Load matching wiki pages
  const wiki = await loadWiki();
  const wikiPages = wiki ? findRelevantWikis(wiki, categories, regions) : [];
  const wikiContext = formatWikiContext(wikiPages);

  // Step 3: Search articles for specific details
  const allArticles = await loadArticles();
  const results = searchArticles(allArticles, message, TOP_K);
  const contextArticles = results.map((r) => r.article);
  const articleContext = buildArticleContext(contextArticles);

  // Step 4: Build prompt
  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  // Add conversation history
  if (session_id) {
    const prevMessages = await getMessages(kv, session_id);
    for (const m of prevMessages.slice(-6)) {
      messages.push({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      });
    }
  }

  // Build context block
  let context = "";
  if (wikiContext) {
    context += `=== Wiki 分析 ===\n${wikiContext}\n\n`;
  }
  if (articleContext) {
    context += `=== 相關文章 ===\n${articleContext}`;
  }
  if (!context) {
    context = "（知識庫中未找到相關資料）";
  }

  messages.push({
    role: "user",
    content: `參考資料：\n\n${context}\n\n使用者問題：${message}`,
  });

  // Step 5: Call Workers AI
  const aiResponse = (await ai.run(MODEL as any, {
    messages,
    max_tokens: 1500,
    temperature: 0.3,
  })) as any;
  const rawAnswer = aiResponse.response || "抱歉，無法生成回答。";

  // Extract suggestions
  const { clean, suggestions } = extractSuggestions(rawAnswer);
  const finalSuggestions =
    suggestions.length > 0
      ? suggestions
      : [
          `深入了解${wikiPages[0]?.category_zh || "保險"}的最新趨勢`,
          `比較不同地區的${wikiPages[0]?.category_zh || "保險"}發展`,
          "查看相關的監管政策變化",
        ];

  // Build sources from articles
  const sources = contextArticles.map((a) => ({
    title: a.title,
    url: a.source_url || a.url || "",
    category: a.category || "",
  }));

  // Save messages to session
  const userMsg: Message = {
    role: "user",
    content: message,
    created_at: new Date().toISOString(),
  };
  const { session_id: sid } = await saveMessage(
    kv,
    email,
    session_id || null,
    userMsg,
  );

  const assistantMsg: Message = {
    role: "assistant",
    content: clean,
    sources,
    model: MODEL,
    created_at: new Date().toISOString(),
  };
  await saveMessage(kv, email, sid, assistantMsg);

  return {
    answer: clean,
    sources,
    suggestions: finalSuggestions,
    session_id: sid,
    model: MODEL,
  };
}
