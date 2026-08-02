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
import { getFirebaseUser, type FirebaseUser } from "./auth-firebase";
import { handleChat } from "./chat";
import { checkRateLimit } from "./rate-limit";
import { loadArticles, searchArticles } from "./search";
import { deleteSession, getMessages, listSessions } from "./sessions";
import {
  handleArchiveReport,
  handleCreateReport,
  handleGetReport,
  handleGetTopic,
  handleListReports,
  handleListTopics,
} from "./reports";
import { handleMCPManifest, handleMCPRPC, handleMCPSSE } from "./mcp";
import {
  handleIssueToken,
  handleListTokens,
  handleRevokeToken,
} from "./mcp-tokens";

interface Bindings {
  KV: KVNamespace;
  AI: Ai;
  CORS_ORIGIN: string;
  ADMIN_EMAIL: string;
  // v3 (2026-05-05) Firebase / Reports / MCP additions:
  HUB_PROJECT_ID: string;
  KB_PROJECT_ID: string;
  FIREBASE_ADMIN_EMAIL: string;   // wrangler secret
  FIREBASE_ADMIN_KEY: string;     // wrangler secret
  REPORTS_DB: D1Database;
  REPORTS_BUCKET: R2Bucket;
  MCP_PUBLIC_URL: string;
  TG_BOT_TOKEN?: string;
  TG_CHAT_ID?: string;
  REPORTS_REPO?: string;          // v3 (2026-06-03) git snapshot pillar — set in [vars]
  REPORTS_GITHUB_PAT?: string;    // fine-grained PAT, set via `wrangler secret put`
  SNAPSHOT_TEST_KEY?: string;     // shared-secret for /api/snapshot-test (debug endpoint)
  INSURANCE_A_URL?: string;       // research pipeline engine base URL (ba-spec §7) — [vars]
  RESEARCH_PIPELINE_KEY?: string; // shared-secret for /api/research-pipeline/complete (wrangler secret)
}

