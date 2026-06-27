/**
 * WebAuthn / passkey shared helpers for NexyFab's own (same-origin) auth.
 *
 * The /login passkey flow and the /account "register passkey" flow both hit
 * /api/auth/webauthn/* on nexyfab.com. The actual assertion/attestation crypto
 * is handled by @simplewebauthn/server; this module supplies the RP config, a
 * stateless signed challenge cookie (no extra table for the in-flight challenge),
 * and session issuance that mirrors /api/auth/login.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createHmac, randomBytes, createHash, timingSafeEqual } from 'crypto';
import { getDbAdapter } from '@/lib/db-adapter';
import { signJWT } from '@/lib/jwt';
import { SERVICE_NAME } from '@/lib/service-config';
import { accessTokenCookie, refreshTokenCookie } from '@/lib/cookie-config';
import { parseUserStageColumn } from '@/lib/stage-engine';

export const CHALLENGE_COOKIE = 'nf_webauthn_chal';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * Derive the Relying Party config from the request Origin header (robust behind
 * a proxy, where req.nextUrl.origin resolves to the internal 0.0.0.0:8080).
 */
export function getRpConfig(req: NextRequest): { rpID: string; rpName: string; origin: string } {
  const origin = req.headers.get('origin') || process.env.NEXT_PUBLIC_SITE_URL || 'https://nexyfab.com';
  let rpID = 'nexyfab.com';
  try { rpID = new URL(origin).hostname; } catch { /* keep default */ }
  return { rpID, rpName: 'NexyFab', origin };
}

function challengeSecret(): string {
  return process.env.JWT_SECRET || process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_SECRET || '';
}

interface ChallengePayload { challenge: string; kind: 'reg' | 'login'; userId?: string; exp: number }

/** Sign the in-flight challenge into a short-lived value for the cookie. */
export function signChallenge(challenge: string, kind: 'reg' | 'login', userId?: string): string {
  const body = Buffer.from(JSON.stringify({ challenge, kind, userId, exp: Date.now() + CHALLENGE_TTL_MS } as ChallengePayload)).toString('base64url');
  const sig = createHmac('sha256', challengeSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** Read + validate the challenge cookie. Returns null if absent/forged/expired/kind-mismatch. */
export function readChallenge(token: string | undefined | null, expectKind: 'reg' | 'login'): ChallengePayload | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', challengeSecret()).update(body).digest('base64url');
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch { return null; }
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ChallengePayload;
    if (p.kind !== expectKind || typeof p.exp !== 'number' || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}

export function challengeCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: CHALLENGE_TTL_MS / 1000,
  };
}

export interface SessionUserRow {
  id: string; email: string; name: string; plan: string;
  project_count?: number; email_verified?: unknown; stage?: string | null;
}

interface IssuedCookie { name: string; value: string; options: Parameters<NextResponse['cookies']['set']>[2] }

/**
 * Build a NexyFab session — mirrors /api/auth/login: short-lived access JWT +
 * rotated refresh token (revoking prior sessions). Returns the public user object
 * plus the cookies to set, so the caller can build the response body first.
 */
export async function issueNexyfabSession(dbUser: SessionUserRow): Promise<{
  user: { id: string; email: string; name: string; plan: string; projectCount: number; emailVerified: boolean; nexyfabStage: ReturnType<typeof parseUserStageColumn> };
  cookies: IssuedCookie[];
}> {
  const emailVerified = dbUser.email_verified === true || dbUser.email_verified === 1 || dbUser.email_verified === 't';
  const nexyfabStage = parseUserStageColumn(dbUser.stage ?? null);

  const token = await signJWT(
    { sub: dbUser.id, email: dbUser.email, plan: dbUser.plan, emailVerified, service: SERVICE_NAME, nexyfabStage },
    15 * 60,
  );

  const db = getDbAdapter();
  const REFRESH_TTL = 30 * 24 * 3600 * 1000;
  const raw = randomBytes(40).toString('hex');
  const hash = createHash('sha256').update(raw).digest('hex');
  const now = Date.now();
  await db.execute('UPDATE nf_refresh_tokens SET revoked = TRUE WHERE user_id = ? AND revoked = FALSE', dbUser.id);
  await db.execute(
    `INSERT INTO nf_refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at)
     VALUES (?, ?, ?, ?, FALSE, ?)`,
    `rt-${crypto.randomUUID()}`, dbUser.id, hash, now + REFRESH_TTL, now,
  );

  const rc = refreshTokenCookie(raw);
  const ac = accessTokenCookie(token);
  return {
    user: { id: dbUser.id, email: dbUser.email, name: dbUser.name, plan: dbUser.plan, projectCount: dbUser.project_count ?? 0, emailVerified, nexyfabStage },
    cookies: [{ name: rc.name, value: rc.value, options: rc.options }, { name: ac.name, value: ac.value, options: ac.options }],
  };
}
