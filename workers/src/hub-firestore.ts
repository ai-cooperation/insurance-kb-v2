/**
 * Cooperation-hub Firestore client for Cloudflare Workers.
 *
 * Workers can't run firebase-admin (Node-only). Two pieces:
 *   1. Service account JWT signing (RS256) → exchange for OAuth2 access token
 *   2. Firestore REST API calls with that token
 *
 * Token cached in memory for ~50 min (Google access tokens are 1h TTL).
 */

import { importPKCS8, SignJWT } from "jose";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FIRESTORE_BASE =
  "https://firestore.googleapis.com/v1/projects";
const SCOPE = "https://www.googleapis.com/auth/datastore";
const ALG = "RS256";

interface AccessTokenCache {
  token: string;
  expiresAt: number;
}

let _accessTokenCache: AccessTokenCache | null = null;

export interface HubFirestoreEnv {
  FIREBASE_ADMIN_EMAIL: string;
  FIREBASE_ADMIN_KEY: string; // PEM private key, \n preserved or as literal \\n
  HUB_PROJECT_ID: string; // cooperation-hub-bfe79
}

/**
 * Sign a JWT with the service account private key + exchange for OAuth2
 * access token. Token is cached in memory for the worker instance lifetime.
 */
export async function getServiceAccountAccessToken(
  env: HubFirestoreEnv,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  if (_accessTokenCache && _accessTokenCache.expiresAt > now + 60) {
    return _accessTokenCache.token;
  }

  const pem = env.FIREBASE_ADMIN_KEY.replace(/\\n/g, "\n");
  const privateKey = await importPKCS8(pem, ALG);

  const assertion = await new SignJWT({
    scope: SCOPE,
  })
    .setProtectedHeader({ alg: ALG, typ: "JWT" })
    .setIssuer(env.FIREBASE_ADMIN_EMAIL)
    .setSubject(env.FIREBASE_ADMIN_EMAIL)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`SA token exchange failed: ${resp.status} ${body}`);
  }

  const data = (await resp.json()) as {
    access_token: string;
    expires_in: number;
  };

  _accessTokenCache = {
    token: data.access_token,
    expiresAt: now + data.expires_in,
  };
  return data.access_token;
}

/**
 * Convert Firestore proto JSON to a plain object.
 * https://firebase.google.com/docs/firestore/reference/rest/v1/Value
 */
export function decodeFirestoreValue(value: any): any {
  if (value == null) return null;
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return new Date(value.timestampValue).getTime();
  if ("arrayValue" in value) {
    return (value.arrayValue.values ?? []).map(decodeFirestoreValue);
  }
  if ("mapValue" in value) {
    const fields = value.mapValue.fields ?? {};
    return Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, decodeFirestoreValue(v)]),
    );
  }
  return null;
}

export function decodeFirestoreDoc(doc: any): Record<string, any> | null {
  if (!doc || !doc.fields) return null;
  return Object.fromEntries(
    Object.entries(doc.fields).map(([k, v]) => [k, decodeFirestoreValue(v)]),
  );
}

/**
 * Read a single Firestore doc using the service account token.
 * Returns null if 404 or any error (callers treat as guest).
 */
export async function getFirestoreDoc(
  env: HubFirestoreEnv,
  docPath: string, // e.g. "users/abc123" or "projects/agent-kb"
): Promise<Record<string, any> | null> {
  const token = await getServiceAccountAccessToken(env);
  const url = `${FIRESTORE_BASE}/${env.HUB_PROJECT_ID}/databases/(default)/documents/${docPath}`;

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (resp.status === 404) return null;
  if (!resp.ok) {
    console.error(`Firestore GET ${docPath} failed: ${resp.status}`);
    return null;
  }

  const doc = await resp.json();
  return decodeFirestoreDoc(doc);
}
