/**
 * PATCH  /api/nexyfab/prompt-library/[id]   — update title/prompt/description
 * DELETE /api/nexyfab/prompt-library/[id]   — delete
 *
 * Permissions:
 *   personal scope  — only the owner may update or delete.
 *   org scope       — owner may update; owner OR org_admin (of that org)
 *                     may delete. Members may not delete each other's prompts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

interface PromptRow {
  id: string;
  scope: string;
  org_id: string | null;
  owner_id: string;
  title: string;
  prompt: string;
  description: string | null;
  created_at: number;
  updated_at: number;
}

interface UpdateBody {
  title?: unknown;
  prompt?: unknown;
  description?: unknown;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const db = getDbAdapter();

  const row = await db.queryOne<PromptRow>(
    'SELECT * FROM nf_prompt_library WHERE id = ?', id,
  );
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Only the author can edit (org_admin can only delete, not rewrite)
  if (row.owner_id !== authUser.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as UpdateBody;

  const nextTitle = typeof body.title === 'string' ? body.title.trim() : null;
  const nextPrompt = typeof body.prompt === 'string' ? body.prompt.trim() : null;
  const nextDesc = typeof body.description === 'string' ? body.description.trim() : null;

  if (nextTitle !== null && (nextTitle.length === 0 || nextTitle.length > 120)) {
    return NextResponse.json({ error: 'title must be 1-120 chars' }, { status: 400 });
  }
  if (nextPrompt !== null && (nextPrompt.length === 0 || nextPrompt.length > 4000)) {
    return NextResponse.json({ error: 'prompt must be 1-4000 chars' }, { status: 400 });
  }
  if (nextDesc !== null && nextDesc.length > 500) {
    return NextResponse.json({ error: 'description too long (max 500)' }, { status: 400 });
  }

  const now = Date.now();
  await db.execute(
    `UPDATE nf_prompt_library
        SET title = COALESCE(?, title),
            prompt = COALESCE(?, prompt),
            description = CASE WHEN ? IS NULL THEN description ELSE ? END,
            updated_at = ?
      WHERE id = ?`,
    nextTitle, nextPrompt, nextDesc, nextDesc || null, now, id,
  );

  const updated = await db.queryOne<PromptRow>('SELECT * FROM nf_prompt_library WHERE id = ?', id);
  return NextResponse.json({
    entry: updated && {
      id: updated.id,
      scope: updated.scope === 'org' ? 'org' : 'personal',
      orgId: updated.org_id,
      ownerId: updated.owner_id,
      title: updated.title,
      prompt: updated.prompt,
      description: updated.description,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
      isMine: true,
    },
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const db = getDbAdapter();

  const row = await db.queryOne<PromptRow>(
    'SELECT * FROM nf_prompt_library WHERE id = ?', id,
  );
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const isOwner = row.owner_id === authUser.userId;
  const isOrgAdminOfShare = row.scope === 'org' && row.org_id != null && authUser.roles.some(
    (r) => r.product === 'nexyfab' && r.role === 'org_admin' && r.orgId === row.org_id,
  );
  const isSuperAdmin = authUser.globalRole === 'super_admin';

  if (!isOwner && !isOrgAdminOfShare && !isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await db.execute('DELETE FROM nf_prompt_library WHERE id = ?', id);
  return NextResponse.json({ ok: true });
}
