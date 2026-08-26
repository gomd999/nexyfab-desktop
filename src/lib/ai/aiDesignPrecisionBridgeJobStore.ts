import 'server-only';

import { createHash } from 'node:crypto';
import { getDbAdapter, type DbAdapter } from '@/lib/db-adapter';
import {
  canonicalCadConsumerDraftJson,
} from '@/lib/cad/canonicalCadV2ConsumerDraft';
import {
  validateMechanicalStableReferenceBinding,
  type MechanicalStableReferenceBinding,
} from '@/lib/cad/mechanicalStableReferenceBinding';
import { serverEvidenceSha256 } from './serverEvidence';
import {
  verifyAiDesignPrecisionVerificationReceipt,
  type AiDesignPrecisionVerificationReceiptV1,
  type AiDesignPrecisionVerificationRequestV1,
} from './aiDesignPrecisionVerification';
import {
  validateAiDesignComplexWorkspaceAggregate,
  type AiDesignComplexWorkspaceAggregateV1,
} from './aiDesignComplexWorkspaceAggregate';

export const AI_PRECISION_BRIDGE_MIGRATION_VERSION = 2026082403 as const;
export const AI_PRECISION_BRIDGE_JOB_SCHEMA = 'nexyfab.ai-precision-exact-bridge-job.v1' as const;

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const JOB_KEYS = [
  'schema', 'jobId', 'ownerKeySha256', 'projectId', 'sessionId', 'candidateId',
  'handoffRequestId', 'handoffSha256', 'binding', 'precisionRequestId',
  'precisionRequestSha256', 'runtimeRevision', 'complexRevision', 'queuedAt',
  'exactExecution', 'manufacturingReleaseReady', 'jobSha256',
] as const;
const verifiedAdapters = new WeakSet<object>();

export type AiPrecisionBridgeStatus =
  | 'PENDING' | 'CLAIMED' | 'SENT' | 'COMPLETED' | 'HOLD' | 'VERIFIED_UNKNOWN';

export interface AiPrecisionBridgeJobV1 {
  schema: typeof AI_PRECISION_BRIDGE_JOB_SCHEMA;
  jobId: string;
  ownerKeySha256: string;
  projectId: string;
  sessionId: string;
  candidateId: string;
  handoffRequestId: string;
  handoffSha256: string;
  binding: MechanicalStableReferenceBinding;
  precisionRequestId: string;
  precisionRequestSha256: string;
  runtimeRevision: number;
  complexRevision: number;
  queuedAt: string;
  exactExecution: 'NOT_RUN';
  manufacturingReleaseReady: false;
  jobSha256: string;
}

export interface AiPrecisionBridgeOutboxRecord {
  job: AiPrecisionBridgeJobV1;
  status: AiPrecisionBridgeStatus;
  attempt: number;
  leaseGeneration: number;
  leaseOwner: string | null;
  leaseCapabilitySha256: string | null;
  leaseExpiresAt: number | null;
  availableAt: number;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

type OutboxRow = {
  job_id: string;
  owner_key_sha256: string;
  project_id: string;
  session_id: string;
  candidate_id: string;
  handoff_request_id: string;
  handoff_sha256: string;
  binding_sha256: string;
  binding_json: string;
  precision_request_id: string;
  precision_request_sha256: string;
  runtime_revision: number;
  complex_revision: number;
  job_sha256: string;
  job_json: string;
  status: AiPrecisionBridgeStatus;
  attempt: number;
  lease_generation: number;
  lease_owner: string | null;
  lease_capability_sha256: string | null;
  lease_expires_at: number | null;
  available_at: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
};

export type AiPrecisionBridgeStoreResult =
  | { ok: true; record: AiPrecisionBridgeOutboxRecord; replayed?: boolean }
  | { ok: false; code: 'NOT_FOUND' | 'CONFLICT' | 'CAPABILITY_INVALID' | 'LEASE_EXPIRED' | 'STATE_CONFLICT' | 'RECEIPT_CONFLICT' };

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && actual.every(key => typeof key === 'string' && keys.includes(key));
}

