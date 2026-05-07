import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { logAudit } from '@/lib/audit';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { normalizeInviteEmail, parseMemberInviteRole } from '@/lib/nfProjectMemberInput';
import {
  deleteExpiredProjectInvites,
  ensureProjectInvitesTable,
  inviteExpiresAt,
  maskEmailForInvite,
  newInviteToken,
} from '@/lib/nfProjectInvites';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';

const postSchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(['editor', 'viewer']),
});

/**
 * 미수락 이메일 초대 목록 (소유자만). 토큰은 링크 폐기 API용으로만 내려감.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const db = getDbAdapter();
  const access = await resolveProjectAccess(db, id, authUser.userId);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (access.role !== 'owner') {
    return NextResponse.json(
      { error: 'Only the project owner can list invites.', code: 'PROJECT_OWNER_ONLY' },
      { status: 403 },
    );
  }

  await deleteExpiredProjectInvites(db);
  const rows = await db.queryAll<{
    token: string;
    email_norm: string;
    role: string;
    expires_at: number;
    created_at: number;
  }>(
    `SELECT token, email_norm, role, expires_at, created_at
     FROM nf_project_invites WHERE project_id = ? ORDER BY created_at DESC`,
    id,
  );

  const now = Date.now();
  return NextResponse.json({
    invites: rows.map(r => ({
      token: r.token,
      emailHint: maskEmailForInvite(r.email_norm),
      role: r.role,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
      expired: now > r.expires_at,
    })),
  });
}

/**
 * 이메일 가입 전 사용자용 초대 토큰 생성 (소유자만).
 * 이미 `nf_users`에 있는 이메일은 `POST .../members` 사용.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const db = getDbAdapter();
  const access = await resolveProjectAccess(db, id, authUser.userId);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (access.role !== 'owner') {
    return NextResponse.json(
      { error: 'Only the project owner can create invites.', code: 'PROJECT_OWNER_ONLY' },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().formErrors.join('; ') }, { status: 400 });
  }
  const emailNorm = normalizeInviteEmail(parsed.data.email);
  const role = parseMemberInviteRole(parsed.data.role);
  if (!role) return NextResponse.json({ error: 'Invalid role' }, { status: 400 });

  const existingUser = await db.queryOne<{ id: string }>(
    'SELECT id FROM nf_users WHERE lower(trim(email)) = ?',
    emailNorm,
  );
  if (existingUser) {
    return NextResponse.json(
      {
        error: 'User already registered — add them via Team → Add with the same email.',
        code: 'USER_ALREADY_REGISTERED',
      },
      { status: 409 },
    );
  }

  await ensureProjectInvitesTable(db);
  const now = Date.now();
  const token = newInviteToken();
  const exp = inviteExpiresAt(now);
  const rowId = `pvi-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

  await db.execute(
    `INSERT INTO nf_project_invites (id, project_id, email_norm, role, token, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, email_norm) DO UPDATE SET
       role = excluded.role,
       token = excluded.token,
       expires_at = excluded.expires_at,
       created_at = excluded.created_at`,
    rowId,
    id,
    emailNorm,
    role,
    token,
    exp,
    now,
  );

  const ip = getTrustedClientIpOrUndefined(req.headers);
  logAudit({
    userId: authUser.userId,
    action: 'project.invite_create',
    resourceId: id,
    ip,
    metadata: { emailNorm, role },
  });

  return NextResponse.json({
    token,
    expiresAt: exp,
  });
}

/**
 * 소유자만: 미수락 초대 행 삭제(토큰 무효화). 쿼리 `token` 필수.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const token = req.nextUrl.searchParams.get('token')?.trim();
  if (!token || token.length > 80) {
    return NextResponse.json({ error: 'Missing or invalid token' }, { status: 400 });
  }

  const db = getDbAdapter();
  const access = await resolveProjectAccess(db, id, authUser.userId);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (access.role !== 'owner') {
    return NextResponse.json(
      { error: 'Only the project owner can revoke invites.', code: 'PROJECT_OWNER_ONLY' },
      { status: 403 },
    );
  }

  await ensureProjectInvitesTable(db);
  const { changes } = await db.execute(
    'DELETE FROM nf_project_invites WHERE project_id = ? AND token = ?',
    id,
    token,
  );
  if (changes === 0) {
    return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
  }

  const ip = getTrustedClientIpOrUndefined(req.headers);
  logAudit({
    userId: authUser.userId,
    action: 'project.invite_revoke',
    resourceId: id,
    ip,
    metadata: { tokenSuffix: token.slice(-8) },
  });

  return NextResponse.json({ ok: true });
}
