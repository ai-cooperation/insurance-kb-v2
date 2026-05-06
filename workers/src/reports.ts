/**
 * Reports route handlers — feature-gated CRUD over D1 + R2.
 *
 * Routes mounted in index.ts:
 *   GET    /api/reports                 — list, gated by view_reports
 *   GET    /api/reports/:id             — detail (meta + content), gated by view_reports
 *   POST   /api/reports                 — create (admin / VIP via web), gated by create_report
 *   DELETE /api/reports/:id             — archive (admin only)
 */

import type { Context } from "hono";

import type { FirebaseUser } from "./auth-firebase";
import {
  archiveReport,
  createReport,
  getReportContent,
  getReportMeta,
  incrementViewCount,
  listReports,
  notifyTelegramNewReport,
  type CreateReportInput,
} from "./reports-store";

// Loose Ctx — index.ts middleware guarantees `user` is FirebaseUser by the
// time these handlers run (it does c.set("user", fbUser) before next()).
type Ctx = Context<any, any, any>;

function getUser(c: Ctx): FirebaseUser {
  return c.get("user") as FirebaseUser;
}

export async function handleListReports(c: Ctx) {
  const limit = Math.min(parseInt(c.req.query("limit") || "30", 10), 100);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const category = c.req.query("category") || undefined;
  const reports = await listReports(c.env.REPORTS_DB, { limit, offset, category });
  return c.json({ reports, count: reports.length });
}

export async function handleGetReport(c: Ctx) {
  const id = c.req.param("id") as string;
  const meta = await getReportMeta(c.env.REPORTS_DB, id);
  if (!meta || meta.status === "archived") {
    return c.json({ error: "Not found" }, 404);
  }
  const content = await getReportContent(c.env.REPORTS_BUCKET, meta.r2_path);
  if (content === null) {
    return c.json({ error: "Content missing — please contact admin" }, 500);
  }
  // Best-effort view count increment (don't block response)
  c.executionCtx.waitUntil(incrementViewCount(c.env.REPORTS_DB, id));
  return c.json({ meta, content });
}

export async function handleCreateReport(c: Ctx) {
  const user = getUser(c);
  const body = await c.req.json<{
    title?: string;
    markdown?: string;
    tags?: string[];
    region?: string;
    category?: string;
    summary?: string;
    source_session_id?: string;
    finding_count?: number;
  }>();

  if (!body.title || body.title.trim().length === 0) {
    return c.json({ error: "title required" }, 400);
  }
  if (!body.markdown || body.markdown.trim().length < 50) {
    return c.json({ error: "markdown content too short (min 50 chars)" }, 400);
  }

  const input: CreateReportInput = {
    title: body.title.trim(),
    markdown: body.markdown,
    tags: body.tags ?? [],
    region: body.region,
    category: body.category,
    summary: body.summary,
    source_session_id: body.source_session_id,
    finding_count: body.finding_count ?? 0,
    status: "published",
    author_uid: user.uid,
    author_name: user.name,
    author_email: user.email,
  };

  const meta = await createReport(c.env.REPORTS_DB, c.env.REPORTS_BUCKET, input);

  // Best-effort TG notify (won't block / fail)
  const publicUrl = `${c.env.CORS_ORIGIN}/reports/${meta.id}`;
  c.executionCtx.waitUntil(
    notifyTelegramNewReport(
      { TG_BOT_TOKEN: c.env.TG_BOT_TOKEN, TG_CHAT_ID: c.env.TG_CHAT_ID },
      meta,
      publicUrl,
    ),
  );

  return c.json({ meta, url: publicUrl }, 201);
}

export async function handleArchiveReport(c: Ctx) {
  const user = getUser(c);
  const id = c.req.param("id") as string;
  const ok = await archiveReport(c.env.REPORTS_DB, id, user.uid, user.email);
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.json({ archived: id });
}

// Re-exported for convenience but index.ts has its own inline guard since
// TypeScript ergonomics around Hono middleware + variable typing are awkward.
export const reportsRouteGuards = {};
