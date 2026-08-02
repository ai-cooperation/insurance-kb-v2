/**
 * b→a research pipeline handoff (research-pipeline-ba-spec §7/§8/§17).
 *
 * b-side owns: contract assembly from the KV grill session, the D1
 * research_jobs state machine, submit (server-to-server POST to the engine)
 * and status polling. The full contract never travels through chat tool
 * args (§12.3) — submit takes only session_id, everything else is read
 * server-side.
 *
 * Engine = ac-2012 paper-job-service, insurance lane (DomainPack
 * "insurance", lane_version 1). See BUILD_SPEC_BWORKER.md for the HTTP
 * surface this client speaks.
 */
import type { SessionState } from "./research-session";

export const LANE_VERSION = "1";

/** Session statuses that mean "grill converged, contract is submittable"
 *  (§17.1 REQ-B4 — the mechanical gate; chat discipline is only layer 1). */
const SUBMITTABLE_STATUSES: SessionState["status"][] = ["scope_confirmed", "drafting"];

export interface ResearchJobRow {
  session_id: string;
  uid: string;
  email: string | null;
  task_type: string;
  status: "ready" | "pending_sync" | "submitted" | "running" | "completed" | "failed";
  engine_job_id: string | null;
  report_id: string | null;
  contract_json: string;
  error: string | null;
  created_at: number;
  updated_at: number;
}

/** Thrown when the session is not in a submittable state — mapped to a
 *  409-shaped MCP error so chat cannot trigger a premature submit. */
export class NotSubmittableError extends Error {
  readonly code = 409;
  constructor(message: string) {
    super(message);
    this.name = "NotSubmittableError";
  }
}

// ── contract assembly (pure; INV-5: no data values, flags only) ──────────────
export function buildContract(state: SessionState): Record<string, unknown> {
  const decisions = state.scope_decisions ?? {};
  return {
    task_type: "insurance_research",
    domain: "insurance",           // engine _pack_for routes on this
    lane_version: LANE_VERSION,    // INV-1: engine rejects a missing/驟變 version
    topic_brief: state.topic_seed,
    scope_decisions: decisions,
    topic_id: state.topic_id ?? null,
    topic_title: state.topic_title ?? null,
    sort_order: state.sort_order ?? null,
    session_id: state.session_id,
    author_uid: state.uid,
    author_email: state.email,
    submitted_at: Math.floor(Date.now() / 1000),
  };
}

// ── D1 helpers ───────────────────────────────────────────────────────────────
async function getJob(db: D1Database, sessionId: string): Promise<ResearchJobRow | null> {
  const row = await db
    .prepare("SELECT * FROM research_jobs WHERE session_id = ?")
    .bind(sessionId)
    .first<ResearchJobRow>();
  return row ?? null;
}

async function setJobStatus(
  db: D1Database,
  sessionId: string,
  status: ResearchJobRow["status"],
  fields: Partial<Pick<ResearchJobRow, "engine_job_id" | "report_id" | "error">> = {},
): Promise<void> {
  await db
    .prepare(
      "UPDATE research_jobs SET status = ?, engine_job_id = COALESCE(?, engine_job_id), " +
      "report_id = COALESCE(?, report_id), error = ?, updated_at = ? WHERE session_id = ?",
    )
    .bind(status, fields.engine_job_id ?? null, fields.report_id ?? null,
          fields.error ?? null, Math.floor(Date.now() / 1000), sessionId)
    .run();
}

