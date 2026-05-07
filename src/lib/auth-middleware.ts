import { NextRequest } from 'next/server';
import { verifyJWT, type JWTPayload } from './jwt';
import { verifyNexysysToken, resolveOrProvisionUser } from './nexysys-sso';
import { getDbAdapter } from './db-adapter';
import { getTrustedClientIp } from './client-ip';
import type { UserRole } from './rbac';

export interface AuthUser {
  userId: string;
  email: string;
  plan: string;
  globalRole: string;        // 'user' | 'super_admin'
  roles: UserRole[];         // per-product roles from nf_user_roles
  orgIds: string[];          // org IDs the user belongs to
  emailVerified: boolean;
}

/** Enrich base user info with roles and org membership */
async function enrichAuthUser(base: { userId: string; email: string; plan: string }): Promise<AuthUser> {
  const db = getDbAdapter();
  const [roleRows, orgRows, userRow] = await Promise.all([
    db.queryAll<{ product: string; role: string; org_id: string | null }>(
      'SELECT product, role, org_id FROM nf_user_roles WHERE user_id = ?', base.userId,
    ),
    db.queryAll<{ org_id: string }>(
      'SELECT org_id FROM nf_org_members WHERE user_id = ?', base.userId,
    ),
    db.queryOne<{ role: string; email_verified: number }>(
      'SELECT role, email_verified FROM nf_users WHERE id = ?', base.userId,
    ),
  ]);
  return {
    ...base,
    globalRole: userRow?.role ?? 'user',
    roles: roleRows.map(r => ({ product: r.product, role: r.role, orgId: r.org_id }) as UserRole),
    orgIds: orgRows.map(r => r.org_id),
    emailVerified: (userRow?.email_verified ?? 0) === 1,
  };
}

export async function getAuthUser(req: NextRequest): Promise<AuthUser | null> {
  // 1. Try httpOnly cookie first (preferred, XSS-safe)
  const cookieToken = req.cookies.get('nf_access_token')?.value;
  // 2. Fall back to Authorization header (API clients, mobile)
  const authHeader = req.headers.get('authorization');
  const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = cookieToken || headerToken;
  if (!token) return null;

  // Demo token fallback (legacy) — BOTH NODE_ENV=development AND ALLOW_DEMO_AUTH=true required
  if (
    process.env.NODE_ENV === 'development' &&
    process.env.ALLOW_DEMO_AUTH === 'true'
  ) {
    const demoTokenListRaw = process.env.DEMO_TOKEN_LIST ?? '';
    const allowedDemoTokens = demoTokenListRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    if (allowedDemoTokens.length > 0 && allowedDemoTokens.includes(token)) {
      console.warn('[AUTH] demo token used:', token.slice(0, 12) + '...');
      const userId = token.startsWith('demo-token-')
        ? token.replace('demo-token-', '')
        : token.startsWith('sso-demo-token')
          ? 'sso-demo'
          : token.replace('token-', '');
      const db = getDbAdapter();
      const user = await db.queryOne<{ id: string; email: string; plan: string }>(
        'SELECT id, email, plan FROM nf_users WHERE id = ?', userId,
      );
      return user
        ? enrichAuthUser({ userId: user.id, email: user.email, plan: user.plan })
        : null;
    }
  }

  // API Key authentication: Authorization: Bearer nf_live_...
  if (token?.startsWith('nf_live_')) {
    const { createHash } = await import('crypto');
    const keyHash = createHash('sha256').update(token).digest('hex');
    const db = getDbAdapter();
    const apiKey = await db.queryOne<{
      user_id: string; scopes: string; ip_whitelist: string; status: string; expires_at: number | null;
    }>(
      "SELECT user_id, scopes, ip_whitelist, status, expires_at FROM nf_api_keys WHERE key_hash = ? AND status = 'active'",
      keyHash,
    ).catch(() => null);

    if (apiKey) {
      // Check expiry
      if (apiKey.expires_at && apiKey.expires_at < Date.now()) return null;

      // Check IP whitelist
      const ipWhitelist: string[] = JSON.parse(apiKey.ip_whitelist ?? '[]');
      if (ipWhitelist.length > 0) {
        const clientIp = getTrustedClientIp(req.headers);
        if (!ipWhitelist.includes(clientIp)) return null;
      }

      // Update last_used_at (fire-and-forget)
      db.execute('UPDATE nf_api_keys SET last_used_at = ? WHERE key_hash = ?', Date.now(), keyHash).catch(() => {});

      // Get user info
      const user = await db.queryOne<{ id: string; email: string; plan: string }>(
        'SELECT id, email, plan FROM nf_users WHERE id = ?',
        apiKey.user_id,
      );
      if (!user) return null;

      return enrichAuthUser({ userId: user.id, email: user.email, plan: user.plan });
    }
  }

  // ── JWKS-first (NexySys SSO RS256) ──────────────────────────────────────
  const ssoPayload = await verifyNexysysToken(token);
  if (ssoPayload) {
    const user = await resolveOrProvisionUser(ssoPayload);
    if (!user) return null;
    return enrichAuthUser({ userId: user.id, email: user.email, plan: user.plan });
  }

  // ── HMAC fallback (legacy HS256) ─────────────────────────────────────────
  // TODO D+30: add console.warn deprecation notice
  // TODO D+60: remove this branch and redirect /api/auth/login → auth.nexysys.com
  const payload: JWTPayload | null = await verifyJWT(token);
  if (!payload) return null;
  return enrichAuthUser({ userId: payload.sub, email: payload.email, plan: payload.plan });
}
