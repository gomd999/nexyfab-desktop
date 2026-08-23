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
  activeOrgId?: string | null;
  orgContextStatus?: 'personal' | 'active' | 'selection_required' | 'invalid';
  emailVerified: boolean;
  apiKey?: { id: string; scopes: string[] };
}

/** Enrich base user info with roles and org membership */
async function enrichAuthUser(
  base: { userId: string; email: string; plan: string },
  requestedOrgId: string | null,
): Promise<AuthUser | null> {
  const db = getDbAdapter();
  const [roleRows, orgRows, userRow] = await Promise.all([
    db.queryAll<{ product: string; role: string; org_id: string | null }>(
      'SELECT product, role, org_id FROM nf_user_roles WHERE user_id = ?', base.userId,
    ),
    db.queryAll<{ org_id: string; org_plan: string }>(
      `SELECT om.org_id, o.plan AS org_plan
         FROM nf_org_members om
         JOIN nf_orgs o ON o.id = om.org_id
        WHERE om.user_id = ?`,
      base.userId,
    ),
    db.queryOne<{
      email: string;
      plan: string;
      role: string;
      email_verified: number;
      locked_until: number | null;
      pro_grace_until: number | null;
      plan_expires_at: number | null;
      plan_fallback: string | null;
    }>(
      `SELECT email, plan, role, email_verified, locked_until,
              pro_grace_until, plan_expires_at, plan_fallback
         FROM nf_users WHERE id = ?`,
      base.userId,
    ),
  ]);
  // A valid stateless access token must not resurrect a deleted account or
  // bypass an administrator lock. Roles and plan are likewise read from the
  // current row so privilege changes take effect immediately.
  if (!userRow || (userRow.locked_until !== null && userRow.locked_until > Date.now())) {
    return null;
  }
  // Partner Pro grace: if the stored plan is free but a deal-driven grace
  // window is still active, surface 'pro' so downstream tier checks let
  // the partner use Pro tooling to evaluate the customer's 3D model.
  const { resolveEffectivePlan } = await import('./partner-pro-grace');
  // ⚠ 260802: 만료(plan_expires_at)를 함께 넘긴다 — 안 넘기면 관리자가 부여한 Pro 가 영구가 된다.
  const effectivePlan = resolveEffectivePlan(
    userRow.plan,
    userRow?.pro_grace_until ?? null,
    userRow?.plan_expires_at ?? null,
    userRow?.plan_fallback ?? null,
  );
  const orgIds = [...new Set(orgRows.map(r => r.org_id))].sort();
  const explicitPersonal = requestedOrgId === 'personal';
  const requestedMemberOrg = requestedOrgId && requestedOrgId !== 'personal' && orgIds.includes(requestedOrgId)
    ? requestedOrgId
    : null;
  const invalidRequestedOrg = Boolean(requestedOrgId && requestedOrgId !== 'personal' && !requestedMemberOrg);
  const activeOrgId = explicitPersonal
    ? null
    : requestedMemberOrg ?? (requestedOrgId === null && orgIds.length === 1 ? orgIds[0]! : null);
  const orgContextStatus: NonNullable<AuthUser['orgContextStatus']> = invalidRequestedOrg
    ? 'invalid'
    : activeOrgId
      ? 'active'
      : explicitPersonal || orgIds.length === 0
        ? 'personal'
        : 'selection_required';
  const activeOrgPlan = activeOrgId
    ? orgRows.find(row => row.org_id === activeOrgId)?.org_plan
    : null;
  return {
    userId: base.userId,
    email: userRow.email,
    // Entitlements are tenant-scoped. Personal mode uses the user's plan;
    // an active organization uses that organization's plan without mutating
    // the user's personal subscription.
    plan: activeOrgPlan ?? effectivePlan,
    globalRole: userRow?.role ?? 'user',
    roles: roleRows.map(r => ({ product: r.product, role: r.role, orgId: r.org_id }) as UserRole),
    orgIds,
    activeOrgId,
    orgContextStatus,
    emailVerified: (userRow?.email_verified ?? 0) === 1,
  };
}

