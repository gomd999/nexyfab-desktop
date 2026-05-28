/**
 * /api/documents/[id]/permissions — document-level ACL endpoints.
 *
 * Per §4.1 + §8 of `docs/wave-2-cloud-document-migration.md`:
 *
 *   GET  — list per-document permission rows (visible to viewer+).
 *   POST — grant a role to a user; body `{ userId, role, expiresAt? }`.
 *          Idempotent on the (document_id, user_id) PK: upserts the role.
 *
 * Constraint enforcement per §8.1 (last paragraph): exactly one user is
 * `owner` at a time. The schema sketches a partial unique index for this;
 * SQLite tests skip the index, so we enforce in code by refusing to upsert
 * a second `owner` row through this endpoint. Ownership transfer is a Phase
 * 6+ feature with its own flow.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { logAudit } from '@/lib/audit';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';
import {
  ensureCloudDocTables,
  resolveDocAccess,
  type DocRole,
} from '@/lib/cloudDoc/access';

interface PermissionRow {
  document_id: string;
  user_id: string;
  role: string;
  granted_by: string | null;
  granted_at: number;
  expires_at: number | null;
}

function publicPermissionShape(row: PermissionRow) {
  return {
    documentId: row.document_id,
    userId:     row.user_id,
    role:       row.role,
    grantedBy:  row.granted_by,
    grantedAt:  row.granted_at,
    expiresAt:  row.expires_at,
  };
}

function isValidRole(raw: unknown): raw is DocRole {
  return raw === 'owner' || raw === 'editor' || raw === 'commenter' || raw === 'viewer';
}

// ─── GET /api/documents/[id]/permissions ────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const db = getDbAdapter();
  await ensureCloudDocTables();

  const access = await resolveDocAccess(db, id, authUser.userId);
  if (!access) return NextResponse.json({ error: 'Not found', code: 'document.not_found' }, { status: 404 });

  // viewer+ may list (per §4.1).
  const rows = await db.queryAll<PermissionRow>(
    'SELECT * FROM nf_document_permissions WHERE document_id = ? ORDER BY granted_at ASC',
    id,
  );

  return NextResponse.json({
    ok: true,
    permissions: rows.map(publicPermissionShape),
  });
}

// ─── POST /api/documents/[id]/permissions ───────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });

  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const db = getDbAdapter();
  await ensureCloudDocTables();

  const access = await resolveDocAccess(db, id, authUser.userId);
  if (!access) return NextResponse.json({ error: 'Not found', code: 'document.not_found' }, { status: 404 });

  // Only owners can mutate the ACL (§4.1).
  if (access.role !== 'owner') {
    return NextResponse.json(
      { error: 'Only the document owner can manage permissions', code: 'document.permission_denied' },
      { status: 403 },
    );
  }

  let body: { userId?: unknown; role?: unknown; expiresAt?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (typeof body.userId !== 'string' || body.userId.length === 0) {
    return NextResponse.json({ error: 'userId is required', code: 'validation.userId' }, { status: 400 });
  }
  if (!isValidRole(body.role)) {
    return NextResponse.json(
      { error: 'role must be one of owner|editor|commenter|viewer', code: 'validation.role' },
      { status: 400 },
    );
  }

  let expiresAt: number | null = null;
  if (body.expiresAt !== undefined && body.expiresAt !== null) {
    if (typeof body.expiresAt !== 'number' || !Number.isFinite(body.expiresAt)) {
      return NextResponse.json({ error: 'expiresAt must be a unix ms number', code: 'validation.expires' }, { status: 400 });
    }
    if (body.expiresAt <= Date.now()) {
      return NextResponse.json({ error: 'expiresAt must be in the future', code: 'validation.expires' }, { status: 400 });
    }
    expiresAt = body.expiresAt;
  }

  // Check target user exists. We don't surface details about *which* user
  // exists / doesn't (low PII leak), but we *do* require the user to be in
  // the system so we don't create dangling rows.
  const targetUser = await db.queryOne<{ id: string }>(
    'SELECT id FROM nf_users WHERE id = ?', body.userId,
  );
  if (!targetUser) {
    return NextResponse.json({ error: 'User not found', code: 'user.not_found' }, { status: 404 });
  }

  // Self-grant guard — an owner cannot demote themselves through this
  // endpoint (use a dedicated ownership-transfer path Phase 6+).
  if (body.userId === authUser.userId) {
    return NextResponse.json(
      { error: 'Use ownership transfer to change your own role', code: 'permission.self' },
      { status: 400 },
    );
  }

  // Block multi-owner: schema sketches a partial unique index but we also
  // enforce here since SQLite tests skip the index.
  if (body.role === 'owner') {
    return NextResponse.json(
      {
        error: 'Use ownership transfer to set a new owner (single-owner constraint)',
        code: 'permission.multi_owner',
      },
      { status: 400 },
    );
  }

  const now = Date.now();
  const existing = await db.queryOne<PermissionRow>(
    'SELECT * FROM nf_document_permissions WHERE document_id = ? AND user_id = ?',
    id, body.userId,
  );

  if (existing) {
    await db.execute(
      `UPDATE nf_document_permissions
       SET role = ?, granted_by = ?, granted_at = ?, expires_at = ?
       WHERE document_id = ? AND user_id = ?`,
      body.role, authUser.userId, now, expiresAt, id, body.userId,
    );
  } else {
    await db.execute(
      `INSERT INTO nf_document_permissions (
         document_id, user_id, role, granted_by, granted_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      id, body.userId, body.role, authUser.userId, now, expiresAt,
    );
  }

  logAudit({
    userId: authUser.userId,
    action: existing ? 'document.permission_update' : 'document.share',
    resourceId: id,
    ip: getTrustedClientIpOrUndefined(req.headers),
    metadata: { targetUserId: body.userId, role: body.role, expiresAt: expiresAt ?? 0 },
  });

  return NextResponse.json({
    ok: true,
    permission: publicPermissionShape({
      document_id: id,
      user_id:     body.userId,
      role:        body.role,
      granted_by:  authUser.userId,
      granted_at:  now,
      expires_at:  expiresAt,
    }),
  }, { status: existing ? 200 : 201 });
}