function capabilitySha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function exactArtifactManifestValid(
  value: unknown,
  record: AiPrecisionBridgeOutboxRecord,
  receipt: AiDesignPrecisionVerificationReceiptV1,
  exactArtifactSha256: string | null,
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const manifest = value as Record<string, unknown>;
  const job = record.job;
  if (receipt.status === 'FAIL') {
    return exactArtifactSha256 === null
      && manifest.schema === 'nexyfab.ai-precision-exact-failure-manifest.v1'
      && manifest.jobId === job.jobId && manifest.jobSha256 === job.jobSha256
      && manifest.precisionRequestId === job.precisionRequestId
      && manifest.precisionRequestSha256 === job.precisionRequestSha256
      && manifest.bindingSha256 === job.binding.bindingSha256
      && manifest.receiptSha256 === receipt.receiptDigest
      && manifest.exactExecution === 'FAIL' && manifest.release === 'HOLD'
      && manifest.manufacturingReleaseReady === false
      && Array.isArray(manifest.blockers) && manifest.blockers.length > 0
      && manifest.blockers.length <= 64 && manifest.blockers.every(code => typeof code === 'string' && ID.test(code));
  }
  if (!exactArtifactSha256 || manifest.schema !== 'nexyfab.ai-precision-exact-artifact-manifest.v1'
    || manifest.jobId !== job.jobId || manifest.jobSha256 !== job.jobSha256
    || manifest.precisionRequestId !== job.precisionRequestId
    || manifest.precisionRequestSha256 !== job.precisionRequestSha256
    || manifest.bindingSha256 !== job.binding.bindingSha256
    || manifest.manifestSha256 !== exactArtifactSha256
    || manifest.exactExecution !== 'PASS' || manifest.release !== 'HOLD'
    || manifest.manufacturingReleaseReady !== false) return false;
  const expectedKey = `private/ai-precision-exact/v1/${job.jobSha256.slice(0, 2)}/${job.jobSha256}/manifest-${exactArtifactSha256}.json`;
  if (manifest.manifestObjectKey !== expectedKey || !Array.isArray(manifest.objects)
    || manifest.objects.length !== 5) return false;
  const roles = new Set<string>();
  for (const item of manifest.objects as Array<Record<string, unknown>>) {
    if (!item || !['step', 'drawing', 'dimensions', 'bom', 'verification'].includes(String(item.role))
      || roles.has(String(item.role)) || !SHA256.test(String(item.contentSha256 ?? ''))
      || !Number.isSafeInteger(item.byteLength) || Number(item.byteLength) <= 0
      || typeof item.contentType !== 'string' || typeof item.objectKey !== 'string'
      || !item.objectKey.startsWith(`private/ai-precision-exact/v1/${job.jobSha256.slice(0, 2)}/${job.jobSha256}/${item.role}-`)
      || !item.objectKey.includes(String(item.contentSha256))) return false;
    roles.add(String(item.role));
  }
  const { manifestObjectKey: _manifestObjectKey, manifestSha256: _manifestSha256, ...material } = manifest;
  void _manifestObjectKey; void _manifestSha256;
  const computed = createHash('sha256')
    .update(canonicalCadConsumerDraftJson(material as never), 'utf8').digest('hex');
  return computed === exactArtifactSha256;
}

function receiptInputValid(input: {
  record: AiPrecisionBridgeOutboxRecord;
  request: AiDesignPrecisionVerificationRequestV1;
  receipt: AiDesignPrecisionVerificationReceiptV1;
  signingSecret: string;
  exactArtifactSha256: string | null;
  artifactManifest: unknown;
  now: number;
  historical?: boolean;
}): boolean {
  if (Buffer.byteLength(input.signingSecret, 'utf8') < 32
    || (input.exactArtifactSha256 !== null && !SHA256.test(input.exactArtifactSha256))) return false;
  const verification = verifyAiDesignPrecisionVerificationReceipt(input.receipt, input.request, {
    signingSecret: input.signingSecret,
    now: new Date(input.historical ? Date.parse(input.receipt.issuedAt) : input.now),
    expectedRuntimeRevision: input.record.job.runtimeRevision,
    expectedComplexRevision: input.record.job.complexRevision,
  });
  const exactBindingValid = input.receipt.status === 'PASS'
    ? input.exactArtifactSha256 !== null
      && input.receipt.scopeResults.every(result => result.exactArtifactDigest === input.exactArtifactSha256)
    : input.exactArtifactSha256 === null;
  return verification.ok && exactBindingValid
    && input.request.requestId === input.record.job.precisionRequestId
    && input.request.requestDigest === input.record.job.precisionRequestSha256
    && exactArtifactManifestValid(
      input.artifactManifest, input.record, input.receipt, input.exactArtifactSha256,
    );
}

