/**
 * /api/documents — collection endpoint for Wave 2 cloud documents.
 *
 * Implements the §4.1 spec rows for `POST /api/documents` and
 * `GET /api/documents`. Per the migration plan, this lands in Phase 2 of the
 * cloud-doc rollout, before CRDT/WebSocket relay is wired up. Single-user
 * editing only; collab joins later via a Durable Object.
 *
 * Auth — accepts the standard `nf_access_token` cookie or `Authorization:
 * Bearer …` header via `getAuthUser`. All mutation endpoints additionally
 * require `checkOrigin` (origin-matches-host) to defend against CSRF.
 *
 * Storage — the R2 blob is written by the *collab worker* during normal
 * operation. On document **create**, we still need *something* at
 * `documents/{owner}/{doc}/current.ydoc` so the client can issue a
 * signed-GET on first open without a 404. We write a deterministic empty
 * Yjs-snapshot byte sequence (just a tiny marker payload here, since the
 * pure Yjs encode function ships in Phase 3 — `nfabToYjs.ts`). The collab
 * worker overwrites this on the first snapshot tick.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { getStorage } from '@/lib/storage';
import { logAudit } from '@/lib/audit';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';
import { ensureCloudDocTables, ensurePersonalWorkspace, type DocumentRow } from '@/lib/cloudDoc/access';

// ─── helpers ────────────────────────────────────────────────────────────────

const MAX_NAME_LEN = 200;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** Minimal placeholder bytes for the initial `current.ydoc`. The collab
 * worker rewrites this on first save. We use a 2-byte tag so signed-GET
 * succeeds before any user edit. Phase 3 swaps for a real empty Y.Doc. */
const EMPTY_YDOC_PLACEHOLDER = Buffer.from([0x00, 0x00]);

function publicDocShape(row: DocumentRow) {
  return {
    id:               row.id,
    name:             row.name,
    ownerId:          row.owner_id,
    workspaceId:      row.workspace_id,
    version:          row.version,
    nfabFormat:       row.nfab_format,
    yjsProto:         row.yjs_proto,
    sizeBytes:        row.size_bytes,
    featureCount:     row.feature_count,
    partCount:        row.part_count,
    thumbnailKey:     row.thumbnail_r2_key,
    createdAt:        row.created_at,
    updatedAt:        row.updated_at,
    lastEditedBy:     row.last_edited_by,
    deletedAt:        row.deleted_at,
  };
}

function safeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_NAME_LEN) return null;
  return trimmed;
}

// ─── GET /api/documents — list documents user can see ───────────────────────

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDbAdapter();
  await ensureCloudDocTables();

  const { searchParams } = req.nextUrl;
  const workspaceId = searchParams.get('workspaceId');
  const q = searchParams.get('q')?.trim() || null;
  const rawPage = parseInt(searchParams.get('page') || '1', 10);
  const rawPageSize = parseInt(searchParams.get('pageSize') || `${DEFAULT_PAGE_SIZE}`, 10);
  const page = Math.max(1, Number.isFinite(rawPage) ? rawPage : 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.isFinite(rawPageSize) ? rawPageSize : DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;

  // Visibility query:
  //   - user is owner (d.owner_id = ?)
  //   - OR a per-doc permission row exists (override)
  //   - OR a workspace-member row exists for the doc's workspace
  // Soft-deleted docs are filtered.
  //
  // We compose a single UNION rather than a 3-way JOIN with OR because SQLite
  // optimizer + Postgres planner both prefer this shape on the indexes the
  // spec calls for in §2.1.
  const params: unknown[] = [];
  let workspaceClause = '';
  if (workspaceId) {
    workspaceClause = ' AND d.workspace_id = ?';
    params.push(workspaceId);
  }
  let qClause = '';
  if (q) {
    qClause = ` AND lower(d.name) LIKE ?`;
  }

  const visibility = `
    SELECT DISTINCT d.* FROM nf_documents d
    WHERE d.deleted_at IS NULL${workspaceClause}${qClause} AND (
      d.owner_id = ?
      OR EXISTS (SELECT 1 FROM nf_document_permissions p
                 WHERE p.document_id = d.id AND p.user_id = ?
                   AND (p.expires_at IS NULL OR p.expires_at > ?))
      OR EXISTS (SELECT 1 FROM nf_workspace_members m
                 WHERE m.workspace_id = d.workspace_id AND m.user_id = ?)
    )
    ORDER BY d.updated_at DESC
    LIMIT ? OFFSET ?
  `;

  const queryParams: unknown[] = [...params];
  if (q) queryParams.push(`%${q.toLowerCase()}%`);
  queryParams.push(authUser.userId, authUser.userId, Date.now(), authUser.userId, pageSize, offset);

  const rows = await db.queryAll<DocumentRow>(visibility, ...queryParams);

  // Total count (cheap second query — paginated lists shouldn't paginate by
  // scanning the entire result; this matches the existing /files pattern).
  const countSql = `
    SELECT COUNT(*) as total FROM nf_documents d
    WHERE d.deleted_at IS NULL${workspaceClause}${qClause} AND (
      d.owner_id = ?
      OR EXISTS (SELECT 1 FROM nf_document_permissions p
                 WHERE p.document_id = d.id AND p.user_id = ?
                   AND (p.expires_at IS NULL OR p.expires_at > ?))
      OR EXISTS (SELECT 1 FROM nf_workspace_members m
                 WHERE m.workspace_id = d.workspace_id AND m.user_id = ?)
    )`;
  const countParams: unknown[] = [...params];
  if (q) countParams.push(`%${q.toLowerCase()}%`);
  countParams.push(authUser.userId, authUser.userId, Date.now(), authUser.userId);
  const countRow = await db.queryOne<{ total: number }>(countSql, ...countParams);

  return NextResponse.json({
    ok: true,
    documents: rows.map(publicDocShape),
    pagination: { page, pageSize, total: countRow?.total ?? 0 },
  });
}

