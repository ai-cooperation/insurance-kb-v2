/**
 * Firebase ID token verification + cooperation-hub Firestore lookup.
 *
 * Adapted from agent-kb/server/src/auth.ts. Used by v3 routes (reports +
 * MCP) which need feature-aware authorization on the worker side.
 *
 * Flow:
 *   1. Frontend obtains Firebase ID token via @cooperation-hub/membership
 *   2. Frontend sends `Authorization: Bearer <id_token>` on API calls
 *   3. This module verifies the JWT (RS256 against Google JWKS)
 *   4. Reads /users/{uid}.memberships['insurance-kb'] + /projects/insurance-kb
 *   5. Computes effective features (tier defaults + per-user override)
 *
 * MCP-issued tokens (mcp_xxx) bypass JWT verify — they're looked up in KV
 * with snapshotted features. See mcp-tokens.ts.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";

import { getFirestoreDoc, type HubFirestoreEnv } from "./hub-firestore";

export type Tier = "guest" | "member" | "vip";

export interface FirebaseUser {
  uid: string;
  email: string;
  name: string;
  picture: string;
  tier: Tier;
  features: Set<string>;
}

export interface FirebaseAuthEnv extends HubFirestoreEnv {
  KB_PROJECT_ID: string;        // "insurance-kb"
  KV: KVNamespace;
}

const HUB_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

const _jwks = createRemoteJWKSet(new URL(HUB_JWKS_URL));

// Guest = unauthenticated. Hardcoded mirror of /projects/insurance-kb
// tiers.guest.features (view_summary + view_card_titles). Kept in sync
// with design-reference/v3-upgrade-spec.md.
const GUEST_USER: FirebaseUser = {
  uid: "",
  email: "",
  name: "",
  picture: "",
  tier: "guest",
  features: new Set(["view_summary", "view_card_titles"]),
};

export async function verifyFirebaseIdToken(
  idToken: string,
  hubProjectId: string,
): Promise<{
  uid: string;
  email: string;
  name: string;
  picture: string;
} | null> {
  try {
    const { payload } = await jwtVerify(idToken, _jwks, {
      issuer: `https://securetoken.google.com/${hubProjectId}`,
      audience: hubProjectId,
    });
    if (!payload.sub || !payload.email) return null;
    return {
      uid: payload.sub,
      email: payload.email as string,
      name: (payload.name as string) || (payload.email as string).split("@")[0],
      picture: (payload.picture as string) || "",
    };
  } catch {
    return null;
  }
}

/**
 * Compute effective features given membership doc + project doc.
 * Mirrors getUserFeatures() in cooperation-hub/packages/membership.
 *
 * Logic:
 *   1. VIP with expired expiresAt → demote to member
 *   2. Start with project.tiers[tier].features
 *   3. Apply per-user features override (true=add, false=remove)
 */
export function computeFeatures(
  membership: any,
  project: any,
): { tier: Tier; features: Set<string> } {
  if (!project?.tiers) {
    return { tier: "guest", features: new Set() };
  }

  if (!membership) {
    const defaultTier: Tier = project.defaultTier ?? "guest";
    const features = new Set<string>(
      project.tiers[defaultTier]?.features ?? [],
    );
    return { tier: defaultTier, features };
  }

  let tier: Tier = membership.tier ?? "member";
  if (
    tier === "vip" &&
    typeof membership.expiresAt === "number" &&
    membership.expiresAt > 0 &&
    membership.expiresAt < Date.now()
  ) {
    tier = "member";
  }

  const features = new Set<string>(project.tiers[tier]?.features ?? []);
  const override = membership.features ?? {};
  for (const [key, val] of Object.entries(override)) {
    if (val === true) features.add(key);
    else if (val === false) features.delete(key);
  }
  return { tier, features };
}

/**
 * Test whether features cover all required. "*" is wildcard (VIP).
 */
export function hasFeatures(
  features: Set<string>,
  required: string[],
): boolean {
  if (features.has("*")) return true;
  return required.every((f) => features.has(f));
}

/**
 * Extract user from Authorization header. Supports two token formats:
 *   1. mcp_xxx → KV lookup, features snapshotted at issue time
 *   2. Firebase ID token → JWT verify + Firestore lookup
 *
 * Token sources tried in order:
 *   - Authorization: Bearer <token> header (web app + curl)
 *   - ?token=<token> query string (claude.ai connector)
 *
 * Returns guest on missing/invalid token.
 */
export async function getFirebaseUser(
  request: Request,
  env: FirebaseAuthEnv,
): Promise<FirebaseUser> {
  let token = "";
  const authHeader = request.headers.get("Authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  } else {
    const url = new URL(request.url);
    token = url.searchParams.get("token") || "";
  }
  if (!token) return GUEST_USER;

  // MCP token path — KV lookup, features snapshotted
  if (token.startsWith("mcp_")) {
    const raw = await env.KV.get(`mcp:token:${token}`);
    if (!raw) return GUEST_USER;
    try {
      const data = JSON.parse(raw) as {
        uid: string;
        email: string;
        name: string;
        picture: string;
        tier: Tier;
        features: string[];
      };
      return {
        uid: data.uid,
        email: data.email,
        name: data.name,
        picture: data.picture,
        tier: data.tier,
        features: new Set(data.features),
      };
    } catch {
      return GUEST_USER;
    }
  }

  // Firebase ID token path
  const verified = await verifyFirebaseIdToken(token, env.HUB_PROJECT_ID);
  if (!verified) return GUEST_USER;

  const [membership, project] = await Promise.all([
    getFirestoreDoc(
      env,
      `users/${verified.uid}/memberships/${env.KB_PROJECT_ID}`,
    ).catch(() => null),
    getFirestoreDoc(env, `projects/${env.KB_PROJECT_ID}`).catch(() => null),
  ]);

  const { tier, features } = computeFeatures(membership, project);
  return {
    uid: verified.uid,
    email: verified.email,
    name: verified.name,
    picture: verified.picture,
    tier,
    features,
  };
}
