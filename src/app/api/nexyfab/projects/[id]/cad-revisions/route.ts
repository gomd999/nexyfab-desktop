import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { logAudit } from '@/lib/audit';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';
import {
  ensureCadWorkspaceRevisionTables,
  persistCadWorkspaceRevision,
  readCadWorkspaceRevision,
  type CadWorkspaceEnvelopeInput,
} from '@/lib/cad/workspaceRevisionStore';

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
  const access = await resolveProjectAccess(db, id, auth.userId);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await ensureCadWorkspaceRevisionTables(db);
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
  const access = await resolveProjectAccess(db, id, auth.userId);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access.canEdit) return NextResponse.json({ error: 'Editor role required' }, { status: 403 });

  const text = await req.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Revision envelope too large' }, { status: 413 });
  }
  let body: { baseRevision?: unknown; envelope?: unknown };
  try { body = JSON.parse(text); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
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
    metadata: { revision: result.envelope.workspace.revision, contentHash: result.envelope.contentHash },
  });
  return NextResponse.json(result, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
}