// ── submit (REQ-B3 idempotent, REQ-B4 state gate) ────────────────────────────
export async function submitToResearchPipeline(
  db: D1Database,
  kv: KVNamespace,
  engineUrl: string,
  user: { uid: string; email: string },
  sessionId: string,
): Promise<Record<string, unknown>> {
  const raw = await kv.get(`research_session:${user.uid}:${sessionId}`);
  if (!raw) {
    throw new NotSubmittableError(`session ${sessionId} not found (expired or wrong id)`);
  }
  const state = JSON.parse(raw) as SessionState;

  if (!SUBMITTABLE_STATUSES.includes(state.status)) {
    throw new NotSubmittableError(
      `session status is "${state.status}" — submit requires grill 收斂完成 ` +
      `(${SUBMITTABLE_STATUSES.join("/")}). 請先完成 confirm_scope。`,
    );
  }

  // Idempotency (REQ-B3): a session already handed off returns its job
  // instead of double-triggering the engine.
  const existing = await getJob(db, sessionId);
  if (existing && existing.engine_job_id) {
    return {
      status: "already_submitted",
      job_status: existing.status,
      engine_job_id: existing.engine_job_id,
      hint: "用 check_research_job 查進度",
    };
  }

  const contract = buildContract(state);
  const now = Math.floor(Date.now() / 1000);
  if (!existing) {
    await db
      .prepare(
        "INSERT INTO research_jobs (session_id, uid, email, task_type, status, " +
        "contract_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending_sync', ?, ?, ?)",
      )
      .bind(sessionId, user.uid, user.email, "insurance_research",
            JSON.stringify(contract), now, now)
      .run();
  } else {
    await setJobStatus(db, sessionId, "pending_sync");
  }

  const resp = await fetch(`${engineUrl}/v2/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `insurance:${sessionId}`,
    },
    body: JSON.stringify(contract),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    await setJobStatus(db, sessionId, "failed", {
      error: `engine ${resp.status}: ${detail.slice(0, 300)}`,
    });
    throw new Error(`research pipeline submit failed (engine ${resp.status}) — ` +
      `job 標 failed，可重新 submit 重試`);
  }
  const body = (await resp.json()) as { job_id: string; status: string };
  await setJobStatus(db, sessionId, "submitted", { engine_job_id: body.job_id });

  return {
    status: "submitted",
    engine_job_id: body.job_id,
    engine_status: body.status,
    hint: "後端 pipeline 已接手，完成會通知；用 check_research_job 查進度",
  };
}

// ── poll ─────────────────────────────────────────────────────────────────────
export async function checkResearchJob(
  db: D1Database,
  engineUrl: string,
  user: { uid: string },
  sessionId: string,
): Promise<Record<string, unknown>> {
  const job = await getJob(db, sessionId);
  if (!job || job.uid !== user.uid) {
    return { error: `no research job for session ${sessionId}` };
  }
  if (!job.engine_job_id || job.status === "completed" || job.status === "failed") {
    return { job_status: job.status, report_id: job.report_id, error: job.error };
  }

  const resp = await fetch(`${engineUrl}/v2/jobs/${job.engine_job_id}/status`);
  if (!resp.ok) {
    return { job_status: job.status, engine_unreachable: true, engine_http: resp.status };
  }
  const engine = (await resp.json()) as Record<string, unknown>;
  const runStatus = String(
    (engine as { run_status?: string }).run_status ?? engine["status"] ?? "unknown",
  );
  if (runStatus === "running" && job.status !== "running") {
    await setJobStatus(db, sessionId, "running");
  }
  if (runStatus === "failed") {
    await setJobStatus(db, sessionId, "failed", { error: "engine run failed" });
  }
  return { job_status: runStatus === "unknown" ? job.status : runStatus, engine };
}

// ── a→b completion callback (REQ-P1 idempotent; secret-key pattern) ──────────
export interface CompletePayload {
  job_id?: string;
  session_id?: string;
  report_id?: string;
  error?: string;
  /** Phase 3: delivered report body + meta — when present (and no error),
   *  the publish callback runs createReport and returns the new report_id. */
  markdown?: string;
  meta?: { title?: string; summary?: string; finding_count?: number };
}

export async function handlePipelineComplete(
  db: D1Database,
  providedKey: string | undefined,
  expectedKey: string | undefined,
  payload: CompletePayload,
  publish?: (job: ResearchJobRow, payload: CompletePayload) => Promise<string>,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  if (!expectedKey || providedKey !== expectedKey) {
    return { ok: false, status: 401, body: { error: "bad key" } };
  }
  const sessionId = payload.session_id;
  if (!sessionId) {
    return { ok: false, status: 400, body: { error: "session_id required" } };
  }
  const job = await getJob(db, sessionId);
  if (!job) {
    return { ok: false, status: 404, body: { error: `no job for session ${sessionId}` } };
  }
  // Idempotency (REQ-P1): a completed job never re-completes.
  if (job.status === "completed" && job.report_id) {
    return { ok: true, status: 200, body: { status: "already_completed", report_id: job.report_id } };
  }
  if (payload.error) {
    await setJobStatus(db, sessionId, "failed", { error: payload.error.slice(0, 500) });
    return { ok: true, status: 200, body: { status: "failed_recorded" } };
  }
  let reportId = payload.report_id ?? null;
  if (!reportId && payload.markdown && publish) {
    try {
      reportId = await publish(job, payload);
    } catch (e: any) {
      await setJobStatus(db, sessionId, "failed", {
        error: `publish failed: ${String(e?.message || e).slice(0, 400)}`,
      });
      return { ok: false, status: 500, body: { error: "publish failed" } };
    }
  }
  await setJobStatus(db, sessionId, "completed", { report_id: reportId });
  return { ok: true, status: 200, body: { status: "completed", report_id: reportId } };
}
