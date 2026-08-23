import type { AuthUser } from './auth-middleware';

export const ACTIVE_ORG_COOKIE = 'nf_active_org_id';
export const PERSONAL_ORG_CONTEXT = 'personal';

export type RequestOrgContext =
  | { ok: true; orgId: string | null; mode: 'active' | 'personal' }
  | { ok: false; code: 'ORG_CONTEXT_REQUIRED' | 'ORG_CONTEXT_INVALID' };

/**
 * Converts the authenticated membership snapshot into an explicit tenant
 * context. Multi-org users never fall back to the first database row.
 */
export function resolveRequestOrgContext(user: Pick<AuthUser, 'orgIds' | 'activeOrgId' | 'orgContextStatus'>): RequestOrgContext {
  if (user.orgContextStatus === 'invalid') return { ok: false, code: 'ORG_CONTEXT_INVALID' };
  if (user.orgContextStatus === 'selection_required') return { ok: false, code: 'ORG_CONTEXT_REQUIRED' };
  if (user.activeOrgId) {
    return user.orgIds.includes(user.activeOrgId)
      ? { ok: true, orgId: user.activeOrgId, mode: 'active' }
      : { ok: false, code: 'ORG_CONTEXT_INVALID' };
  }
  if (user.orgContextStatus === 'personal' || user.orgIds.length === 0) return { ok: true, orgId: null, mode: 'personal' };
  // Compatibility for old test doubles while preserving fail-closed behavior
  // for real multi-org users.
  if (user.orgIds.length === 1) return { ok: true, orgId: user.orgIds[0]!, mode: 'active' };
  return { ok: false, code: 'ORG_CONTEXT_REQUIRED' };
}

export function activeOrgCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  };
}

export function resourceBelongsToOrgContext(
  resourceOrgId: unknown,
  context: Extract<RequestOrgContext, { ok: true }>,
): boolean {
  const normalized = typeof resourceOrgId === 'string' && resourceOrgId.length > 0
    ? resourceOrgId
    : null;
  return normalized === context.orgId;
}
