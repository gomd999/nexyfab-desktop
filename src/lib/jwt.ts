if (
  !process.env.JWT_SECRET &&
  process.env.NODE_ENV === 'production' &&
  process.env.NEXT_PHASE !== 'phase-production-build'
) {
  throw new Error('[FATAL] JWT_SECRET 환경변수가 프로덕션에서 설정되지 않았습니다.');
}
if (!process.env.JWT_SECRET) {
  console.warn('[WARNING] JWT_SECRET not set — using insecure development default');
}

const SECRET =
  process.env.JWT_SECRET || 'nexyfab-dev-secret-change-in-production';

export interface JWTPayload {
  sub: string;
  email: string;
  plan: string;
  emailVerified?: boolean;
  service?: string;
  iat: number;
  exp: number;
}

// ─── Base64URL helpers ────────────────────────────────────────────────────────

function base64urlEncode(data: Uint8Array | string): string {
  const str =
    typeof data === 'string'
      ? data
      : String.fromCharCode(...Array.from(data));
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (padded.length % 4)) % 4;
  const base64 = padded + '='.repeat(pad);
  const binary = atob(base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// ─── Key import ───────────────────────────────────────────────────────────────

async function getKey(): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

// ─── Sign ─────────────────────────────────────────────────────────────────────

export async function signJWT(
  payload: Omit<JWTPayload, 'iat' | 'exp'>,
  expiresInSeconds = 7 * 24 * 3600
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JWTPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const header = { alg: 'HS256', typ: 'JWT' };
  const enc = new TextEncoder();

  const headerB64 = base64urlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64urlEncode(enc.encode(JSON.stringify(fullPayload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await getKey();
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode(signingInput)
  );

  const sigB64 = base64urlEncode(new Uint8Array(signature));
  return `${signingInput}.${sigB64}`;
}

// ─── Verify ───────────────────────────────────────────────────────────────────

export async function verifyJWT(token: string): Promise<JWTPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, sigB64] = parts;

    // Validate header algorithm to prevent algorithm confusion attacks
    const headerJson = new TextDecoder().decode(base64urlDecode(headerB64));
    const header = JSON.parse(headerJson) as { alg?: string; typ?: string };
    if (header.alg !== 'HS256') return null;

    const signingInput = `${headerB64}.${payloadB64}`;

    const enc = new TextEncoder();
    const key = await getKey();

    const sigBytes = base64urlDecode(sigB64);
    // Ensure a plain ArrayBuffer (not SharedArrayBuffer) for crypto.subtle.verify
    const sigBuffer = sigBytes.buffer instanceof ArrayBuffer
      ? sigBytes.buffer
      : new Uint8Array(sigBytes).buffer;
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBuffer,
      enc.encode(signingInput)
    );

    if (!isValid) return null;

    const payloadJson = new TextDecoder().decode(base64urlDecode(payloadB64));
    const payload = JSON.parse(payloadJson) as JWTPayload;

    if (payload.exp < Date.now() / 1000) return null;

    return payload;
  } catch {
    return null;
  }
}
