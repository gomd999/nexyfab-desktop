import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { boundedRawBodyError, readBoundedRawBody } from '@/lib/boundedRawBody';
import { getDbAdapter } from '@/lib/db-adapter';
import { getStorage } from '@/lib/storage';
import {
  COMMERCIAL_OUTPUT_MAX_BYTES,
  authorizeCommercialLease,
  commercialOutputObjectKey,
  validateCommercialOutputIntent,
  type CommercialOutputIntent,
} from '@/lib/precision-cad-agent/commercialWorkerIo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type IntentRow = {
  artifact_id: string;
  artifact_role: string;
  object_key: string;
  content_sha256: string;
  byte_length: number;
  media_type: string;
  worker_identity: string;
  status: 'PENDING' | 'COMMITTED';
  committed_at: number | null;
};

type Body = { action?: unknown; jobId?: unknown; intent?: unknown };

function json(status: number, body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

function bearer(req: NextRequest): string {
  return req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
}

function workerIdentity(req: NextRequest): string {
  return req.headers.get('x-commercial-worker-identity') ?? '';
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function rowMatchesIntent(row: IntentRow, intent: CommercialOutputIntent, objectKey: string, worker: string): boolean {
  return row.worker_identity === worker
    && row.artifact_id === intent.artifactId
    && row.artifact_role === intent.role
    && row.object_key === objectKey
    && row.content_sha256 === intent.contentSha256
    && Number(row.byte_length) === intent.byteLength
    && row.media_type === intent.mediaType;
}

async function authorize(req: NextRequest, jobId: string) {
  return authorizeCommercialLease({
    db: getDbAdapter(),
    jobId,
    workerIdentity: workerIdentity(req),
    leaseCapability: bearer(req),
  });
}

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId') ?? '';
  const artifactId = req.nextUrl.searchParams.get('artifactId') ?? '';
  const lease = await authorize(req, jobId).catch(() => null);
  if (!lease) return json(403, { ok: false, code: 'LEASE_CAPABILITY_INVALID' });
  const input = lease.job.inputArtifact;
  if (!input || input.artifactId !== artifactId) return json(403, { ok: false, code: 'INPUT_ARTIFACT_NOT_AUTHORIZED' });
  const db = getDbAdapter();
  const row = await db.queryOne<Record<string, unknown>>(
    'SELECT execution_id, tenant_id, project_id, artifact_id, object_key, content_sha256, byte_length, media_type FROM nf_precision_cad_commercial_input_artifacts WHERE job_id = ?',
    jobId,
  );
  if (!row || row.execution_id !== lease.job.executionId || row.tenant_id !== lease.job.tenantId
    || row.project_id !== lease.job.projectId || row.artifact_id !== input.artifactId
    || row.object_key !== input.objectKey || row.content_sha256 !== input.contentSha256
    || Number(row.byte_length) !== input.byteLength || row.media_type !== input.mediaType) {
    return json(409, { ok: false, code: 'INPUT_ARTIFACT_IDENTITY_MISMATCH' });
  }
  const storage = getStorage();
  if (!storage.download) return json(503, { ok: false, code: 'INPUT_ARTIFACT_STREAM_UNAVAILABLE' });
  const bytes = await storage.download(input.objectKey).catch(() => null);
  if (!bytes || bytes.byteLength !== input.byteLength || sha256(bytes) !== input.contentSha256) {
    return json(409, { ok: false, code: 'INPUT_ARTIFACT_HASH_MISMATCH' });
  }
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'content-type': input.mediaType,
      'content-length': String(bytes.byteLength),
      'cache-control': 'private, no-store',
      'x-content-sha256': input.contentSha256,
    },
  });
}

