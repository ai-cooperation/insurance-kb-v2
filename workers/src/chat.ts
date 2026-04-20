/**
 * RAG chat handler: search articles → build context → call Workers AI → save session.
 * Uses Cloudflare Workers AI (free 10,000 neurons/day).
 */

import { type Article, loadArticles, searchArticles } from "./search";
import { getMessages, saveMessage, type Message } from "./sessions";

const MODEL = "@cf/meta/llama-3.2-3b-instruct";

const SYSTEM_PROMPT =
  "你是保險產業知識庫助手，專門回答亞太地區保險產業相關問題。\n" +
  "規則：\n" +
  "1. 只根據提供的參考資料回答，不要編造\n" +
  "2. 用繁體中文回答\n" +
  "3. 引用來源時標注 [來源名稱]\n" +
  "4. 如果資料不足，誠實說明並建議相關的搜尋方向\n" +
  "5. 回答結束後，根據對話內容建議 3 個可以進一步探討的方向";

const TOP_K = 5;

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

function buildContext(articles: Article[]): string {
  if (articles.length === 0) {
    return "（知識庫中未找到相關文章）";
  }
  return articles
    .map(
      (a, i) =>
        `[${i + 1}] ${a.title}\n` +
        `來源: ${a.source} | 日期: ${a.date} | 分類: ${a.category}\n` +
        `摘要: ${a.summary || "無摘要"}`,
    )
    .join("\n\n");
}

function extractSuggestions(answer: string): { clean: string; suggestions: string[] } {
  // Try to extract suggestions from the answer
  const patterns = [
    /(?:建議.*?探討|進一步.*?方向|可以.*?了解)[：:]\s*\n([\s\S]*?)$/,
    /(?:\d\.\s*.+\n?){3,}$/,
  ];

  for (const pat of patterns) {
    const match = answer.match(pat);
    if (match) {
      const sugText = match[1] || match[0];
      const items = sugText
        .split(/\n/)
        .map((l) => l.replace(/^\d+[\.\)、]\s*/, "").trim())
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

  // Search for relevant articles
  const allArticles = await loadArticles(kv);
  const results = searchArticles(allArticles, message, TOP_K);
  const contextArticles = results.map((r) => r.article);
  const context = buildContext(contextArticles);

  // Build conversation history
  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  if (session_id) {
    const prevMessages = await getMessages(kv, session_id);
    for (const m of prevMessages.slice(-6)) {
      messages.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.content });
    }
  }

  messages.push({
    role: "user",
    content: `參考資料：\n\n${context}\n\n使用者問題：${message}`,
  });

  // Call Cloudflare Workers AI
  const aiResponse = await ai.run(MODEL as any, { messages }) as any;
  const rawAnswer = aiResponse.response || "抱歉，無法生成回答。";

  // Extract suggestions from answer
  const { clean, suggestions } = extractSuggestions(rawAnswer);
  const finalSuggestions =
    suggestions.length > 0
      ? suggestions
      : [
          `深入了解${contextArticles[0]?.category || "保險"}的最新趨勢`,
          `比較不同地區的${contextArticles[0]?.category || "保險"}發展`,
          "查看相關的監管政策變化",
        ];

  // Build sources
  const sources = contextArticles.map((a) => ({
    title: a.title,
    url: a.source_url || a.url || "",
    category: a.category || "",
  }));

  // Save messages
  const userMsg: Message = {
    role: "user",
    content: message,
    created_at: new Date().toISOString(),
  };
  const { session_id: sid } = await saveMessage(kv, email, session_id || null, userMsg);

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
