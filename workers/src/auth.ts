/**
 * Cloudflare Access JWT authentication.
 * Decodes the CF Access JWT to extract user email.
 * Trusts CF edge for signature verification.
 */

export interface AccessJwtPayload {
  email: string;
  aud: string[];
  exp: number;
  iat: number;
  sub: string;
}

export function decodeAccessJwt(token: string, expectedAud?: string): AccessJwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return null;
    }

    const payloadB64 = parts[1];
    const padded = payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4);
    const decoded = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(decoded) as AccessJwtPayload;

    // Verify expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null;
    }

    // Verify audience if provided
    if (expectedAud && payload.aud) {
      const audList = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (!audList.includes(expectedAud)) {
        return null;
      }
    }

    if (!payload.email) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function extractEmail(request: Request): string {
  const jwtHeader = request.headers.get("Cf-Access-Jwt-Assertion");
  if (jwtHeader) {
    const payload = decodeAccessJwt(jwtHeader);
    if (payload?.email) {
      return payload.email;
    }
  }
  return "dev@localhost";
}
