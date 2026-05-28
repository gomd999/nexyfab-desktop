/**
 * /api/documents/[id] — single-document CRUD endpoints.
 *
 * Per §4.1 of `docs/wave-2-cloud-document-migration.md`:
 *
 *   GET    — metadata + 10-min signed GET URL for `current.ydoc`
 *   PUT    — metadata-only update (name / workspaceId / thumbnailKey);
 *            blob writes go through the collab worker, NOT this endpoint
 *   DELETE — soft-delete (deleted_at = NOW); restorable within 90 d
 *            via PUT ?undelete=1 by the owner only.
 *
 * The DELETE soft-delete model is non-destructive: the R2 blob stays in
 * place under the user's prefix until the nightly GC sweeps deleted_at
 * older than 90 days (§3.5). This means storage cost continues to accrue
 * during the soft-delete window, which we accept in exchange for human-error
 * recovery time.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { getStorage } from '@/lib/storage';
import { logAudit } from '@/lib/audit';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';
import {
  resolveDocAccess,
  type DocumentRow,
  type DocAccess,
} from '@/lib/cloudDoc/access';

const SIGNED_URL_TTL_SEC = 600;     // 10 min, per spec §4.3
const MAX_NAME_LEN = 200;
const SOFT_DELETE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

function publicDocShape(row: DocumentRow, role: string) {
  return {
    id:           row.id,
    name:         row.name,
    ownerId:      row.owner_id,
    workspaceId:  row.workspace_id,
    version:      row.version,
    nfabFormat:   row.nfab_format,
    yjsProto:     row.yjs_proto,
    sizeBytes:    row.size_bytes,
    featureCount: row.feature_count,
    partCount:    row.part_count,
    thumbnailKey: row.thumbnail_r2_key,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
    lastEditedBy: row.last_edited_by,
    deletedAt:    row.deleted_at,
    role,
  };
}

/**
 * Centralised access-resolver wrapper.
 *
 * Returns:
 *   { ok: true, access } on success
 *   { ok: false, response } when the caller should short-circuit with the response.
 *
 * Always returns 404 on no-access (never 403 for non-existence). The caller
 * needs to layer extra checks (role >= editor etc.) on top.
 */
async function loadAccess(
  req: NextRequest,
  documentId: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<{ ok: true; access: DocAccess; userId: string } | { ok: false; response: NextResponse }> {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const db = getDbAdapter();
  const access = await resolveDocAccess(db, documentId, authUser.userId, opts);
  if (!access) {
    return { ok: false, response: NextResponse.json({ error: 'Not found', code: 'document.not_found' }, { status: 404 }) };
  }
  return { ok: true, access, userId: authUser.userId };
}

// ─── GET /api/documents/[id] ────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await loadAccess(req, id);
  if (!result.ok) return result.response;
  const { access } = result;

  // Best-effort signed URL — never fail the request on storage hiccup;
  // client can retry GET (a 200 with no `blobUrl` still gives the client
  // a way to call /api/documents/{id} again).
  let blobUrl: string | null = null;
  try {
    const storage = getStorage();
    blobUrl = await storage.getSignedUrl(access.row.blob_r2_key, SIGNED_URL_TTL_SEC);
  } catch (err) {
    console.warn('[documents.GET] signed URL failed:', (err as Error).message);
  }

  return NextResponse.json({
    ok: true,
    document: publicDocShape(access.row, access.role),
    blobUrl,
    blobUrlExpiresAt: blobUrl ? Date.now() + SIGNED_URL_TTL_SEC * 1000 : null,
  });
}

