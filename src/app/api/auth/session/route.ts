/**
 * GET /api/auth/session
 *
 * httpOnly 쿠키(`nf_access_token`)만 있는 경우(OAuth 리다이렉트 직후 등) 클라이언트가
 * `useAuthStore` 를 채우기 위해 호출. JSON에 `user` 만 반환(토큰은 쿠키에 유지).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter, toBool } from '@/lib/db-adapter';
import { parseUserStageColumn } from '@/lib/stage-engine';
import { BROWSER_SESSION_COOKIE, clearAuthCookies } from '@/lib/cookie-config';

export const dynamic = 'force-dynamic';

function anonymousSession(req: NextRequest, refreshable = Boolean(req.cookies.get('nf_refresh_token')?.value)) {
  return NextResponse.json(
    {
      authenticated: false,
      user: null,
      // The client cannot read the httpOnly token itself. This hint lets the
      // hydrator recover an expired access cookie without probing refresh for
      // every genuine guest.
      refreshable,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

export async function GET(req: NextRequest) {
  const hasAuthCookie = Boolean(
    req.cookies.get('nf_access_token')?.value || req.cookies.get('nf_refresh_token')?.value,
  );
  if (hasAuthCookie && req.cookies.get(BROWSER_SESSION_COOKIE)?.value !== 'v1') {
    const response = anonymousSession(req, false);
    clearAuthCookies(response);
    return response;
  }

  const auth = await getAuthUser(req);
  if (!auth) {
    // This endpoint is an identity probe, not a protected resource. A signed-out
    // browser is a normal state, so do not turn every public page load into a
    // noisy 401. Protected APIs continue to reject anonymous requests.
    return anonymousSession(req);
  }

  const db = getDbAdapter();
  const row = await db.queryOne<{
    id: string;
    email: string;
    name: string;
    plan: string;
    email_verified: number | boolean;
    project_count: number;
    avatar_url: string | null;
    stage: string | null;
    role: string | null;
  }>(
    `SELECT id, email, name, plan, email_verified, project_count, avatar_url, stage, role
       FROM nf_users WHERE id = ?`,
    auth.userId,
  );

  if (!row) {
    // The account may have been deleted between token verification and this
    // lookup. Treat that as an authoritative signed-out state so stale local
    // identity is cleared rather than preserved indefinitely.
    return anonymousSession(req);
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      plan: row.plan,
      projectCount: row.project_count ?? 0,
      emailVerified: toBool(row.email_verified),
      avatarUrl: row.avatar_url ?? undefined,
      role: row.role ?? undefined,
      nexyfabStage: parseUserStageColumn(row.stage),
    },
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
