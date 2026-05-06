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
  ensureTopic,
  getReportContent,
  getReportMeta,
  getTopic,
  incrementViewCount,
  listReports,
  listTopics,
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
  const limit = Math.min(parseInt(c.req.query("limit") || "200", 10), 200);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const category = c.req.query("category") || undefined;
  const topic_id = c.req.query("topic_id") || undefined;
  const by_topic = c.req.query("by_topic") === "1";
  const reports = await listReports(c.env.REPORTS_DB, {
    limit,
    offset,
    category,
    topic_id,
    by_topic,
  });
  return c.json({ reports, count: reports.length });
}

export async function handleListTopics(c: Ctx) {
  const topics = await listTopics(c.env.REPORTS_DB);
  return c.json({ topics, count: topics.length });
}

export async function handleGetTopic(c: Ctx) {
  const id = c.req.param("id") as string;
  const topic = await getTopic(c.env.REPORTS_DB, id);
  if (!topic) return c.json({ error: "Topic not found" }, 404);
  const reports = await listReports(c.env.REPORTS_DB, {
    topic_id: id,
    by_topic: true,
    limit: 200,
  });
  return c.json({ topic, reports });
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
    topic_id?: string;
    topic_title?: string;       // if topic_id doesn't exist, auto-create with this title
    topic_summary?: string;
    sort_order?: number;
  }>();

  if (!body.title || body.title.trim().length === 0) {
    return c.json({ error: "title required" }, 400);
  }
  if (!body.markdown || body.markdown.trim().length < 50) {
    return c.json({ error: "markdown content too short (min 50 chars)" }, 400);
  }

  // If topic_id given, ensure topic exists (auto-create if topic_title given).
  if (body.topic_id) {
    const existing = await getTopic(c.env.REPORTS_DB, body.topic_id);
    if (!existing) {
      if (!body.topic_title) {
        return c.json(
          {
            error: "topic_id does not exist; provide topic_title to auto-create",
            hint: "list existing topics via GET /api/topics",
          },
          400,
        );
      }
      await ensureTopic(c.env.REPORTS_DB, {
        id: body.topic_id,
        title: body.topic_title,
        summary: body.topic_summary,
      });
    }
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
    topic_id: body.topic_id,
    sort_order: body.sort_order,
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
