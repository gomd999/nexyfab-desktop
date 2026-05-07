import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

// POST /api/nexyfab/teams/join  body: { token }
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { token } = await req.json().catch(() => ({})) as { token?: string };
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });

  const db = getDbAdapter();
  const invite = await db.queryOne<{ id: string; team_id: string; email: string; role: string; expires_at: number }>(
    'SELECT * FROM nf_team_invites WHERE token = ?', token,
  );

  if (!invite) return NextResponse.json({ error: '유효하지 않은 초대 링크입니다.' }, { status: 404 });
  if (invite.expires_at < Date.now()) return NextResponse.json({ error: '만료된 초대 링크입니다.' }, { status: 410 });
  if (invite.email !== authUser.email) return NextResponse.json({ error: '이 초대는 다른 이메일 주소로 발송되었습니다.' }, { status: 403 });

  const now = Date.now();
  await db.execute(
    `INSERT OR IGNORE INTO nf_team_members (id, team_id, user_id, email, role, invited_by, joined_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    `tm-${crypto.randomUUID()}`, invite.team_id, authUser.userId, authUser.email, invite.role, 'invite', now, now,
  );
  await db.execute('DELETE FROM nf_team_invites WHERE token = ?', token);

  // Notify team owner
  const { createNotification } = await import('@/lib/notify');
  const teamRow = await db.queryOne<{ owner_id: string; name: string }>(
    'SELECT owner_id, name FROM nf_teams WHERE id = ?', invite.team_id,
  );
  if (teamRow) {
    await createNotification({
      userId: teamRow.owner_id,
      type: 'team.member_joined',
      title: `새 팀원이 합류했습니다`,
      body: `${authUser.email}님이 ${teamRow.name} 팀에 참여했습니다.`,
      link: `/nexyfab/team`,
    });
  }

  return NextResponse.json({ ok: true, teamId: invite.team_id, role: invite.role });
}
