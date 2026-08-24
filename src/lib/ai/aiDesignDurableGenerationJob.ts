import {
  AI_DESIGN_DURABLE_JOB_MAX_ATTEMPTS, AI_DESIGN_DURABLE_JOB_MAX_PAYLOAD_BYTES, DurableStoreError, type DurableStoreMode,
  assertId, assertProjectSession, assertRevision, assertTimestamp, backoffMs, clone, nowIso, payloadDigest,
} from './aiDesignDurableJobPrimitives';

export const DURABLE_GENERATION_JOB_V1_SCHEMA = 'nexyfab.durable-generation-job.v1' as const;
export type DurableGenerationJobStatus = 'QUEUED' | 'LEASED' | 'RUNNING' | 'CANCEL_REQUESTED' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'DEAD_LETTER';
export type DurableGenerationJobTerminalStatus = 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'DEAD_LETTER';
export interface DurableGenerationJobV1 {
  schema: typeof DURABLE_GENERATION_JOB_V1_SCHEMA; jobId: string; idempotencyKey: string; projectId: string; sessionId: string;
  payloadDigest: string; payloadBytes: number; status: DurableGenerationJobStatus; revision: number; attempt: number; maxAttempts: number;
  availableAt: string; createdAt: string; updatedAt: string; cancelRequested: boolean;
  lease: { owner: string; expiresAt: string; heartbeatAt: string } | null;
  lastErrorCode: string | null;
}
export interface DurableGenerationJobStoreV1 {
  enqueue(input: { jobId: string; idempotencyKey: string; projectId: string; sessionId: string; payload: unknown; maxAttempts?: number; now?: string }): DurableGenerationJobV1;
  get(scope: { projectId: string; sessionId: string; jobId: string }): DurableGenerationJobV1 | null;
  claim(input: { projectId: string; sessionId: string; jobId: string; owner: string; leaseMs: number; expectedRevision: number; now?: string }): DurableGenerationJobV1;
  heartbeat(input: { projectId: string; sessionId: string; jobId: string; owner: string; expectedRevision: number; leaseMs: number; now?: string }): DurableGenerationJobV1;
  requestCancel(input: { projectId: string; sessionId: string; jobId: string; expectedRevision: number; now?: string }): DurableGenerationJobV1;
  succeed(input: { projectId: string; sessionId: string; jobId: string; owner: string; expectedRevision: number; now?: string }): DurableGenerationJobV1;
  fail(input: { projectId: string; sessionId: string; jobId: string; owner: string; expectedRevision: number; errorCode: string; retryable: boolean; now?: string }): DurableGenerationJobV1;
}

function scope(input: { projectId: string; sessionId: string; jobId?: string }): void { assertProjectSession(input.projectId, input.sessionId); if (input.jobId !== undefined) assertId(input.jobId, 'job_id'); }
function worker(value: string): void { assertId(value, 'lease_owner'); }
function checkLeaseMs(value: number): void { if (!Number.isSafeInteger(value) || value < 1 || value > 24 * 60 * 60 * 1_000) throw new DurableStoreError('INVALID_INPUT', 'lease_ms_invalid'); }

