/**
 * Insurance KB API — Cloudflare Workers entry point.
 * Hono router with CORS, auth, rate limiting, search, chat, sessions.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";

import { extractEmail } from "./auth";
import { handleChat } from "./chat";
import { checkRateLimit } from "./rate-limit";
import { loadArticles, searchArticles } from "./search";
import { deleteSession, getMessages, listSessions } from "./sessions";

interface Bindings {
  KV: KVNamespace;
  CORS_ORIGIN: string;
  GROQ_API_KEY: string;
}

const app = new Hono<{ Bindings: Bindings; Variables: { email: string } }>();

// --- CORS ---
app.use("/api/*", async (c, next) => {
  const origin = c.env.CORS_ORIGIN || "*";
  const middleware = cors({
    origin,
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  });
  return middleware(c, next);
});

// --- Auth middleware ---
app.use("/api/*", async (c, next) => {
  const email = extractEmail(c.req.raw);
  c.set("email", email);
  await next();
});

// --- Rate limit middleware (chat only) ---
app.use("/api/chat", async (c, next) => {
  if (c.req.method !== "POST") {
    return next();
  }
  const email = c.get("email");
  const result = await checkRateLimit(c.env.KV, email);
  if (!result.allowed) {
    return c.json(
      {
        error: "Rate limit exceeded",
        remaining: result.remaining,
        limit: result.limit,
        reset_at: result.resetAt,
      },
      429,
    );
  }
  await next();
});

// --- Routes ---

// GET /api/status
app.get("/api/status", (c) => {
  return c.json({
    status: "ok",
    service: "insurance-kb-api",
    version: "2.0.0",
    model: "llama-3.3-70b-versatile",
  });
});

// GET /api/stats
app.get("/api/stats", async (c) => {
  const articles = await loadArticles(c.env.KV);
  const active = articles.filter((a) => !a.filter);
  const categories = new Set(active.map((a) => a.category).filter(Boolean));
  const sources = new Set(active.map((a) => a.source).filter(Boolean));

  return c.json({
    total_articles: articles.length,
    active_articles: active.length,
    filtered_articles: articles.length - active.length,
    categories: categories.size,
    sources: sources.size,
  });
});

// GET /api/search?q=
app.get("/api/search", async (c) => {
  const query = c.req.query("q") || "";
  const limit = Math.min(parseInt(c.req.query("limit") || "10", 10), 50);

  if (!query.trim()) {
    return c.json({ results: [], query: "" });
  }

  const articles = await loadArticles(c.env.KV);
  const results = searchArticles(articles, query, limit);

  return c.json({
    query,
    count: results.length,
    results: results.map((r) => ({
      ...r.article,
      score: r.score,
    })),
  });
});

// GET /api/chat/status
app.get("/api/chat/status", async (c) => {
  const email = c.get("email");
  const result = await checkRateLimit(c.env.KV, email, 20);

  return c.json({
    email,
    rate_limit: {
      remaining: result.remaining + (result.allowed ? 0 : 0),
      limit: result.limit,
      reset_at: result.resetAt,
    },
  });
});

// POST /api/chat
app.post("/api/chat", async (c) => {
  const email = c.get("email");
  const body = await c.req.json();

  if (!c.env.GROQ_API_KEY) {
    return c.json({ error: "GROQ_API_KEY not configured" }, 500);
  }

  try {
    const result = await handleChat(c.env.KV, c.env.GROQ_API_KEY, email, body);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ error: message }, 400);
  }
});

// GET /api/sessions
app.get("/api/sessions", async (c) => {
  const email = c.get("email");
  const sessions = await listSessions(c.env.KV, email);
  return c.json({ sessions });
});

// GET /api/sessions/:id/messages
app.get("/api/sessions/:id/messages", async (c) => {
  const sessionId = c.req.param("id");
  const messages = await getMessages(c.env.KV, sessionId);
  return c.json({ session_id: sessionId, messages });
});

// DELETE /api/sessions/:id
app.delete("/api/sessions/:id", async (c) => {
  const email = c.get("email");
  const sessionId = c.req.param("id");
  const deleted = await deleteSession(c.env.KV, email, sessionId);

  if (!deleted) {
    return c.json({ error: "Session not found" }, 404);
  }
  return c.json({ deleted: true, session_id: sessionId });
});

export default app;
