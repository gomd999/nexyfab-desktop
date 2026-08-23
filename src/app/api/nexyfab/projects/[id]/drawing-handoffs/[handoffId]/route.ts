import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { resolveArtifactTenantId } from '@/lib/artifacts/directArtifactUploadStore';
import {
  ensureAssemblyDrawingHandoffTable,
  isAssemblyDrawingHandoffStorageConfigured,
  isServerAssemblyDrawingHandoffId,
  readStoredAssemblyDrawingHandoff,
} from '@/lib/cad/assemblyDrawingHandoffStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; handoffId: string }> },
) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: projectId, handoffId } = await params;
  if (!isServerAssemblyDrawingHandoffId(handoffId)) {
    return NextResponse.json({ error: 'Not found', code: 'HANDOFF_NOT_FOUND' }, { status: 404 });
  }
  const db = getDbAdapter();
  const access = await resolveProjectAccess(db, projectId, auth);
  if (!access) return NextResponse.json({ error: 'Not found', code: 'HANDOFF_NOT_FOUND' }, { status: 404 });
  if (!isAssemblyDrawingHandoffStorageConfigured()) {
    return NextResponse.json(
      { error: 'Durable handoff storage is not configured', code: 'HANDOFF_STORAGE_NOT_CONFIGURED' },
      { status: 503 },
    );
  }
  await ensureAssemblyDrawingHandoffTable(db);
  const tenantId = resolveArtifactTenantId(access.row.org_id, access.ownerUserId);
  const result = await readStoredAssemblyDrawingHandoff(db, { handoffId, projectId, tenantId });
  if (!result.ok) {
    if (result.code === 'EXPIRED') return NextResponse.json({ error: 'Drawing handoff expired', code: result.code }, { status: 410 });
    if (result.code === 'STORED_HANDOFF_INVALID') {
      return NextResponse.json({ error: 'Stored drawing handoff failed integrity verification', code: result.code }, { status: 500 });
    }
    return NextResponse.json({ error: 'Not found', code: 'HANDOFF_NOT_FOUND' }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    handoffId: result.stored.handoffId,
    handoff: result.stored.handoff,
    payloadSha256: result.stored.payloadSha256,
    byteLength: result.stored.byteLength,
    expiresAt: new Date(result.stored.expiresAt).toISOString(),
    persistence: 'SERVER_OWNED_IMMUTABLE',
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
