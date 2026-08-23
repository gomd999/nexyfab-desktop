import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import {
  persistSpatialCadCommand,
  persistSpatialCadDraft,
  releaseSpatialCadDraftLocks,
  readSpatialCadDraft,
} from '@/lib/cad/spatialCadDraftStore';
import type { SpatialCadDocument, SpatialCadDomain } from '@/lib/cad/spatialCadCommand';
import { normalizeSpatialCadLocks, spatialCadLockClientView, spatialCadLockScope } from '@/lib/cad/spatialCadLocks';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MAX_BODY_BYTES = 300_000;
const DOMAINS = new Set<SpatialCadDomain>(['building', 'civil', 'landscape', 'interior', 'coordination']);

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const domain = req.nextUrl.searchParams.get('domain') as SpatialCadDomain | null;
  if (!domain || !DOMAINS.has(domain)) return NextResponse.json({ error: 'Invalid domain' }, { status: 400 });
  const db = getDbAdapter();
  const access = await resolveProjectAccess(db, id, auth);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const draft = await readSpatialCadDraft(db, id, domain);
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  const normalized = normalizeSpatialCadLocks(draft.locks ?? []);
  if (draft.lockIssues?.length || normalized.issues.length || (!draft.documentId && normalized.locks.length)) return NextResponse.json({ error: 'Invalid authoritative lock state' }, { status: 409 });
  const scope = draft.documentId ? spatialCadLockScope(id, domain, draft.documentId) : 'legacy-unscoped';
  const sanitizedLocks = normalized.locks.map(lock => spatialCadLockClientView(lock, auth.userId, scope));
  const { lockIssues: _lockIssues, ...safeDraft } = draft;
  void _lockIssues;
  return NextResponse.json({ ok: true, draft: { ...safeDraft, locks: sanitizedLocks } }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const db = getDbAdapter();
  const access = await resolveProjectAccess(db, id, auth);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access.canEdit) return NextResponse.json({ error: 'Editor role required' }, { status: 403 });

  let body: { action?: unknown; domain?: unknown; baseRevision?: unknown; document?: unknown; command?: unknown; baseProjectRevision?: unknown; baseContentHash?: unknown; documentId?: unknown; locks?: unknown; lockIds?: unknown; parameterPaths?: unknown; mode?: unknown };
  try { body = await readBoundedJson<typeof body>(req, MAX_BODY_BYTES); }
  catch (cause) {
    if (boundedJsonError(cause)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Spatial draft too large' }, { status: 413 });
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (body.action === 'release_locks') {
    if (!['building', 'civil', 'landscape', 'interior', 'coordination'].includes(String(body.domain)) || !Number.isSafeInteger(body.baseProjectRevision) || typeof body.baseContentHash !== 'string' || typeof body.documentId !== 'string' || !Array.isArray(body.lockIds) || body.lockIds.some(id => typeof id !== 'string')) return NextResponse.json({ error: 'release lock guards are required' }, { status: 400 });
    const result = await releaseSpatialCadDraftLocks(db, auth.userId, id, body.domain as SpatialCadDomain, { baseProjectRevision: body.baseProjectRevision as number, contentHash: body.baseContentHash, documentId: body.documentId, lockIds: body.lockIds as string[] });
    if (!result.ok) return NextResponse.json(result, { status: result.code === 'INVALID_REQUEST' ? 400 : 409 });
    const scope = spatialCadLockScope(id, body.domain as SpatialCadDomain, body.documentId);
    const locks = normalizeSpatialCadLocks(result.draft.locks ?? []).locks.map(lock => spatialCadLockClientView(lock, auth.userId, scope));
    return NextResponse.json({ ...result, draft: { ...result.draft, locks } }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
  }
  if (body.command && typeof body.command === 'object') {
    if (!Number.isSafeInteger(body.baseProjectRevision) || typeof body.baseContentHash !== 'string' || typeof body.documentId !== 'string' || !Array.isArray(body.locks)) {
      return NextResponse.json({ error: 'baseProjectRevision, baseContentHash, documentId, locks and command are required' }, { status: 400 });
    }
    const result = await persistSpatialCadCommand(db, auth.userId, id, {
      baseProjectRevision: body.baseProjectRevision as number,
      baseContentHash: body.baseContentHash,
      documentId: body.documentId,
      locks: body.locks as Array<{ id: string; target: { kind: string; objectId: string; field?: string } }>,
      command: body.command as import('@/lib/cad/spatialCadCommand').SpatialCadCommand,
      parameterPaths: Array.isArray(body.parameterPaths) ? body.parameterPaths.filter((path): path is string => typeof path === 'string') : [],
      mode: body.mode === 'new_design' ? 'new_design' : 'request_only_edit',
    });
    if (!result.ok) {
      const status = result.code === 'REVISION_CONFLICT' || result.code === 'CONTENT_HASH_CONFLICT' || result.code === 'DOCUMENT_ID_CONFLICT' || result.code === 'LOCK_CONFLICT' ? 409 : 422;
      return NextResponse.json(result, { status });
    }
    const scope = spatialCadLockScope(id, result.draft.document.domain, body.documentId);
    const locks = normalizeSpatialCadLocks(result.draft.locks ?? []).locks.map(lock => spatialCadLockClientView(lock, auth.userId, scope));
    return NextResponse.json({ ...result, draft: { ...result.draft, locks } }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
  }
  if (!Number.isSafeInteger(body.baseRevision) || !body.document || typeof body.document !== 'object') {
    return NextResponse.json({ error: 'baseRevision and document are required' }, { status: 400 });
  }
  if (typeof body.documentId !== 'string' || !body.documentId.trim()) return NextResponse.json({ error: 'documentId is required' }, { status: 400 });
  if (body.locks !== undefined) return NextResponse.json({ error: 'client lock replacement is not allowed' }, { status: 400 });
  const result = await persistSpatialCadDraft(db, auth.userId, id, body.baseRevision as number, body.document as SpatialCadDocument, { documentId: body.documentId });
  if (!result.ok && result.code === 'REVISION_CONFLICT') {
    return NextResponse.json(result, { status: 409 });
  }
  if (!result.ok && (result.code === 'DOCUMENT_ID_CONFLICT' || result.code === 'LOCK_CONFLICT')) return NextResponse.json(result, { status: 409 });
  if (!result.ok) return NextResponse.json(result, { status: 422 });
  const scope = spatialCadLockScope(id, result.draft.document.domain, body.documentId);
  const locks = normalizeSpatialCadLocks(result.draft.locks ?? []).locks.map(lock => spatialCadLockClientView(lock, auth.userId, scope));
  return NextResponse.json({ ...result, draft: { ...result.draft, locks } }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
}
