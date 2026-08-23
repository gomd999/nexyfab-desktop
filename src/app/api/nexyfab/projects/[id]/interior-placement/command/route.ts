import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { spatialCadLockClientView, spatialCadLockScope } from '@/lib/cad/spatialCadLocks';
import { persistInteriorPlacementOperation } from '@/lib/cad/interiorPlacementDraftStore';
import type { InteriorPlacementOperation } from '@/lib/cad/interiorPlacementTransaction';
import { hasOnlyKeys, isPlainJsonRecord, isStrictInteriorPlacementOperation, isStrictLockProjectionArray } from '@/lib/cad/interiorPlacementRouteInput';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MAX_BODY_BYTES = 300_000;
const ALLOWED_KEYS = ['documentId', 'roomDocumentId', 'baseProjectRevision', 'baseContentHash', 'selectedObjectId', 'parameterPaths', 'locks', 'operation'] as const;

function statusFor(code: string): number { if (code === 'INVALID_REQUEST') return 400; if (code === 'REVISION_CONFLICT' || code === 'CONTENT_HASH_CONFLICT' || code === 'DOCUMENT_ID_CONFLICT' || code === 'LOCK_CONFLICT') return 409; return 422; }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const auth = await getAuthUser(req); if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params; const db = getDbAdapter(); const access = await resolveProjectAccess(db, id, auth); if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access.canEdit) return NextResponse.json({ error: 'Editor role required' }, { status: 403 });
  let parsed: unknown;
  try { parsed = await readBoundedJson<unknown>(req, MAX_BODY_BYTES); }
  catch (cause) {
    if (boundedJsonError(cause)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Placement command too large' }, { status: 413 });
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!isPlainJsonRecord(parsed)) return NextResponse.json({ error: 'JSON object required' }, { status: 400 });
  const body = parsed;
  if (!hasOnlyKeys(body, ALLOWED_KEYS) || typeof body.documentId !== 'string' || typeof body.roomDocumentId !== 'string' || !Number.isSafeInteger(body.baseProjectRevision)
    || typeof body.baseContentHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.baseContentHash) || typeof body.selectedObjectId !== 'string' || !body.selectedObjectId.trim()
    || !Array.isArray(body.parameterPaths) || !body.parameterPaths.length || new Set(body.parameterPaths).size !== body.parameterPaths.length || body.parameterPaths.some(path => typeof path !== 'string')
    || !isStrictLockProjectionArray(body.locks) || !isStrictInteriorPlacementOperation(body.operation, ['patch_selected_object'])) return NextResponse.json({ error: 'reviewed placement command fields are required' }, { status: 400 });
  const operation = body.operation as Partial<InteriorPlacementOperation>;
  if (operation.kind !== 'patch_selected_object' || operation.objectId !== body.selectedObjectId) return NextResponse.json({ error: 'AI placement command must patch the selected object' }, { status: 422 });
  const result = await persistInteriorPlacementOperation(db, auth.userId, id, { documentId: body.documentId, roomDocumentId: body.roomDocumentId, baseProjectRevision: body.baseProjectRevision as number, operation: operation as InteriorPlacementOperation, actor: 'ai', guards: { selectedObjectId: body.selectedObjectId, parameterPaths: body.parameterPaths as string[], locks: body.locks, baseContentHash: body.baseContentHash, currentContentHash: body.baseContentHash } });
  if (!result.ok) return NextResponse.json(result, { status: statusFor(result.code) });
  const scope = spatialCadLockScope(id, 'interior', result.draft.documentId);
  return NextResponse.json({ ...result, draft: { ...result.draft, locks: result.draft.locks.map(lock => spatialCadLockClientView(lock, auth.userId, scope)) } }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
}
