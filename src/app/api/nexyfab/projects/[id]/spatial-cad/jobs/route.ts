import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { logAudit } from '@/lib/audit';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';
import { cancelExactClashJob, enqueueExactClashJob, ensureSpatialCadJobTables, getSpatialCadJobUsage, listSpatialCadJobs, SPATIAL_CAD_IDEMPOTENCY_KEY } from '@/lib/cad/spatialCadJobStore';
import type { ExactClashJobRequest } from '@/lib/cad/coordinationSpatialModel';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_SPATIAL_JOB_BODY_BYTES = 256 * 1024;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const db = getDbAdapter();
  const access = await resolveProjectAccess(db, id, auth);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await ensureSpatialCadJobTables(db);
  const [jobs, usage] = await Promise.all([listSpatialCadJobs(db, id), getSpatialCadJobUsage(db, id)]);
  return NextResponse.json({ ok: true, canEdit: access.canEdit, jobs, usage }, { headers: { 'Cache-Control': 'private, no-store' } });
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
  let body: { action?: unknown; jobId?: unknown; request?: unknown } | null = null;
  try { body = await readBoundedJson(req, MAX_SPATIAL_JOB_BODY_BYTES); }
  catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Request too large', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
  }
  if (body?.action === 'cancel') {
    if (typeof body.jobId !== 'string' || !body.jobId.trim()) return NextResponse.json({ ok: false, code: 'JOB_REQUIRED' }, { status: 400 });
    await ensureSpatialCadJobTables(db);
    const result = await cancelExactClashJob(db, id, body.jobId);
    const usage = await getSpatialCadJobUsage(db, id);
    if (!result.ok) {
      const status = result.code === 'JOB_NOT_FOUND' ? 404 : 409;
      return NextResponse.json({ ...result, usage }, { status });
    }
    logAudit({ userId: auth.userId, action: 'cad.spatial_exact_clash_cancelled', resourceId: id, ip: getTrustedClientIpOrUndefined(req.headers), metadata: { jobId: result.job.id, status: result.job.status } });
    return NextResponse.json({ ...result, usage }, { status: 200, headers: { 'Cache-Control': 'private, no-store' } });
  }
  const idempotencyKey = req.headers.get('Idempotency-Key')?.trim() ?? '';
  if (!idempotencyKey) return NextResponse.json({ ok: false, code: 'IDEMPOTENCY_KEY_REQUIRED' }, { status: 400 });
  if (!SPATIAL_CAD_IDEMPOTENCY_KEY.test(idempotencyKey)) return NextResponse.json({ ok: false, code: 'IDEMPOTENCY_KEY_INVALID' }, { status: 400 });
  if (!body?.request || typeof body.request !== 'object') return NextResponse.json({ error: 'Exact clash request required' }, { status: 400 });
  await ensureSpatialCadJobTables(db);
  const result = await enqueueExactClashJob(db, auth.userId, id, body.request as ExactClashJobRequest, idempotencyKey);
  const usage = await getSpatialCadJobUsage(db, id);
  if (!result.ok) return NextResponse.json({ ...result, usage }, { status: result.code === 'JOB_BLOCKED' ? 422 : 409 });
  if (!result.reused) logAudit({ userId: auth.userId, action: 'cad.spatial_exact_clash_queued', resourceId: id, ip: getTrustedClientIpOrUndefined(req.headers), metadata: { jobId: result.job.id, modelCount: result.job.request.models.length, execution: result.job.execution, releaseVerification: result.job.releaseVerification } });
  return NextResponse.json({ ...result, usage }, { status: result.reused ? 200 : 202, headers: { 'Cache-Control': 'private, no-store' } });
}