export async function POST(req: NextRequest) {
  let body: Body;
  try { body = await readBoundedJson<Body>(req, 128 * 1024); }
  catch (error) {
    const bounded = boundedJsonError(error);
    return json(bounded?.status ?? 400, { ok: false, code: bounded?.code ?? 'INVALID_JSON' });
  }
  const jobId = typeof body.jobId === 'string' ? body.jobId : '';
  const lease = await authorize(req, jobId).catch(() => null);
  if (!lease) return json(403, { ok: false, code: 'LEASE_CAPABILITY_INVALID' });
  if (body.action !== 'output-intent' && body.action !== 'commit-output') return json(400, { ok: false, code: 'ACTION_INVALID' });
  if (!body.intent || typeof body.intent !== 'object' || Array.isArray(body.intent)) return json(400, { ok: false, code: 'OUTPUT_INTENT_REQUIRED' });
  const intent = body.intent as CommercialOutputIntent;
  const issues = validateCommercialOutputIntent(intent);
  if (issues.length) return json(422, { ok: false, code: 'OUTPUT_INTENT_REJECTED', issues });
  const objectKey = commercialOutputObjectKey(lease.job, intent);
  const db = getDbAdapter();
  let row = await db.queryOne<IntentRow>(
    'SELECT artifact_id, artifact_role, object_key, content_sha256, byte_length, media_type, worker_identity, status, committed_at FROM nf_precision_cad_commercial_output_intents WHERE job_id = ? AND artifact_role = ?',
    jobId, intent.role,
  );
  if (row && !rowMatchesIntent(row, intent, objectKey, lease.owner)) return json(409, { ok: false, code: 'OUTPUT_INTENT_CONFLICT' });
  if (!row) {
    const createdAt = Date.now();
    const inserted = await db.execute(
      'INSERT INTO nf_precision_cad_commercial_output_intents (job_id, execution_id, tenant_id, project_id, worker_identity, artifact_id, artifact_role, object_key, content_sha256, byte_length, media_type, status, created_at, committed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      jobId, lease.job.executionId, lease.job.tenantId, lease.job.projectId, lease.owner,
      intent.artifactId, intent.role, objectKey, intent.contentSha256, intent.byteLength,
      intent.mediaType, 'PENDING', createdAt, null,
    );
    if (inserted.changes !== 1) return json(409, { ok: false, code: 'OUTPUT_INTENT_CONFLICT' });
    row = { artifact_id: intent.artifactId, artifact_role: intent.role, object_key: objectKey, content_sha256: intent.contentSha256, byte_length: intent.byteLength, media_type: intent.mediaType, worker_identity: lease.owner, status: 'PENDING', committed_at: null };
  }
  if (body.action === 'output-intent') {
    if (row.status === 'COMMITTED') return json(200, { ok: true, committed: true, artifact: { artifactId: row.artifact_id, role: row.artifact_role, objectKey: row.object_key, contentSha256: row.content_sha256, byteLength: Number(row.byte_length) } });
    return json(200, {
      ok: true,
      grant: {
        uploadMode: 'CORE_PUT',
        uploadUrl: `${new URL(req.url).origin}/api/internal/precision-cad-commercial/artifacts?jobId=${encodeURIComponent(jobId)}&role=${encodeURIComponent(intent.role)}`,
        expiresAt: new Date(lease.leaseExpiresAt).toISOString(),
        requiredContentType: intent.mediaType,
        artifact: { artifactId: intent.artifactId, role: intent.role, objectKey, contentSha256: intent.contentSha256, byteLength: intent.byteLength },
      },
    });
  }
  const storage = getStorage();
  if (!storage.sha256) return json(503, { ok: false, code: 'OUTPUT_VERIFICATION_UNAVAILABLE' });
  const stored = await storage.sha256(objectKey).catch(() => null);
  if (!stored || stored.size !== intent.byteLength || stored.contentSha256 !== intent.contentSha256) return json(409, { ok: false, code: 'OUTPUT_STORAGE_IDENTITY_MISMATCH' });
  if (row.status !== 'COMMITTED') {
    const updated = await db.execute(
      'UPDATE nf_precision_cad_commercial_output_intents SET status = ?, committed_at = ? WHERE job_id = ? AND artifact_role = ? AND status = ? AND worker_identity = ?',
      'COMMITTED', Date.now(), jobId, intent.role, 'PENDING', lease.owner,
    );
    if (updated.changes !== 1) return json(409, { ok: false, code: 'OUTPUT_COMMIT_CONFLICT' });
  }
  return json(200, { ok: true, committed: true, idempotent: row.status === 'COMMITTED', artifact: { artifactId: intent.artifactId, role: intent.role, objectKey, contentSha256: intent.contentSha256, byteLength: intent.byteLength } });
}

export async function PUT(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId') ?? '';
  const role = req.nextUrl.searchParams.get('role') ?? '';
  const lease = await authorize(req, jobId).catch(() => null);
  if (!lease) return json(403, { ok: false, code: 'LEASE_CAPABILITY_INVALID' });
  const db = getDbAdapter();
  const row = await db.queryOne<IntentRow>(
    'SELECT artifact_id, artifact_role, object_key, content_sha256, byte_length, media_type, worker_identity, status, committed_at FROM nf_precision_cad_commercial_output_intents WHERE job_id = ? AND artifact_role = ?',
    jobId, role,
  );
  if (!row || row.worker_identity !== lease.owner || row.status !== 'PENDING') return json(409, { ok: false, code: 'OUTPUT_INTENT_NOT_PENDING' });
  if (req.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== row.media_type) return json(415, { ok: false, code: 'OUTPUT_CONTENT_TYPE_MISMATCH' });
  let bytes: Uint8Array;
  try { bytes = await readBoundedRawBody(req, COMMERCIAL_OUTPUT_MAX_BYTES); }
  catch (error) {
    return json(boundedRawBodyError(error)?.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, { ok: false, code: boundedRawBodyError(error)?.code ?? 'OUTPUT_BODY_INVALID' });
  }
  if (bytes.byteLength !== Number(row.byte_length) || sha256(bytes) !== row.content_sha256) return json(422, { ok: false, code: 'OUTPUT_BYTES_MISMATCH' });
  const storage = getStorage();
  if (!storage.uploadRawImmutable) return json(503, { ok: false, code: 'IMMUTABLE_OUTPUT_STORAGE_REQUIRED' });
  try { await storage.uploadRawImmutable(Buffer.from(bytes), row.object_key, row.media_type); }
  catch { return json(409, { ok: false, code: 'IMMUTABLE_OUTPUT_CONFLICT' }); }
  return json(200, { ok: true, uploaded: true, contentSha256: row.content_sha256 });
}
