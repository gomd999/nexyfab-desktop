import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { logAudit } from '@/lib/audit';
import { ensureProjectMembersTable } from '@/lib/nfProjectAccess';
import { normalizeInviteEmail } from '@/lib/nfProjectMemberInput';
import { ensureProjectInvitesTable } from '@/lib/nfProjectInvites';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';

/** 로그인한 사용자 이메일이 초대와 일치하면 `nf_project_members`에 추가하고 초대 행을 삭제. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { token } = await params;
  if (!token || token.length > 80) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
  }

  const db = getDbAdapter();
  await ensureProjectInvitesTable(db);
  const inv = await db.queryOne<{
    id: string;
    project_id: string;
    email_norm: string;
    role: string;
    expires_at: number;
  }>(
    'SELECT id, project_id, email_norm, role, expires_at FROM nf_project_invites WHERE token = ?',
    token,
  );
  if (!inv || Date.now() > inv.expires_at) {
    return NextResponse.json({ error: 'Invite not found or expired' }, { status: 404 });
  }

  const meNorm = normalizeInviteEmail(authUser.email);
  if (meNorm !== inv.email_norm) {
    return NextResponse.json(
      { error: 'Signed-in email does not match this invite.', code: 'INVITE_EMAIL_MISMATCH' },
      { status: 403 },
    );
  }

  const ownerRow = await db.queryOne<{ user_id: string }>(
    'SELECT user_id FROM nf_projects WHERE id = ?',
    inv.project_id,
  );
  if (!ownerRow) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  if (ownerRow.user_id === authUser.userId) {
    return NextResponse.json({ error: 'You already own this project' }, { status: 400 });
  }

  const memberRole = inv.role === 'viewer' ? 'viewer' : 'editor';
  await ensureProjectMembersTable();
  const now = Date.now();
  await db.execute(
    `INSERT INTO nf_project_members (project_id, user_id, role, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role`,
    inv.project_id,
    authUser.userId,
    memberRole,
    now,
  );

  await db.execute('DELETE FROM nf_project_invites WHERE id = ?', inv.id);

  const ip = getTrustedClientIpOrUndefined(req.headers);
  logAudit({
    userId: authUser.userId,
    action: 'project.invite_accept',
    resourceId: inv.project_id,
    ip,
    metadata: { role: memberRole },
  });

  return NextResponse.json({ ok: true, projectId: inv.project_id, role: memberRole });
}
