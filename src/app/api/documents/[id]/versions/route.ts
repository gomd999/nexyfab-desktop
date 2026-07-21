/**
 * /api/documents/[id]/versions — version-history endpoints.
 *
 * Phase 2 minimum: list explicit + auto snapshots and create a labelled
 * (explicit) snapshot on demand. Per §4.1:
 *
 *   GET  — list versions (visible to viewer+; ordered newest first)
 *   POST — create an EXPLICIT snapshot; body: { label?, branchName? }
 *
 * "Auto" snapshots (the collab worker's 60-second tick or 5 KB-pending-ops
 * trigger, §1.4 + §3.3) write directly into `nf_document_versions` from
 * inside the Durable Object. This REST endpoint is for the user-facing
 * "Save version" / "Branch from here" buttons only — it copies the current
 * blob to a new R2 key, inserts a row with `is_explicit = TRUE`, and bumps
 * `nf_documents.version`.
 *
 * Restoration (POST `/versions/[vid]/restore`) is deferred to a follow-up
 * route file; this Phase-2 scope ships list + explicit-create only.
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
  ensureCloudDocTables,
  resolveDocAccess,
} from '@/lib/cloudDoc/access';
import { publicVersionShape, type VersionRow } from '@/lib/cloudDoc/versions';
import { getLockHeldByOther, lockConflictPayload } from '@/lib/cloudDoc/locks';

const MAX_LABEL_LEN = 100;
const MAX_BRANCH_LEN = 80;

// ─── GET /api/documents/[id]/versions ───────────────────────────────────────

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

  const { searchParams } = req.nextUrl;
  const explicitOnly = searchParams.get('explicitOnly') === '1';
  const rawLimit = parseInt(searchParams.get('limit') || '50', 10);
  const limit = Math.min(200, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 50));

  const rows = await db.queryAll<VersionRow>(
    `SELECT * FROM nf_document_versions
     WHERE document_id = ?${explicitOnly ? ' AND is_explicit = 1' : ''}
     ORDER BY created_at DESC LIMIT ?`,
    id, limit,
  );

  return NextResponse.json({
    ok: true,
    versions: rows.map(publicVersionShape),
    docVersion: access.row.version,
  });
}

// ─── POST /api/documents/[id]/versions ──────────────────────────────────────

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
  if (!access.canEdit) {
    return NextResponse.json(
      { error: 'Editor role required', code: 'document.permission_denied' },
      { status: 403 },
    );
  }

  // W6-B: snapshot creation is an edit — blocked while another user holds
  // an active check-out (423 with holder + expiry; expired locks never block).
  const heldByOther = await getLockHeldByOther(db, id, authUser.userId);
  if (heldByOther) {
    return NextResponse.json(lockConflictPayload(heldByOther), { status: 423 });
  }

  let body: { label?: unknown; branchName?: unknown; parentVersionId?: unknown };
  try { body = await req.json().catch(() => ({})); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  // Validation
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

  let branchName: string | null = null;
  if (body.branchName !== undefined && body.branchName !== null) {
    if (typeof body.branchName !== 'string') {
      return NextResponse.json({ error: 'branchName must be a string', code: 'validation.branch' }, { status: 400 });
    }
    const trimmed = body.branchName.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_BRANCH_LEN) {
      return NextResponse.json({ error: `branchName 1..${MAX_BRANCH_LEN}`, code: 'validation.branch' }, { status: 400 });
    }
    if (!/^[a-zA-Z0-9_./-]+$/.test(trimmed)) {
      return NextResponse.json({ error: 'branchName chars [A-Za-z0-9_./-]', code: 'validation.branch' }, { status: 400 });
    }
    branchName = trimmed;
  }

  let parentVersionId: string | null = null;
  if (body.parentVersionId !== undefined && body.parentVersionId !== null) {
    if (typeof body.parentVersionId !== 'string') {
      return NextResponse.json({ error: 'parentVersionId must be a string', code: 'validation.parent' }, { status: 400 });
    }
    parentVersionId = body.parentVersionId;
    const parent = await db.queryOne<{ id: string; document_id: string }>(
      'SELECT id, document_id FROM nf_document_versions WHERE id = ?',
      parentVersionId,
    );
    if (!parent || parent.document_id !== id) {
      return NextResponse.json({ error: 'parentVersionId does not belong to this doc', code: 'validation.parent' }, { status: 400 });
    }
  }

  // Schema CHECK: branch_name implies parent_version_id (§2.1).
  if (branchName && !parentVersionId) {
    return NextResponse.json(
      { error: 'branchName requires parentVersionId', code: 'validation.branch_parent' },
      { status: 400 },
    );
  }

  const newVersion = access.row.version + 1;
  const versionId = crypto.randomUUID();
  const now = Date.now();
  const versionBlobKey = `documents/${access.row.owner_id}/${access.row.id}/versions/v${newVersion}.ydoc`;

  // Best-effort copy from current.ydoc → versions/v{n}.ydoc. If download/upload
  // primitives are unavailable on the storage adapter, we still record the
  // version row (collab worker fills the blob on next tick).
  let copiedSize = 0;
  try {
    const storage = getStorage();
    if (storage.download && storage.uploadRaw) {
      const buf = await storage.download(access.row.blob_r2_key);
      await storage.uploadRaw(buf, versionBlobKey, 'application/octet-stream');
      copiedSize = buf.length;
    }
  } catch (err) {
    console.warn('[versions.POST] blob copy failed:', (err as Error).message);
  }

  await db.execute(
    `INSERT INTO nf_document_versions (
       id, document_id, parent_version_id, blob_r2_key, oplog_r2_key,
       label, branch_name, is_explicit, size_bytes, created_by, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    versionId, id, parentVersionId, versionBlobKey, null,
    label, branchName, 1, copiedSize, authUser.userId, now,
  );

  await db.execute(
    'UPDATE nf_documents SET version = ?, updated_at = ?, last_edited_by = ? WHERE id = ?',
    newVersion, now, authUser.userId, id,
  );

  logAudit({
    userId: authUser.userId,
    action: 'document.version',
    resourceId: id,
    ip: getTrustedClientIpOrUndefined(req.headers),
    metadata: { versionId, versionNumber: newVersion, branchName },
  });

  return NextResponse.json({
    ok: true,
    version: publicVersionShape({
      id: versionId,
      document_id: id,
      parent_version_id: parentVersionId,
      blob_r2_key: versionBlobKey,
      oplog_r2_key: null,
      label,
      branch_name: branchName,
      is_explicit: 1,
      size_bytes: copiedSize,
      restored_from: null,
      created_by: authUser.userId,
      created_at: now,
    }),
    docVersion: newVersion,
  }, { status: 201 });
}
