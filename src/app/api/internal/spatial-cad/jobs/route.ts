import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { boundedRawBodyError, readBoundedRawBody } from '@/lib/boundedRawBody';
import {
  claimNextExactClashJob,
  completeExactClashJob,
  ensureSpatialCadJobTables,
  failExactClashJobDetailed,
  heartbeatExactClashJob,
  type ExactClashExecutionReceipt,
} from '@/lib/cad/spatialCadJobStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BODY_BYTES = 512 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;

function authorizeWorker(req: NextRequest): 'OK' | 'NOT_CONFIGURED' | 'FORBIDDEN' {
  const expected = process.env.NEXYFAB_SPATIAL_CAD_WORKER_SECRET?.trim();
  if (!expected || expected.length < 32) return 'NOT_CONFIGURED';
  const supplied = req.headers.get('x-spatial-cad-worker-secret') ?? '';
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right) ? 'OK' : 'FORBIDDEN';
}

type WorkerBody = {
  action?: 'claim' | 'heartbeat' | 'complete' | 'fail';
  workerId?: string;
  jobId?: string;
  leaseToken?: string;
  leaseMs?: number;
  receipt?: ExactClashExecutionReceipt;
  errorCode?: string;
};

function registeredWorkerIdentity(workerId: string): 'NOT_CONFIGURED' | 'NOT_REGISTERED' | string {
  const raw = process.env.NEXYFAB_SPATIAL_CAD_WORKER_IDENTITIES?.trim();
  if (!raw) return 'NOT_CONFIGURED';
  try {
    const registry = JSON.parse(raw) as Record<string, unknown>;
    const identity = registry[workerId];
    return typeof identity === 'string' && SHA256.test(identity) ? identity : 'NOT_REGISTERED';
  } catch { return 'NOT_CONFIGURED'; }
}

function trustedKernelIdentity(identity: string): boolean | 'NOT_CONFIGURED' {
  const values = process.env.NEXYFAB_SPATIAL_CAD_KERNEL_IDENTITIES?.split(',').map(value => value.trim()).filter(Boolean) ?? [];
  if (!values.length || values.some(value => !SHA256.test(value))) return 'NOT_CONFIGURED';
  return values.includes(identity);
}

export async function POST(req: NextRequest) {
  const authorization = authorizeWorker(req);
  if (authorization === 'NOT_CONFIGURED') return NextResponse.json({ ok: false, code: 'WORKER_NOT_CONFIGURED' }, { status: 503 });
  if (authorization !== 'OK') return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403 });
  let text: string;
  try {
    const bytes = await readBoundedRawBody(req, MAX_BODY_BYTES);
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    if (boundedRawBodyError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, code: 'BODY_TOO_LARGE' }, { status: 413 });
    return NextResponse.json({ ok: false, code: 'INVALID_JSON' }, { status: 400 });
  }
  let body: WorkerBody;
  try { body = JSON.parse(text) as WorkerBody; }
  catch { return NextResponse.json({ ok: false, code: 'INVALID_JSON' }, { status: 400 }); }
  if (!body.action || !body.workerId?.trim()) return NextResponse.json({ ok: false, code: 'ACTION_AND_WORKER_REQUIRED' }, { status: 400 });
  const registeredIdentity = registeredWorkerIdentity(body.workerId);
  if (registeredIdentity === 'NOT_CONFIGURED') return NextResponse.json({ ok: false, code: 'WORKER_IDENTITY_REGISTRY_NOT_CONFIGURED' }, { status: 503 });
  if (registeredIdentity === 'NOT_REGISTERED') return NextResponse.json({ ok: false, code: 'WORKER_NOT_REGISTERED' }, { status: 403 });

  const db = getDbAdapter();
  await ensureSpatialCadJobTables(db);
  if (body.action === 'claim') {
    const claim = await claimNextExactClashJob(db, body.workerId, Date.now(), body.leaseMs ?? 60_000);
    return NextResponse.json({ ok: true, claim }, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  if (!body.jobId?.trim() || !body.leaseToken?.trim()) return NextResponse.json({ ok: false, code: 'JOB_AND_LEASE_REQUIRED' }, { status: 400 });
  if (body.action === 'heartbeat') {
    const ok = await heartbeatExactClashJob(db, body.jobId, body.workerId, body.leaseToken, Date.now(), body.leaseMs ?? 60_000);
    return NextResponse.json({ ok, code: ok ? 'LEASE_EXTENDED' : 'LEASE_REJECTED' }, { status: ok ? 200 : 409 });
  }
  if (body.action === 'complete') {
    if (!body.receipt || body.receipt.jobId !== body.jobId) return NextResponse.json({ ok: false, code: 'MATCHING_RECEIPT_REQUIRED' }, { status: 400 });
    if (body.receipt.workerIdentitySha256 !== registeredIdentity) return NextResponse.json({ ok: false, code: 'WORKER_IDENTITY_MISMATCH' }, { status: 403 });
    const kernelTrusted = trustedKernelIdentity(body.receipt.kernelIdentitySha256);
    if (kernelTrusted === 'NOT_CONFIGURED') return NextResponse.json({ ok: false, code: 'KERNEL_IDENTITY_REGISTRY_NOT_CONFIGURED' }, { status: 503 });
    if (!kernelTrusted) return NextResponse.json({ ok: false, code: 'KERNEL_IDENTITY_NOT_TRUSTED' }, { status: 403 });
    const result = await completeExactClashJob(db, body.workerId, body.leaseToken, body.receipt);
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  }
  if (body.action === 'fail') {
    if (!body.errorCode) return NextResponse.json({ ok: false, code: 'ERROR_CODE_REQUIRED' }, { status: 400 });
    const result = await failExactClashJobDetailed(db, body.jobId, body.workerId, body.leaseToken, body.errorCode);
    const status = result.ok ? 200 : result.code === 'INVALID_FAILURE' ? 400 : 409;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json({ ok: false, code: 'INVALID_ACTION' }, { status: 400 });
}