/** Reference-only in-memory implementation. Commercial mode deliberately fails closed: use a transactional DB adapter. */
export class InMemoryDurableGenerationJobStoreV1 implements DurableGenerationJobStoreV1 {
  private readonly rows = new Map<string, DurableGenerationJobV1>(); private readonly idem = new Map<string, string>();
  constructor(private readonly options: { mode: DurableStoreMode; now?: () => number }) {}
  private ensure(): void { if (this.options.mode === 'commercial') throw new DurableStoreError('COMMERCIAL_PERSISTENCE_REQUIRED', 'commercial_generation_job_store_required'); }
  private clock = (): number => this.options.now?.() ?? Date.now();
  private key(projectId: string, sessionId: string, jobId: string): string { return `${projectId}\0${sessionId}\0${jobId}`; }
  private require(input: { projectId: string; sessionId: string; jobId: string }): DurableGenerationJobV1 { scope(input); const row = this.rows.get(this.key(input.projectId, input.sessionId, input.jobId)); if (!row) throw new DurableStoreError('NOT_FOUND', 'job_not_found'); return row; }
  private cas(row: DurableGenerationJobV1, expected: number): void { assertRevision(expected); if (row.revision !== expected) throw new DurableStoreError('CAS_CONFLICT', 'job_revision_conflict'); }
  enqueue(input: { jobId: string; idempotencyKey: string; projectId: string; sessionId: string; payload: unknown; maxAttempts?: number; now?: string }): DurableGenerationJobV1 {
    this.ensure(); scope(input); assertId(input.idempotencyKey, 'idempotency_key'); const digest = payloadDigest(input.payload, AI_DESIGN_DURABLE_JOB_MAX_PAYLOAD_BYTES); const maxAttempts = input.maxAttempts ?? 3;
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > AI_DESIGN_DURABLE_JOB_MAX_ATTEMPTS) throw new DurableStoreError('INVALID_INPUT', 'max_attempts_invalid');
    const time = input.now ?? nowIso(() => this.clock()); assertTimestamp(time); const idemKey = `${input.projectId}\0${input.sessionId}\0${input.idempotencyKey}`; const priorId = this.idem.get(idemKey);
    if (priorId) { const prior = this.rows.get(this.key(input.projectId, input.sessionId, priorId))!; if (prior.payloadDigest !== digest.digest) throw new DurableStoreError('IDEMPOTENCY_CONFLICT', 'idempotency_payload_mismatch'); return clone(prior); }
    const key = this.key(input.projectId, input.sessionId, input.jobId); if (this.rows.has(key)) throw new DurableStoreError('IDEMPOTENCY_CONFLICT', 'job_id_exists');
    const row: DurableGenerationJobV1 = { schema: DURABLE_GENERATION_JOB_V1_SCHEMA, jobId: input.jobId, idempotencyKey: input.idempotencyKey, projectId: input.projectId, sessionId: input.sessionId, payloadDigest: digest.digest, payloadBytes: digest.bytes, status: 'QUEUED', revision: 0, attempt: 0, maxAttempts, availableAt: time, createdAt: time, updatedAt: time, cancelRequested: false, lease: null, lastErrorCode: null };
    this.rows.set(key, row); this.idem.set(idemKey, input.jobId); return clone(row);
  }
  get(input: { projectId: string; sessionId: string; jobId: string }): DurableGenerationJobV1 | null { this.ensure(); scope(input); return clone(this.rows.get(this.key(input.projectId, input.sessionId, input.jobId)) ?? null); }
  claim(input: { projectId: string; sessionId: string; jobId: string; owner: string; leaseMs: number; expectedRevision: number; now?: string }): DurableGenerationJobV1 {
    this.ensure(); const row = this.require(input); worker(input.owner); checkLeaseMs(input.leaseMs); this.cas(row, input.expectedRevision); const now = input.now ?? nowIso(() => this.clock()); assertTimestamp(now);
    if (['SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD_LETTER'].includes(row.status)) throw new DurableStoreError('TERMINAL', 'job_terminal');
    if (row.status === 'LEASED' || row.status === 'RUNNING' || row.status === 'CANCEL_REQUESTED') { if (row.lease && Date.parse(row.lease.expiresAt) > Date.parse(now)) { if (row.lease.owner !== input.owner) throw new DurableStoreError('LEASE_CONFLICT', 'job_lease_owned'); return clone(row); } }
    if (Date.parse(row.availableAt) > Date.parse(now)) throw new DurableStoreError('LEASE_CONFLICT', 'job_not_available');
    row.attempt += 1; if (row.attempt > row.maxAttempts) { row.status = 'DEAD_LETTER'; row.lastErrorCode = 'MAX_ATTEMPTS_EXCEEDED'; row.revision += 1; row.updatedAt = now; row.lease = null; throw new DurableStoreError('RETRY_EXHAUSTED', 'job_max_attempts_exceeded'); }
    row.status = row.cancelRequested ? 'CANCEL_REQUESTED' : 'RUNNING'; row.lease = { owner: input.owner, expiresAt: new Date(Date.parse(now) + input.leaseMs).toISOString(), heartbeatAt: now }; row.revision += 1; row.updatedAt = now; return clone(row);
  }
  heartbeat(input: { projectId: string; sessionId: string; jobId: string; owner: string; expectedRevision: number; leaseMs: number; now?: string }): DurableGenerationJobV1 {
    this.ensure(); const row = this.require(input); worker(input.owner); checkLeaseMs(input.leaseMs); this.cas(row, input.expectedRevision); const now = input.now ?? nowIso(() => this.clock()); assertTimestamp(now);
    if (!row.lease || row.lease.owner !== input.owner || Date.parse(row.lease.expiresAt) <= Date.parse(now) || ['SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD_LETTER'].includes(row.status)) throw new DurableStoreError('LEASE_CONFLICT', 'lease_invalid_or_expired');
    row.lease = { owner: input.owner, expiresAt: new Date(Date.parse(now) + input.leaseMs).toISOString(), heartbeatAt: now }; row.revision += 1; row.updatedAt = now; return clone(row);
  }
  requestCancel(input: { projectId: string; sessionId: string; jobId: string; expectedRevision: number; now?: string }): DurableGenerationJobV1 {
    this.ensure(); const row = this.require(input); this.cas(row, input.expectedRevision); const now = input.now ?? nowIso(() => this.clock()); assertTimestamp(now); if (['SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD_LETTER'].includes(row.status)) throw new DurableStoreError('TERMINAL', 'job_terminal'); row.cancelRequested = true; row.status = row.lease && Date.parse(row.lease.expiresAt) > Date.parse(now) ? 'CANCEL_REQUESTED' : 'CANCELLED'; row.lease = row.status === 'CANCELLED' ? null : row.lease; row.revision += 1; row.updatedAt = now; return clone(row);
  }
  succeed(input: { projectId: string; sessionId: string; jobId: string; owner: string; expectedRevision: number; now?: string }): DurableGenerationJobV1 { return this.finish(input, 'SUCCEEDED'); }
  private finish(input: { projectId: string; sessionId: string; jobId: string; owner: string; expectedRevision: number; now?: string }, status: DurableGenerationJobTerminalStatus): DurableGenerationJobV1 { this.ensure(); const row = this.require(input); worker(input.owner); this.cas(row, input.expectedRevision); const now = input.now ?? nowIso(() => this.clock()); assertTimestamp(now); if (!row.lease || row.lease.owner !== input.owner || Date.parse(row.lease.expiresAt) <= Date.parse(now)) throw new DurableStoreError('LEASE_CONFLICT', 'lease_owner_mismatch_or_expired'); if (['SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD_LETTER'].includes(row.status)) throw new DurableStoreError('TERMINAL', 'job_terminal'); if (row.cancelRequested && status === 'SUCCEEDED') throw new DurableStoreError('TERMINAL', 'job_cancel_requested'); row.status = status; row.lease = null; row.revision += 1; row.updatedAt = now; return clone(row); }
  fail(input: { projectId: string; sessionId: string; jobId: string; owner: string; expectedRevision: number; errorCode: string; retryable: boolean; now?: string }): DurableGenerationJobV1 {
    this.ensure(); const row = this.require(input); worker(input.owner); this.cas(row, input.expectedRevision); const now = input.now ?? nowIso(() => this.clock()); assertTimestamp(now); if (!row.lease || row.lease.owner !== input.owner || Date.parse(row.lease.expiresAt) <= Date.parse(now)) throw new DurableStoreError('LEASE_CONFLICT', 'lease_owner_mismatch_or_expired'); if (['SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD_LETTER'].includes(row.status)) throw new DurableStoreError('TERMINAL', 'job_terminal'); assertId(input.errorCode, 'error_code'); row.lastErrorCode = input.errorCode; row.lease = null;
    if (row.cancelRequested) row.status = 'CANCELLED'; else if (input.retryable && row.attempt < row.maxAttempts) { row.status = 'QUEUED'; row.availableAt = new Date(Date.parse(now) + backoffMs(row.attempt)).toISOString(); } else { row.status = row.attempt >= row.maxAttempts ? 'DEAD_LETTER' : 'FAILED'; }
    row.revision += 1; row.updatedAt = now; return clone(row);
  }
}
