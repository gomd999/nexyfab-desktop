import { randomUUID } from 'node:crypto';
import type { DbAdapter } from '@/lib/db-adapter';
import type { ExactClashJobRequest } from './coordinationSpatialModel';
import {
  ensureCadWorkspaceRevisionTables,
  hashCadPayload,
  hashCadWorkspaceEnvelope,
  validateCadWorkspaceEnvelope,
  type CadWorkspaceEnvelopeInput,
  type StoredCadWorkspaceEnvelope,
} from './workspaceRevisionStore';

export interface StoredSpatialCadJob {
  id: string;
  projectId: string;
  kind: 'EXACT_CLASH';
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  execution: 'NOT_RUN' | 'RUNNING' | 'PASS' | 'FAIL';
  releaseVerification: 'NOT_RUN';
  request: ExactClashJobRequest;
  requestSha256: string;
  idempotencyKey?: string;
  createdBy: string;
  createdAt: number;
  attempts: number;
  leasedBy?: string;
  leaseExpiresAt?: number;
  startedAt?: number;
  finishedAt?: number;
  cancelledAt?: number;
  nextAttemptAt?: number;
  result?: ExactClashExecutionReceipt;
  errorCode?: string;
  updatedAt: number;
}

export interface ExactClashExecutionReceipt {
  schema: 'nexyfab.exact-clash-execution-receipt.v1';
  jobId: string;
  requestSha256: string;
  workerIdentitySha256: string;
  kernelIdentitySha256: string;
  engine: 'OCCT';
  algorithm: 'exact_brep_common_and_distance';
  stubFallback: false;
  checkedPairs: number;
  clashes: Array<{
    id: string;
    modelA: string;
    modelB: string;
    classification: 'HARD' | 'CLEARANCE' | 'CLEAR';
    commonVolumeMm3: number;
    minimumDistanceMm: number;
  }>;
  completedAt: number;
  receiptSha256: string;
}

export const SPATIAL_CAD_IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const MAX_ACTIVE_EXACT_CLASH_JOBS = 2;
export interface SpatialCadJobUsage { active: number; limit: number }

const SHA256 = /^[a-f0-9]{64}$/;

export function validateExactClashJobRequest(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['invalid_exact_clash_request'];
  const request = value as Partial<ExactClashJobRequest>;
  const issues: string[] = [];
  if (request.schema !== 'nexyfab.exact-clash-job-request.v1') issues.push('invalid_exact_clash_schema');
  if (!request.coordinateSystem?.trim() || request.coordinateSystem === 'CRS_NOT_CONNECTED') issues.push('coordinate_system_not_connected');
  if (typeof request.toleranceMm !== 'number' || !Number.isFinite(request.toleranceMm) || request.toleranceMm < 0 || request.toleranceMm > 100_000) issues.push('invalid_exact_clash_tolerance');
  if (!Number.isSafeInteger(request.documentRevision) || (request.documentRevision ?? -1) < 0) issues.push('invalid_document_revision');
  if (!Array.isArray(request.models) || request.models.length < 2 || request.models.length > 100) issues.push('exact_clash_requires_2_to_100_models');
  const ids = new Set<string>();
  const artifactIds = new Set<string>();
  for (const model of request.models ?? []) {
    if (!model.id?.trim() || ids.has(model.id)) issues.push(`duplicate_or_empty_model:${model.id || '(empty)'}`);
    ids.add(model.id);
    if (!model.artifactId?.trim()) issues.push(`exact_artifact_required:${model.id}`);
    else if (artifactIds.has(model.artifactId)) issues.push(`duplicate_exact_artifact:${model.id}`);
    artifactIds.add(model.artifactId ?? '');
    if (!SHA256.test(model.contentHash ?? '')) issues.push(`exact_content_hash_required:${model.id}`);
    if (!SHA256.test(model.shapeIdentityHash ?? '')) issues.push(`exact_shape_identity_required:${model.id}`);
    if (!Array.isArray(model.offsetMm) || model.offsetMm.length !== 3 || model.offsetMm.some(item => !Number.isFinite(item))) issues.push(`invalid_model_offset:${model.id}`);
  }
  return [...new Set(issues)];
}

