import { NextRequest } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import { getAuthUser } from './auth-middleware';
import {
  parseAdminEmailToken,
  verifyAdminEmailTokenLive,
} from './admin-email-auth';

function safeCompare(a: string, b: string): boolean {
  const ah = createHash('sha256').update(a).digest();
  const bh = createHash('sha256').update(b).digest();
  try { return timingSafeEqual(ah, bh); } catch { return false; }
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

/**
 * Cheap signed-token check. API routes and the admin layout must additionally
 * call verifyAdminTokenLive so revocation and allowlist changes take effect.
 */
export function verifyAdminToken(token: string | undefined | null): boolean {
  try { return Boolean(parseAdminEmailToken(token)); } catch { return false; }
}

export async function verifyAdminTokenLive(token: string | undefined | null): Promise<boolean> {
  try { return Boolean(await verifyAdminEmailTokenLive(token)); } catch { return false; }
}

/**
 * Verify admin access via:
 * 1. Signed admin session token (x-admin-token header or nf_admin_token cookie)
 * 2. JWT with globalRole = 'super_admin' (nf_users.role)
 */
export async function verifyAdminSession(req: NextRequest): Promise<boolean> {
  const token = req.headers.get('x-admin-token')
    ?? req.cookies.get('nf_admin_token')?.value;
  return verifyAdminTokenLive(token);
}

/**
 * Async version: also checks JWT-based super_admin role.
 * Use this in new routes; legacy routes can continue using verifyAdminSession.
 */
export async function verifyAdmin(req: NextRequest): Promise<boolean> {
  // 1. Signed, revocable email-admin session.
  if (await verifyAdminSession(req)) return true;

  // 2. Shared CI/automation secret (x-admin-secret vs ADMIN_SECRET env)
  if (verifyAdminSecretHeader(req)) return true;

  // 3. JWT with super_admin role
  try {
    const authUser = await getAuthUser(req);
    if (authUser?.globalRole === 'super_admin') return true;
  } catch { /* not authenticated */ }

  return false;
}

/** Identity used by allowlist management and admin audit rows. */
export async function getAdminIdentity(req: NextRequest): Promise<string | null> {
  const token = req.headers.get('x-admin-token') ?? req.cookies.get('nf_admin_token')?.value;
  try {
    const session = await verifyAdminEmailTokenLive(token);
    if (session) return session.email;
  } catch { /* fall through */ }
  if (verifyAdminSecretHeader(req)) return 'automation';
  try {
    const authUser = await getAuthUser(req);
    if (authUser?.globalRole === 'super_admin') return authUser.email;
  } catch { /* not authenticated */ }
  return null;
}

/**
 * Strict super-admin gate. Used for actions that mutate platform secrets
 * (API key rotation, encryption key changes) — verifyAdmin's three paths
 * include shared-secret headers and signed cookies that any operator can
 * obtain. This one requires the actual nf_users.role = 'super_admin'.
 *
 * Returns the authenticated super-admin user on success, null otherwise.
 */
export async function verifySuperAdmin(req: NextRequest): Promise<{
  userId: string; email: string;
} | null> {
  try {
    const authUser = await getAuthUser(req);
    if (authUser?.globalRole === 'super_admin') {
      return { userId: authUser.userId, email: authUser.email };
    }
  } catch { /* not authenticated */ }
  return null;
}
