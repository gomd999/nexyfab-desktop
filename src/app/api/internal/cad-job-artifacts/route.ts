import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter, type DbAdapter } from '@/lib/db-adapter';
import {
  artifactTenantNamespace,
  ensureDirectArtifactUploadTables,
  safeArtifactNamespaceSegment,
} from '@/lib/artifacts/directArtifactUploadStore';
import { hashCadPayload } from '@/lib/cad/workspaceRevisionStore';
import { verifyCadJobAuthorizationToken } from '@/lib/jobs/cadJobAuthorization';
import { getStorage } from '@/lib/storage';
import { readBoundedRawBody } from '@/lib/boundedRawBody';
import {
  ARTIFACT_CONTRACT_VERSION,
  validateCadJobMessage,
  validateCadJobOutputArtifactIntent,
  type CadJobMessage,
  type CadJobOutputArtifactIntent,
} from '@/lib/platform/contracts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const INLINE_MAX_BYTES = 16 * 1024 * 1024;
const MAX_BODY_BYTES = Math.ceil(INLINE_MAX_BYTES * 4 / 3) + 128 * 1024;

interface RegistryRow { message_sha256: string; message_json: string }
interface IntentRow {
  job_id: string; artifact_id: string; object_key: string; intent_sha256: string;
  intent_json: string; status: string; committed_artifact_id: string | null;
}

type Body = {
  action?: unknown;
  message?: unknown;
  authorizationToken?: unknown;
  intent?: unknown;
  dataBase64?: unknown;
};

