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
  topic_id: string | null;                // v3 (2026-05-06)
  sort_order: number;                     // 0 = main report, 10/20/... = chapters
}

export interface TopicMeta {
  id: string;
  title: string;
  summary: string | null;
  icon: string | null;                    // Icon.tsx name; defaults to "book"
  sort_order: number;
  created_at: number;
  updated_at: number;
  report_count?: number;                  // populated by listTopics with count
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
  topic_id?: string;                      // v3: assign to a topic on create
  sort_order?: number;                    // v3: defaults to 100 (after main reports)
}

export interface CreateTopicInput {
  id: string;                             // caller-supplied slug (e.g. "topic_abc")
  title: string;
  summary?: string;
  icon?: string;
  sort_order?: number;
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
  topic_id: string | null;
  sort_order: number;
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
        word_count, finding_count, view_count, created_at, updated_at, r2_path,
        topic_id, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
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
      input.topic_id ?? null,
      input.sort_order ?? 100,
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
  opts: {
    limit?: number;
    offset?: number;
    status?: ReportStatus;
    author_uid?: string;
    category?: string;
    topic_id?: string;
    /** When true, sort by (topic_id ASC, sort_order ASC) instead of created_at. */
    by_topic?: boolean;
  } = {},
): Promise<ReportMeta[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
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
  if (opts.topic_id) {
    where.push("topic_id = ?");
    params.push(opts.topic_id);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const orderSql = opts.by_topic
    ? "ORDER BY topic_id IS NULL, topic_id, sort_order, created_at"
    : "ORDER BY created_at DESC";

  const stmt = db
    .prepare(`SELECT * FROM reports ${whereSql} ${orderSql} LIMIT ? OFFSET ?`)
    .bind(...params, limit, offset);

  const result = await stmt.all<ReportRow>();
  return (result.results ?? []).map(rowToMeta);
}

// ===== Topics =====

interface TopicRow {
  id: string;
  title: string;
  summary: string | null;
  icon: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

/**
 * List all topics with their published-report counts. Topics with 0 reports
 * are still returned (so admins can see empty topics they need to populate).
 */
export async function listTopics(
  db: D1Database,
): Promise<TopicMeta[]> {
  // Order by most-recent activity (latest published report's created_at)
  // DESC, falling back to topic's own created_at when topic has no reports.
  // This makes "active research" float to top of sidebar — user requirement
  // 2026-05-07: 「主議題排序用上架日期，新的在最上面」.
  // sort_order field on report_topics is now ignored for top-level ordering;
  // it still controls report ordering WITHIN a topic.
  const result = await db
    .prepare(
      `SELECT t.*,
              (SELECT count(*)
                 FROM reports r
                WHERE r.topic_id = t.id AND r.status != 'archived'
              ) AS report_count,
              (SELECT MAX(r.created_at)
                 FROM reports r
                WHERE r.topic_id = t.id AND r.status != 'archived'
              ) AS last_report_at
         FROM report_topics t
        ORDER BY COALESCE(last_report_at, t.created_at) DESC`,
    )
    .all<TopicRow & { report_count: number; last_report_at: number | null }>();
  return (result.results ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    icon: r.icon,
    sort_order: r.sort_order,
    created_at: r.created_at,
    updated_at: r.updated_at,
    report_count: r.report_count,
  }));
}

export async function getTopic(
  db: D1Database,
  id: string,
): Promise<TopicMeta | null> {
  const row = await db
    .prepare(`SELECT * FROM report_topics WHERE id = ?`)
    .bind(id)
    .first<TopicRow>();
  return row;
}

/**
 * Find existing topics whose title / id / summary matches the given seed.
 *
 * Used by start_research_session to suggest binding to an existing topic
 * (so user doesn't have to remember topic_id slugs across chat sessions).
 *
 * Strategy: simple keyword overlap (CJK + English tokens). Each candidate
 * topic gets a score = number of overlapping tokens. Returns top N with
 * score > 0, ordered by score desc.
 *
 * For real-world topic counts (< 50) this is fine; if catalog grows past
 * a few hundred topics we'd want to revisit (precompute index, etc).
 */
