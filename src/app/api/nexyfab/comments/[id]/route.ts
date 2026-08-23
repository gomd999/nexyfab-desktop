import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { rowToComment } from '../comments-types';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { resolveRequestOrgContext, resourceBelongsToOrgContext } from '@/lib/org-context';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_COMMENT_PATCH_BODY_BYTES = 16 * 1024;

// ─── PATCH /api/nexyfab/comments/[id] — Resolve a comment ────────────────────

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const workspace = resolveRequestOrgContext(authUser);
  if (!workspace.ok) return NextResponse.json({ error: 'Select a valid workspace', code: workspace.code }, { status: 409 });

  const { id } = await context.params;
  const db = getDbAdapter();

  const row = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM nf_comments WHERE id = ?',
    id,
  );

  if (!row) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
  }

  // Ownership check: only comment author can resolve
  if (row.author !== authUser.email) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await db.execute('ALTER TABLE nf_projects ADD COLUMN org_id TEXT').catch(() => {});
  const access = await resolveProjectAccess(db, String(row.project_id), authUser);
  if (!access || !access.canEdit || !resourceBelongsToOrgContext(access.row.org_id, workspace)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { resolved?: boolean };
  try {
    body = await readBoundedJson(req, MAX_COMMENT_PATCH_BODY_BYTES);
  } catch (error) {
    const bounded = boundedJsonError(error) ?? { code: 'BAD_REQUEST' as const, status: 400 as const };
    return NextResponse.json(
      {
        error: bounded.code === 'PAYLOAD_TOO_LARGE' ? 'Request too large' : 'Invalid JSON',
        ...(bounded.code === 'PAYLOAD_TOO_LARGE' ? { code: bounded.code } : {}),
      },
      { status: bounded.status },
    );
  }
  if (typeof body.resolved !== 'boolean') {
    return NextResponse.json({ error: 'resolved (boolean) is required' }, { status: 400 });
  }

  await db.execute(
    'UPDATE nf_comments SET resolved = ? WHERE id = ?',
    body.resolved ? 1 : 0,
    id,
  );

  const updated = await db.queryOne<Record<string, unknown>>(
    'SELECT * FROM nf_comments WHERE id = ?',
    id,
  );
  if (!updated) return NextResponse.json({ error: 'Comment not found' }, { status: 404 });

  return NextResponse.json({ comment: rowToComment(updated) });
}

// ─── DELETE /api/nexyfab/comments/[id] ───────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const workspace = resolveRequestOrgContext(authUser);
  if (!workspace.ok) return NextResponse.json({ error: 'Select a valid workspace', code: workspace.code }, { status: 409 });

  const { id } = await context.params;
  const db = getDbAdapter();

  const row = await db.queryOne<Record<string, unknown>>(
    'SELECT id, author, project_id FROM nf_comments WHERE id = ?',
    id,
  );
  if (!row) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
  }
  if (row.author !== authUser.email) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await db.execute('ALTER TABLE nf_projects ADD COLUMN org_id TEXT').catch(() => {});
  const access = await resolveProjectAccess(db, String(row.project_id), authUser);
  if (!access || !access.canEdit || !resourceBelongsToOrgContext(access.row.org_id, workspace)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const result = await db.execute('DELETE FROM nf_comments WHERE id = ? AND author = ?', id, authUser.email);

  if (result.changes === 0) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
  }

  return new Response(null, { status: 204 });
}
