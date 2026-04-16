export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { sendNotificationEmail } from '@/app/lib/mailer';

/**
 * GET  /api/nexyfab/orgs/invite — 초대 목록 + 현재 멤버 목록
 * POST /api/nexyfab/orgs/invite — 멤버 초대 (이메일로 토큰 발송)
 */

// ─── GET: 초대 + 멤버 목록 ──────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const orgId = authUser.orgIds[0];
  if (!orgId) return NextResponse.json({ error: '조직에 소속되어 있지 않습니다.' }, { status: 403 });

  const db = getDbAdapter();

  const [members, invites] = await Promise.all([
    db.queryAll<{ user_id: string; email: string; name: string; role: string; joined_at: number }>(
      `SELECT om.user_id, u.email, u.name, om.role, om.joined_at
       FROM nf_org_members om
       JOIN nf_users u ON u.id = om.user_id
       WHERE om.org_id = ?
       ORDER BY om.joined_at ASC`,
      orgId,
    ),
    db.queryAll<{ id: string; email: string; role: string; expires_at: number; created_at: number }>(
      "SELECT id, email, role, expires_at, created_at FROM nf_org_invites WHERE org_id = ? AND status = 'pending' ORDER BY created_at DESC",
      orgId,
    ),
  ]);

  return NextResponse.json({ members, invites });
}

// ─── POST: 멤버 초대 ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const orgId = authUser.orgIds[0];
  if (!orgId) return NextResponse.json({ error: '조직에 소속되어 있지 않습니다.' }, { status: 403 });

  // Only owner or org_admin can invite
  const isOrgAdmin = authUser.roles.some(
    r => r.product === 'nexyfab' && (r.role === 'org_admin') && r.orgId === orgId,
  );
  if (!isOrgAdmin && authUser.globalRole !== 'super_admin') {
    return NextResponse.json({ error: '초대 권한이 없습니다.' }, { status: 403 });
  }

  const body = await req.json() as { email: string; role?: string };
  const email = body.email?.trim()?.toLowerCase();
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: '유효한 이메일을 입력해주세요.' }, { status: 400 });
  }

  const VALID_INVITE_ROLES = ['member', 'admin'];
  const role = body.role ?? 'member';
  if (!VALID_INVITE_ROLES.includes(role)) {
    return NextResponse.json({ error: '유효하지 않은 역할입니다.' }, { status: 400 });
  }
  const db = getDbAdapter();

  // Check if already a member
  const existingMember = await db.queryOne<{ id: string }>(
    `SELECT om.id FROM nf_org_members om
     JOIN nf_users u ON u.id = om.user_id
     WHERE om.org_id = ? AND u.email = ?`,
    orgId, email,
  );
  if (existingMember) {
    return NextResponse.json({ error: '이미 조직 멤버입니다.' }, { status: 409 });
  }

  // Check for pending invite
  const existingInvite = await db.queryOne<{ id: string }>(
    "SELECT id FROM nf_org_invites WHERE org_id = ? AND email = ? AND status = 'pending' AND expires_at > ?",
    orgId, email, Date.now(),
  );
  if (existingInvite) {
    return NextResponse.json({ error: '이미 초대가 발송되었습니다.' }, { status: 409 });
  }

  // Get org name
  const org = await db.queryOne<{ name: string }>('SELECT name FROM nf_orgs WHERE id = ?', orgId);
  const orgName = org?.name ?? '조직';

  // Create invite
  const inviteId = crypto.randomUUID();
  const token = crypto.randomUUID();
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7일

  await db.execute(
    `INSERT INTO nf_org_invites (id, org_id, email, role, token, status, expires_at, invited_by, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    inviteId, orgId, email, role, token, expiresAt, authUser.userId, Date.now(),
  );

  // Send email
  const inviteUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'https://nexyfab.com'}/ko/nexyfab/orgs/join?token=${token}`;
  await sendNotificationEmail(
    email,
    `[NexyFab] ${orgName} 조직 초대`,
    `${orgName}에서 NexyFab 조직 멤버로 초대했습니다.\n\n아래 링크를 클릭하여 초대를 수락하세요:\n${inviteUrl}\n\n이 초대는 7일 후 만료됩니다.`,
  ).catch(err => console.error('[org-invite] Email failed:', err));

  return NextResponse.json({
    ok: true,
    invite: { id: inviteId, email, role, expiresAt },
  }, { status: 201 });
}
