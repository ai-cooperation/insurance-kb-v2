/**
 * MCP long-lived token issuance + revoke + listing.
 *
 * Adapted from agent-kb/server/src/mcp-tokens.ts. Identical token model:
 * 90-day Bearer token, max 5 per user, embed in claude.ai connector URL.
 *
 * Insurance KB v3 specifics:
 * - Gated by `use_mcp` feature (admin-grant only; not in member tier defaults).
 * - Token snapshots `features` at issue time → revoke + reissue when admin
 *   updates user's permissions.
 */

import type { Context } from "hono";

import type { FirebaseUser } from "./auth-firebase";

interface Bindings {
  KV: KVNamespace;
  CORS_ORIGIN: string;
  MCP_PUBLIC_URL?: string;
}

export interface McpTokenData {
  uid: string;
  email: string;
  name: string;
  picture: string;
  tier: "guest" | "member" | "vip";
  features: string[]; // snapshot at issue time
  issued_at: number;  // unix seconds
  expires_at: number;
  label: string;
}

const TOKEN_TTL_SECONDS = 90 * 24 * 3600;
const PER_USER_TOKEN_LIMIT = 5;

function generateToken(): string {
  return "mcp_" + crypto.randomUUID().replace(/-/g, "");
}

function deriveMcpUrl(c: Context): string {
  const explicit = (c.env as any).MCP_PUBLIC_URL as string | undefined;
  if (explicit) return explicit;
  const host = c.req.header("host") || "insurance-kb-api.workers.dev";
  return `https://${host}/mcp/sse`;
}

type Ctx = Context<{ Bindings: Bindings; Variables: { user: FirebaseUser } }>;

export async function handleIssueToken(c: Ctx) {
  const user = c.get("user");

  const idxKey = `mcp:user-tokens:${user.uid}`;
  const existing: Array<{ token: string; label: string; expires_at: number }> = JSON.parse(
    (await c.env.KV.get(idxKey)) || "[]",
  );
  const now = Math.floor(Date.now() / 1000);
  const live = existing.filter((t) => t.expires_at > now);
  if (live.length >= PER_USER_TOKEN_LIMIT) {
    return c.json(
      {
        error: `每人最多 ${PER_USER_TOKEN_LIMIT} 個 token。請先撤銷舊的再產新的。`,
        active_count: live.length,
      },
      400,
    );
  }

  const body = await c.req.json().catch(() => ({}));
  const label: string = (body.label || "未命名").slice(0, 40);

  const token = generateToken();
  const expiresAt = now + TOKEN_TTL_SECONDS;

  const tokenData: McpTokenData = {
    uid: user.uid,
    email: user.email,
    name: user.name,
    picture: user.picture,
    tier: user.tier,
    features: Array.from(user.features),
    issued_at: now,
    expires_at: expiresAt,
    label,
  };

  await c.env.KV.put(`mcp:token:${token}`, JSON.stringify(tokenData), {
    expirationTtl: TOKEN_TTL_SECONDS,
  });

  live.push({ token, label, expires_at: expiresAt });
  await c.env.KV.put(idxKey, JSON.stringify(live));

  const baseUrl = deriveMcpUrl(c);
  // Embed token in URL — claude.ai connector form has no separate Bearer field.
  const connectorUrl = `${baseUrl}?token=${token}`;

  return c.json({
    token,
    base_url: baseUrl,
    connector_url: connectorUrl,
    label,
    issued_at: now,
    expires_at: expiresAt,
    features: tokenData.features,
  });
}

export async function handleListTokens(c: Ctx) {
  const user = c.get("user");
  const idxKey = `mcp:user-tokens:${user.uid}`;
  const list: Array<{ token: string; label: string; expires_at: number }> = JSON.parse(
    (await c.env.KV.get(idxKey)) || "[]",
  );
  const now = Math.floor(Date.now() / 1000);
  const live = list.filter((t) => t.expires_at > now);

  if (live.length !== list.length) {
    await c.env.KV.put(idxKey, JSON.stringify(live));
  }

  return c.json({
    tokens: live.map((t) => ({
      token_preview: `${t.token.slice(0, 8)}…${t.token.slice(-4)}`,
      token_id: t.token,
      label: t.label,
      expires_at: t.expires_at,
    })),
    url: deriveMcpUrl(c),
  });
}

export async function handleRevokeToken(c: Ctx) {
  const user = c.get("user");
  const { token } = await c.req.json();
  if (!token || typeof token !== "string") {
    return c.json({ error: "token required" }, 400);
  }

  const tokenDataRaw = await c.env.KV.get(`mcp:token:${token}`);
  if (!tokenDataRaw) {
    const idxKey = `mcp:user-tokens:${user.uid}`;
    const list: Array<{ token: string }> = JSON.parse((await c.env.KV.get(idxKey)) || "[]");
    const filtered = list.filter((t) => t.token !== token);
    if (filtered.length !== list.length) {
      await c.env.KV.put(idxKey, JSON.stringify(filtered));
    }
    return c.json({ revoked: token, note: "already expired" });
  }

  const data: McpTokenData = JSON.parse(tokenDataRaw);
  if (data.uid !== user.uid) {
    return c.json({ error: "Not your token" }, 403);
  }

  await c.env.KV.delete(`mcp:token:${token}`);
  const idxKey = `mcp:user-tokens:${user.uid}`;
  const list: Array<{ token: string }> = JSON.parse((await c.env.KV.get(idxKey)) || "[]");
  const filtered = list.filter((t) => t.token !== token);
  await c.env.KV.put(idxKey, JSON.stringify(filtered));

  return c.json({ revoked: token });
}
