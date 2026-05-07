export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { addOrgMember, grantRole } from '@/lib/rbac';

/**
 * POST /api/nexyfab/orgs/join — 초대 수락
 * Body: { token: string }
 */
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { token } = await req.json() as { token: string };
  if (!token) return NextResponse.json({ error: 'token이 필요합니다.' }, { status: 400 });

  const db = getDbAdapter();

  // 이미 조직에 소속되어 있으면 거부 (DB에서 직접 확인 — race condition 방지)
  const existingMembership = await db.queryOne<{ id: string }>(
    'SELECT id FROM nf_org_members WHERE user_id = ? LIMIT 1',
    authUser.userId,
  );
  if (existingMembership) {
    return NextResponse.json({ error: '이미 다른 조직에 소속되어 있습니다.' }, { status: 409 });
  }

  const invite = await db.queryOne<{
    id: string; org_id: string; email: string; role: string; status: string; expires_at: number;
  }>(
    "SELECT id, org_id, email, role, status, expires_at FROM nf_org_invites WHERE token = ?",
    token,
  );

  if (!invite) {
    return NextResponse.json({ error: '유효하지 않은 초대입니다.' }, { status: 404 });
  }
  if (invite.status !== 'pending') {
    return NextResponse.json({ error: '이미 처리된 초대입니다.' }, { status: 410 });
  }
  if (invite.expires_at < Date.now()) {
    return NextResponse.json({ error: '만료된 초대입니다.' }, { status: 410 });
  }
  if (invite.email !== authUser.email) {
    return NextResponse.json({ error: '초대된 이메일과 로그인 계정이 다릅니다.' }, { status: 403 });
  }

  // Add to org
  await addOrgMember(invite.org_id, authUser.userId, invite.role);

  // Grant nexyfab customer role if not already
  await grantRole(authUser.userId, 'nexyfab', 'customer', invite.org_id);

  // Update invite status
  await db.execute(
    "UPDATE nf_org_invites SET status = 'accepted' WHERE id = ?",
    invite.id,
  );

  // Sync user plan to org plan
  const org = await db.queryOne<{ plan: string; name: string }>(
    'SELECT plan, name FROM nf_orgs WHERE id = ?',
    invite.org_id,
  );
  if (org && org.plan !== authUser.plan) {
    await db.execute('UPDATE nf_users SET plan = ? WHERE id = ?', org.plan, authUser.userId);
  }

  return NextResponse.json({
    ok: true,
    org: { id: invite.org_id, name: org?.name },
    message: '조직에 합류했습니다.',
  });
}