type CadArtifactRow = { id: string; payload_json: string };

/**
 * Treat exact geometry identity as server-owned data. The client may select a
 * project CAD revision, but it cannot manufacture an artifact id or hashes and
 * have them accepted by the clash queue.
 */
export async function verifyExactClashArtifactBindings(
  db: DbAdapter,
  projectId: string,
  request: ExactClashJobRequest,
): Promise<string[]> {
  const basicIssues = validateExactClashJobRequest(request);
  if (basicIssues.length) return basicIssues;
  const artifactIds = [...new Set(request.models.map(model => model.artifactId))];
  const rows = await db.queryAll<CadArtifactRow>(
    `SELECT id, payload_json FROM nf_cad_workspace_revisions
     WHERE project_id = ? AND id IN (${artifactIds.map(() => '?').join(', ')})`,
    projectId,
    ...artifactIds,
  );
  const byId = new Map(rows.map(row => [row.id, row]));
  const issues: string[] = [];
  for (const model of request.models) {
    const row = byId.get(model.artifactId);
    if (!row) {
      issues.push(`project_exact_artifact_not_found:${model.id}`);
      continue;
    }
    let stored: StoredCadWorkspaceEnvelope;
    try { stored = JSON.parse(row.payload_json) as StoredCadWorkspaceEnvelope; }
    catch {
      issues.push(`project_exact_artifact_invalid_json:${model.id}`);
      continue;
    }
    const { contentHash: storedEnvelopeHash, ...input } = stored;
    const envelopeInput = input as CadWorkspaceEnvelopeInput;
    const envelopeIssues = validateCadWorkspaceEnvelope(envelopeInput);
    if (envelopeIssues.length || storedEnvelopeHash !== hashCadWorkspaceEnvelope(envelopeInput)) {
      issues.push(`project_exact_artifact_invalid_envelope:${model.id}`);
      continue;
    }
    if (envelopeInput.workspace.projectId !== projectId) issues.push(`project_exact_artifact_project_mismatch:${model.id}`);
    if (envelopeInput.geometry.fidelity !== 'exact_brep') issues.push(`project_exact_artifact_fidelity_mismatch:${model.id}`);
    if (envelopeInput.geometry.contentHash !== model.contentHash) issues.push(`project_exact_content_hash_mismatch:${model.id}`);
    if (envelopeInput.geometry.shapeIdentityHash !== model.shapeIdentityHash) issues.push(`project_exact_shape_identity_mismatch:${model.id}`);
  }
  return [...new Set(issues)];
}

export async function ensureSpatialCadJobTables(db: DbAdapter): Promise<void> {
  await db.executeRaw(`
    CREATE TABLE IF NOT EXISTS nf_spatial_cad_jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      execution TEXT NOT NULL,
      release_verification TEXT NOT NULL,
      request_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      lease_token TEXT,
      leased_by TEXT,
      lease_expires_at BIGINT,
      started_at BIGINT,
      finished_at BIGINT,
      result_json TEXT,
      error_code TEXT,
      request_sha256 TEXT,
      idempotency_key TEXT,
      cancelled_at BIGINT,
      next_attempt_at BIGINT,
      updated_at BIGINT NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_nf_spatial_job_project ON nf_spatial_cad_jobs(project_id, created_at DESC);
  `);
  const additions = [
    'attempts INTEGER NOT NULL DEFAULT 0', 'lease_token TEXT', 'leased_by TEXT', 'lease_expires_at BIGINT',
    'started_at BIGINT', 'finished_at BIGINT', 'result_json TEXT', 'error_code TEXT', 'request_sha256 TEXT', 'idempotency_key TEXT', 'cancelled_at BIGINT', 'next_attempt_at BIGINT', 'updated_at BIGINT NOT NULL DEFAULT 0',
  ];
  for (const definition of additions) {
    await db.execute(`ALTER TABLE nf_spatial_cad_jobs ADD COLUMN ${definition}`).catch(() => ({ changes: 0 }));
  }
  // The first Wave 3 draft used project+key. Remove it explicitly before
  // installing creator-scoped idempotency so an older process cannot keep
  // leaking another creator's durable job on key reuse.
  await db.executeRaw('DROP INDEX IF EXISTS idx_nf_spatial_job_project_idempotency');
  await db.executeRaw('CREATE UNIQUE INDEX IF NOT EXISTS idx_nf_spatial_job_project_creator_idempotency ON nf_spatial_cad_jobs(project_id, created_by, idempotency_key)');
}

