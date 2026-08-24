import { createHash, timingSafeEqual } from 'node:crypto';
import type { DbAdapter } from '@/lib/db-adapter';
import { artifactTenantNamespace, safeArtifactNamespaceSegment } from '@/lib/artifacts/directArtifactUploadStore';
import { getStorage, type StorageAdapter } from '@/lib/storage';
import {
  COMMERCIAL_PRECISION_EXECUTION_VERSION,
  COMMERCIAL_PRECISION_INPUT_SCHEMA,
  canonicalCommercialExecution,
  commercialExecutionJobBinding,
  validateCommercialExecutionInput,
  validateCommercialExecutionJob,
  type CommercialExecutionInput,
  type CommercialExecutionJob,
  type CommercialOutputArtifact,
  type CommercialOutputRole,
  type CommercialWorkerReceipt,
} from '../../../packages/job-contracts/src/commercialPrecisionExecution';

export const COMMERCIAL_WORKER_IO_MIGRATION_VERSION = 2026082502;
export const COMMERCIAL_OUTPUT_MAX_BYTES = 64 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export type CommercialOutputIntent = {
  artifactId: string;
  role: CommercialOutputRole;
  contentSha256: string;
  byteLength: number;
  mediaType: 'application/step' | 'model/step' | 'application/json';
};

