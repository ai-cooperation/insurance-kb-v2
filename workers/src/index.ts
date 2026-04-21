/**
 * Insurance KB API — Cloudflare Workers entry point.
 * Google auth + KV whitelist + Workers AI chat + RAG search.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";

import {
  getUserFromRequest,
  addVip,
  removeVip,
  listVips,
  type UserInfo,
} from "./auth";
import { handleChat } from "./chat";
import { checkRateLimit } from "./rate-limit";
import { loadArticles, searchArticles } from "./search";
import { deleteSession, getMessages, listSessions } from "./sessions";

interface Bindings {
  KV: KVNamespace;
  AI: Ai;
  CORS_ORIGIN: string;
  ADMIN_EMAIL: string;
}

const app = new Hono<{ Bindings: Bindings; Variables: { user: UserInfo } }>();

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

// --- Auth middleware (all routes) ---
app.use("/api/*", async (c, next) => {
  const user = await getUserFromRequest(c.req.raw, c.env.KV);
  c.set("user", user);
  await next();
});

// --- Tier guards ---
const requireMember = async (c: any, next: any) => {
  const user = c.get("user") as UserInfo;
  if (user.tier === "guest") {
    return c.json({ error: "Login required", tier: "guest" }, 401);
  }
  await next();
};

const requireVip = async (c: any, next: any) => {
  const user = c.get("user") as UserInfo;
  if (user.tier !== "vip") {
    return c.json({ error: "VIP access required", tier: user.tier }, 403);
  }
  await next();
};

const requireAdmin = async (c: any, next: any) => {
  const user = c.get("user") as UserInfo;
  const adminEmail = c.env.ADMIN_EMAIL || "";
  if (user.email !== adminEmail) {
    return c.json({ error: "Admin access required" }, 403);
  }
  await next();
};

// === PUBLIC ROUTES ===

// GET /api/status
app.get("/api/status", (c) => {
  return c.json({
    status: "ok",
    service: "insurance-kb-api",
    version: "2.1.0",
  });
});

// GET /api/auth/me — return current user info
app.get("/api/auth/me", (c) => {
  const user = c.get("user");
  return c.json(user);
});

// GET /api/stats
app.get("/api/stats", async (c) => {
  const articles = await loadArticles();
  const active = articles.filter((a) => !a.filter);
  const categories = new Set(active.map((a) => a.category).filter(Boolean));

  return c.json({
    total_articles: articles.length,
    active_articles: active.length,
    categories: categories.size,
  });
});

// GET /api/search?q=
app.get("/api/search", async (c) => {
  const query = c.req.query("q") || "";
  const limit = Math.min(parseInt(c.req.query("limit") || "10", 10), 50);

  if (!query.trim()) {
    return c.json({ results: [], query: "" });
  }

  const articles = await loadArticles();
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

// === MEMBER ROUTES (Google login required) ===

// GET /api/sessions
app.get("/api/sessions", requireMember, async (c) => {
  const user = c.get("user");
  const sessions = await listSessions(c.env.KV, user.email);
  return c.json({ sessions });
});

// GET /api/sessions/:id/messages
app.get("/api/sessions/:id/messages", requireMember, async (c) => {
  const sessionId = c.req.param("id");
  const messages = await getMessages(c.env.KV, sessionId);
  return c.json({ session_id: sessionId, messages });
});

// DELETE /api/sessions/:id
app.delete("/api/sessions/:id", requireMember, async (c) => {
  const user = c.get("user");
  const sessionId = c.req.param("id");
  const deleted = await deleteSession(c.env.KV, user.email, sessionId);
  if (!deleted) {
    return c.json({ error: "Session not found" }, 404);
  }
  return c.json({ deleted: true });
});

// === VIP ROUTES (whitelist required) ===

// POST /api/chat — tier check in frontend (Firebase Auth), rate limit by IP here
app.post("/api/chat", async (c) => {
  // Rate limit by IP (no auth needed, prevents API abuse)
  const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
  const rl = await checkRateLimit(c.env.KV, `ip:${ip}`, 100);
  if (!rl.allowed) {
    return c.json({ error: "Rate limit exceeded", remaining: rl.remaining, reset_at: rl.resetAt }, 429);
  }
  const user = c.get("user");

  // Rate limit
  const rl = await checkRateLimit(c.env.KV, user.email, 50);
  if (!rl.allowed) {
    return c.json(
      { error: "Rate limit exceeded", remaining: rl.remaining, reset_at: rl.resetAt },
      429,
    );
  }

  const body = await c.req.json();

  try {
    const result = await handleChat(c.env.KV, c.env.AI, user.email, body);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ error: message }, 400);
  }
});

// GET /api/chat/status
app.get("/api/chat/status", requireVip, async (c) => {
  const user = c.get("user");
  const rl = await checkRateLimit(c.env.KV, user.email, 50);

  return c.json({
    email: user.email,
    tier: user.tier,
    rate_limit: { remaining: rl.remaining, limit: rl.limit, reset_at: rl.resetAt },
  });
});

// === ADMIN ROUTES ===

// GET /api/admin/vips
app.get("/api/admin/vips", requireAdmin, async (c) => {
  const vips = await listVips(c.env.KV);
  return c.json({ vips });
});

// POST /api/admin/vips { email }
app.post("/api/admin/vips", requireAdmin, async (c) => {
  const { email } = await c.req.json();
  if (!email) return c.json({ error: "email required" }, 400);
  await addVip(c.env.KV, email);
  return c.json({ added: email });
});

// DELETE /api/admin/vips/:email
app.delete("/api/admin/vips/:email", requireAdmin, async (c) => {
  const email = c.req.param("email");
  await removeVip(c.env.KV, email);
  return c.json({ removed: email });
});

export default app;
