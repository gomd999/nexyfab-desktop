import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { teamId } = await params;

  const body = await req.json().catch(() => ({})) as { newOwnerId?: string };
  if (!body.newOwnerId || typeof body.newOwnerId !== 'string') {
    return NextResponse.json({ error: 'newOwnerId is required' }, { status: 400 });
  }
  const { newOwnerId } = body;

  const db = getDbAdapter();

  // 요청자가 현재 소유자인지 확인
  const team = await db.queryOne<{ owner_id: string }>(
    'SELECT owner_id FROM nf_teams WHERE id = ?', teamId,
  );
  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  if (team.owner_id !== authUser.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // newOwnerId가 해당 팀의 멤버인지 확인
  const newOwnerMember = await db.queryOne<{ id: string; email: string; role: string }>(
    'SELECT id, email, role FROM nf_team_members WHERE team_id = ? AND user_id = ?',
    teamId, newOwnerId,
  );
  if (!newOwnerMember) {
    return NextResponse.json({ error: '새 소유자가 팀 멤버가 아닙니다.' }, { status: 400 });
  }

  const now = Date.now();

  // nf_teams owner_id 업데이트
  await db.execute(
    'UPDATE nf_teams SET owner_id = ? WHERE id = ?',
    newOwnerId, teamId,
  );

  // 기존 소유자를 nf_team_members에 manager 역할로 추가 (INSERT OR IGNORE)
  await db.execute(
    `INSERT OR IGNORE INTO nf_team_members (id, team_id, user_id, email, role, invited_by, joined_at, created_at)
     VALUES (?, ?, ?, ?, 'manager', ?, ?, ?)`,
    `tm-${crypto.randomUUID()}`, teamId, authUser.userId, authUser.email,
    authUser.userId, now, now,
  );

  // 새 소유자의 nf_team_members 레코드 삭제 (소유자는 members 테이블에 없어도 됨)
  await db.execute(
    'DELETE FROM nf_team_members WHERE team_id = ? AND user_id = ?',
    teamId, newOwnerId,
  );

  return NextResponse.json({ ok: true, newOwnerId });
}