type JobRow = {
  id: string; project_id: string; kind: 'EXACT_CLASH'; status: StoredSpatialCadJob['status']; execution: StoredSpatialCadJob['execution'];
  release_verification: 'NOT_RUN'; request_json: string; created_by: string; created_at: number; attempts?: number; lease_token?: string | null;
  leased_by?: string | null; lease_expires_at?: number | null; started_at?: number | null; finished_at?: number | null; result_json?: string | null;
  error_code?: string | null; request_sha256?: string | null; idempotency_key?: string | null; cancelled_at?: number | null; next_attempt_at?: number | null; updated_at?: number | null;
};
const rowRequestSha256 = (row: JobRow): string => row.request_sha256 ?? hashCadPayload(JSON.parse(row.request_json));
const rowToJob = (row: JobRow): StoredSpatialCadJob => ({
  id: row.id, projectId: row.project_id, kind: row.kind, status: row.status, execution: row.execution,
  releaseVerification: row.release_verification, request: JSON.parse(row.request_json) as ExactClashJobRequest,
  requestSha256: rowRequestSha256(row),
  ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}),
  createdBy: row.created_by, createdAt: Number(row.created_at), attempts: Number(row.attempts ?? 0),
  ...(row.leased_by ? { leasedBy: row.leased_by } : {}), ...(row.lease_expires_at ? { leaseExpiresAt: Number(row.lease_expires_at) } : {}),
  ...(row.started_at ? { startedAt: Number(row.started_at) } : {}), ...(row.finished_at ? { finishedAt: Number(row.finished_at) } : {}),
  ...(row.cancelled_at ? { cancelledAt: Number(row.cancelled_at) } : {}),
  ...(row.next_attempt_at ? { nextAttemptAt: Number(row.next_attempt_at) } : {}),
  ...(row.result_json ? { result: JSON.parse(row.result_json) as ExactClashExecutionReceipt } : {}),
  ...(row.error_code ? { errorCode: row.error_code } : {}), updatedAt: Number(row.updated_at ?? row.created_at),
});

export async function listSpatialCadJobs(db: DbAdapter, projectId: string): Promise<StoredSpatialCadJob[]> {
  return (await db.queryAll<JobRow>('SELECT * FROM nf_spatial_cad_jobs WHERE project_id = ? ORDER BY created_at DESC', projectId)).map(rowToJob);
}

export async function getSpatialCadJobUsage(db: DbAdapter, projectId: string): Promise<SpatialCadJobUsage> {
  const row = await db.queryOne<{ count: number | string }>(
    "SELECT COUNT(*) AS count FROM nf_spatial_cad_jobs WHERE project_id = ? AND status IN ('QUEUED', 'RUNNING')",
    projectId,
  );
  const active = Number(row?.count ?? 0);
  return { active: Number.isSafeInteger(active) && active >= 0 ? active : 0, limit: MAX_ACTIVE_EXACT_CLASH_JOBS };
}

