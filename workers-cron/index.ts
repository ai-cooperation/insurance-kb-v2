/**
 * Cloudflare Worker Cron Trigger for Insurance KB Crawl.
 * - scheduled(): fires at 00:30 / 12:30 UTC, triggers GitHub Actions workflow
 * - fetch(): GET / returns metadata; POST /trigger?key=<secret> manually fires
 *   the same workflow_dispatch (PAT never leaves the worker; external callers
 *   authenticate with TRIGGER_SECRET, not the GitHub PAT).
 */

interface Env {
  GITHUB_PAT: string;
  TRIGGER_SECRET: string;
  REPO: string;
  WORKFLOW: string;
}

async function triggerWorkflow(env: Env): Promise<{ ok: boolean; status: number; text: string }> {
  const url = `https://api.github.com/repos/${env.REPO}/actions/workflows/${env.WORKFLOW}/dispatches`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.GITHUB_PAT}`,
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "insurance-kb-cron",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  return {
    ok: resp.ok,
    status: resp.status,
    text: resp.ok ? "" : await resp.text(),
  };
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const result = await triggerWorkflow(env);
    if (result.ok) {
      console.log(`Triggered ${env.WORKFLOW} at ${new Date().toISOString()}`);
    } else {
      console.error(`Failed to trigger: ${result.status} ${result.text}`);
    }
  },

  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (url.pathname === "/trigger" && request.method === "POST") {
      const key = url.searchParams.get("key");
      if (!env.TRIGGER_SECRET || key !== env.TRIGGER_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }
      const result = await triggerWorkflow(env);
      if (result.ok) {
        return new Response(
          JSON.stringify({
            triggered: true,
            workflow: env.WORKFLOW,
            ts: new Date().toISOString(),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          triggered: false,
          status: result.status,
          error: result.text,
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        service: "insurance-kb-cron",
        next_triggers: ["00:30 UTC (08:30 UTC+8)", "12:30 UTC (20:30 UTC+8)"],
        repo: env.REPO,
        manual_trigger: "POST /trigger?key=<secret>",
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  },
};
