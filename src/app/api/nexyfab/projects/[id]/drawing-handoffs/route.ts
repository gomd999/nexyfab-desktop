import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { resolveArtifactTenantId } from '@/lib/artifacts/directArtifactUploadStore';
import { logAudit } from '@/lib/audit';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';
import {
  ASSEMBLY_DRAWING_HANDOFF_MAX_BYTES,
  cleanupExpiredAssemblyDrawingHandoffs,
  ensureAssemblyDrawingHandoffTable,
  isAssemblyDrawingHandoffStorageConfigured,
  persistAssemblyDrawingHandoff,
} from '@/lib/cad/assemblyDrawingHandoffStore';
import type { AssemblyDrawingHandoff } from '@/app/[lang]/shape-generator/assembly/drawingHandoff';
import { enrichServerDrawingHandoffWithExactSinglePart } from '@/app/[lang]/shape-generator/drawing/exactSinglePartServerHandoff';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MAX_BODY_BYTES = ASSEMBLY_DRAWING_HANDOFF_MAX_BYTES + 64 * 1024;

type RequestBody = {
  expectedRevision?: unknown;
  expectedContentSha256?: unknown;
  handoff?: unknown;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: projectId } = await params;
  const db = getDbAdapter();
  const access = await resolveProjectAccess(db, projectId, auth);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access.canEdit) return NextResponse.json({ error: 'Editor role required' }, { status: 403 });
  if (!isAssemblyDrawingHandoffStorageConfigured()) {
    return NextResponse.json(
      { error: 'Durable handoff storage is not configured', code: 'HANDOFF_STORAGE_NOT_CONFIGURED' },
      { status: 503 },
    );
  }

  let body: RequestBody;
  try { body = await readBoundedJson<RequestBody>(req, MAX_BODY_BYTES); }
  catch (cause) {
    if (boundedJsonError(cause)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Drawing handoff too large', code: 'HANDOFF_TOO_LARGE' }, { status: 413 });
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (
    !Number.isSafeInteger(body.expectedRevision)
    || typeof body.expectedContentSha256 !== 'string'
    || !body.handoff
    || typeof body.handoff !== 'object'
  ) {
    return NextResponse.json(
      { error: 'expectedRevision, expectedContentSha256 and handoff are required', code: 'INVALID_HANDOFF_REQUEST' },
      { status: 400 },
    );
  }

  await ensureAssemblyDrawingHandoffTable(db);
  await cleanupExpiredAssemblyDrawingHandoffs(db, Date.now(), 25);
  const tenantId = resolveArtifactTenantId(access.row.org_id, access.ownerUserId);
  const enrichment = await enrichServerDrawingHandoffWithExactSinglePart(
    body.handoff as AssemblyDrawingHandoff,
  );
  if (enrichment.status === 'INVALID_INPUT') {
    return NextResponse.json({
      error: 'Client-provided downstream exact evidence is not accepted',
      code: enrichment.reason,
    }, { status: 422 });
  }
  const result = await persistAssemblyDrawingHandoff(db, {
    projectId,
    tenantId,
    userId: auth.userId,
    expectedRevision: body.expectedRevision as number,
    expectedContentSha256: body.expectedContentSha256,
    handoff: enrichment.handoff,
  });
  if (!result.ok) {
    if (result.code === 'HANDOFF_TOO_LARGE') return NextResponse.json(result, { status: 413 });
    if (result.code === 'REVISION_CONFLICT') return NextResponse.json(result, { status: 409 });
    return NextResponse.json(result, { status: 422 });
  }
  logAudit({
    userId: auth.userId,
    action: 'cad.assembly_drawing_handoff_persist',
    resourceId: projectId,
    ip: getTrustedClientIpOrUndefined(req.headers),
    metadata: {
      handoffId: result.stored.handoffId,
      sourceRevision: result.stored.sourceRevision,
      payloadSha256: result.stored.payloadSha256,
      byteLength: result.stored.byteLength,
      idempotent: result.idempotent,
      exactSinglePartStatus: enrichment.status,
      ...(enrichment.status === 'NOT_RUN' ? { exactSinglePartReason: enrichment.reason } : {}),
    },
  });
  return NextResponse.json({
    ok: true,
    handoffId: result.stored.handoffId,
    payloadSha256: result.stored.payloadSha256,
    byteLength: result.stored.byteLength,
    expiresAt: new Date(result.stored.expiresAt).toISOString(),
    sourceRevision: result.stored.sourceRevision,
    sourceContentSha256: result.stored.sourceContentSha256,
    idempotent: result.idempotent,
    persistence: 'SERVER_OWNED_IMMUTABLE',
    exactSinglePartStatus: enrichment.status,
    ...(enrichment.status === 'NOT_RUN' ? { exactSinglePartReason: enrichment.reason } : {}),
  }, { status: result.idempotent ? 200 : 201, headers: { 'Cache-Control': 'private, no-store' } });
}