function jobMaterial(value: Omit<AiPrecisionBridgeJobV1, 'jobSha256'> | AiPrecisionBridgeJobV1) {
  const { jobSha256: _jobSha256, ...material } = value as AiPrecisionBridgeJobV1;
  void _jobSha256;
  return material;
}

export function createAiPrecisionBridgeJob(
  input: Omit<AiPrecisionBridgeJobV1, 'schema' | 'jobId' | 'exactExecution' | 'manufacturingReleaseReady' | 'jobSha256'>,
): AiPrecisionBridgeJobV1 {
  const identity = {
    ownerKeySha256: input.ownerKeySha256,
    projectId: input.projectId,
    sessionId: input.sessionId,
    handoffRequestId: input.handoffRequestId,
    handoffSha256: input.handoffSha256,
  };
  const material = {
    schema: AI_PRECISION_BRIDGE_JOB_SCHEMA,
    jobId: `ai-precision-job:${serverEvidenceSha256(identity).slice(0, 48)}`,
    ...structuredClone(input),
    exactExecution: 'NOT_RUN' as const,
    manufacturingReleaseReady: false as const,
  };
  const job = Object.freeze({ ...material, jobSha256: serverEvidenceSha256(material) });
  const issues = validateAiPrecisionBridgeJob(job);
  if (issues.length) throw new Error(`AI_PRECISION_BRIDGE_JOB_INVALID:${issues.join(',')}`);
  return job;
}

export function validateAiPrecisionBridgeJob(value: unknown): string[] {
  if (!exactRecord(value, JOB_KEYS)) return ['bridge_job_schema_invalid'];
  const job = value as unknown as AiPrecisionBridgeJobV1;
  const issues: string[] = [];
  if (job.schema !== AI_PRECISION_BRIDGE_JOB_SCHEMA
    || [job.jobId, job.projectId, job.sessionId, job.candidateId, job.handoffRequestId, job.precisionRequestId]
      .some(value => !ID.test(value ?? ''))) issues.push('bridge_job_identity_invalid');
  if (![job.ownerKeySha256, job.handoffSha256, job.precisionRequestSha256, job.jobSha256]
    .every(value => SHA256.test(value ?? ''))) issues.push('bridge_job_hash_invalid');
  if (!Number.isSafeInteger(job.runtimeRevision) || job.runtimeRevision < 0
    || !Number.isSafeInteger(job.complexRevision) || job.complexRevision < 0) issues.push('bridge_job_revision_invalid');
  if (!Number.isFinite(Date.parse(job.queuedAt ?? ''))) issues.push('bridge_job_time_invalid');
  const bindingIssues = validateMechanicalStableReferenceBinding(job.binding);
  if (bindingIssues.length || job.binding.projectId !== job.projectId) issues.push('bridge_job_binding_invalid');
  if (job.exactExecution !== 'NOT_RUN' || job.manufacturingReleaseReady !== false) issues.push('bridge_job_authority_invalid');
  if (issues.length === 0 && job.jobSha256 !== serverEvidenceSha256(jobMaterial(job))) issues.push('bridge_job_digest_mismatch');
  return [...new Set(issues)];
}

