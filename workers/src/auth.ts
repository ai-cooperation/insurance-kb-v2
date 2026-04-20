/**
 * Google ID Token verification + KV-based VIP whitelist.
 *
 * Flow:
 * 1. Frontend gets Google ID token via Google Identity Services
 * 2. Frontend sends token in Authorization: Bearer <token>
 * 3. Workers verifies token with Google's tokeninfo endpoint
 * 4. Workers checks KV for VIP status
 */

export interface UserInfo {
  email: string;
  name: string;
  picture: string;
  tier: "guest" | "member" | "vip";
}

const GOOGLE_TOKENINFO = "https://oauth2.googleapis.com/tokeninfo";

/**
 * Verify a Google ID token and return user info.
 * Returns null if token is invalid.
 */
export async function verifyGoogleToken(
  idToken: string,
): Promise<{ email: string; name: string; picture: string } | null> {
  try {
    const resp = await fetch(`${GOOGLE_TOKENINFO}?id_token=${idToken}`);
    if (!resp.ok) return null;

    const data = (await resp.json()) as Record<string, string>;
    if (!data.email || data.email_verified !== "true") return null;

    return {
      email: data.email,
      name: data.name || data.email.split("@")[0],
      picture: data.picture || "",
    };
  } catch {
    return null;
  }
}

/**
 * Check if an email is in the VIP whitelist (stored in KV).
 * KV key format: vip:<email> = "1"
 */
export async function isVip(kv: KVNamespace, email: string): Promise<boolean> {
  const val = await kv.get(`vip:${email}`);
  return val !== null;
}

/**
 * Extract user info from request Authorization header.
 * Returns guest if no token or invalid token.
 */
export async function getUserFromRequest(
  request: Request,
  kv: KVNamespace,
): Promise<UserInfo> {
  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return { email: "", name: "", picture: "", tier: "guest" };
  }

  const token = auth.slice(7);
  const user = await verifyGoogleToken(token);
  if (!user) {
    return { email: "", name: "", picture: "", tier: "guest" };
  }

  const vip = await isVip(kv, user.email);
  return {
    ...user,
    tier: vip ? "vip" : "member",
  };
}

/**
 * Add an email to VIP whitelist.
 */
export async function addVip(kv: KVNamespace, email: string): Promise<void> {
  await kv.put(`vip:${email}`, "1");
}

/**
 * Remove an email from VIP whitelist.
 */
export async function removeVip(
  kv: KVNamespace,
  email: string,
): Promise<void> {
  await kv.delete(`vip:${email}`);
}

/**
 * List all VIP emails.
 */
export async function listVips(kv: KVNamespace): Promise<string[]> {
  const list = await kv.list({ prefix: "vip:" });
  return list.keys.map((k) => k.name.replace("vip:", ""));
}