export async function enqueueExactClashJob(
  db: DbAdapter,
  userId: string,
  projectId: string,
  request: ExactClashJobRequest,
  idempotencyKey?: string,
): Promise<{ ok: true; job: StoredSpatialCadJob; reused?: boolean } | { ok: false; code: 'JOB_BLOCKED' | 'IDEMPOTENCY_CONFLICT' | 'ACTIVE_JOB_LIMIT'; issues: string[] }> {
  const issues = validateExactClashJobRequest(request);
  if (!projectId.trim()) issues.push('invalid_project_id');
  if (idempotencyKey !== undefined && !SPATIAL_CAD_IDEMPOTENCY_KEY.test(idempotencyKey)) issues.push('invalid_idempotency_key');
  if (!issues.length) {
    await ensureCadWorkspaceRevisionTables(db);
    issues.push(...await verifyExactClashArtifactBindings(db, projectId, request));
  }
  if (issues.length) return { ok: false, code: 'JOB_BLOCKED', issues: [...new Set(issues)] };
  const requestSha256 = hashCadPayload(request);
  return db.transaction(async tx => {
    // PostgreSQL READ COMMITTED does not serialize two project count checks.
    // A transaction-scoped advisory lock makes the cap decision + insert one
    // project-scoped critical section. SQLite's transaction already serializes
    // this path via its adapter's immediate transaction.
    if (tx.backend === 'postgres') await tx.queryOne('SELECT pg_advisory_xact_lock(hashtext(?))', `nexyfab:spatial-cad:${projectId}`);
    if (idempotencyKey) {
      const existing = await tx.queryOne<JobRow>('SELECT * FROM nf_spatial_cad_jobs WHERE project_id = ? AND created_by = ? AND idempotency_key = ?', projectId, userId, idempotencyKey);
      if (existing) {
        if (rowRequestSha256(existing) !== requestSha256) return { ok: false as const, code: 'IDEMPOTENCY_CONFLICT' as const, issues: ['idempotency_key_payload_conflict'] };
        return { ok: true as const, job: rowToJob(existing), reused: true };
      }
    }
    const active = await tx.queryOne<{ count: number }>("SELECT COUNT(*) AS count FROM nf_spatial_cad_jobs WHERE project_id = ? AND status IN ('QUEUED', 'RUNNING')", projectId);
    if (Number(active?.count ?? 0) >= MAX_ACTIVE_EXACT_CLASH_JOBS) return { ok: false as const, code: 'ACTIVE_JOB_LIMIT' as const, issues: ['active_exact_clash_job_limit'] };
    const createdAt = Date.now();
    const job: StoredSpatialCadJob = { id: `SCJ-${randomUUID()}`, projectId, kind: 'EXACT_CLASH', status: 'QUEUED', execution: 'NOT_RUN', releaseVerification: 'NOT_RUN', request: structuredClone(request), requestSha256, ...(idempotencyKey ? { idempotencyKey } : {}), createdBy: userId, createdAt, attempts: 0, updatedAt: createdAt };
    try {
      await tx.execute('INSERT INTO nf_spatial_cad_jobs (id, project_id, kind, status, execution, release_verification, request_json, request_sha256, idempotency_key, created_by, created_at, attempts, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', job.id, job.projectId, job.kind, job.status, job.execution, job.releaseVerification, JSON.stringify(job.request), job.requestSha256, job.idempotencyKey ?? null, job.createdBy, job.createdAt, job.attempts, job.updatedAt);
    } catch (error) {
      if (!idempotencyKey) throw error;
      const existing = await tx.queryOne<JobRow>('SELECT * FROM nf_spatial_cad_jobs WHERE project_id = ? AND created_by = ? AND idempotency_key = ?', projectId, userId, idempotencyKey);
      if (!existing) throw error;
      if (rowRequestSha256(existing) !== requestSha256) return { ok: false as const, code: 'IDEMPOTENCY_CONFLICT' as const, issues: ['idempotency_key_payload_conflict'] };
      return { ok: true as const, job: rowToJob(existing), reused: true };
    }
    return { ok: true as const, job };
  });
}