export async function findSimilarTopics(
  db: D1Database,
  seed: string,
  limit = 3,
): Promise<Array<{ topic: TopicMeta; score: number; matched_tokens: string[] }>> {
  const tokens = tokenize(seed);
  if (tokens.length === 0) return [];

  const all = await listTopics(db);
  const scored: Array<{ topic: TopicMeta; score: number; matched_tokens: string[] }> = [];
  for (const t of all) {
    const corpus = `${t.id} ${t.title} ${t.summary ?? ""}`.toLowerCase();
    const matched: string[] = [];
    for (const tok of tokens) {
      if (corpus.includes(tok)) matched.push(tok);
    }
    if (matched.length > 0) {
      scored.push({ topic: t, score: matched.length, matched_tokens: matched });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/** Tokenize for keyword overlap. Handles mixed CJK + Latin. */
function tokenize(s: string): string[] {
  const lower = s.toLowerCase();
  const tokens = new Set<string>();
  // English/digit tokens (>= 2 chars, common stop-words excluded)
  const stop = new Set(["the", "a", "an", "and", "or", "of", "in", "for", "to", "on", "with", "by", "is", "as", "vs"]);
  for (const m of lower.matchAll(/[a-z0-9]{2,}/g)) {
    if (!stop.has(m[0])) tokens.add(m[0]);
  }
  // CJK: take 2-character substrings as proxies for word-level match
  // (Chinese tokenization without dict — bigram works for keyword overlap)
  const cjk = lower.replace(/[^一-鿿]/g, " ").split(/\s+/).filter(Boolean);
  for (const seg of cjk) {
    if (seg.length === 1) {
      tokens.add(seg);
    } else {
      for (let i = 0; i + 2 <= seg.length; i++) {
        tokens.add(seg.slice(i, i + 2));
      }
    }
  }
  return [...tokens];
}

/**
 * Get a topic's progress: completed reports + suggested next sort_order.
 *
 * Used by `list_topic_progress` MCP tool — chat in a fresh session can
 * quickly see what's already done and what to do next, without user
 * having to remember details across sessions.
 */
export async function getTopicProgress(
  db: D1Database,
  topic_id: string,
): Promise<{
  topic: TopicMeta | null;
  completed: Array<{ report_id: string; title: string; sort_order: number; created_at: number }>;
  used_sort_orders: number[];
  next_recommended_sort_order: number;
  has_main_report: boolean;     // sort_order=0 done?
} | null> {
  const topic = await getTopic(db, topic_id);
  if (!topic) return null;

  const reports = await listReports(db, { topic_id, by_topic: true, limit: 200 });
  const completed = reports.map((r) => ({
    report_id: r.id,
    title: r.title,
    sort_order: r.sort_order,
    created_at: r.created_at,
  }));
  const used = completed.map((r) => r.sort_order).sort((a, b) => a - b);

  // Suggest next chapter slot: max non-zero + 10. Skip 0 (reserved for main).
  const chapterSlots = used.filter((n) => n > 0);
  const next = chapterSlots.length > 0 ? Math.max(...chapterSlots) + 10 : 10;
  const hasMain = used.includes(0);

  return {
    topic,
    completed,
    used_sort_orders: used,
    next_recommended_sort_order: next,
    has_main_report: hasMain,
  };
}

/**
 * Create a topic. Caller chooses the id (slug-like). Idempotent — INSERT OR
 * IGNORE so MCP create_report can safely "ensure" a topic without erroring
 * if it already exists.
 */
export async function ensureTopic(
  db: D1Database,
  input: CreateTopicInput,
): Promise<TopicMeta> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT OR IGNORE INTO report_topics (id, title, summary, icon, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.title,
      input.summary ?? null,
      input.icon ?? "book",
      input.sort_order ?? 100,
      now,
      now,
    )
    .run();
  const got = await getTopic(db, input.id);
  if (!got) throw new Error(`Topic ${input.id} disappeared after ensureTopic`);
  return got;
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
