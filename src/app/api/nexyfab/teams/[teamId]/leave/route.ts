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
  const db = getDbAdapter();

  const team = await db.queryOne<{ owner_id: string }>(
    'SELECT owner_id FROM nf_teams WHERE id = ?', teamId,
  );
  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

  // 소유자는 탈퇴 불가
  if (team.owner_id === authUser.userId) {
    return NextResponse.json(
      { error: '소유자는 팀을 탈퇴할 수 없습니다. 소유권을 이전하거나 팀을 삭제하세요.' },
      { status: 403 },
    );
  }

  // nf_team_members에서 삭제
  await db.execute(
    'DELETE FROM nf_team_members WHERE team_id = ? AND user_id = ?',
    teamId, authUser.userId,
  );

  return NextResponse.json({ ok: true });
}