const WORKER_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,127}$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{2,127}$/;
export const EXACT_CLASH_MAX_ATTEMPTS = 5;
export const EXACT_CLASH_RETRY_BACKOFF_MS = Object.freeze([30_000, 120_000, 300_000, 900_000]);
export const EXACT_CLASH_RETRYABLE_ERROR_CODES = new Set([
  'ARTIFACT_LOAD_FAILED', 'OCCT_KERNEL_UNAVAILABLE', 'OCCT_COMMON_FAILED',
  'WORKER_TIMEOUT', 'WORKER_UNAVAILABLE', 'UPSTREAM_TIMEOUT', 'UPSTREAM_UNAVAILABLE',
]);
export type ExactClashFailureDisposition = 'RETRYABLE' | 'TERMINAL';
export function classifyExactClashFailure(errorCode: string): ExactClashFailureDisposition {
  return EXACT_CLASH_RETRYABLE_ERROR_CODES.has(errorCode) ? 'RETRYABLE' : 'TERMINAL';
}
export function exactClashRetryAt(now: number, attempt: number): number | null {
  const delay = EXACT_CLASH_RETRY_BACKOFF_MS[Math.max(0, attempt - 1)];
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(attempt) || attempt < 1 || delay === undefined || !Number.isSafeInteger(now + delay)) return null;
  return now + delay;
}

export async function claimNextExactClashJob(
  db: DbAdapter,
  workerId: string,
  now = Date.now(),
  leaseMs = 60_000,
): Promise<{ job: StoredSpatialCadJob; leaseToken: string } | null> {
  if (!WORKER_ID.test(workerId) || !Number.isFinite(now) || leaseMs < 10_000 || leaseMs > 300_000) return null;
  return db.transaction(async tx => {
    const row = await tx.queryOne<JobRow>(
      `SELECT * FROM nf_spatial_cad_jobs
       WHERE kind = 'EXACT_CLASH' AND attempts < ?
         AND ((status = 'QUEUED' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
           OR (status = 'RUNNING' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?))
       ORDER BY created_at ASC LIMIT 1`,
      EXACT_CLASH_MAX_ATTEMPTS, now, now,
    );
    if (!row) return null;
    const leaseToken = randomUUID();
    const leaseExpiresAt = now + leaseMs;
    const updated = await tx.execute(
      `UPDATE nf_spatial_cad_jobs
       SET status = 'RUNNING', execution = 'RUNNING', attempts = attempts + 1,
           lease_token = ?, leased_by = ?, lease_expires_at = ?, started_at = COALESCE(started_at, ?),
           error_code = NULL, next_attempt_at = NULL, updated_at = ?
       WHERE id = ? AND attempts < ?
         AND ((status = 'QUEUED' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
           OR (status = 'RUNNING' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?))`,
      leaseToken, workerId, leaseExpiresAt, now, now, row.id, EXACT_CLASH_MAX_ATTEMPTS, now, now,
    );
    if (updated.changes !== 1) return null;
    return {
      leaseToken,
      job: rowToJob({ ...row, status: 'RUNNING', execution: 'RUNNING', attempts: Number(row.attempts ?? 0) + 1, lease_token: leaseToken, leased_by: workerId, lease_expires_at: leaseExpiresAt, next_attempt_at: null, started_at: row.started_at ?? now, updated_at: now }),
    };
  });
}

