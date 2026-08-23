/**
 * /api/documents/[id]/versions/[versionId]/restore — W6-C version restore.
 *
 * POST — restore the payload of `versionId` as the CURRENT document state,
 * recorded as a NEW version stacked on top of the history (history is
 * never rewritten or truncated — a restore is itself an event you can
 * restore away from). The new row carries:
 *
 *   restored_from     = source version id  (provenance, queryable)
 *   parent_version_id = source version id  (lineage: the new state derives
 *                                           from that snapshot, not from the
 *                                           latest tip)
 *
 * Responses:
 *   201 { ok, version, docVersion }        — restored; nf_documents.version += 1
 *   404 code=document.not_found            — doc missing OR caller has no
 *                                            access (never leak existence)
 *   404 code=version.not_found             — version missing OR belongs to a
 *                                            different document (same non-leak
 *                                            rule at version granularity)
 *   403                                    — viewer/commenter (read-only)
 *   423 code=document.locked               — another user holds an active
 *                                            check-out (W6-B)
 *
 * Blob copy (version snapshot → new version key + live current.ydoc) is
 * best-effort, mirroring versions/route.ts POST: if the storage adapter
 * lacks download/uploadRaw the rows are still written and the collab worker
 * reconciles the blob on its next tick.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { getStorage } from '@/lib/storage';
import { logAudit } from '@/lib/audit';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';
import { ensureCloudDocTables, resolveDocAccess } from '@/lib/cloudDoc/access';
import { publicVersionShape, type VersionRow } from '@/lib/cloudDoc/versions';
import { getLockHeldByOther, lockConflictPayload } from '@/lib/cloudDoc/locks';
import { readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_LABEL_LEN = 100;
const MAX_JSON_BODY_BYTES = 64 * 1024;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });

  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, versionId } = await params;
  const db = getDbAdapter();
  await ensureCloudDocTables();

  const access = await resolveDocAccess(db, id, authUser.userId);
  if (!access) return NextResponse.json({ error: 'Not found', code: 'document.not_found' }, { status: 404 });
  if (!access.canEdit) {
    return NextResponse.json(
      { error: 'Editor role required', code: 'document.permission_denied' },
      { status: 403 },
    );
  }

  // W6-B: restore rewrites the current state — blocked by another user's
  // active check-out exactly like any other edit.
  const heldByOther = await getLockHeldByOther(db, id, authUser.userId);
  if (heldByOther) {
    return NextResponse.json(lockConflictPayload(heldByOther), { status: 423 });
  }

  const source = await db.queryOne<VersionRow>(
    'SELECT * FROM nf_document_versions WHERE id = ?',
    versionId,
  );
  // Non-leak: a version that exists but belongs to another document is
  // indistinguishable from one that never existed.
  if (!source || source.document_id !== id) {
    return NextResponse.json({ error: 'Not found', code: 'version.not_found' }, { status: 404 });
  }

  // Optional label override (same rules as versions POST).
  let body: { label?: unknown } = {};
  try { body = req.body ? await readBoundedJson<{ label?: unknown }>(req, MAX_JSON_BODY_BYTES) : {}; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  let label: string | null = null;
  if (body.label !== undefined && body.label !== null) {
    if (typeof body.label !== 'string') {
      return NextResponse.json({ error: 'label must be a string', code: 'validation.label' }, { status: 400 });
    }
    const trimmed = body.label.trim();
    if (trimmed.length > MAX_LABEL_LEN) {
      return NextResponse.json({ error: `label too long (>${MAX_LABEL_LEN})`, code: 'validation.label' }, { status: 400 });
    }
    label = trimmed || null;
  }
  if (label === null) {
    const sourceName = source.label || `#${source.id.slice(0, 8)}`;
    label = `Restored from ${sourceName}`.slice(0, MAX_LABEL_LEN);
  }

  const newVersion = access.row.version + 1;
  const newVersionId = crypto.randomUUID();
  const now = Date.now();
  const newBlobKey = `documents/${access.row.owner_id}/${access.row.id}/versions/v${newVersion}.ydoc`;

  // Best-effort blob copy: snapshot payload → new version key AND → the live
  // current.ydoc (that copy IS the restore, payload-wise).
  let copiedSize = 0;
  try {
    const storage = getStorage();
    if (storage.download && storage.uploadRaw) {
      const buf = await storage.download(source.blob_r2_key);
      await storage.uploadRaw(buf, newBlobKey, 'application/octet-stream');
      await storage.uploadRaw(buf, access.row.blob_r2_key, 'application/octet-stream');
      copiedSize = buf.length;
    }
  } catch (err) {
    console.warn('[versions.restore.POST] blob copy failed:', (err as Error).message);
  }

  await db.execute(
    `INSERT INTO nf_document_versions (
       id, document_id, parent_version_id, blob_r2_key, oplog_r2_key,
       label, branch_name, is_explicit, size_bytes, restored_from,
       created_by, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newVersionId, id, source.id, newBlobKey, null,
    label, null, 1, copiedSize, source.id,
    authUser.userId, now,
  );

  if (copiedSize > 0) {
    await db.execute(
      'UPDATE nf_documents SET version = ?, updated_at = ?, last_edited_by = ?, size_bytes = ? WHERE id = ?',
      newVersion, now, authUser.userId, copiedSize, id,
    );
  } else {
    await db.execute(
      'UPDATE nf_documents SET version = ?, updated_at = ?, last_edited_by = ? WHERE id = ?',
      newVersion, now, authUser.userId, id,
    );
  }

  logAudit({
    userId: authUser.userId,
    action: 'document.version_restore',
    resourceId: id,
    ip: getTrustedClientIpOrUndefined(req.headers),
    metadata: { restoredFrom: source.id, newVersionId, versionNumber: newVersion },
  });

  return NextResponse.json({
    ok: true,
    version: publicVersionShape({
      id: newVersionId,
      document_id: id,
      parent_version_id: source.id,
      blob_r2_key: newBlobKey,
      oplog_r2_key: null,
      label,
      branch_name: null,
      is_explicit: 1,
      size_bytes: copiedSize,
      restored_from: source.id,
      created_by: authUser.userId,
      created_at: now,
    }),
    docVersion: newVersion,
  }, { status: 201 });
}
