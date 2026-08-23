import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { spatialCadLockClientView, spatialCadLockScope, type SpatialCadLockDto } from '@/lib/cad/spatialCadLocks';
import { readInteriorPlacementDraft, persistInteriorPlacementOperation, releaseInteriorPlacementLocks } from '@/lib/cad/interiorPlacementDraftStore';
import type { InteriorPlacementOperation } from '@/lib/cad/interiorPlacementTransaction';
import type { InteriorPlacementDocument } from '@/lib/cad/interiorPlacementDocument';
import { hasOnlyKeys, isPlainJsonRecord, isStrictInteriorPlacementDocument, isStrictInteriorPlacementOperation } from '@/lib/cad/interiorPlacementRouteInput';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MAX_BODY_BYTES = 300_000;

function statusFor(code: string): number {
  if (code === 'INVALID_REQUEST') return 400;
  if (code === 'REVISION_CONFLICT' || code === 'CONTENT_HASH_CONFLICT' || code === 'DOCUMENT_ID_CONFLICT' || code === 'LOCK_CONFLICT') return 409;
  if (code === 'INVALID_DRAFT' || code === 'INVALID_DOCUMENT' || code === 'VALIDATION_FAILED') return 422;
  return 422;
}

function clientDraft(result: { projectId: string; documentId: string; roomDocumentId: string; projectRevision: number; contentHash: string; document: unknown; locks: SpatialCadLockDto[]; savedAt: number }, userId: string) {
  const scope = spatialCadLockScope(result.projectId, 'interior', result.documentId);
  return { ...result, locks: result.locks.map(lock => spatialCadLockClientView(lock, userId, scope)) };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthUser(req); if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params; const documentId = req.nextUrl.searchParams.get('documentId');
  if (!documentId?.trim()) return NextResponse.json({ error: 'documentId is required' }, { status: 400 });
  const db = getDbAdapter(); const access = await resolveProjectAccess(db, id, auth); if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const result = await readInteriorPlacementDraft(db, id, documentId);
  if (!result) return NextResponse.json({ error: 'Placement draft not found' }, { status: 404 });
  if (!result.ok) return NextResponse.json(result, { status: statusFor(result.code) });
  return NextResponse.json({ ok: true, draft: clientDraft(result.draft, auth.userId) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const auth = await getAuthUser(req); if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params; const db = getDbAdapter(); const access = await resolveProjectAccess(db, id, auth);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access.canEdit) return NextResponse.json({ error: 'Editor role required' }, { status: 403 });
  let parsed: unknown;
  try { parsed = await readBoundedJson<unknown>(req, MAX_BODY_BYTES); }
  catch (cause) {
    if (boundedJsonError(cause)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Placement request too large' }, { status: 413 });
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!isPlainJsonRecord(parsed)) return NextResponse.json({ error: 'JSON object required' }, { status: 400 });
  const body = parsed;
  if (body.action === 'release_locks') {
    if (!hasOnlyKeys(body, ['action', 'documentId', 'baseContentHash', 'baseProjectRevision', 'lockIds']) || typeof body.documentId !== 'string' || typeof body.baseContentHash !== 'string' || !Number.isSafeInteger(body.baseProjectRevision) || !Array.isArray(body.lockIds) || body.lockIds.some(lockId => typeof lockId !== 'string')) return NextResponse.json({ error: 'release lock guards are required' }, { status: 400 });
    const result = await releaseInteriorPlacementLocks(db, auth.userId, id, { documentId: body.documentId, baseProjectRevision: body.baseProjectRevision as number, contentHash: body.baseContentHash, lockIds: body.lockIds as string[] });
    if (!result.ok) return NextResponse.json(result, { status: statusFor(result.code) });
    return NextResponse.json({ ...result, draft: clientDraft(result.draft, auth.userId) }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
  }
  if (!hasOnlyKeys(body, ['action', 'documentId', 'roomDocumentId', 'baseProjectRevision', 'operation', 'document'])
    || body.action !== 'commit' || typeof body.documentId !== 'string' || typeof body.roomDocumentId !== 'string' || !Number.isSafeInteger(body.baseProjectRevision)
    || !isStrictInteriorPlacementOperation(body.operation, ['add_object', 'move_object', 'delete_object', 'reset_layout', 'update_object'])
    || (body.document !== undefined && !isStrictInteriorPlacementDocument(body.document))) return NextResponse.json({ error: 'human placement commit fields are required' }, { status: 400 });
  const result = await persistInteriorPlacementOperation(db, auth.userId, id, { documentId: body.documentId, roomDocumentId: body.roomDocumentId, baseProjectRevision: body.baseProjectRevision as number, operation: body.operation as InteriorPlacementOperation, actor: 'human', ...(body.document ? { document: body.document as InteriorPlacementDocument } : {}) });
  if (!result.ok) return NextResponse.json(result, { status: statusFor(result.code) });
  return NextResponse.json({ ...result, draft: clientDraft(result.draft, auth.userId) }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
}