export async function getAuthUser(req: NextRequest): Promise<AuthUser | null> {
  const requestedOrgId = req.headers.get('x-nexyfab-org-id')?.trim()
    || req.cookies.get('nf_active_org_id')?.value?.trim()
    || null;
  // 1. Try httpOnly cookie first (preferred, XSS-safe)
  const cookieToken = req.cookies.get('nf_access_token')?.value;
  // 2. Fall back to Authorization header (API clients, mobile)
  const authHeader = req.headers.get('authorization');
  const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = cookieToken || headerToken;
  if (!token) return null;

  // Demo token fallback (legacy). Triple-gated: NODE_ENV must equal
  // 'development' (not 'test', not unset), ALLOW_DEMO_AUTH must be the
  // literal string 'true', and the hostname/host header must not look
  // production. Last gate is belt-and-suspenders against env leaks.
  const hostHeader = req.headers.get('host') ?? '';
  const looksProduction = hostHeader.includes('nexyfab.com')
    || hostHeader.includes('nexysys.com')
    || hostHeader.includes('railway.app');
  if (
    process.env.NODE_ENV === 'development' &&
    process.env.ALLOW_DEMO_AUTH === 'true' &&
    !looksProduction
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
        ? enrichAuthUser({ userId: user.id, email: user.email, plan: user.plan }, requestedOrgId)
        : null;
    }
  }

  // API Key authentication: Authorization: Bearer nf_live_...
  if (token?.startsWith('nf_live_')) {
    const { createHash } = await import('crypto');
    const keyHash = createHash('sha256').update(token).digest('hex');
    const db = getDbAdapter();
    const apiKey = await db.queryOne<{
      id: string; user_id: string; scopes: string; ip_whitelist: string; status: string; expires_at: number | null;
    }>(
      "SELECT id, user_id, scopes, ip_whitelist, status, expires_at FROM nf_api_keys WHERE key_hash = ? AND status = 'active'",
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

      const enriched = await enrichAuthUser({ userId: user.id, email: user.email, plan: user.plan }, requestedOrgId);
      if (!enriched) return null;
      let scopes: string[] = [];
      try {
        const parsed = JSON.parse(apiKey.scopes ?? '[]');
        if (Array.isArray(parsed)) scopes = parsed.filter((scope): scope is string => typeof scope === 'string');
      } catch { /* malformed legacy scope means no privileges */ }
      return { ...enriched, apiKey: { id: apiKey.id, scopes } };
    }
  }

  // ── JWKS-first (NexySys SSO RS256) ──────────────────────────────────────
  const ssoPayload = await verifyNexysysToken(token);
  if (ssoPayload) {
    const user = await resolveOrProvisionUser(ssoPayload);
    if (!user) return null;
    return enrichAuthUser({ userId: user.id, email: user.email, plan: user.plan }, requestedOrgId);
  }

  // ── HMAC fallback (legacy HS256) ─────────────────────────────────────────
  // Legacy HS256 tokens predate the NexySys SSO rollout. We keep accepting
  // them so existing sessions don't get logged out, but every accepted token
  // is now sampled into the logs so we can watch traffic taper to zero.
  //
  // Removal plan (target 2026-07-11): once daily sampled-warn count is 0 for
  // a full week, delete this branch and have /api/auth/login redirect to
  // auth.nexysys.com.
  const payload: JWTPayload | null = await verifyJWT(token);
  if (!payload) return null;
  warnLegacyHs256(payload.sub);
  return enrichAuthUser({ userId: payload.sub, email: payload.email, plan: payload.plan }, requestedOrgId);
}

// Sampled deprecation warning. Logging every legacy token would flood stdout
// (every authenticated request hits this on the fallback path), so we keep
// one warn per unique userId per process — enough to see who's still on the
// legacy issuer without drowning the log stream.
const _legacyHs256SeenUsers = new Set<string>();
function warnLegacyHs256(userId: string): void {
  if (_legacyHs256SeenUsers.has(userId)) return;
  _legacyHs256SeenUsers.add(userId);
  console.warn(
    `[auth-middleware] legacy HS256 token accepted for user=${userId}; ` +
    `this issuer is scheduled for removal — migrate to auth.nexysys.com SSO.`,
  );
}
