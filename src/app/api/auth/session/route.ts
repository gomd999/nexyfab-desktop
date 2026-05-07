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

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await getAuthUser(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({
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
  });
}
