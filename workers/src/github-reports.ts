/**
 * GitHub snapshot of finalized reports (third pillar of D1 + R2 + git triple-write
 * per design-reference/v3-upgrade-spec.md §報告儲存).
 *
 * Writes `reports/{yyyy-mm}/{id}.md` to a PRIVATE companion repo
 * (ai-cooperation/insurance-kb-reports). The main v2 repo is public, so VIP
 * reports can't live there — this private archive is the source-of-truth
 * backup if D1 corrupts or the CF account is lost.
 *
 * Failure semantics: best-effort. If the git commit fails (PAT missing,
 * GitHub down, etc.) we log and return — the report is still safe in D1+R2.
 * A backfill script can replay missing reports later.
 */

export interface GitSnapshotEnv {
  REPORTS_REPO?: string;            // "ai-cooperation/insurance-kb-reports"
  REPORTS_GITHUB_PAT?: string;      // fine-grained PAT, contents:write
}

interface SnapshotArgs {
  id: string;
  title: string;
  markdown: string;
  createdAt: number;                // unix seconds (for yyyy-mm bucket)
}

/**
 * Commit a finalized report to the private snapshot repo.
 *
 * - No-op when REPORTS_REPO or REPORTS_GITHUB_PAT is unset (e.g. local dev,
 *   PAT-not-yet-provisioned). Logs a warning so it's visible in worker logs
 *   but does not throw — the caller (createReport) must remain robust.
 * - Idempotent: a re-publish of the same id overwrites the file (we fetch
 *   the existing sha first; GitHub's Contents API requires it for updates).
 * - Path: reports/{yyyy-mm}/{id}.md where yyyy-mm derives from createdAt.
 */
export async function snapshotReportToGit(
  env: GitSnapshotEnv,
  args: SnapshotArgs,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const repo = env.REPORTS_REPO;
  const token = env.REPORTS_GITHUB_PAT;
  if (!repo || !token) {
    console.warn(
      `[github-snapshot] skipped (REPORTS_REPO=${!!repo} PAT=${!!token})`,
    );
    return { ok: false, error: "snapshot-disabled" };
  }

  const ym = yyyyMonth(args.createdAt);
  const path = `reports/${ym}/${args.id}.md`;
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${path}`;

  // Idempotent upsert: GitHub requires the existing blob sha when overwriting
  // a file. A 404 means "new file", anything else propagates as an error.
  let sha: string | undefined;
  try {
    const existing = await fetchGitHub(apiUrl, token);
    if (existing.ok) {
      const body = (await existing.json()) as { sha?: string };
      sha = body.sha;
    } else if (existing.status !== 404) {
      const text = await existing.text();
      console.error(
        `[github-snapshot] GET ${path} returned ${existing.status}: ${text.slice(0, 200)}`,
      );
      return { ok: false, error: `get-sha-${existing.status}` };
    }
  } catch (err) {
    console.error(`[github-snapshot] GET failed: ${(err as Error).message}`);
    return { ok: false, error: "get-sha-failed" };
  }

  const payload: Record<string, unknown> = {
    message: `chore: snapshot report ${args.id} — ${truncate(args.title, 60)}`,
    content: utf8ToBase64(args.markdown),
    branch: "main",
  };
  if (sha) payload.sha = sha;

  const put = await fetch(apiUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "insurance-kb-v2-worker",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!put.ok) {
    const text = await put.text();
    console.error(
      `[github-snapshot] PUT ${path} returned ${put.status}: ${text.slice(0, 200)}`,
    );
    return { ok: false, error: `put-${put.status}` };
  }

  const result = (await put.json()) as { content?: { html_url?: string } };
  return { ok: true, url: result.content?.html_url };
}

async function fetchGitHub(url: string, token: string): Promise<Response> {
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "insurance-kb-v2-worker",
    },
  });
}

function yyyyMonth(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${d.getUTCFullYear()}-${m}`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

/**
 * Base64-encode a UTF-8 string. btoa() takes a binary-safe string only —
 * naïvely passing CJK content corrupts on the byte boundary. We encode
 * to bytes first, then walk the byte array (avoid spread on large arrays).
 */
function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
