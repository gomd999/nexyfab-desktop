import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { rowToComment } from '../comments-types';

// ─── PATCH /api/nexyfab/comments/[id] — Resolve a comment ────────────────────

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

  // Verify user has access to the project
  const project = await db.queryOne<{ id: string }>(
    'SELECT id FROM nf_projects WHERE id = ? AND user_id = ?',
    row.project_id, authUser.userId,
  );
  if (!project) {
    // Also check org-level access
    const orgProject = authUser.orgIds.length > 0
      ? await db.queryOne<{ id: string }>(
          `SELECT p.id FROM nf_projects p
           JOIN nf_org_members om ON om.user_id = p.user_id
           WHERE p.id = ? AND om.org_id IN (SELECT org_id FROM nf_org_members WHERE user_id = ?)`,
          row.project_id, authUser.userId,
        )
      : null;
    if (!orgProject) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const body = await req.json() as { resolved?: boolean };
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

  return NextResponse.json({ comment: rowToComment(updated!) });
}

// ─── DELETE /api/nexyfab/comments/[id] ───────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

  const result = await db.execute('DELETE FROM nf_comments WHERE id = ? AND author = ?', id, authUser.email);

  if (result.changes === 0) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
  }

  return new Response(null, { status: 204 });
}