// ─── POST /api/documents — create a document ────────────────────────────────

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });

  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { name?: unknown; workspaceId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = safeName(body.name);
  if (!name) {
    return NextResponse.json({ error: 'name is required (1..200 chars)', code: 'validation.name' }, { status: 400 });
  }

  const db = getDbAdapter();
  await ensureCloudDocTables();

  // Resolve workspace — explicit if given, else Personal.
  let workspaceId: string;
  if (body.workspaceId !== undefined && body.workspaceId !== null) {
    if (typeof body.workspaceId !== 'string' || body.workspaceId.length === 0) {
      return NextResponse.json({ error: 'workspaceId must be a non-empty string', code: 'validation.workspace' }, { status: 400 });
    }
    workspaceId = body.workspaceId;
    // Check the user has at least editor access on the workspace.
    const wsRow = await db.queryOne<{ id: string; owner_id: string; deleted_at: number | null }>(
      'SELECT id, owner_id, deleted_at FROM nf_workspaces WHERE id = ?',
      workspaceId,
    );
    if (!wsRow || wsRow.deleted_at) {
      return NextResponse.json({ error: 'Workspace not found', code: 'workspace.not_found' }, { status: 404 });
    }
    if (wsRow.owner_id !== authUser.userId) {
      const member = await db.queryOne<{ role: string }>(
        'SELECT role FROM nf_workspace_members WHERE workspace_id = ? AND user_id = ?',
        workspaceId, authUser.userId,
      );
      const role = member?.role;
      if (role !== 'owner' && role !== 'editor') {
        return NextResponse.json({ error: 'Workspace permission denied', code: 'workspace.permission_denied' }, { status: 403 });
      }
    }
  } else {
    workspaceId = await ensurePersonalWorkspace(db, authUser.userId);
  }

  const docId = crypto.randomUUID();
  const now = Date.now();
  const blobKey = `documents/${authUser.userId}/${docId}/current.ydoc`;

  // Best-effort upload of the placeholder bytes — non-fatal on local FS path
  // mishaps (the storage adapter falls back to a writable temp area). The
  // collab worker rewrites this on first save anyway.
  try {
    const storage = getStorage();
    if (storage.uploadRaw) {
      await storage.uploadRaw(EMPTY_YDOC_PLACEHOLDER, blobKey, 'application/octet-stream');
    }
  } catch (err) {
    // Surface the failure to logs but don't 500 — the doc row is the source
    // of truth; an empty current.ydoc just means the first GET will 404 and
    // the client falls back to a fresh Y.Doc.
    console.warn('[documents.POST] placeholder upload failed:', (err as Error).message);
  }

  await db.execute(
    `INSERT INTO nf_documents (
       id, owner_id, workspace_id, name, blob_r2_key, version, nfab_format, yjs_proto,
       thumbnail_r2_key, size_bytes, feature_count, part_count,
       created_at, updated_at, last_edited_by, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    docId, authUser.userId, workspaceId, name, blobKey,
    1, 2, 1,
    null, EMPTY_YDOC_PLACEHOLDER.length, 0, 0,
    now, now, authUser.userId, null,
  );

  // Seed the owner permission row so the owner is *also* listed in
  // nf_document_permissions. This duplicates owner_id but makes the
  // permission-list endpoint a single SELECT.
  await db.execute(
    `INSERT INTO nf_document_permissions (document_id, user_id, role, granted_by, granted_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    docId, authUser.userId, 'owner', authUser.userId, now, null,
  );

  const ip = getTrustedClientIpOrUndefined(req.headers);
  logAudit({
    userId: authUser.userId,
    action: 'document.create',
    resourceId: docId,
    ip,
    metadata: { workspaceId, name },
  });

  const row: DocumentRow = {
    id: docId,
    owner_id: authUser.userId,
    workspace_id: workspaceId,
    name,
    blob_r2_key: blobKey,
    version: 1,
    nfab_format: 2,
    yjs_proto: 1,
    thumbnail_r2_key: null,
    size_bytes: EMPTY_YDOC_PLACEHOLDER.length,
    feature_count: 0,
    part_count: 0,
    created_at: now,
    updated_at: now,
    last_edited_by: authUser.userId,
    deleted_at: null,
  };
  return NextResponse.json({ ok: true, document: publicDocShape(row) }, { status: 201 });
}
