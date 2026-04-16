import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { teamId } = await params;
  const db = getDbAdapter();

  // 1. 요청자가 해당 팀의 멤버인지 확인 (owner 또는 nf_team_members)
  const team = await db.queryOne<{ owner_id: string }>(
    'SELECT owner_id FROM nf_teams WHERE id = ?', teamId,
  );
  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

  const isOwner = team.owner_id === authUser.userId;
  if (!isOwner) {
    const membership = await db.queryOne(
      'SELECT id FROM nf_team_members WHERE team_id = ? AND user_id = ?',
      teamId, authUser.userId,
    );
    if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 2. 팀원 전체 user_id 목록 수집 (owner + members)
  const members = await db.queryAll<{ user_id: string; email: string }>(
    'SELECT user_id, email FROM nf_team_members WHERE team_id = ?', teamId,
  );
  const memberUserIds = members.map((m) => m.user_id);
  const allUserIds = Array.from(new Set([team.owner_id, ...memberUserIds]));

  if (allUserIds.length === 0) {
    return NextResponse.json({ logs: [] });
  }

  // 3. nf_audit_log WHERE user_id IN (...) — 최신순, limit 50
  const placeholders = allUserIds.map(() => '?').join(', ');
  const rawLogs = await db.queryAll<{
    id: string;
    user_id: string;
    action: string;
    resource_id: string | null;
    created_at: number;
  }>(
    `SELECT id, user_id, action, resource_id, created_at
     FROM nf_audit_log
     WHERE user_id IN (${placeholders})
     ORDER BY created_at DESC
     LIMIT 50`,
    ...allUserIds,
  );

  // 4. userEmail 필드 매핑 (owner는 'owner' 표기)
  const emailMap = new Map<string, string>();
  for (const m of members) {
    emailMap.set(m.user_id, m.email);
  }

  const logs = rawLogs.map((log) => ({
    id: log.id,
    userId: log.user_id,
    userEmail: log.user_id === team.owner_id ? 'owner' : (emailMap.get(log.user_id) ?? log.user_id),
    action: log.action,
    resourceId: log.resource_id ?? null,
    createdAt: log.created_at,
  }));

  return NextResponse.json({ logs });
}
