import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { ensureCadWorkspaceRevisionTables } from '@/lib/cad/workspaceRevisionStore';
import { assertRemoteProjectRevision, loadInstallerCoreCatalog, validateRemoteBinding } from '@/lib/precision-cad-agent/remoteAgentApi';
import { REMOTE_PRECISION_CAD_CONTRACT_VERSION } from '@/lib/precision-cad-agent/remoteCadContract';
import { hasPrecisionCadProjectScope } from '@/lib/precision-cad-agent/apiKeyScope';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  if (!hasPrecisionCadProjectScope(auth, 'read:projects')) return NextResponse.json({ ok: false, error: { code: 'INSUFFICIENT_API_KEY_SCOPE', requiredScope: 'read:projects' } }, { status: 403 });
  const { id: projectId } = await params;
  const access = await resolveProjectAccess(getDbAdapter(), projectId, auth);
  if (!access) return NextResponse.json({ ok: false, error: { code: 'PROJECT_NOT_FOUND' } }, { status: 404 });
  const revision = Number(req.nextUrl.searchParams.get('revision'));
  const rawUpdatedAt = req.nextUrl.searchParams.get('updatedAt');
  const contractVersion = req.nextUrl.searchParams.get('contractVersion') ?? REMOTE_PRECISION_CAD_CONTRACT_VERSION;
  const db = getDbAdapter();
  await ensureCadWorkspaceRevisionTables(db);
  const project = rawUpdatedAt === null ? await db.queryOne<{ updated_at: number }>('SELECT updated_at FROM nf_projects WHERE id = ?', projectId).catch(() => null) : null;
  const updatedAt = rawUpdatedAt === null ? Number(project?.updated_at) : Number(rawUpdatedAt);
  const binding = { projectId, revision, updatedAt };
  if (contractVersion !== REMOTE_PRECISION_CAD_CONTRACT_VERSION || !validateRemoteBinding(binding)) return NextResponse.json({ ok: false, error: { code: 'INVALID_REQUEST' } }, { status: 400 });
  const revisionError = await assertRemoteProjectRevision(db, projectId, revision, updatedAt);
  if (revisionError) return NextResponse.json(revisionError, { status: revisionError.error.code === 'REVISION_NOT_FOUND' ? 404 : revisionError.error.code === 'REVISION_CONFLICT' ? 409 : 400 });
  try {
    return NextResponse.json({ ok: true, contractVersion, binding, tools: await loadInstallerCoreCatalog() }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return NextResponse.json({ ok: false, error: { code: 'CATALOG_UNAVAILABLE' } }, { status: 503 }); }
}