export async function heartbeatExactClashJob(
  db: DbAdapter,
  jobId: string,
  workerId: string,
  leaseToken: string,
  now = Date.now(),
  leaseMs = 60_000,
): Promise<boolean> {
  if (!jobId.trim() || !WORKER_ID.test(workerId) || !leaseToken.trim() || leaseMs < 10_000 || leaseMs > 300_000) return false;
  const updated = await db.execute(
    `UPDATE nf_spatial_cad_jobs SET lease_expires_at = ?, updated_at = ?
     WHERE id = ? AND status = 'RUNNING' AND leased_by = ? AND lease_token = ? AND lease_expires_at >= ?`,
    now + leaseMs, now, jobId, workerId, leaseToken, now,
  );
  return updated.changes === 1;
}

export async function cancelExactClashJob(
  db: DbAdapter,
  projectId: string,
  jobId: string,
  now = Date.now(),
): Promise<{ ok: true; job: StoredSpatialCadJob } | { ok: false; code: 'JOB_NOT_FOUND' | 'CANCEL_NOT_ALLOWED' | 'CANCEL_CONFLICT'; issues: string[] }> {
  // Cancellation is durable cooperative cancellation: it prevents future
  // claims and terminal worker writes, but does not attempt to kill a process.
  if (!projectId.trim() || !jobId.trim() || !Number.isSafeInteger(now) || now < 0) return { ok: false, code: 'CANCEL_CONFLICT', issues: ['invalid_cancel_request'] };
  const row = await db.queryOne<JobRow>('SELECT * FROM nf_spatial_cad_jobs WHERE id = ? AND project_id = ?', jobId, projectId);
  if (!row) return { ok: false, code: 'JOB_NOT_FOUND', issues: ['spatial_cad_job_not_found'] };
  if (row.status !== 'QUEUED' && row.status !== 'RUNNING') return { ok: false, code: 'CANCEL_NOT_ALLOWED', issues: ['spatial_cad_job_terminal'] };
  const updated = await db.execute(
    `UPDATE nf_spatial_cad_jobs SET status = 'CANCELLED', execution = 'NOT_RUN', error_code = 'CANCELLED',
       finished_at = ?, cancelled_at = ?, next_attempt_at = NULL, lease_token = NULL, leased_by = NULL, lease_expires_at = NULL, updated_at = ?
     WHERE id = ? AND project_id = ? AND status IN ('QUEUED', 'RUNNING')`,
    now, now, now, jobId, projectId,
  );
  if (updated.changes !== 1) return { ok: false, code: 'CANCEL_CONFLICT', issues: ['spatial_cad_cancel_compare_and_swap_failed'] };
  return { ok: true, job: rowToJob({ ...row, status: 'CANCELLED', execution: 'NOT_RUN', error_code: 'CANCELLED', finished_at: now, cancelled_at: now, next_attempt_at: null, lease_token: null, leased_by: null, lease_expires_at: null, updated_at: now }) };
}

export function hashExactClashExecutionReceipt(receipt: Omit<ExactClashExecutionReceipt, 'receiptSha256'>): string {
  return hashCadPayload(receipt);
}