export async function assertAiPrecisionBridgeMigration(db: DbAdapter): Promise<void> {
  if (db.backend !== 'postgres') throw new Error('AI_PRECISION_BRIDGE_POSTGRES_REQUIRED');
  if (verifiedAdapters.has(db as object)) return;
  const expected = process.env.POSTGRES_MIGRATION_CHECKSUM_2026082403?.trim();
  const migration = await db.queryOne<{ version: number; checksum: string }>(
    'SELECT version, checksum FROM nf_schema_migrations WHERE version = ?',
    AI_PRECISION_BRIDGE_MIGRATION_VERSION,
  ).catch(() => undefined);
  if (!migration || migration.version !== AI_PRECISION_BRIDGE_MIGRATION_VERSION
    || !expected || !SHA256.test(expected) || migration.checksum !== expected) {
    throw new Error('AI_PRECISION_BRIDGE_MIGRATION_REQUIRED');
  }
  await db.queryOne('SELECT job_id FROM nf_ai_precision_bridge_outbox LIMIT 1');
  await db.queryOne('SELECT receipt_id FROM nf_ai_precision_bridge_receipts LIMIT 1');
  verifiedAdapters.add(db as object);
}

function parseRow(row: OutboxRow | undefined): AiPrecisionBridgeOutboxRecord | null {
  if (!row) return null;
  let job: AiPrecisionBridgeJobV1;
  try { job = JSON.parse(row.job_json) as AiPrecisionBridgeJobV1; }
  catch { throw new Error('AI_PRECISION_BRIDGE_JOB_INTEGRITY_FAILED'); }
  const issues = validateAiPrecisionBridgeJob(job);
  let binding: MechanicalStableReferenceBinding;
  try { binding = JSON.parse(row.binding_json) as MechanicalStableReferenceBinding; }
  catch { throw new Error('AI_PRECISION_BRIDGE_JOB_INTEGRITY_FAILED'); }
  if (issues.length || validateMechanicalStableReferenceBinding(binding).length
    || job.jobId !== row.job_id || job.ownerKeySha256 !== row.owner_key_sha256
    || job.projectId !== row.project_id || job.sessionId !== row.session_id
    || job.candidateId !== row.candidate_id || job.handoffRequestId !== row.handoff_request_id
    || job.handoffSha256 !== row.handoff_sha256 || job.binding.bindingSha256 !== row.binding_sha256
    || binding.bindingSha256 !== row.binding_sha256 || job.precisionRequestId !== row.precision_request_id
    || job.precisionRequestSha256 !== row.precision_request_sha256
    || job.runtimeRevision !== Number(row.runtime_revision) || job.complexRevision !== Number(row.complex_revision)
    || job.jobSha256 !== row.job_sha256) throw new Error('AI_PRECISION_BRIDGE_JOB_INTEGRITY_FAILED');
  return {
    job: structuredClone(job), status: row.status, attempt: Number(row.attempt),
    leaseGeneration: Number(row.lease_generation), leaseOwner: row.lease_owner,
    leaseCapabilitySha256: row.lease_capability_sha256,
    leaseExpiresAt: row.lease_expires_at === null ? null : Number(row.lease_expires_at),
    availableAt: Number(row.available_at), lastError: row.last_error,
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
}

export class PostgresAiPrecisionBridgeJobStore {
  constructor(private readonly db: DbAdapter = getDbAdapter()) {}

  private async ready(): Promise<void> { await assertAiPrecisionBridgeMigration(this.db); }

  async enqueue(job: AiPrecisionBridgeJobV1, now = Date.now()): Promise<AiPrecisionBridgeStoreResult> {
    await this.ready();
    const issues = validateAiPrecisionBridgeJob(job);
    if (issues.length) throw new Error(`AI_PRECISION_BRIDGE_JOB_INVALID:${issues.join(',')}`);
    const existing = parseRow(await this.db.queryOne<OutboxRow>(
      `SELECT * FROM nf_ai_precision_bridge_outbox
       WHERE job_id = ? OR (owner_key_sha256 = ? AND project_id = ? AND session_id = ? AND handoff_request_id = ?)
       ORDER BY CASE WHEN job_id = ? THEN 0 ELSE 1 END LIMIT 1`,
      job.jobId, job.ownerKeySha256, job.projectId, job.sessionId, job.handoffRequestId, job.jobId,
    ));
    if (existing) return existing.job.jobSha256 === job.jobSha256
      ? { ok: true, record: existing, replayed: true }
      : { ok: false, code: 'CONFLICT' };
    try {
      await this.db.execute(
        `INSERT INTO nf_ai_precision_bridge_outbox
         (job_id, owner_key_sha256, project_id, session_id, candidate_id,
          handoff_request_id, handoff_sha256, binding_sha256, binding_json,
          precision_request_id, precision_request_sha256, runtime_revision,
          complex_revision, job_sha256, job_json, status, attempt,
          lease_generation, available_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        job.jobId, job.ownerKeySha256, job.projectId, job.sessionId, job.candidateId,
        job.handoffRequestId, job.handoffSha256, job.binding.bindingSha256,
        JSON.stringify(job.binding), job.precisionRequestId, job.precisionRequestSha256,
        job.runtimeRevision, job.complexRevision, job.jobSha256, JSON.stringify(job),
        'PENDING', 0, 0, now, now, now,
      );
    } catch {
      const raced = await this.read(job.jobId);
      return raced?.job.jobSha256 === job.jobSha256
        ? { ok: true, record: raced, replayed: true }
        : { ok: false, code: 'CONFLICT' };
    }
    const created = await this.read(job.jobId);
    if (!created) return { ok: false, code: 'NOT_FOUND' };
    return { ok: true, record: created };
  }

  async claimNext(input: {
    owner: string; capability: string; leaseMs: number; now?: number;
  }): Promise<AiPrecisionBridgeStoreResult> {
    await this.ready();
    const now = input.now ?? Date.now();
    if (!ID.test(input.owner) || Buffer.byteLength(input.capability, 'utf8') < 32
      || !Number.isSafeInteger(input.leaseMs) || input.leaseMs < 1_000 || input.leaseMs > 15 * 60_000) {
      return { ok: false, code: 'CAPABILITY_INVALID' };
    }
    return this.db.transaction(async tx => {
      const selected = await tx.queryOne<OutboxRow>(
        `SELECT * FROM nf_ai_precision_bridge_outbox
         WHERE status = ? AND available_at <= ?
         ORDER BY available_at, created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
        'PENDING', now,
      );
      if (!selected) return { ok: false, code: 'NOT_FOUND' } as AiPrecisionBridgeStoreResult;
      const changed = await tx.execute(
        `UPDATE nf_ai_precision_bridge_outbox
         SET status = ?, attempt = attempt + 1, lease_generation = lease_generation + 1,
             lease_owner = ?, lease_capability_sha256 = ?, lease_expires_at = ?, updated_at = ?
         WHERE job_id = ? AND status = ? AND available_at <= ?`,
        'CLAIMED', input.owner, capabilitySha256(input.capability), now + input.leaseMs,
        now, selected.job_id, 'PENDING', now,
      );
      if (changed.changes !== 1) return { ok: false, code: 'STATE_CONFLICT' } as AiPrecisionBridgeStoreResult;
      return {
        ok: true,
        record: parseRow({
          ...selected, status: 'CLAIMED', attempt: Number(selected.attempt) + 1,
          lease_generation: Number(selected.lease_generation) + 1,
          lease_owner: input.owner, lease_capability_sha256: capabilitySha256(input.capability),
          lease_expires_at: now + input.leaseMs, updated_at: now,
        })!,
      } as AiPrecisionBridgeStoreResult;
    });
  }

  async markSent(jobId: string, owner: string, capability: string, now = Date.now()): Promise<AiPrecisionBridgeStoreResult> {
    await this.ready();
    const current = await this.read(jobId);
    const capabilityHash = capabilitySha256(capability);
    if (!current) return { ok: false, code: 'NOT_FOUND' };
    if (current.status !== 'CLAIMED' || current.leaseOwner !== owner
      || current.leaseCapabilitySha256 !== capabilityHash) return { ok: false, code: 'CAPABILITY_INVALID' };
    if (!current.leaseExpiresAt || current.leaseExpiresAt <= now) return { ok: false, code: 'LEASE_EXPIRED' };
    const changed = await this.db.execute(
      `UPDATE nf_ai_precision_bridge_outbox SET status = ?, updated_at = ?
       WHERE job_id = ? AND status = ? AND lease_owner = ? AND lease_capability_sha256 = ? AND lease_expires_at > ?`,
      'SENT', now, jobId, 'CLAIMED', owner, capabilityHash, now,
    );
    if (changed.changes !== 1) return { ok: false, code: 'STATE_CONFLICT' };
    return { ok: true, record: { ...current, status: 'SENT', updatedAt: now } };
  }

  async hold(jobId: string, errorCode: string, now = Date.now()): Promise<AiPrecisionBridgeStoreResult> {
    await this.ready();
    const current = await this.read(jobId);
    if (!current) return { ok: false, code: 'NOT_FOUND' };
    if (['COMPLETED', 'HOLD'].includes(current.status)) return { ok: true, record: current, replayed: true };
    const changed = await this.db.execute(
      `UPDATE nf_ai_precision_bridge_outbox
       SET status = ?, last_error = ?, lease_owner = NULL, lease_capability_sha256 = NULL,
           lease_expires_at = NULL, updated_at = ?
       WHERE job_id = ? AND status NOT IN (?, ?)`,
      'HOLD', errorCode.slice(0, 512), now, jobId, 'COMPLETED', 'HOLD',
    );
    if (changed.changes !== 1) return { ok: false, code: 'STATE_CONFLICT' };
    return { ok: true, record: { ...current, status: 'HOLD', lastError: errorCode.slice(0, 512), leaseOwner: null, leaseCapabilitySha256: null, leaseExpiresAt: null, updatedAt: now } };
  }

  async recoverExpiredClaims(now = Date.now()): Promise<number> {
    await this.ready();
    const changed = await this.db.execute(
      `UPDATE nf_ai_precision_bridge_outbox
       SET status = ?, last_error = ?, lease_owner = NULL, lease_capability_sha256 = NULL,
           lease_expires_at = NULL, updated_at = ?
       WHERE status IN (?, ?) AND lease_expires_at <= ?`,
      'VERIFIED_UNKNOWN', 'lease_expired_authoritative_receipt_required', now,
      'CLAIMED', 'SENT', now,
    );
    return changed.changes;
  }

  async acceptReceipt(input: {
    jobId: string;
    owner: string;
    capability: string;
    request: AiDesignPrecisionVerificationRequestV1;
    receipt: AiDesignPrecisionVerificationReceiptV1;
    signingSecret: string;
    exactArtifactSha256: string | null;
    artifactManifest: unknown;
    now?: number;
  }): Promise<AiPrecisionBridgeStoreResult> {
    await this.ready();
    const now = input.now ?? Date.now();
    const current = await this.read(input.jobId);
    if (!current) return { ok: false, code: 'NOT_FOUND' };
    if (!receiptInputValid({ ...input, record: current, now })) {
      return { ok: false, code: 'RECEIPT_CONFLICT' };
    }
    if (current.status === 'COMPLETED') {
      const existing = await this.db.queryOne<{ receipt_sha256: string }>(
        'SELECT receipt_sha256 FROM nf_ai_precision_bridge_receipts WHERE job_id = ?', input.jobId,
      );
      return existing?.receipt_sha256 === input.receipt.receiptDigest
        ? { ok: true, record: current, replayed: true }
        : { ok: false, code: 'RECEIPT_CONFLICT' };
    }
    const capabilityHash = capabilitySha256(input.capability);
    if (!['CLAIMED', 'SENT'].includes(current.status) || current.leaseOwner !== input.owner
      || current.leaseCapabilitySha256 !== capabilityHash) return { ok: false, code: 'CAPABILITY_INVALID' };
    if (!current.leaseExpiresAt || current.leaseExpiresAt <= now) return { ok: false, code: 'LEASE_EXPIRED' };
    return this.db.transaction(async tx => {
      const inserted = await tx.execute(
        `INSERT INTO nf_ai_precision_bridge_receipts
         (receipt_id, job_id, project_id, session_id, precision_request_id,
          precision_request_sha256, exact_artifact_sha256, receipt_sha256,
          receipt_json, artifact_manifest_json, accepted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(job_id) DO NOTHING`,
        input.receipt.receiptId, input.jobId, current.job.projectId, current.job.sessionId,
        current.job.precisionRequestId, current.job.precisionRequestSha256,
        input.exactArtifactSha256, input.receipt.receiptDigest, JSON.stringify(input.receipt),
        JSON.stringify(input.artifactManifest), now,
      );
      if (inserted.changes !== 1) return { ok: false, code: 'RECEIPT_CONFLICT' } as AiPrecisionBridgeStoreResult;
      const updated = await tx.execute(
        `UPDATE nf_ai_precision_bridge_outbox
         SET status = ?, lease_owner = NULL, lease_capability_sha256 = NULL,
             lease_expires_at = NULL, updated_at = ?
         WHERE job_id = ? AND status IN (?, ?) AND lease_owner = ?
           AND lease_capability_sha256 = ? AND lease_expires_at > ?`,
        'COMPLETED', now, input.jobId, 'CLAIMED', 'SENT', input.owner, capabilityHash, now,
      );
      if (updated.changes !== 1) throw new Error('AI_PRECISION_BRIDGE_RECEIPT_CAS_FAILED');
      return {
        ok: true,
        record: { ...current, status: 'COMPLETED', leaseOwner: null, leaseCapabilitySha256: null, leaseExpiresAt: null, updatedAt: now },
      } as AiPrecisionBridgeStoreResult;
    });
  }

  async readNextVerifiedUnknown(): Promise<AiPrecisionBridgeOutboxRecord | null> {
    await this.ready();
    return parseRow(await this.db.queryOne<OutboxRow>(
      `SELECT * FROM nf_ai_precision_bridge_outbox
       WHERE status = ? ORDER BY updated_at, created_at LIMIT 1`,
      'VERIFIED_UNKNOWN',
    ));
  }

  /** Completes quarantined work only from a previously persisted AI receipt; it never re-executes CAD. */
  async reconcileVerifiedUnknownReceipt(input: {
    jobId: string;
    request: AiDesignPrecisionVerificationRequestV1;
    receipt: AiDesignPrecisionVerificationReceiptV1;
    signingSecret: string;
    exactArtifactSha256: string | null;
    artifactManifest: unknown;
    now?: number;
  }): Promise<AiPrecisionBridgeStoreResult> {
    await this.ready();
    const now = input.now ?? Date.now();
    const current = await this.read(input.jobId);
    if (!current) return { ok: false, code: 'NOT_FOUND' };
    if (current.status === 'COMPLETED') {
      const existing = await this.db.queryOne<{ receipt_sha256: string }>(
        'SELECT receipt_sha256 FROM nf_ai_precision_bridge_receipts WHERE job_id = ?', input.jobId,
      );
      return existing?.receipt_sha256 === input.receipt.receiptDigest
        ? { ok: true, record: current, replayed: true }
        : { ok: false, code: 'RECEIPT_CONFLICT' };
    }
    if (current.status !== 'VERIFIED_UNKNOWN'
      || !receiptInputValid({ ...input, record: current, now, historical: true })) {
      return { ok: false, code: 'RECEIPT_CONFLICT' };
    }
    const persisted = await this.db.queryOne<{
      content_sha256: string; value_json: string; byte_length: number;
    }>(
      `SELECT content_sha256, value_json, byte_length FROM nf_ai_design_artifacts
       WHERE artifact_id = ? AND project_id = ? AND session_id = ? AND artifact_kind = ?`,
      input.receipt.receiptId, current.job.projectId, current.job.sessionId, 'precision_receipt',
    );
    if (!persisted || Buffer.byteLength(persisted.value_json, 'utf8') !== Number(persisted.byte_length)) {
      return { ok: false, code: 'RECEIPT_CONFLICT' };
    }
    let persistedReceipt: AiDesignPrecisionVerificationReceiptV1;
    try { persistedReceipt = JSON.parse(persisted.value_json) as AiDesignPrecisionVerificationReceiptV1; }
    catch { return { ok: false, code: 'RECEIPT_CONFLICT' }; }
    if (persistedReceipt.receiptDigest !== input.receipt.receiptDigest
      || serverEvidenceSha256(persistedReceipt) !== persisted.content_sha256
      || canonicalCadConsumerDraftJson(persistedReceipt as never)
        !== canonicalCadConsumerDraftJson(input.receipt as never)) {
      return { ok: false, code: 'RECEIPT_CONFLICT' };
    }
    const aggregateRow = await this.db.queryOne<{ aggregate_json: string }>(
      `SELECT aggregate_json FROM nf_ai_design_complex_workspaces
       WHERE owner_key_sha256 = ? AND project_id = ? AND session_id = ?`,
      current.job.ownerKeySha256, current.job.projectId, current.job.sessionId,
    );
    let aggregate: AiDesignComplexWorkspaceAggregateV1;
    try { aggregate = JSON.parse(aggregateRow?.aggregate_json ?? '') as AiDesignComplexWorkspaceAggregateV1; }
    catch { return { ok: false, code: 'RECEIPT_CONFLICT' }; }
    if (validateAiDesignComplexWorkspaceAggregate(aggregate).length
      || !aggregate.precisionReceipts.some(item => item.artifactId === input.receipt.receiptId
        && item.artifactDigest === input.receipt.receiptDigest)) {
      return { ok: false, code: 'RECEIPT_CONFLICT' };
    }
    return this.db.transaction(async tx => {
      const inserted = await tx.execute(
        `INSERT INTO nf_ai_precision_bridge_receipts
         (receipt_id, job_id, project_id, session_id, precision_request_id,
          precision_request_sha256, exact_artifact_sha256, receipt_sha256,
          receipt_json, artifact_manifest_json, accepted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(job_id) DO NOTHING`,
        input.receipt.receiptId, input.jobId, current.job.projectId, current.job.sessionId,
        current.job.precisionRequestId, current.job.precisionRequestSha256,
        input.exactArtifactSha256, input.receipt.receiptDigest, JSON.stringify(input.receipt),
        JSON.stringify(input.artifactManifest), now,
      );
      if (inserted.changes !== 1) return { ok: false, code: 'RECEIPT_CONFLICT' } as AiPrecisionBridgeStoreResult;
      const updated = await tx.execute(
        `UPDATE nf_ai_precision_bridge_outbox
         SET status = ?, last_error = NULL, updated_at = ?
         WHERE job_id = ? AND status = ?`,
        'COMPLETED', now, input.jobId, 'VERIFIED_UNKNOWN',
      );
      if (updated.changes !== 1) throw new Error('AI_PRECISION_BRIDGE_RECONCILE_CAS_FAILED');
      return {
        ok: true,
        record: { ...current, status: 'COMPLETED', lastError: null, updatedAt: now },
      } as AiPrecisionBridgeStoreResult;
    });
  }

  async read(jobId: string): Promise<AiPrecisionBridgeOutboxRecord | null> {
    await this.ready();
    return parseRow(await this.db.queryOne<OutboxRow>(
      'SELECT * FROM nf_ai_precision_bridge_outbox WHERE job_id = ?', jobId,
    ));
  }

  async readByHandoff(input: {
    ownerKeySha256: string; projectId: string; sessionId: string; handoffRequestId: string;
  }): Promise<AiPrecisionBridgeOutboxRecord | null> {
    await this.ready();
    return parseRow(await this.db.queryOne<OutboxRow>(
      `SELECT * FROM nf_ai_precision_bridge_outbox
       WHERE owner_key_sha256 = ? AND project_id = ? AND session_id = ? AND handoff_request_id = ?`,
      input.ownerKeySha256, input.projectId, input.sessionId, input.handoffRequestId,
    ));
  }
}
