import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { logAudit } from '@/lib/audit';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';
import {
  createSpatialCadIssue,
  ensureSpatialCadIssueTables,
  listSpatialCadIssues,
  updateSpatialCadIssueStatus,
  type SpatialCadIssueCandidate,
} from '@/lib/cad/spatialCadIssueStore';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MAX_BODY_BYTES = 64_000;

async function editable(req: NextRequest, id: string) {
  const auth = await getAuthUser(req);
  if (!auth) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;
  const db = getDbAdapter();
  const access = await resolveProjectAccess(db, id, auth);
  if (!access) return { response: NextResponse.json({ error: 'Not found' }, { status: 404 }) } as const;
  return { auth, db, access } as const;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await editable(req, id);
  if ('response' in context) return context.response;
  await ensureSpatialCadIssueTables(context.db);
  return NextResponse.json({ ok: true, issues: await listSpatialCadIssues(context.db, id) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const { id } = await params;
  const context = await editable(req, id);
  if ('response' in context) return context.response;
  if (!context.access.canEdit) return NextResponse.json({ error: 'Editor role required' }, { status: 403 });
  let body: { candidate?: unknown };
  try { body = await readBoundedJson<{ candidate?: unknown }>(req, MAX_BODY_BYTES); }
  catch (cause) {
    if (boundedJsonError(cause)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Issue payload too large' }, { status: 413 });
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  await ensureSpatialCadIssueTables(context.db);
  const result = await createSpatialCadIssue(context.db, context.auth.userId, id, body.candidate as SpatialCadIssueCandidate);
  if (!result.ok) return NextResponse.json(result, { status: 422 });
  logAudit({ userId: context.auth.userId, action: 'cad.spatial_issue_create', resourceId: id, ip: getTrustedClientIpOrUndefined(req.headers), metadata: { issueId: result.issue.id, candidateId: result.issue.candidateId, evidence: result.issue.evidence, exactVerification: result.issue.exactVerification } });
  return NextResponse.json(result, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const { id } = await params;
  const context = await editable(req, id);
  if ('response' in context) return context.response;
  if (!context.access.canEdit) return NextResponse.json({ error: 'Editor role required' }, { status: 403 });
  let body: { issueId?: unknown; status?: unknown; expectedUpdatedAt?: unknown } | null;
  try { body = await readBoundedJson<{ issueId?: unknown; status?: unknown; expectedUpdatedAt?: unknown }>(req, MAX_BODY_BYTES); }
  catch (cause) {
    if (boundedJsonError(cause)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Issue payload too large' }, { status: 413 });
    return NextResponse.json({ error: 'Invalid issue update' }, { status: 400 });
  }
  if (!body || typeof body.issueId !== 'string' || (body.status !== 'OPEN' && body.status !== 'RESOLVED') || !Number.isSafeInteger(body.expectedUpdatedAt)) return NextResponse.json({ error: 'Invalid issue update' }, { status: 400 });
  await ensureSpatialCadIssueTables(context.db);
  const result = await updateSpatialCadIssueStatus(context.db, id, body.issueId, body.status, body.expectedUpdatedAt as number);
  if (!result.ok) return NextResponse.json(result, { status: result.code === 'ISSUE_NOT_FOUND' ? 404 : 409 });
  logAudit({ userId: context.auth.userId, action: 'cad.spatial_issue_status', resourceId: id, ip: getTrustedClientIpOrUndefined(req.headers), metadata: { issueId: result.issue.id, status: result.issue.status } });
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
}