export function validateExactClashExecutionReceipt(job: StoredSpatialCadJob, receipt: ExactClashExecutionReceipt, now = Date.now()): string[] {
  const issues: string[] = [];
  const ids = new Set(job.request.models.map(model => model.id));
  if (receipt.schema !== 'nexyfab.exact-clash-execution-receipt.v1') issues.push('invalid_exact_clash_receipt_schema');
  if (receipt.jobId !== job.id) issues.push('exact_clash_receipt_job_mismatch');
  if (receipt.requestSha256 !== hashCadPayload(job.request)) issues.push('exact_clash_receipt_request_hash_mismatch');
  if (!SHA256.test(receipt.workerIdentitySha256 ?? '')) issues.push('invalid_exact_clash_worker_identity');
  if (!SHA256.test(receipt.kernelIdentitySha256 ?? '')) issues.push('invalid_exact_clash_kernel_identity');
  if (receipt.engine !== 'OCCT' || receipt.algorithm !== 'exact_brep_common_and_distance' || receipt.stubFallback !== false) issues.push('invalid_exact_clash_engine');
  const expectedPairs = job.request.models.length * (job.request.models.length - 1) / 2;
  if (receipt.checkedPairs !== expectedPairs) issues.push('exact_clash_incomplete_pair_coverage');
  if (!Array.isArray(receipt.clashes) || receipt.clashes.length > expectedPairs) issues.push('invalid_exact_clash_results');
  const pairs = new Set<string>();
  for (const clash of receipt.clashes ?? []) {
    const pair = [clash.modelA, clash.modelB].sort().join(':');
    if (!clash.id?.trim() || clash.modelA === clash.modelB || !ids.has(clash.modelA) || !ids.has(clash.modelB) || pairs.has(pair)) issues.push(`invalid_exact_clash_pair:${clash.id || '(empty)'}`);
    pairs.add(pair);
    if (!['HARD', 'CLEARANCE', 'CLEAR'].includes(clash.classification)
      || !Number.isFinite(clash.commonVolumeMm3) || clash.commonVolumeMm3 < 0
      || !Number.isFinite(clash.minimumDistanceMm) || clash.minimumDistanceMm < 0) issues.push(`invalid_exact_clash_measurement:${clash.id || '(empty)'}`);
    if (clash.classification === 'HARD' && clash.commonVolumeMm3 <= 0) issues.push(`hard_clash_requires_common_volume:${clash.id}`);
  }
  if (!Number.isSafeInteger(receipt.completedAt) || receipt.completedAt < job.createdAt || receipt.completedAt > now + 300_000) issues.push('invalid_exact_clash_completion_time');
  const { receiptSha256, ...core } = receipt;
  if (!SHA256.test(receiptSha256 ?? '') || receiptSha256 !== hashExactClashExecutionReceipt(core)) issues.push('exact_clash_receipt_hash_mismatch');
  return [...new Set(issues)];
}

export async function completeExactClashJob(
  db: DbAdapter,
  workerId: string,
  leaseToken: string,
  receipt: ExactClashExecutionReceipt,
  now = Date.now(),
): Promise<{ ok: true; job: StoredSpatialCadJob } | { ok: false; code: 'LEASE_REJECTED' | 'RECEIPT_REJECTED'; issues: string[] }> {
  const row = await db.queryOne<JobRow>('SELECT * FROM nf_spatial_cad_jobs WHERE id = ?', receipt.jobId);
  if (!row || row.status !== 'RUNNING' || row.leased_by !== workerId || row.lease_token !== leaseToken || Number(row.lease_expires_at ?? 0) < now) return { ok: false, code: 'LEASE_REJECTED', issues: ['exact_clash_lease_invalid_or_expired'] };
  const job = rowToJob(row);
  const issues = validateExactClashExecutionReceipt(job, receipt, now);
  if (issues.length) return { ok: false, code: 'RECEIPT_REJECTED', issues };
  const updated = await db.execute(
    `UPDATE nf_spatial_cad_jobs SET status = 'SUCCEEDED', execution = 'PASS', result_json = ?,
       finished_at = ?, next_attempt_at = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = ?
     WHERE id = ? AND status = 'RUNNING' AND leased_by = ? AND lease_token = ? AND lease_expires_at >= ?`,
    JSON.stringify(receipt), now, now, job.id, workerId, leaseToken, now,
  );
  if (updated.changes !== 1) return { ok: false, code: 'LEASE_REJECTED', issues: ['exact_clash_lease_compare_and_swap_failed'] };
  return { ok: true, job: { ...job, status: 'SUCCEEDED', execution: 'PASS', result: structuredClone(receipt), finishedAt: now, updatedAt: now, leaseExpiresAt: undefined } };
}

