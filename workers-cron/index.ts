/**
 * Cloudflare Worker Cron Trigger for Insurance KB Crawl.
 * Fires at 00:30 and 12:30 UTC → triggers GitHub Actions workflow.
 * More reliable than GitHub's built-in cron scheduler.
 */

interface Env {
  GITHUB_PAT: string;
  REPO: string;
  WORKFLOW: string;
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
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

    if (resp.ok) {
      console.log(`Triggered ${env.WORKFLOW} at ${new Date().toISOString()}`);
    } else {
      console.error(`Failed to trigger: ${resp.status} ${await resp.text()}`);
    }
  },

  async fetch(request: Request, env: Env) {
    return new Response(JSON.stringify({
      service: "insurance-kb-cron",
      next_triggers: ["00:30 UTC (08:30 UTC+8)", "12:30 UTC (20:30 UTC+8)"],
      repo: env.REPO,
    }), { headers: { "Content-Type": "application/json" } });
  },
};
