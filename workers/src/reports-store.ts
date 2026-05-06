/**
 * Reports storage layer — D1 metadata + R2 markdown content.
 *
 * Three-write strategy (per design-reference/v3-upgrade-spec.md):
 *   1. D1 row in `reports` table (metadata, queryable)
 *   2. R2 object at `reports/{id}.md` (full markdown content)
 *   3. (Phase 4) Optional git snapshot via worker → GitHub API
 */

export type ReportStatus = "draft" | "published" | "archived";

export interface ReportMeta {
  id: string;
  title: string;
  author_uid: string;
  author_name: string | null;
  author_email: string | null;
  tags: string[];                         // decoded from JSON column
  status: ReportStatus;
  source_session_id: string | null;
  region: string | null;
  category: string | null;
  summary: string | null;
  word_count: number;
  finding_count: number;
  view_count: number;
  created_at: number;
  updated_at: number;
  r2_path: string;
}

export interface CreateReportInput {
  title: string;
  markdown: string;
  tags?: string[];
  region?: string;
  category?: string;
  summary?: string;
  source_session_id?: string;
  finding_count?: number;
  status?: ReportStatus;
  author_uid: string;
  author_name?: string;
  author_email?: string;
}

interface ReportRow {
  id: string;
  title: string;
  author_uid: string;
  author_name: string | null;
  author_email: string | null;
  tags: string | null;
  status: ReportStatus;
  source_session_id: string | null;
  region: string | null;
  category: string | null;
  summary: string | null;
  word_count: number;
  finding_count: number;
  view_count: number;
  created_at: number;
  updated_at: number;
  r2_path: string;
}

function rowToMeta(r: ReportRow): ReportMeta {
  return {
    ...r,
    tags: r.tags ? safeParseTags(r.tags) : [],
  };
}

function safeParseTags(s: string): string[] {
  try {
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

function generateReportId(): string {
  const date = new Date().toISOString().slice(0, 10);
  const rand = crypto.randomUUID().split("-")[0];
  return `rpt_${date}_${rand}`;
}

function countWords(md: string): number {
  // Rough count — works OK for mixed CJK + English. Strips markdown syntax.
  const stripped = md
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[#*_>`\[\]()]/g, "");
  return stripped.length;
}

export async function createReport(
  db: D1Database,
  bucket: R2Bucket,
  input: CreateReportInput,
): Promise<ReportMeta> {
  const id = generateReportId();
  const now = Math.floor(Date.now() / 1000);
  const r2_path = `reports/${id}.md`;
  const word_count = countWords(input.markdown);

  // Write R2 first — if D1 fails we can re-publish; if R2 fails users see a
  // "ghost" row but no content (less bad than orphan content nobody can find).
  await bucket.put(r2_path, input.markdown, {
    httpMetadata: { contentType: "text/markdown; charset=utf-8" },
    customMetadata: {
      author_uid: input.author_uid,
      created_at: String(now),
    },
  });

  await db
    .prepare(
      `INSERT INTO reports (
        id, title, author_uid, author_name, author_email,
        tags, status, source_session_id, region, category, summary,
        word_count, finding_count, view_count, created_at, updated_at, r2_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    )
    .bind(
      id,
      input.title,
      input.author_uid,
      input.author_name ?? null,
      input.author_email ?? null,
      JSON.stringify(input.tags ?? []),
      input.status ?? "published",
      input.source_session_id ?? null,
      input.region ?? null,
      input.category ?? null,
      input.summary ?? null,
      word_count,
      input.finding_count ?? 0,
      now,
      now,
      r2_path,
    )
    .run();

  await db
    .prepare(
      `INSERT INTO reports_audit (report_id, action, actor_uid, actor_email, diff_summary, created_at)
       VALUES (?, 'create', ?, ?, ?, ?)`,
    )
    .bind(id, input.author_uid, input.author_email ?? null, `created (${word_count} chars)`, now)
    .run();

  const meta = await getReportMeta(db, id);
  if (!meta) throw new Error("Report disappeared after insert");
  return meta;
}

export async function getReportMeta(
  db: D1Database,
  id: string,
): Promise<ReportMeta | null> {
  const row = await db
    .prepare(`SELECT * FROM reports WHERE id = ?`)
    .bind(id)
    .first<ReportRow>();
  return row ? rowToMeta(row) : null;
}

export async function getReportContent(
  bucket: R2Bucket,
  r2_path: string,
): Promise<string | null> {
  const obj = await bucket.get(r2_path);
  if (!obj) return null;
  return await obj.text();
}

export async function listReports(
  db: D1Database,
  opts: { limit?: number; offset?: number; status?: ReportStatus; author_uid?: string; category?: string } = {},
): Promise<ReportMeta[]> {
  const limit = Math.min(opts.limit ?? 50, 100);
  const offset = opts.offset ?? 0;

  const where: string[] = [];
  const params: any[] = [];
  if (opts.status) {
    where.push("status = ?");
    params.push(opts.status);
  } else {
    where.push("status != 'archived'");
  }
  if (opts.author_uid) {
    where.push("author_uid = ?");
    params.push(opts.author_uid);
  }
  if (opts.category) {
    where.push("category = ?");
    params.push(opts.category);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const stmt = db
    .prepare(
      `SELECT * FROM reports ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .bind(...params, limit, offset);

  const result = await stmt.all<ReportRow>();
  return (result.results ?? []).map(rowToMeta);
}

export async function incrementViewCount(
  db: D1Database,
  id: string,
): Promise<void> {
  await db
    .prepare(`UPDATE reports SET view_count = view_count + 1 WHERE id = ?`)
    .bind(id)
    .run();
}

export async function archiveReport(
  db: D1Database,
  id: string,
  actor_uid: string,
  actor_email?: string,
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const result = await db
    .prepare(
      `UPDATE reports SET status = 'archived', updated_at = ? WHERE id = ?`,
    )
    .bind(now, id)
    .run();
  if (!result.meta?.changes) return false;
  await db
    .prepare(
      `INSERT INTO reports_audit (report_id, action, actor_uid, actor_email, diff_summary, created_at)
       VALUES (?, 'delete', ?, ?, 'archived', ?)`,
    )
    .bind(id, actor_uid, actor_email ?? null, now)
    .run();
  return true;
}

/**
 * Notify Telegram about a new published report (best-effort, no-op on failure).
 */
export async function notifyTelegramNewReport(
  env: { TG_BOT_TOKEN?: string; TG_CHAT_ID?: string },
  meta: ReportMeta,
  publicUrl: string,
): Promise<void> {
  if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) return;
  const text =
    `📑 新研究報告上架\n\n` +
    `<b>${escapeHtml(meta.title)}</b>\n` +
    (meta.category ? `分類：${escapeHtml(meta.category)}\n` : "") +
    (meta.region ? `地區：${escapeHtml(meta.region)}\n` : "") +
    (meta.author_name ? `作者：${escapeHtml(meta.author_name)}\n` : "") +
    `字數：${meta.word_count} | 引用：${meta.finding_count}\n\n` +
    `${publicUrl}`;
  try {
    await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TG_CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: false,
      }),
    });
  } catch {
    // Best effort — don't fail the request because TG is down.
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
