import { NextRequest } from 'next/server';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { getAuthUser } from './auth-middleware';

const ADMIN_SESSION_TTL_MS = 30 * 60 * 1000;

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function safeCompare(a: string, b: string): boolean {
  const ah = createHash('sha256').update(a).digest();
  const bh = createHash('sha256').update(b).digest();
  try { return timingSafeEqual(ah, bh); } catch { return false; }
}

function adminSessionSecret(): string | null {
  return process.env.ADMIN_SESSION_SECRET
    ?? process.env.JWT_SECRET
    ?? process.env.ADMIN_SECRET
    ?? null;
}

/**
 * Constant-time compare for shared-secret headers (CI → admin endpoints).
 * Returns false on length mismatch or if ADMIN_SECRET is unset.
 */
function verifyAdminSecretHeader(req: NextRequest): boolean {
  const expected = process.env.ADMIN_SECRET;
  if (!expected) return false;
  const provided = req.headers.get('x-admin-secret');
  if (!provided) return false;
  return safeCompare(provided, expected);
}

export function createAdminSession(): string {
  const secret = adminSessionSecret();
  if (!secret) throw new Error('ADMIN_SESSION_SECRET or JWT_SECRET is required for admin sessions');

  const payload = base64UrlEncode(JSON.stringify({
    typ: 'nf_admin_session',
    exp: Date.now() + ADMIN_SESSION_TTL_MS,
    nonce: randomBytes(16).toString('hex'),
  }));
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/**
 * Verify admin access via:
 * 1. Signed admin session token (x-admin-token header or nf_admin_token cookie)
 * 2. JWT with globalRole = 'super_admin' (nf_users.role)
 */
export function verifyAdminSession(req: NextRequest): boolean {
  const token = req.headers.get('x-admin-token')
    ?? req.cookies.get('nf_admin_token')?.value;
  if (!token) return false;

  const secret = adminSessionSecret();
  if (!secret) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;

  const expectedSig = createHmac('sha256', secret).update(payload).digest('base64url');
  if (!safeCompare(sig, expectedSig)) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      typ?: string;
      exp?: number;
    };
    return parsed.typ === 'nf_admin_session' && typeof parsed.exp === 'number' && parsed.exp >= Date.now();
  } catch {
    return false;
  }
}

/**
 * Async version: also checks JWT-based super_admin role.
 * Use this in new routes; legacy routes can continue using verifyAdminSession.
 */
export async function verifyAdmin(req: NextRequest): Promise<boolean> {
  // 1. Signed admin token (sync)
  if (verifyAdminSession(req)) return true;

  // 2. Shared CI/automation secret (x-admin-secret vs ADMIN_SECRET env)
  if (verifyAdminSecretHeader(req)) return true;

  // 3. JWT with super_admin role
  try {
    const authUser = await getAuthUser(req);
    if (authUser?.globalRole === 'super_admin') return true;
  } catch { /* not authenticated */ }

  return false;
}
