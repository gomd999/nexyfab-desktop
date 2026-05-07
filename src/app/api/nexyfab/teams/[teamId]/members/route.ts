import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { sendNotificationEmail } from '@/app/lib/mailer';

export const dynamic = 'force-dynamic';

async function requireTeamOwnerOrManager(teamId: string, userId: string) {
  const db = getDbAdapter();
  const team = await db.queryOne<{ owner_id: string }>(
    'SELECT owner_id FROM nf_teams WHERE id = ?', teamId,
  );
  if (!team) return null;
  if (team.owner_id === userId) return 'owner';
  const member = await db.queryOne<{ role: string }>(
    'SELECT role FROM nf_team_members WHERE team_id = ? AND user_id = ?', teamId, userId,
  );
  if (!member || member.role === 'viewer') return null;
  return member.role;
}

// GET — list members + pending invites
export async function GET(req: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { teamId } = await params;
  const db = getDbAdapter();

  // Must be owner or member
  const team = await db.queryOne<{ id: string; owner_id: string }>('SELECT id, owner_id FROM nf_teams WHERE id = ?', teamId);
  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

  // 팀 소유자이거나 멤버인 경우에만 목록 조회 가능
  const isOwner = team.owner_id === authUser.userId;
  if (!isOwner) {
    const membership = await db.queryOne('SELECT id FROM nf_team_members WHERE team_id = ? AND user_id = ?', teamId, authUser.userId);
    if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const members = await db.queryAll<{ id: string; user_id: string; email: string; role: string; joined_at: number | null; display_name: string | null }>(
    'SELECT tm.id, tm.user_id, tm.email, tm.role, tm.joined_at, u.name as display_name FROM nf_team_members tm LEFT JOIN nf_users u ON u.id = tm.user_id WHERE tm.team_id = ? ORDER BY tm.created_at ASC',
    teamId,
  );

  // Pending invites (owner/manager can see)
  const canManage = await requireTeamOwnerOrManager(teamId, authUser.userId);
  let pendingInvites: { id: string; email: string; role: string; expires_at: number; created_at: number }[] = [];
  if (canManage) {
    pendingInvites = await db.queryAll<{ id: string; email: string; role: string; expires_at: number; created_at: number }>(
      'SELECT id, email, role, expires_at, created_at FROM nf_team_invites WHERE team_id = ? AND expires_at > ? ORDER BY created_at DESC',
      teamId, Date.now(),
    );
  }

  return NextResponse.json({ members, pendingInvites });
}

// POST — invite member
export async function POST(req: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { teamId } = await params;

  const access = await requireTeamOwnerOrManager(teamId, authUser.userId);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const schema = z.object({
    email: z.string().email().max(255),
    role: z.enum(['manager', 'viewer']).default('viewer'),
  });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  const db = getDbAdapter();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nexyfab.com';
  const lang = req.headers.get('accept-language')?.startsWith('ko') ? 'ko' : 'en';
  const token = randomBytes(32).toString('hex');
  const now = Date.now();

  await db.execute(
    `INSERT INTO nf_team_invites (id, team_id, email, role, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(team_id, email) DO UPDATE SET
       id=EXCLUDED.id, role=EXCLUDED.role, token=EXCLUDED.token, expires_at=EXCLUDED.expires_at`,
    `inv-${crypto.randomUUID()}`, teamId, parsed.data.email, parsed.data.role, token, now + 7 * 24 * 3600_000, now,
  );

  await sendNotificationEmail(
    parsed.data.email,
    '[NexyFab] 팀에 초대되었습니다',
    `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>NexyFab Team Invite</title></head>
<body style="margin:0;padding:0;background:#0d1117;font-family:system-ui,-apple-system,sans-serif">
  <div style="max-width:520px;margin:40px auto;background:#161b22;border:1px solid #30363d;border-radius:12px;overflow:hidden">
    <div style="padding:24px 32px;border-bottom:1px solid #30363d;background:linear-gradient(135deg,#1c2033,#161b22)">
      <span style="font-size:22px;font-weight:800;color:#e6edf3"><span style="color:#8b9cf4">Nexy</span>Fab</span>
    </div>
    <div style="padding:32px">
      <h2 style="margin:0 0 12px;font-size:20px;color:#e6edf3">팀에 초대되었습니다 👋</h2>
      <p style="color:#8b949e;line-height:1.6;margin:0 0 8px">NexyFab 팀 협업 플랫폼에 초대받으셨습니다.</p>
      <p style="color:#8b949e;line-height:1.6;margin:0 0 24px">역할: <strong style="color:#e6edf3">${parsed.data.role === 'manager' ? '매니저 (Manager)' : '뷰어 (Viewer)'}</strong></p>
      <a href="${siteUrl}/${lang}/nexyfab/teams/join?token=${token}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#388bfd,#8b5cf6);color:#fff;font-weight:700;font-size:14px;border-radius:8px;text-decoration:none">초대 수락하기 / Accept Invite</a>
      <p style="margin:24px 0 0;font-size:12px;color:#6e7681">이 링크는 7일 후 만료됩니다. 초대를 원치 않으시면 무시하세요.</p>
    </div>
    <div style="padding:16px 32px;border-top:1px solid #30363d;background:#0d1117">
      <p style="margin:0;font-size:11px;color:#6e7681">© NexyFab — AI Manufacturing Platform</p>
    </div>
  </div>
</body>
</html>`,
  ).catch(() => {});

  return NextResponse.json({ ok: true, message: `초대 이메일을 ${parsed.data.email}에 발송했습니다.` });
}

// PATCH — change member role or revoke pending invite
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { teamId } = await params;

  const access = await requireTeamOwnerOrManager(teamId, authUser.userId);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const schema = z.object({
    memberId: z.string().optional(),
    inviteId: z.string().optional(),
    role: z.enum(['manager', 'viewer']),
  });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  const db = getDbAdapter();

  if (parsed.data.memberId) {
    // Cannot demote the owner
    const member = await db.queryOne<{ role: string }>(
      'SELECT role FROM nf_team_members WHERE id = ? AND team_id = ?', parsed.data.memberId, teamId,
    );
    if (!member) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (member.role === 'owner') return NextResponse.json({ error: 'Cannot change owner role' }, { status: 400 });

    await db.execute(
      'UPDATE nf_team_members SET role = ? WHERE id = ? AND team_id = ?',
      parsed.data.role, parsed.data.memberId, teamId,
    );
  } else if (parsed.data.inviteId) {
    await db.execute(
      'UPDATE nf_team_invites SET role = ? WHERE id = ? AND team_id = ?',
      parsed.data.role, parsed.data.inviteId, teamId,
    );
  } else {
    return NextResponse.json({ error: 'memberId or inviteId required' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

// DELETE — remove member or revoke pending invite
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { teamId } = await params;

  const access = await requireTeamOwnerOrManager(teamId, authUser.userId);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { memberId, inviteId } = await req.json().catch(() => ({})) as { memberId?: string; inviteId?: string };
  if (!memberId && !inviteId) return NextResponse.json({ error: 'memberId or inviteId required' }, { status: 400 });

  const db = getDbAdapter();
  if (memberId) {
    await db.execute('DELETE FROM nf_team_members WHERE id = ? AND team_id = ?', memberId, teamId);
  }
  if (inviteId) {
    await db.execute('DELETE FROM nf_team_invites WHERE id = ? AND team_id = ?', inviteId, teamId);
  }
  return NextResponse.json({ ok: true });
}
