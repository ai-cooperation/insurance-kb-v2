/**
 * KV-based per-user hourly rate limiter.
 * Key format: rate:{email}:{hour}
 * TTL: 7200 seconds (2 hours, covers current + previous hour overlap).
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: string;
}

const DEFAULT_LIMIT = 100;
const TTL_SECONDS = 86400;

function getCurrentHourKey(identifier: string): string {
  const now = new Date();
  const day = now.toISOString().slice(0, 10); // "2026-04-21"
  return `rate:${identifier}:${day}`;
}

function getResetTime(): string {
  const now = new Date();
  const reset = new Date(now);
  reset.setHours(24, 0, 0, 0);
  return reset.toISOString();
}

export async function checkRateLimit(
  kv: KVNamespace,
  email: string,
  limit: number = DEFAULT_LIMIT,
): Promise<RateLimitResult> {
  const key = getCurrentHourKey(email);
  const current = await kv.get(key);
  const count = current ? parseInt(current, 10) : 0;

  if (count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      limit,
      resetAt: getResetTime(),
    };
  }

  await kv.put(key, String(count + 1), { expirationTtl: TTL_SECONDS });

  return {
    allowed: true,
    remaining: limit - count - 1,
    limit,
    resetAt: getResetTime(),
  };
}
