import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { logAudit } from '@/lib/audit';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';
import {
  ensureCadWorkspaceRevisionTables,
  listCadWorkspaceRevisions,
  persistCadWorkspaceRevision,
  readCadWorkspaceRevision,
  type CadWorkspaceEnvelopeInput,
} from '@/lib/cad/workspaceRevisionStore';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MAX_BODY_BYTES = 2_200_000;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const db = getDbAdapter();
  const access = await resolveProjectAccess(db, id, auth);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await ensureCadWorkspaceRevisionTables(db);
  if (req.nextUrl.searchParams.get('list') === '1') {
    const rawLimit = req.nextUrl.searchParams.get('limit');
    const limit = rawLimit === null ? 50 : Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return NextResponse.json({ error: 'Invalid limit' }, { status: 400 });
    return NextResponse.json({ ok: true, revisions: await listCadWorkspaceRevisions(db, id, limit) }, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  const rawRevision = req.nextUrl.searchParams.get('revision');
  const revision = rawRevision === null ? undefined : Number(rawRevision);
  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 0)) {
    return NextResponse.json({ error: 'Invalid revision' }, { status: 400 });
  }
  const envelope = await readCadWorkspaceRevision(db, id, revision);
  if (!envelope) return NextResponse.json({ error: 'Revision not found' }, { status: 404 });
  return NextResponse.json({ ok: true, envelope }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const db = getDbAdapter();
  const access = await resolveProjectAccess(db, id, auth);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access.canEdit) return NextResponse.json({ error: 'Editor role required' }, { status: 403 });

  let body: { baseRevision?: unknown; envelope?: unknown };
  try { body = await readBoundedJson<{ baseRevision?: unknown; envelope?: unknown }>(req, MAX_BODY_BYTES); }
  catch (cause) {
    if (boundedJsonError(cause)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Revision envelope too large' }, { status: 413 });
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!Number.isSafeInteger(body.baseRevision) || !body.envelope || typeof body.envelope !== 'object') {
    return NextResponse.json({ error: 'baseRevision and envelope are required' }, { status: 400 });
  }

  await ensureCadWorkspaceRevisionTables(db);
  const result = await persistCadWorkspaceRevision(
    db,
    auth.userId,
    id,
    body.baseRevision as number,
    body.envelope as CadWorkspaceEnvelopeInput,
  );
  if (!result.ok && result.code === 'REVISION_CONFLICT') {
    logAudit({
      userId: auth.userId,
      action: 'cad.workspace_revision_conflict',
      resourceId: id,
      ip: getTrustedClientIpOrUndefined(req.headers),
      metadata: { baseRevision: body.baseRevision, currentRevision: result.currentRevision, conflictPaths: result.conflictPaths.slice(0, 20) },
    });
    return NextResponse.json(result, { status: 409 });
  }
  if (!result.ok) return NextResponse.json(result, { status: 422 });
  logAudit({
    userId: auth.userId,
    action: 'cad.workspace_revision_commit',
    resourceId: id,
    ip: getTrustedClientIpOrUndefined(req.headers),
    metadata: {
      revision: result.envelope.workspace.revision,
      contentHash: result.envelope.contentHash,
      invalidatedLineageIds: result.invalidatedLineageIds,
    },
  });
  return NextResponse.json(result, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
}