// ─── PUT /api/documents/[id] ────────────────────────────────────────────────

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });

  const { id } = await params;
  const undelete = req.nextUrl.searchParams.get('undelete') === '1';

  // For undelete the caller must be the owner and we *do* include deleted
  // rows; for normal PUT we exclude deleted rows (treat as 404).
  const result = await loadAccess(req, id, { includeDeleted: undelete });
  if (!result.ok) return result.response;
  const { access, userId } = result;

  const db = getDbAdapter();
  const now = Date.now();

  // ── Undelete branch ──
  if (undelete) {
    if (access.role !== 'owner') {
      return NextResponse.json(
        { error: 'Only the document owner can restore', code: 'document.permission_denied' },
        { status: 403 },
      );
    }
    if (!access.row.deleted_at) {
      return NextResponse.json({ error: 'Document is not deleted', code: 'document.not_deleted' }, { status: 400 });
    }
    if (now - access.row.deleted_at > SOFT_DELETE_WINDOW_MS) {
      // Past the 90-day window — treat as gone, even though the row may still exist pending GC.
      return NextResponse.json({ error: 'Restore window expired', code: 'document.deleted' }, { status: 410 });
    }
    await db.execute(
      'UPDATE nf_documents SET deleted_at = NULL, updated_at = ? WHERE id = ?',
      now, id,
    );
    const updated = await db.queryOne<DocumentRow>('SELECT * FROM nf_documents WHERE id = ?', id);
    if (!updated) return NextResponse.json({ error: 'Document missing after restore' }, { status: 500 });
    logAudit({
      userId, action: 'document.restore', resourceId: id,
      ip: getTrustedClientIpOrUndefined(req.headers),
    });
    return NextResponse.json({ ok: true, document: publicDocShape(updated, access.role) });
  }

  // ── Normal metadata update branch ──
  if (!access.canEdit) {
    return NextResponse.json(
      { error: 'Editor role required', code: 'document.permission_denied' },
      { status: 403 },
    );
  }

  let body: { name?: unknown; workspaceId?: unknown; thumbnailKey?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  let nextName: string | undefined;
  if (body.name !== undefined) {
    if (typeof body.name !== 'string') {
      return NextResponse.json({ error: 'name must be a string', code: 'validation.name' }, { status: 400 });
    }
    const trimmed = body.name.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_NAME_LEN) {
      return NextResponse.json({ error: 'name length must be 1..200', code: 'validation.name' }, { status: 400 });
    }
    nextName = trimmed;
  }

  let nextWorkspaceId: string | null | undefined;
  if (body.workspaceId !== undefined) {
    // Reassigning workspace requires owner role (changes who can access the doc).
    if (access.role !== 'owner') {
      return NextResponse.json(
        { error: 'Only the owner can change workspace', code: 'document.permission_denied' },
        { status: 403 },
      );
    }
    if (body.workspaceId === null) {
      nextWorkspaceId = null;
    } else if (typeof body.workspaceId === 'string' && body.workspaceId.length > 0) {
      const ws = await db.queryOne<{ id: string; owner_id: string; deleted_at: number | null }>(
        'SELECT id, owner_id, deleted_at FROM nf_workspaces WHERE id = ?',
        body.workspaceId,
      );
      if (!ws || ws.deleted_at) {
        return NextResponse.json({ error: 'Workspace not found', code: 'workspace.not_found' }, { status: 404 });
      }
      nextWorkspaceId = ws.id;
    } else {
      return NextResponse.json({ error: 'workspaceId must be string or null', code: 'validation.workspace' }, { status: 400 });
    }
  }

  let nextThumb: string | null | undefined;
  if (body.thumbnailKey !== undefined) {
    if (body.thumbnailKey === null) nextThumb = null;
    else if (typeof body.thumbnailKey === 'string') nextThumb = body.thumbnailKey;
    else return NextResponse.json({ error: 'thumbnailKey must be string or null', code: 'validation.thumbnail' }, { status: 400 });
  }

  // If nothing to update, short-circuit happy path.
  if (nextName === undefined && nextWorkspaceId === undefined && nextThumb === undefined) {
    return NextResponse.json({ ok: true, document: publicDocShape(access.row, access.role) });
  }

  await db.execute(
    `UPDATE nf_documents SET
       name             = COALESCE(?, name),
       workspace_id     = CASE WHEN ? = 1 THEN ? ELSE workspace_id END,
       thumbnail_r2_key = CASE WHEN ? = 1 THEN ? ELSE thumbnail_r2_key END,
       updated_at       = ?,
       last_edited_by   = ?
     WHERE id = ?`,
    nextName ?? null,
    nextWorkspaceId === undefined ? 0 : 1, nextWorkspaceId ?? null,
    nextThumb === undefined ? 0 : 1, nextThumb ?? null,
    now, userId, id,
  );

  const updated = await db.queryOne<DocumentRow>('SELECT * FROM nf_documents WHERE id = ?', id);
  if (!updated) return NextResponse.json({ error: 'Document missing after update' }, { status: 500 });

  logAudit({
    userId, action: 'document.update', resourceId: id,
    ip: getTrustedClientIpOrUndefined(req.headers),
    metadata: {
      renamed: nextName !== undefined,
      movedWorkspace: nextWorkspaceId !== undefined,
      changedThumbnail: nextThumb !== undefined,
    },
  });

  return NextResponse.json({ ok: true, document: publicDocShape(updated, access.role) });
}

// ─── DELETE /api/documents/[id] ─────────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });

  const { id } = await params;
  const result = await loadAccess(req, id);
  if (!result.ok) return result.response;
  const { access, userId } = result;

  if (access.role !== 'owner') {
    return NextResponse.json(
      { error: 'Only the document owner can delete', code: 'document.permission_denied' },
      { status: 403 },
    );
  }

  const db = getDbAdapter();
  const now = Date.now();
  const result2 = await db.execute(
    'UPDATE nf_documents SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
    now, now, id,
  );

  if (result2.changes === 0) {
    // Already deleted — idempotent success rather than 404 on a delete.
    return NextResponse.json({ ok: true, alreadyDeleted: true });
  }

  logAudit({
    userId, action: 'document.delete', resourceId: id,
    ip: getTrustedClientIpOrUndefined(req.headers),
    metadata: { softDeletedAt: now, restoreUntil: now + SOFT_DELETE_WINDOW_MS },
  });

  return NextResponse.json({
    ok: true,
    deletedAt: now,
    restoreUntil: now + SOFT_DELETE_WINDOW_MS,
  });
}
