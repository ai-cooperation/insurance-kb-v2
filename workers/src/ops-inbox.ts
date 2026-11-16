// ops-inbox client — operational events go to GitHub Issues in
// ai-cooperation/ops-inbox instead of Telegram (2026-11-16).
// Contract: https://github.com/ai-cooperation/ops-inbox#readme
// Same title + still-open issue => append a comment, so keep titles stable
// when the event can recur. Secret: OPS_INBOX_TOKEN (wrangler secret put).

const REPO = "ai-cooperation/ops-inbox";
const SOURCE = "insurance-kb-v2";
const MENTION = "AlanChen75";

export type OpsSeverity = "critical" | "warn" | "info";
export interface OpsInboxEnv {
  OPS_INBOX_TOKEN?: string;
}
export interface OpsNotifyResult {
  ok: boolean;
  action?: string;
  error?: string;
}

async function gh<T>(env: OpsInboxEnv, method: string, path: string, payload?: unknown): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.OPS_INBOX_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "insurance-kb-v2-worker",
      "Content-Type": "application/json",
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`ops-inbox HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/**
 * Never throws — a notification must not fail the request — but never
 * silent either: every non-delivery is logged and returned as ok:false.
 */
export async function opsNotify(
  env: OpsInboxEnv,
  severity: OpsSeverity,
  title: string,
  body = "",
): Promise<OpsNotifyResult> {
  if (!env.OPS_INBOX_TOKEN) {
    console.error("opsNotify: OPS_INBOX_TOKEN not set — event NOT delivered:", title);
    return { ok: false, error: "OPS_INBOX_TOKEN not set" };
  }
  if (!title.trim()) return { ok: false, error: "empty title" };
  const stamp = `\n\n---\nworker · ${new Date().toISOString()}`;
  try {
    const query = new URLSearchParams({ state: "open", labels: `src:${SOURCE}`, per_page: "100" });
    const open = await gh<Array<{ number: number; title: string; pull_request?: unknown }>>(
      env, "GET", `/repos/${REPO}/issues?${query}`,
    );
    const hit = open.find((i) => !i.pull_request && i.title === title);
    if (hit) {
      await gh(env, "POST", `/repos/${REPO}/issues/${hit.number}/comments`, {
        body: `再次發生（${severity}）\n\n${body}${stamp}`,
      });
      return { ok: true, action: `commented #${hit.number}` };
    }
    const mention = severity === "critical" ? `@${MENTION} ` : "";
    const created = await gh<{ number: number }>(env, "POST", `/repos/${REPO}/issues`, {
      title: title.slice(0, 250),
      body: `${mention}${body.slice(0, 60000)}${stamp}`,
      labels: [`sev:${severity}`, `src:${SOURCE}`],
    });
    return { ok: true, action: `created #${created.number}` };
  } catch (err) {
    console.error("opsNotify failed — event NOT delivered:", title, err);
    return { ok: false, error: String(err) };
  }
}
