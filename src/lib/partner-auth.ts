/**
 * Shared partner authentication module.
 *
 * Dual-mode: JWT (new) + legacy opaque session token (backward compat).
 * Partners are nf_users with nf_user_roles (nexyfab, partner).
 * Sessions are stored in nf_partner_sessions (DB).
 */
import { createHash } from 'crypto';
import { getAuthUser, type AuthUser } from './auth-middleware';
import { getDbAdapter } from './db-adapter';

export interface PartnerInfo {
  partnerId: string;   // nf_users.id (new) or legacy partner_id
  userId: string;      // nf_users.id
  email: string;
  company: string;
}

/**
 * Authenticate a partner from a request.
 * 1. Try JWT auth (getAuthUser) + check for nexyfab:partner role
 * 2. Fall back to legacy opaque session token → nf_partner_sessions lookup
 */
export async function getPartnerAuth(req: Request): Promise<PartnerInfo | null> {
  // 1. Try JWT auth
  try {
    const authUser = await getAuthUser(req as import('next/server').NextRequest);
    if (authUser) {
      const isPartner = authUser.roles.some(r => r.product === 'nexyfab' && r.role === 'partner');
      if (isPartner) {
        return {
          partnerId: authUser.userId,
          userId: authUser.userId,
          email: authUser.email,
          company: '',
        };
      }
    }
  } catch { /* fall through to legacy */ }

  // 2. Legacy opaque session token → DB lookup
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;

  const db = getDbAdapter();
  const sessionHash = createHash('sha256').update(token).digest('hex');

  const row = await db.queryOne<{
    partner_id: string; user_id: string | null; email: string; company: string; expires_at: number;
  }>(
    'SELECT partner_id, user_id, email, company, expires_at FROM nf_partner_sessions WHERE session_hash = ?',
    sessionHash,
  ).catch(() => null);

  if (!row || row.expires_at <= Date.now()) return null;

  return {
    partnerId: row.partner_id,
    userId: row.user_id ?? row.partner_id,
    email: row.email,
    company: row.company,
  };
}