export type ExactClashFailureResult =
  | { ok: true; code: 'RETRY_SCHEDULED'; outcome: 'RETRY_SCHEDULED'; errorCode: string; nextAttemptAt: number; attempts: number; attemptsRemaining: number }
  | { ok: true; code: 'TERMINAL_FAILURE'; outcome: 'TERMINAL_FAILURE'; errorCode: string; attempts: number; attemptsRemaining: 0 }
  | { ok: false; code: 'LEASE_REJECTED' | 'INVALID_FAILURE' | 'RETRY_NOT_SAFE'; outcome: 'LEASE_REJECTED' | 'INVALID_FAILURE' | 'RETRY_NOT_SAFE'; issues: string[] };

export async function failExactClashJobDetailed(
  db: DbAdapter,
  jobId: string,
  workerId: string,
  leaseToken: string,
  errorCode: string,
  now = Date.now(),
): Promise<ExactClashFailureResult> {
  if (!ERROR_CODE.test(errorCode) || !jobId.trim() || !WORKER_ID.test(workerId) || !leaseToken.trim() || !Number.isSafeInteger(now) || now < 0) return { ok: false, code: 'INVALID_FAILURE', outcome: 'INVALID_FAILURE', issues: ['invalid_exact_clash_failure_request'] };
  const row = await db.queryOne<JobRow>('SELECT * FROM nf_spatial_cad_jobs WHERE id = ?', jobId);
  if (!row || row.status !== 'RUNNING' || row.leased_by !== workerId || row.lease_token !== leaseToken || Number(row.lease_expires_at ?? 0) < now) return { ok: false, code: 'LEASE_REJECTED', outcome: 'LEASE_REJECTED', issues: ['exact_clash_lease_invalid_or_expired'] };
  const attempts = Number(row.attempts ?? 0);
  const retryable = classifyExactClashFailure(errorCode) === 'RETRYABLE';
  const nextAttemptAt = retryable && attempts < EXACT_CLASH_MAX_ATTEMPTS ? exactClashRetryAt(now, attempts) : null;
  if (retryable && attempts < EXACT_CLASH_MAX_ATTEMPTS && nextAttemptAt === null) return { ok: false, code: 'RETRY_NOT_SAFE', outcome: 'RETRY_NOT_SAFE', issues: ['exact_clash_retry_time_overflow'] };
  const shouldRetry = nextAttemptAt !== null;
  const updated = await db.execute(
    `UPDATE nf_spatial_cad_jobs SET status = ?, execution = ?, error_code = ?, finished_at = ?,
       next_attempt_at = ?, lease_token = NULL, leased_by = NULL, lease_expires_at = NULL, updated_at = ?
     WHERE id = ? AND status = 'RUNNING' AND leased_by = ? AND lease_token = ? AND lease_expires_at >= ?`,
    shouldRetry ? 'QUEUED' : 'FAILED', shouldRetry ? 'NOT_RUN' : 'FAIL', errorCode,
    shouldRetry ? null : now, nextAttemptAt, now, jobId, workerId, leaseToken, now,
  );
  if (updated.changes !== 1) return { ok: false, code: 'LEASE_REJECTED', outcome: 'LEASE_REJECTED', issues: ['exact_clash_failure_compare_and_swap_failed'] };
  if (nextAttemptAt !== null) return { ok: true, code: 'RETRY_SCHEDULED', outcome: 'RETRY_SCHEDULED', errorCode, nextAttemptAt, attempts, attemptsRemaining: EXACT_CLASH_MAX_ATTEMPTS - attempts };
  return { ok: true, code: 'TERMINAL_FAILURE', outcome: 'TERMINAL_FAILURE', errorCode, attempts, attemptsRemaining: 0 };
}

/** Backward-compatible boolean facade for non-HTTP/internal callers. */
export async function failExactClashJob(
  db: DbAdapter,
  jobId: string,
  workerId: string,
  leaseToken: string,
  errorCode: string,
  now = Date.now(),
): Promise<boolean> {
  const result = await failExactClashJobDetailed(db, jobId, workerId, leaseToken, errorCode, now);
  return result.ok;
}