function secret(): string | null {
  const value = process.env.NEXYFAB_JOB_AUTHORIZATION_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

function bearer(req: NextRequest): string {
  return req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
}

async function ensureTables(db: DbAdapter): Promise<void> {
  await ensureDirectArtifactUploadTables(db);
  await db.executeRaw(`
    CREATE TABLE IF NOT EXISTS nf_cad_job_output_intents (
      job_id TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      object_key TEXT NOT NULL UNIQUE,
      intent_sha256 TEXT NOT NULL,
      intent_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      committed_at BIGINT,
      committed_artifact_id TEXT,
      PRIMARY KEY(job_id, artifact_id)
    );
  `);
  await db.execute('ALTER TABLE nf_cad_job_output_intents ADD COLUMN committed_artifact_id TEXT').catch(() => ({ changes: 0 }));
}

async function authorize(
  db: DbAdapter,
  message: CadJobMessage,
  token: string,
): Promise<{ ok: true; messageSha256: string } | { ok: false; status: number; code: string }> {
  const issues = validateCadJobMessage(message);
  if (issues.length) return { ok: false, status: 422, code: 'JOB_CONTRACT_REJECTED' };
  const messageSha256 = hashCadPayload(message);
  const registry = await db.queryOne<RegistryRow>(
    'SELECT message_sha256, message_json FROM nf_cad_job_registry WHERE job_id = ?', message.jobId,
  );
  if (!registry || registry.message_sha256 !== messageSha256 || hashCadPayload(JSON.parse(registry.message_json)) !== messageSha256) {
    return { ok: false, status: 409, code: 'JOB_NOT_AUTHORIZED' };
  }
  const signingSecret = secret();
  if (!signingSecret) return { ok: false, status: 503, code: 'JOB_AUTHORIZATION_NOT_CONFIGURED' };
  if (!verifyCadJobAuthorizationToken(token, message.jobId, messageSha256, signingSecret)) {
    return { ok: false, status: 403, code: 'JOB_AUTHORIZATION_INVALID' };
  }
  return { ok: true, messageSha256 };
}

function outputObjectKey(message: CadJobMessage, intent: CadJobOutputArtifactIntent): string | null {
  const project = safeArtifactNamespaceSegment(message.projectId);
  const job = safeArtifactNamespaceSegment(message.jobId);
  const artifact = safeArtifactNamespaceSegment(intent.artifactId);
  if (!project || !job || !artifact) return null;
  return `private/artifacts/${artifactTenantNamespace(message.tenantId)}/projects/${project}/jobs/${job}/${artifact}/${intent.filename}`;
}

async function readJson(req: NextRequest): Promise<Body | null> {
  try {
    const bytes = await readBoundedRawBody(req, MAX_BODY_BYTES);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(text) as Body;
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId') ?? '';
  const artifactId = req.nextUrl.searchParams.get('artifactId') ?? '';
  if (!safeArtifactNamespaceSegment(jobId) || !safeArtifactNamespaceSegment(artifactId)) {
    return NextResponse.json({ ok: false, code: 'ARTIFACT_QUERY_INVALID' }, { status: 400 });
  }
  const db = getDbAdapter();
  await ensureTables(db);
  const registry = await db.queryOne<RegistryRow>(
    'SELECT message_sha256, message_json FROM nf_cad_job_registry WHERE job_id = ?', jobId,
  );
  if (!registry) return NextResponse.json({ ok: false, code: 'JOB_NOT_AUTHORIZED' }, { status: 404 });
  const message = JSON.parse(registry.message_json) as CadJobMessage;
  const auth = await authorize(db, message, bearer(req));
  if (!auth.ok) return NextResponse.json({ ok: false, code: auth.code }, { status: auth.status });
  const ref = message.inputArtifacts.find(item => item.artifactId === artifactId);
  if (!ref) return NextResponse.json({ ok: false, code: 'INPUT_ARTIFACT_NOT_AUTHORIZED' }, { status: 403 });
  const row = await db.queryOne<{ object_key: string; content_sha256: string; immutability_state: string }>(
    'SELECT object_key, content_sha256, immutability_state FROM nf_cad_artifacts WHERE id = ? AND project_id = ? AND tenant_id = ?',
    artifactId, message.projectId, message.tenantId,
  );
  if (!row || row.immutability_state !== 'IMMUTABLE' || row.object_key !== ref.objectKey || row.content_sha256 !== ref.contentSha256) {
    return NextResponse.json({ ok: false, code: 'INPUT_ARTIFACT_IDENTITY_MISMATCH' }, { status: 409 });
  }
  const storage = getStorage();
  if (!storage.download) return NextResponse.json({ ok: false, code: 'ARTIFACT_STREAM_UNAVAILABLE' }, { status: 501 });
  const bytes = await storage.download(ref.objectKey).catch(() => null);
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== ref.contentSha256) {
    return NextResponse.json({ ok: false, code: 'INPUT_ARTIFACT_HASH_MISMATCH' }, { status: 409 });
  }
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: { 'content-type': 'application/octet-stream', 'cache-control': 'private, no-store', 'x-content-sha256': ref.contentSha256 },
  });
}

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body || !body.message || typeof body.message !== 'object' || typeof body.authorizationToken !== 'string') {
    return NextResponse.json({ ok: false, code: 'REQUEST_INVALID' }, { status: body ? 400 : 413 });
  }
  const message = body.message as CadJobMessage;
  const db = getDbAdapter();
  await ensureTables(db);
  const auth = await authorize(db, message, body.authorizationToken);
  if (!auth.ok) return NextResponse.json({ ok: false, code: auth.code }, { status: auth.status });
  if (!body.intent || typeof body.intent !== 'object') {
    return NextResponse.json({ ok: false, code: 'OUTPUT_INTENT_REQUIRED' }, { status: 400 });
  }
  const intent = body.intent as CadJobOutputArtifactIntent;
  const issues = validateCadJobOutputArtifactIntent(intent);
  const objectKey = outputObjectKey(message, intent);
  if (!objectKey) issues.push('output_namespace_invalid');
  if (issues.length) return NextResponse.json({ ok: false, code: 'OUTPUT_INTENT_REJECTED', issues }, { status: 422 });
  const intentSha256 = hashCadPayload(intent);
  const existing = await db.queryOne<IntentRow>(
    'SELECT * FROM nf_cad_job_output_intents WHERE job_id = ? AND artifact_id = ?', message.jobId, intent.artifactId,
  );
  if (existing && (existing.intent_sha256 !== intentSha256 || existing.object_key !== objectKey)) {
    return NextResponse.json({ ok: false, code: 'OUTPUT_INTENT_CONFLICT' }, { status: 409 });
  }
  if (!existing) {
    await db.execute(
      `INSERT INTO nf_cad_job_output_intents
       (job_id, artifact_id, object_key, intent_sha256, intent_json, status, created_at, committed_at, committed_artifact_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      message.jobId, intent.artifactId, objectKey!, intentSha256, JSON.stringify(intent), 'PENDING', Date.now(), null, null,
    );
  }
  const storage = getStorage();
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();

  if (body.action === 'output-intent') {
    if (existing?.status === 'COMMITTED') {
      const committed = existing.committed_artifact_id
        ? await db.queryOne<{ id: string; object_key: string; content_sha256: string }>(
          'SELECT id, object_key, content_sha256 FROM nf_cad_artifacts WHERE id = ?', existing.committed_artifact_id,
        )
        : null;
      if (!committed) return NextResponse.json({ ok: false, code: 'COMMITTED_ARTIFACT_MISSING' }, { status: 409 });
      return NextResponse.json({
        ok: true, committed: true,
        artifact: { artifactId: committed.id, objectKey: committed.object_key, contentSha256: committed.content_sha256 },
      });
    }
    const direct = storage.createPrivateRawUploadUrl
      ? await storage.createPrivateRawUploadUrl(objectKey!, intent.mediaType, 15 * 60).catch(() => null)
      : null;
    return NextResponse.json({
      ok: true,
      grant: {
        artifact: { artifactId: intent.artifactId, objectKey, contentSha256: intent.contentSha256 },
        uploadMode: direct ? 'DIRECT_PUT' : 'CORE_INLINE',
        uploadUrl: direct?.uploadUrl ?? new URL(req.url).toString(),
        expiresAt,
        requiredContentType: intent.mediaType,
      },
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  }

  if (body.action === 'output-upload') {
    if (typeof body.dataBase64 !== 'string') return NextResponse.json({ ok: false, code: 'OUTPUT_DATA_REQUIRED' }, { status: 400 });
    const bytes = Buffer.from(body.dataBase64, 'base64');
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (!bytes.length || bytes.length > INLINE_MAX_BYTES || bytes.length !== intent.byteLength || actualHash !== intent.contentSha256) {
      return NextResponse.json({ ok: false, code: 'OUTPUT_BYTES_MISMATCH' }, { status: 422 });
    }
    if (!storage.uploadRaw) return NextResponse.json({ ok: false, code: 'OUTPUT_UPLOAD_UNAVAILABLE' }, { status: 501 });
    if (existing?.status !== 'COMMITTED') {
      await storage.uploadRaw(bytes, objectKey!, intent.mediaType).catch(error => {
        if (!String(error).includes('EEXIST')) throw error;
      });
    }
    return NextResponse.json({ ok: true, uploaded: true });
  }

  if (body.action === 'commit-output') {
    if (!storage.sha256) return NextResponse.json({ ok: false, code: 'OUTPUT_VERIFICATION_UNAVAILABLE' }, { status: 501 });
    const stored = await storage.sha256(objectKey!).catch(() => null);
    if (!stored || stored.size !== intent.byteLength || stored.contentSha256 !== intent.contentSha256) {
      return NextResponse.json({ ok: false, code: 'OUTPUT_STORAGE_IDENTITY_MISMATCH' }, { status: 409 });
    }
    const registered = await db.queryOne<{ id: string; object_key: string; content_sha256: string }>(
      'SELECT id, object_key, content_sha256 FROM nf_cad_artifacts WHERE id = ?', intent.artifactId,
    );
    if (registered && (registered.object_key !== objectKey || registered.content_sha256 !== intent.contentSha256)) {
      return NextResponse.json({ ok: false, code: 'OUTPUT_ARTIFACT_CONFLICT' }, { status: 409 });
    }
    const duplicate = registered ?? await db.queryOne<{ id: string; object_key: string; content_sha256: string }>(
      'SELECT id, object_key, content_sha256 FROM nf_cad_artifacts WHERE project_id = ? AND content_sha256 = ?',
      message.projectId, intent.contentSha256,
    );
    if (!duplicate) {
      await db.transaction(async tx => {
        await tx.execute(
          `INSERT INTO nf_cad_artifacts
           (id, contract_version, project_id, tenant_id, object_key, media_type, format, byte_length,
            content_sha256, shape_identity_sha256, producer_build_id, kernel_identity, created_by, created_at, immutability_state)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          intent.artifactId, ARTIFACT_CONTRACT_VERSION, message.projectId, message.tenantId, objectKey!,
          intent.mediaType, intent.format, intent.byteLength, intent.contentSha256,
          intent.shapeIdentitySha256 ?? null, intent.producerBuildId, intent.kernelIdentity,
          message.requestedBy, Date.now(), 'IMMUTABLE',
        );
        await tx.execute(
          'UPDATE nf_cad_job_output_intents SET status = ?, committed_at = ?, committed_artifact_id = ? WHERE job_id = ? AND artifact_id = ?',
          'COMMITTED', Date.now(), intent.artifactId, message.jobId, intent.artifactId,
        );
      });
    } else if (existing?.status !== 'COMMITTED') {
      await db.execute(
        'UPDATE nf_cad_job_output_intents SET status = ?, committed_at = ?, committed_artifact_id = ? WHERE job_id = ? AND artifact_id = ?',
        'COMMITTED', Date.now(), duplicate.id, message.jobId, intent.artifactId,
      );
    }
    const authoritative = duplicate ?? { id: intent.artifactId, object_key: objectKey!, content_sha256: intent.contentSha256 };
    return NextResponse.json({
      ok: true, committed: true, idempotent: Boolean(duplicate),
      artifact: { artifactId: authoritative.id, objectKey: authoritative.object_key, contentSha256: authoritative.content_sha256 },
    });
  }
  return NextResponse.json({ ok: false, code: 'ACTION_INVALID' }, { status: 400 });
}
