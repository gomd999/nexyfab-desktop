// ─── JWT verify — HS256 ──────────────────────────────────────────────────────
//
// Mirrors src/lib/jwt.ts in the Next.js app so a single JWT_SECRET works for
// both the issuing webapp and this verifier worker.
//
// Tokens are issued by /api/nexyfab/worker-token in the main app and carry the
// shape { sub, email, plan, emailVerified?, service?, nexyfabStage?, iat, exp }.

export interface JWTPayload {
  sub: string;
  email: string;
  plan: string;
  emailVerified?: boolean;
  service?: string;
  nexyfabStage?: string;
  iat: number;
  exp: number;
}

// ─── Base64url helpers ───────────────────────────────────────────────────────

function base64urlEncode(data: Uint8Array | string): string {
  const str =
    typeof data === 'string'
      ? data
      : String.fromCharCode(...Array.from(data));
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (padded.length % 4)) % 4;
  const base64 = padded + '='.repeat(pad);
  const binary = atob(base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// ─── HMAC key import (lazy, per-isolate cache) ───────────────────────────────

let cachedKey: CryptoKey | null = null;
let cachedSecret: string | null = null;

async function getKey(secret: string): Promise<CryptoKey> {
  if (cachedKey && cachedSecret === secret) return cachedKey;
  const enc = new TextEncoder();
  cachedKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  cachedSecret = secret;
  return cachedKey;
}

// ─── verifyJWT ───────────────────────────────────────────────────────────────

export async function verifyJWT(
  token: string,
  secret: string,
): Promise<JWTPayload | null> {
  if (!secret) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, sigB64] = parts;

    // Lock the accepted algorithm to HS256 — block `alg: none`/RS256 confusion.
    const headerJson = new TextDecoder().decode(base64urlDecode(headerB64));
    const header = JSON.parse(headerJson) as { alg?: string; typ?: string };
    if (header.alg !== 'HS256') return null;

    const signingInput = `${headerB64}.${payloadB64}`;
    const enc = new TextEncoder();
    const key = await getKey(secret);

    const sigBytes = base64urlDecode(sigB64);
    const sigBuffer =
      sigBytes.buffer instanceof ArrayBuffer
        ? sigBytes.buffer
        : new Uint8Array(sigBytes).buffer;

    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBuffer,
      enc.encode(signingInput),
    );
    if (!isValid) return null;

    const payloadJson = new TextDecoder().decode(base64urlDecode(payloadB64));
    const payload = JSON.parse(payloadJson) as JWTPayload;

    if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) {
      return null;
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

// ─── Extract token from request ──────────────────────────────────────────────
//
// Accept either ?token=<jwt> query parameter (required for native browser
// WebSocket which cannot set custom headers) or Authorization: Bearer <jwt>.

export function extractToken(request: Request): string | null {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get('token');
  if (fromQuery) return fromQuery;

  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
}