const app = new Hono<{
  Bindings: Bindings;
  Variables: { user: UserInfo; fbUser: FirebaseUser };
}>();

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
// `user`  = legacy Google + KV vip path (still used by /api/chat etc.)
// `fbUser` = v3 Firebase + Firestore + features path (used by /api/reports etc.)
app.use("/api/*", async (c, next) => {
  const [user, fbUser] = await Promise.all([
    getUserFromRequest(c.req.raw, c.env.KV),
    getFirebaseUser(c.req.raw, c.env).catch(() => null),
  ]);
  c.set("user", user);
  if (fbUser) c.set("fbUser", fbUser);
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
  const user = c.get("user");
  const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
  const rl = await checkRateLimit(c.env.KV, `ip:${ip}`, 100);
  if (!rl.allowed) {
    return c.json(
      { error: "Rate limit exceeded", remaining: rl.remaining, reset_at: rl.resetAt },
      429,
    );
  }

  const body = await c.req.json();
  try {
    const result = await handleChat(c.env.KV, c.env.AI, user.email || `ip:${ip}`, body);
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

// GET /api/snapshot-test?key=<secret> — E2E test of the report git snapshot
// pipeline. Writes reports/{yyyy-mm}/snapshot-test.md to the private archive
// repo (idempotent — same path each run). Returns env-vars-set flags +
// snapshot result so missing PAT vs bad scope vs wrong repo is diagnosable.
//
// Auth: shared-secret header pattern (same as cron worker /trigger). The
// admin-only variant required browser-side Firebase login flow which was
// awkward for a one-off pipeline check.
// GET /api/mcp-debug?key=<secret> — dump last 50 MCP tool invocations
// (uid, tool name, args preview, ok/error). Same shared-secret pattern as
// /api/snapshot-test. Useful when wrangler tail websocket is firewall-
// blocked (the dev box → CF tail-stream connection sometimes ETIMEDOUTs).
//
// DELETE /api/mcp-debug?key=<secret> — clear the ring buffer.
app.get("/api/mcp-debug", async (c) => {
  const key = c.req.query("key");
  if (!c.env.SNAPSHOT_TEST_KEY || key !== c.env.SNAPSHOT_TEST_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const { readMCPDebugLog } = await import("./mcp");
  const log = await readMCPDebugLog(c.env.KV);
  return c.json({ count: log.length, calls: log });
});

// POST /api/research-pipeline/complete?key=<secret> — a→b completion
// callback from the research pipeline engine (ba-spec §7). Phase 1 records
// the terminal state on research_jobs; Phase 3 extends this to run
// createReport (D1/R2/git triple-write) from the delivered markdown.
// Same shared-secret pattern as /api/snapshot-test — the engine is a
// server, not a Firebase user.
app.post("/api/research-pipeline/complete", async (c) => {
  const { handlePipelineComplete } = await import("./research-pipeline");
  const { createReport, notifyTelegramNewReport } = await import("./reports-store");
  const payload = await c.req.json().catch(() => ({}));
  const result = await handlePipelineComplete(
    c.env.REPORTS_DB, c.req.query("key"), c.env.RESEARCH_PIPELINE_KEY, payload,
    async (job, p) => {
      const contract = JSON.parse(job.contract_json || "{}");
      // Topic binding (ba-spec §5): existing topic passes through; a new
      // topic_title is ensured first so pipeline reports never land 未分類.
      let topicId: string | undefined = contract.topic_id || undefined;
      if (!topicId && contract.topic_title) {
        const { ensureTopic } = await import("./reports-store");
        topicId = `topic_rp_${job.session_id.replace(/^rs_/, "")}`;
        await ensureTopic(c.env.REPORTS_DB, {
          id: topicId,
          title: String(contract.topic_title).slice(0, 60),
        } as any).catch(() => { topicId = undefined; });
      }
      const meta = await createReport(
        c.env.REPORTS_DB, c.env.REPORTS_BUCKET,
        {
          title: p.meta?.title ?? String(contract.topic_brief ?? "研究報告").slice(0, 80),
          markdown: p.markdown!,
          tags: ["research-pipeline"],
          region: contract.region,
          summary: p.meta?.summary,
          source_session_id: job.session_id,
          finding_count: p.meta?.finding_count ?? 0,
          status: "published",
          author_uid: job.uid,
          author_email: job.email ?? undefined,
          topic_id: topicId,
          sort_order: typeof contract.sort_order === "number" ? contract.sort_order : 100,
        },
        { REPORTS_REPO: c.env.REPORTS_REPO, REPORTS_GITHUB_PAT: c.env.REPORTS_GITHUB_PAT },
      );
      const publicUrl = `${c.env.CORS_ORIGIN}/reports/${meta.id}`;
      await notifyTelegramNewReport(c.env, meta, publicUrl).catch(() => {});
      return meta.id;
    });
  // blocked/failed deliveries alert the user (ba-spec REQ-A3): the pipeline
  // asks a human only when the gate could not be satisfied.
  if ((result.body as any).status === "failed_recorded" && c.env.TG_BOT_TOKEN && c.env.TG_CHAT_ID) {
    const err = String(payload.error ?? "").slice(0, 300);
    await fetch(`https://api.telegram.org/bot${c.env.TG_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: c.env.TG_CHAT_ID,
        text: `[research-pipeline] 任務 blocked，需人工裁示\nsession: ${payload.session_id}\n原因: ${err}`,
      }),
    }).catch(() => {});
  }
  return c.json(result.body, result.status as 200);
});

// GET /api/research-pipeline/search?key=&q=&limit= — Exa proxy for the
// engine (a-side). Keeps EXA_API_KEY worker-side; the engine authenticates
// with the same pipeline shared secret.
app.get("/api/research-pipeline/search", async (c) => {
  if (!c.env.RESEARCH_PIPELINE_KEY || c.req.query("key") !== c.env.RESEARCH_PIPELINE_KEY) {
    return c.json({ error: "bad key" }, 401);
  }
  const q = c.req.query("q");
  if (!q) return c.json({ error: "q required" }, 400);
  const { handleWebSearch } = await import("./mcp");
  const results = await handleWebSearch(c.env as any, {
    query: q,
    limit: Number(c.req.query("limit") ?? 8),
  });
  return c.json(results);
});

app.delete("/api/mcp-debug", async (c) => {
  const key = c.req.query("key");
  if (!c.env.SNAPSHOT_TEST_KEY || key !== c.env.SNAPSHOT_TEST_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const { clearMCPDebugLog } = await import("./mcp");
  await clearMCPDebugLog(c.env.KV);
  return c.json({ cleared: true });
});

app.get("/api/snapshot-test", async (c) => {
  const key = c.req.query("key");
  if (!c.env.SNAPSHOT_TEST_KEY || key !== c.env.SNAPSHOT_TEST_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const { snapshotReportToGit } = await import("./github-reports");
  const now = Math.floor(Date.now() / 1000);
  const result = await snapshotReportToGit(
    {
      REPORTS_REPO: c.env.REPORTS_REPO,
      REPORTS_GITHUB_PAT: c.env.REPORTS_GITHUB_PAT,
    },
    {
      id: "snapshot-test",
      title: "snapshot pipeline E2E test",
      markdown: `# Snapshot Test\n\nWritten at ${new Date(
        now * 1000,
      ).toISOString()} to verify git snapshot pipeline is wired correctly.\n`,
      createdAt: now,
    },
  );
  return c.json({
    env_vars_set: {
      REPORTS_REPO: !!c.env.REPORTS_REPO,
      REPORTS_GITHUB_PAT: !!c.env.REPORTS_GITHUB_PAT,
    },
    snapshot_result: result,
  });
});

// === REPORTS (v3 — Firebase auth, feature-gated) ===
//
// Auth: routes use the `fbUser` variable populated by getFirebaseUser middleware.
// Bearer token can be either Firebase ID token (web app) or mcp_xxx (claude.ai).
// Feature gates documented in design-reference/v3-upgrade-spec.md.

const requireReportsFeature = (...keys: string[]) =>
  async (c: any, next: any) => {
    const fb = c.get("fbUser");
    if (!fb) return c.json({ error: "Login required" }, 401);
    const ok = fb.features.has("*") || keys.every((k: string) => fb.features.has(k));
    if (!ok) {
      return c.json(
        { error: "Feature access required", required: keys, tier: fb.tier },
        403,
      );
    }
    c.set("user", fb);  // reports.ts handlers expect `user` = FirebaseUser
    await next();
  };

const requireCreateReport = requireReportsFeature("create_report");
const requireViewReports = requireReportsFeature("view_reports");

app.get("/api/reports", requireViewReports, handleListReports);
app.get("/api/reports/:id", requireViewReports, handleGetReport);
app.get("/api/topics", requireViewReports, handleListTopics);
app.get("/api/topics/:id", requireViewReports, handleGetTopic);
app.post("/api/reports", requireCreateReport, handleCreateReport);
app.delete("/api/reports/:id", async (c, next) => {
  const fb = c.get("fbUser");
  if (!fb || fb.email !== c.env.ADMIN_EMAIL) {
    return c.json({ error: "Admin only" }, 403);
  }
  c.set("user", fb);
  await next();
}, handleArchiveReport);

// === MCP TOKEN MANAGEMENT (web UI for self-serve) ===

// POST /api/mcp/issue-token { label? } — gated by use_mcp
app.post(
  "/api/mcp/issue-token",
  requireReportsFeature("use_mcp"),
  handleIssueToken as any,
);
// GET /api/mcp/my-tokens — any logged-in user (just lists their own)
app.get("/api/mcp/my-tokens", async (c, next) => {
  const fb = c.get("fbUser");
  if (!fb || fb.tier === "guest") return c.json({ error: "Login required" }, 401);
  c.set("user", fb);
  await next();
}, handleListTokens as any);
app.post("/api/mcp/revoke-token", async (c, next) => {
  const fb = c.get("fbUser");
  if (!fb || fb.tier === "guest") return c.json({ error: "Login required" }, 401);
  c.set("user", fb);
  await next();
}, handleRevokeToken as any);

// === MCP PROTOCOL ENDPOINTS ===
//
// Auth: must use mcp_xxx token in ?token= or Bearer header. claude.ai's
// connector form takes a single URL → users paste {base}?token={mcp_xxx}.
// The existing /api/* auth middleware reads `token` from query string too,
// so by the time we get here `fbUser` is populated when token is valid.
app.get("/mcp/manifest", async (c, next) => {
  // Manifest is public — returns tool list, no user data
  await next();
}, handleMCPManifest as any);

const mcpAuthMiddleware = async (c: any, next: any) => {
  // /mcp/* paths are NOT covered by /api/* middleware — install our own
  const fbUser = await getFirebaseUser(c.req.raw, c.env).catch(() => null);
  if (fbUser) c.set("user", fbUser);
  await next();
};

app.get("/mcp/sse", mcpAuthMiddleware, handleMCPSSE as any);
app.post("/mcp/sse", mcpAuthMiddleware, handleMCPRPC as any);

// Streamable HTTP transport (2025-03-26 spec) — same handler, no SSE endpoint
// redirect dance. Required by Codex CLI's rmcp client which doesn't understand
// the legacy HTTP+SSE `event: endpoint` handshake. Claude.ai still uses /mcp/sse.
app.post("/mcp", mcpAuthMiddleware, handleMCPRPC as any);
app.get("/mcp", mcpAuthMiddleware, async () => {
  // Streamable HTTP clients may GET to open a notification stream. We don't
  // emit server-initiated notifications, so return an empty SSE that clients
  // can hold open or immediately close.
  return new Response(":\n\n", {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
    },
  });
});

export default app;
