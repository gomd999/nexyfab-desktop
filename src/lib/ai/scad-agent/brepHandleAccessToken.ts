import { createHmac, timingSafeEqual } from 'node:crypto';

/** Short-lived capability for the legacy process-local SCAD BRep registry. */
export const BREP_HANDLE_ACCESS_TOKEN_TTL_MS = 5 * 60 * 1000;

type TokenPayload = {
  v: 1;
  userId: string;
  handle: string;
  issuedAt: number;
  expiresAt: number;
};

function secret(): string | null {
  const value = (
    process.env.SCAD_AGENT_HANDLE_TOKEN_SECRET
    ?? process.env.SCAD_AGENT_SESSION_SECRET
    ?? process.env.JWT_SECRET
    ?? process.env.NEXYFAB_SERVER_SECRET
    ?? ''
  ).trim();
  return value.length >= 16 ? value : null;
}

function validHandle(value: unknown): value is string {
  return typeof value === 'string' && /^occt:[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);
}

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decode(value: string): string | null {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    return decoded && decoded.length <= 4096 ? decoded : null;
  } catch {
    return null;
  }
}

function mac(secretValue: string, body: string): string {
  return createHmac('sha256', secretValue).update(body).digest('hex');
}

function bodyFor(payload: TokenPayload): string {
  return JSON.stringify(payload);
}

export function issueBrepHandleAccessToken(input: {
  userId: string;
  handle: string;
  nowMs?: number;
  ttlMs?: number;
}): string | null {
  const secretValue = secret();
  const nowMs = input.nowMs ?? Date.now();
  const ttlMs = input.ttlMs ?? BREP_HANDLE_ACCESS_TOKEN_TTL_MS;
  if (!secretValue || typeof input.userId !== 'string' || input.userId.length < 1 || input.userId.length > 256
    || !validHandle(input.handle) || !Number.isSafeInteger(nowMs) || !Number.isSafeInteger(ttlMs)
    || ttlMs < 1 || ttlMs > BREP_HANDLE_ACCESS_TOKEN_TTL_MS) return null;
  const payload: TokenPayload = {
    v: 1,
    userId: input.userId,
    handle: input.handle,
    issuedAt: nowMs,
    expiresAt: nowMs + ttlMs,
  };
  const body = bodyFor(payload);
  return `v1.${encode(body)}.${mac(secretValue, body)}`;
}

export function verifyBrepHandleAccessToken(input: {
  token: unknown;
  userId: string;
  handle: string;
  nowMs?: number;
}): boolean {
  const secretValue = secret();
  if (!secretValue || typeof input.token !== 'string' || input.token.length > 8192
    || typeof input.userId !== 'string' || !validHandle(input.handle)) return false;
  const parts = input.token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || !/^[a-f0-9]{64}$/.test(parts[2] ?? '')) return false;
  const body = decode(parts[1] ?? '');
  if (!body) return false;
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return false; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const payload = parsed as Partial<TokenPayload>;
  const issuedAt = payload.issuedAt;
  const expiresAt = payload.expiresAt;
  if (payload.v !== 1 || typeof payload.userId !== 'string' || typeof payload.handle !== 'string'
    || payload.userId !== input.userId || payload.handle !== input.handle
    || typeof issuedAt !== 'number' || typeof expiresAt !== 'number'
    || !Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)
    || expiresAt <= issuedAt || expiresAt - issuedAt > BREP_HANDLE_ACCESS_TOKEN_TTL_MS) return false;
  const normalized: TokenPayload = { v: 1, userId: payload.userId, handle: payload.handle, issuedAt, expiresAt };
  if (bodyFor(normalized) !== body) return false;
  const expected = Buffer.from(mac(secretValue, body), 'hex');
  const supplied = Buffer.from(parts[2]!, 'hex');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return false;
  const nowMs = input.nowMs ?? Date.now();
  return Number.isSafeInteger(nowMs) && nowMs >= issuedAt && nowMs < expiresAt;
}
