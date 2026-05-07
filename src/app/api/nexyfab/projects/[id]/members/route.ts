/**
 * 멤버 upsert: SQLite·PostgreSQL 모두 `ON CONFLICT(project_id, user_id) DO UPDATE` 지원.
 * 스테이징에서 PG만 쓸 경우 한 번 `POST /members`로 스모크 권장.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { logAudit } from '@/lib/audit';
import { ensureProjectMembersTable, resolveProjectAccess } from '@/lib/nfProjectAccess';
import { normalizeInviteEmail, parseMemberInviteRole } from '@/lib/nfProjectMemberInput';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';

const postBodySchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(['editor', 'viewer']),
});

export type NfProjectMemberRow = {
  userId: string;
  email: string;
  role: string;
  createdAt: number;
};

// ─── GET /api/nexyfab/projects/[id]/members — 소유자만 ───────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authUser = await getAuthUser(_req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const db = getDbAdapter();
  const access = await resolveProjectAccess(db, id, authUser.userId);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (access.role !== 'owner') {
    return NextResponse.json(
      { error: 'Only the project owner can manage members.', code: 'PROJECT_OWNER_ONLY' },
      { status: 403 },
    );
  }

  await ensureProjectMembersTable();
  const rows = await db.queryAll<{ user_id: string; email: string; role: string; created_at: number }>(
    `SELECT m.user_id, u.email, m.role, m.created_at
     FROM nf_project_members m
     INNER JOIN nf_users u ON u.id = m.user_id
     WHERE m.project_id = ?
     ORDER BY m.created_at ASC`,
    id,
  );
  const members: NfProjectMemberRow[] = rows.map(r => ({
    userId: r.user_id,
    email: r.email,
    role: r.role,
    createdAt: r.created_at,
  }));
  return NextResponse.json({ members });
}

// ─── POST /api/nexyfab/projects/[id]/members — 소유자만, 이메일로 초대 ───────

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
      { error: 'Only the project owner can add members.', code: 'PROJECT_OWNER_ONLY' },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = postBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().formErrors.join('; ') }, { status: 400 });
  }
  const emailNorm = normalizeInviteEmail(parsed.data.email);
  const role = parseMemberInviteRole(parsed.data.role);
  if (!role) return NextResponse.json({ error: 'Invalid role' }, { status: 400 });

  const target = await db.queryOne<{ id: string }>(
    'SELECT id FROM nf_users WHERE lower(trim(email)) = ?',
    emailNorm,
  );
  if (!target) {
    return NextResponse.json({ error: 'No user with that email', code: 'USER_NOT_FOUND' }, { status: 404 });
  }
  if (target.id === access.ownerUserId) {
    return NextResponse.json({ error: 'Owner is already on the project' }, { status: 400 });
  }

  await ensureProjectMembersTable();
  const now = Date.now();
  await db.execute(
    `INSERT INTO nf_project_members (project_id, user_id, role, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role`,
    id,
    target.id,
    role,
    now,
  );

  const ip = getTrustedClientIpOrUndefined(req.headers);
  logAudit({
    userId: authUser.userId,
    action: 'project.member_add',
    resourceId: id,
    ip,
    metadata: { memberUserId: target.id, role },
  });

  const row = await db.queryOne<{ user_id: string; email: string; role: string; created_at: number }>(
    `SELECT m.user_id, u.email, m.role, m.created_at
     FROM nf_project_members m
     INNER JOIN nf_users u ON u.id = m.user_id
     WHERE m.project_id = ? AND m.user_id = ?`,
    id,
    target.id,
  );
  if (!row) return NextResponse.json({ error: 'Member row missing after insert' }, { status: 500 });

  return NextResponse.json({
    member: {
      userId: row.user_id,
      email: row.email,
      role: row.role,
      createdAt: row.created_at,
    } satisfies NfProjectMemberRow,
  });
}

// ─── DELETE /api/nexyfab/projects/[id]/members?userId= — 소유자만 ───────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId || userId.length > 128) {
    return NextResponse.json({ error: 'userId query required' }, { status: 400 });
  }

  const { id } = await params;
  const db = getDbAdapter();
  const access = await resolveProjectAccess(db, id, authUser.userId);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (access.role !== 'owner') {
    return NextResponse.json(
      { error: 'Only the project owner can remove members.', code: 'PROJECT_OWNER_ONLY' },
      { status: 403 },
    );
  }
  if (userId === access.ownerUserId) {
    return NextResponse.json({ error: 'Cannot remove project owner' }, { status: 400 });
  }

  await ensureProjectMembersTable();
  const result = await db.execute(
    'DELETE FROM nf_project_members WHERE project_id = ? AND user_id = ?',
    id,
    userId,
  );
  if (result.changes === 0) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }

  const ip = getTrustedClientIpOrUndefined(req.headers);
  logAudit({
    userId: authUser.userId,
    action: 'project.member_remove',
    resourceId: id,
    ip,
    metadata: { memberUserId: userId },
  });

  return NextResponse.json({ ok: true });
}