export type CommercialLeaseAuthorization = {
  job: CommercialExecutionJob;
  owner: string;
  capabilityHash: string;
  leaseExpiresAt: number;
};

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function constantTimeHex(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function safeSegment(value: string): string {
  const safe = safeArtifactNamespaceSegment(value);
  if (!safe) throw new Error('commercial_worker_namespace_invalid');
  return safe;
}

export async function assertCommercialWorkerIoMigration(db: DbAdapter): Promise<void> {
  if (db.backend !== 'postgres') throw new Error(`commercial_worker_io_migration_required:v${COMMERCIAL_WORKER_IO_MIGRATION_VERSION}`);
  const migration = await db.queryOne<{ version: number; checksum?: string }>(
    'SELECT version, checksum FROM nf_schema_migrations WHERE version = ?',
    COMMERCIAL_WORKER_IO_MIGRATION_VERSION,
  ).catch(() => undefined);
  const expected = process.env.POSTGRES_MIGRATION_CHECKSUM_2026082502?.trim();
  const commercial = process.env.NEXYFAB_COMMERCIAL_MODE === '1'
    || process.env.NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE === '1';
  if (!migration || Number(migration.version) !== COMMERCIAL_WORKER_IO_MIGRATION_VERSION
    || !SHA256.test(migration.checksum ?? '') || (commercial && !expected)
    || (expected && migration.checksum !== expected)) {
    throw new Error(`commercial_worker_io_migration_required:v${COMMERCIAL_WORKER_IO_MIGRATION_VERSION}`);
  }
}

export async function stageCommercialExecutionInput(input: {
  job: Omit<CommercialExecutionJob, 'inputArtifact'>;
  arguments: Readonly<Record<string, unknown>>;
  storage?: StorageAdapter;
}): Promise<{ job: CommercialExecutionJob; input: CommercialExecutionInput; bytes: Buffer }> {
  const provisional: CommercialExecutionJob = {
    ...input.job,
    inputArtifact: {
      artifactId: 'pending-input',
      objectKey: 'private/commercial-precision-inputs/pending/input.json',
      contentSha256: '0'.repeat(64),
      byteLength: 1,
      mediaType: 'application/json',
    },
  };
  const payload: CommercialExecutionInput = {
    schema: COMMERCIAL_PRECISION_INPUT_SCHEMA,
    job: commercialExecutionJobBinding(provisional),
    arguments: input.arguments,
  };
  const bytes = Buffer.from(canonicalCommercialExecution(payload), 'utf8');
  const contentSha256 = sha256(bytes);
  const tenant = artifactTenantNamespace(input.job.tenantId);
  const project = safeSegment(input.job.projectId);
  const jobId = safeSegment(input.job.jobId);
  const artifactId = `input-${contentSha256.slice(0, 48)}`;
  const objectKey = `private/commercial-precision-inputs/${tenant}/projects/${project}/jobs/${jobId}/${contentSha256}.json`;
  const job: CommercialExecutionJob = {
    ...input.job,
    contractVersion: COMMERCIAL_PRECISION_EXECUTION_VERSION,
    inputArtifact: { artifactId, objectKey, contentSha256, byteLength: bytes.byteLength, mediaType: 'application/json' },
  };
  const issues = [
    ...validateCommercialExecutionJob(job),
    ...await validateCommercialExecutionInput({ ...payload, job: commercialExecutionJobBinding(job) }, job),
  ];
  if (issues.length) throw new Error(`commercial_worker_input_invalid:${[...new Set(issues)].join(',')}`);
  const storage = input.storage ?? getStorage();
  if (!storage.uploadRawImmutable || !storage.sha256 || !storage.download) {
    throw new Error('commercial_worker_immutable_storage_required');
  }
  await storage.uploadRawImmutable(bytes, objectKey, 'application/json');
  const [identity, readback] = await Promise.all([
    storage.sha256(objectKey),
    storage.download(objectKey),
  ]);
  if (identity.size !== bytes.byteLength || identity.contentSha256 !== contentSha256
    || readback.byteLength !== bytes.byteLength || sha256(readback) !== contentSha256) {
    throw new Error('commercial_worker_input_readback_failed');
  }
  return { job, input: { ...payload, job: commercialExecutionJobBinding(job) }, bytes };
}

export async function authorizeCommercialLease(input: {
  db: DbAdapter;
  jobId: string;
  workerIdentity: string;
  leaseCapability: string;
  now?: number;
}): Promise<CommercialLeaseAuthorization | null> {
  if (!SAFE_ID.test(input.jobId) || !SAFE_ID.test(input.workerIdentity)
    || !/^[A-Za-z0-9_-]{43,128}$/.test(input.leaseCapability)) return null;
  await assertCommercialWorkerIoMigration(input.db);
  const row = await input.db.queryOne<Record<string, unknown>>(
    'SELECT job_json, status, lease_owner, lease_expires_at, capability_hash FROM nf_precision_cad_commercial_outbox WHERE job_id = ?',
    input.jobId,
  );
  if (!row || (row.status !== 'CLAIMED' && row.status !== 'SENT')
    || row.lease_owner !== input.workerIdentity || Number(row.lease_expires_at) <= (input.now ?? Date.now())) return null;
  const capabilityHash = sha256(Buffer.from(input.leaseCapability, 'utf8'));
  if (!SHA256.test(String(row.capability_hash ?? ''))
    || !constantTimeHex(capabilityHash, String(row.capability_hash))) return null;
  let job: CommercialExecutionJob;
  try { job = JSON.parse(String(row.job_json)) as CommercialExecutionJob; } catch { return null; }
  if (job.jobId !== input.jobId || validateCommercialExecutionJob(job).length) return null;
  return { job, owner: input.workerIdentity, capabilityHash, leaseExpiresAt: Number(row.lease_expires_at) };
}

export function validateCommercialOutputIntent(intent: CommercialOutputIntent): string[] {
  const issues: string[] = [];
  if (!intent || typeof intent !== 'object') return ['output_intent_invalid'];
  if (!SAFE_ID.test(intent.artifactId ?? '')) issues.push('output_artifact_id_invalid');
  if (!['model', 'report', 'verification'].includes(intent.role)) issues.push('output_role_invalid');
  if (!SHA256.test(intent.contentSha256 ?? '')) issues.push('output_sha256_invalid');
  if (!Number.isSafeInteger(intent.byteLength) || intent.byteLength < 1 || intent.byteLength > COMMERCIAL_OUTPUT_MAX_BYTES) issues.push('output_size_invalid');
  if (intent.role === 'model' && intent.mediaType !== 'application/step' && intent.mediaType !== 'model/step') issues.push('model_media_type_invalid');
  if ((intent.role === 'report' || intent.role === 'verification') && intent.mediaType !== 'application/json') issues.push('json_media_type_invalid');
  return [...new Set(issues)];
}

export function commercialOutputObjectKey(job: CommercialExecutionJob, intent: CommercialOutputIntent): string {
  const tenant = artifactTenantNamespace(job.tenantId);
  const project = safeSegment(job.projectId);
  const jobId = safeSegment(job.jobId);
  const artifact = safeSegment(intent.artifactId);
  const extension = intent.role === 'model' ? 'step' : 'json';
  return `private/commercial-precision-outputs/${tenant}/projects/${project}/jobs/${jobId}/${intent.role}/${artifact}-${intent.contentSha256}.${extension}`;
}

export async function committedCommercialOutputIssues(input: {
  db: DbAdapter;
  receipt: CommercialWorkerReceipt;
}): Promise<string[]> {
  await assertCommercialWorkerIoMigration(input.db);
  const rows = await input.db.queryAll<Record<string, unknown>>(
    'SELECT artifact_id, artifact_role, object_key, content_sha256, byte_length, worker_identity, status FROM nf_precision_cad_commercial_output_intents WHERE job_id = ? AND execution_id = ?',
    input.receipt.jobId,
    input.receipt.executionId,
  );
  const committed = new Map(rows.map(row => [String(row.artifact_role), row]));
  const issues: string[] = [];
  if (rows.length !== 3 || committed.size !== 3) issues.push('committed_output_roles_incomplete');
  for (const artifact of input.receipt.outputArtifacts) {
    const row = committed.get(artifact.role);
    if (!row || row.status !== 'COMMITTED') { issues.push(`output_not_committed:${artifact.role}`); continue; }
    if (row.worker_identity !== input.receipt.workerIdentity
      || row.artifact_id !== artifact.artifactId
      || row.object_key !== artifact.objectKey
      || row.content_sha256 !== artifact.contentSha256
      || Number(row.byte_length) !== artifact.byteLength) issues.push(`output_binding_mismatch:${artifact.role}`);
  }
  return [...new Set(issues)];
}

export function sameCommercialOutputArtifacts(
  left: CommercialOutputArtifact[],
  right: CommercialOutputArtifact[],
): boolean {
  const normalized = (items: CommercialOutputArtifact[]) => items
    .map(item => `${item.role}\0${item.artifactId}\0${item.objectKey}\0${item.contentSha256}\0${item.byteLength}`)
    .sort();
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}
