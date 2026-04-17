/**
 * RAG chat handler: search articles → build context → call Groq → save session.
 */

import { chatCompletion, type ChatMessage } from "./groq";
import { type Article, loadArticles, searchArticles } from "./search";
import { getMessages, saveMessage, type Message } from "./sessions";

const SYSTEM_PROMPT =
  "你是保險產業知識庫助手。根據提供的文章資料回答問題。" +
  "規則：1.只根據提供的資料回答不要編造 2.用繁體中文回答 " +
  "3.引用來源時標注[來源名稱] 4.如果資料不足以回答誠實說明";

const TOP_K = 5;

interface ChatRequest {
  message: string;
  session_id?: string;
}

interface ChatResponse {
  answer: string;
  sources: Array<{ title: string; url: string }>;
  session_id: string;
  model: string;
}

function buildContext(articles: Article[]): string {
  if (articles.length === 0) {
    return "（知識庫中未找到相關文章）";
  }
  return articles
    .map((a, i) => {
      const url = a.source_url || a.url || "";
      return (
        `[${i + 1}] ${a.title}\n` +
        `來源: ${a.source} | 日期: ${a.date}\n` +
        `連結: ${url}\n` +
        `摘要: ${a.summary || "無摘要"}`
      );
    })
    .join("\n\n");
}

export async function handleChat(
  kv: KVNamespace,
  groqApiKey: string,
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
  const history: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];

  if (session_id) {
    const prevMessages = await getMessages(kv, session_id);
    for (const m of prevMessages.slice(-10)) {
      history.push({ role: m.role, content: m.content });
    }
  }

  history.push({
    role: "user",
    content: `根據以下參考資料回答問題：\n\n${context}\n\n問題：${message}`,
  });

  // Call Groq
  const groqResponse = await chatCompletion(groqApiKey, history);
  const answer = groqResponse.choices[0]?.message?.content || "抱歉，無法生成回答。";
  const model = groqResponse.model;

  // Build sources list
  const sources = contextArticles.map((a) => ({
    title: a.title,
    url: a.source_url || a.url || "",
  }));

  // Save user message
  const userMsg: Message = {
    role: "user",
    content: message,
    created_at: new Date().toISOString(),
  };
  const { session_id: sid } = await saveMessage(kv, email, session_id || null, userMsg);

  // Save assistant message
  const assistantMsg: Message = {
    role: "assistant",
    content: answer,
    sources,
    model,
    created_at: new Date().toISOString(),
  };
  await saveMessage(kv, email, sid, assistantMsg);

  return { answer, sources, session_id: sid, model };
}
