import { NextRequest } from 'next/server';
import { getAuthUser } from './auth-middleware';

// In-memory admin sessions (sufficient for single-instance admin)
const adminSessions = new Map<string, number>(); // token → expiresAt

export function createAdminSession(): string {
  const { randomBytes } = require('crypto');
  const token = randomBytes(32).toString('hex');
  adminSessions.set(token, Date.now() + 30 * 60 * 1000); // 30 min
  // Cleanup expired sessions
  const now = Date.now();
  for (const [t, exp] of adminSessions) { if (exp < now) adminSessions.delete(t); }
  return token;
}

/**
 * Verify admin access via:
 * 1. Legacy in-memory admin token (x-admin-token header or nf_admin_token cookie)
 * 2. JWT with globalRole = 'super_admin' (nf_users.role)
 */
export function verifyAdminSession(req: NextRequest): boolean {
  // 1. Legacy admin token
  const token = req.headers.get('x-admin-token')
    ?? req.cookies.get('nf_admin_token')?.value;
  if (token) {
    const exp = adminSessions.get(token);
    if (exp && exp >= Date.now()) return true;
    adminSessions.delete(token as string);
  }
  return false;
}

/**
 * Async version: also checks JWT-based super_admin role.
 * Use this in new routes; legacy routes can continue using verifyAdminSession.
 */
export async function verifyAdmin(req: NextRequest): Promise<boolean> {
  // 1. Legacy admin token (sync)
  if (verifyAdminSession(req)) return true;

  // 2. JWT with super_admin role
  try {
    const authUser = await getAuthUser(req);
    if (authUser?.globalRole === 'super_admin') return true;
  } catch { /* not authenticated */ }

  return false;
}
