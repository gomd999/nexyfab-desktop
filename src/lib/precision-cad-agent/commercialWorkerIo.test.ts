import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DbAdapter, SqlParam } from '@/lib/db-adapter';
import type { StorageAdapter } from '@/lib/storage';
import { canonicalCommercialExecution, type CommercialExecutionJob } from '../../../packages/job-contracts/src/commercialPrecisionExecution';
import { authorizeCommercialLease, committedCommercialOutputIssues, stageCommercialExecutionInput } from './commercialWorkerIo';

const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');

function baseJob(argumentsHash: string): Omit<CommercialExecutionJob, 'inputArtifact'> {
  return {
    contractVersion: 'nexyfab.precision-cad-commercial-execution.v3', jobId: 'job-1', tenantId: 'tenant-1', projectId: 'project-1', executionId: 'exec-1',
    generationRunId: 'run-1', generationStateRevision: 11, generationProgramSha256: '8'.repeat(64), workspaceId: 'workspace-1', workspaceRevision: 7,
    workspaceContentHash: 'a'.repeat(64), tool: 'build_assembly', scope: 'apply', callId: 'call-1', argumentsHash, commandHash: 'b'.repeat(64),
    targetHash: 'c'.repeat(64), journalVersion: 3, attempt: 1, leaseGeneration: 1,
  };
}

describe('commercial worker immutable I/O', () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  it('writes and reads back one content-addressed canonical input bound to the v3 job', async () => {
    const objects = new Map<string, Buffer>();
    const storage = {
      uploadRawImmutable: async (bytes: Buffer, key: string) => { objects.set(key, Buffer.from(bytes)); return { replayed: false }; },
      sha256: async (key: string) => { const bytes = objects.get(key)!; return { size: bytes.byteLength, contentSha256: sha256(bytes) }; },
      download: async (key: string) => Buffer.from(objects.get(key)!),
    } as unknown as StorageAdapter;
    const args = { amount: 2 };
    const result = await stageCommercialExecutionInput({ job: baseJob(sha256(canonicalCommercialExecution(args))), arguments: args, storage });
    expect(result.job.inputArtifact).toMatchObject({ contentSha256: sha256(result.bytes), byteLength: result.bytes.byteLength, mediaType: 'application/json' });
    expect(result.job.inputArtifact?.objectKey).toMatch(/^private\/commercial-precision-inputs\/org-tenant-1\/projects\/project-1\/jobs\/job-1\/[a-f0-9]{64}\.json$/);
    expect(objects.get(result.job.inputArtifact!.objectKey)).toEqual(result.bytes);
    expect(JSON.parse(result.bytes.toString('utf8'))).toEqual(result.input);
  });

  it('fails closed when authoritative storage readback differs', async () => {
    const storage = {
      uploadRawImmutable: async () => ({ replayed: false }),
      sha256: async () => ({ size: 1, contentSha256: '0'.repeat(64) }),
      download: async () => Buffer.from('{}'),
    } as unknown as StorageAdapter;
    const args = { amount: 2 };
    await expect(stageCommercialExecutionInput({ job: baseJob(sha256(canonicalCommercialExecution(args))), arguments: args, storage })).rejects.toThrow('commercial_worker_input_readback_failed');
  });

  it('authorizes only the exact live worker lease capability', async () => {
    vi.stubEnv('NEXYFAB_COMMERCIAL_MODE', '0');
    const capability = 'x'.repeat(43);
    const job = { ...baseJob('e'.repeat(64)), inputArtifact: { artifactId: 'input-1', objectKey: 'private/commercial/input.json', contentSha256: 'f'.repeat(64), byteLength: 256, mediaType: 'application/json' as const } };
    const db = {
      backend: 'postgres',
      queryOne: async <T>(sql: string) => sql.includes('nf_schema_migrations')
        ? { version: 2026082502, checksum: 'a'.repeat(64) } as T
        : { job_json: canonicalCommercialExecution(job), status: 'CLAIMED', lease_owner: 'worker-1', lease_expires_at: 2_000, capability_hash: sha256(capability) } as T,
      queryAll: async <T>() => [] as T[], execute: async () => ({ changes: 0 }), executeRaw: async () => undefined,
      transaction: async <T>(fn: (tx: DbAdapter) => Promise<T>) => fn(db as DbAdapter), close: async () => undefined,
    } as DbAdapter;
    await expect(authorizeCommercialLease({ db, jobId: job.jobId, workerIdentity: 'worker-1', leaseCapability: capability, now: 1_000 })).resolves.toMatchObject({ owner: 'worker-1', job: { jobId: 'job-1' } });
    await expect(authorizeCommercialLease({ db, jobId: job.jobId, workerIdentity: 'worker-2', leaseCapability: capability, now: 1_000 })).resolves.toBeNull();
    await expect(authorizeCommercialLease({ db, jobId: job.jobId, workerIdentity: 'worker-1', leaseCapability: 'y'.repeat(43), now: 1_000 })).resolves.toBeNull();
    await expect(authorizeCommercialLease({ db, jobId: job.jobId, workerIdentity: 'worker-1', leaseCapability: capability, now: 2_001 })).resolves.toBeNull();
  });

  it('requires all three committed output rows to match the signed receipt', async () => {
    vi.stubEnv('NEXYFAB_COMMERCIAL_MODE', '0');
    const artifacts = (['model', 'report', 'verification'] as const).map((role, index) => ({ artifactId: `${role}-1`, role, objectKey: `private/commercial/${role}`, contentSha256: String(index + 1).repeat(64), byteLength: index + 10 }));
    const rows = artifacts.map(artifact => ({ artifact_id: artifact.artifactId, artifact_role: artifact.role, object_key: artifact.objectKey, content_sha256: artifact.contentSha256, byte_length: artifact.byteLength, worker_identity: 'worker-1', status: 'COMMITTED' }));
    const db = {
      backend: 'postgres',
      queryOne: async <T>() => ({ version: 2026082502, checksum: 'a'.repeat(64) }) as T,
      queryAll: async <T>(_sql: string, ..._params: SqlParam[]) => rows as T[], execute: async () => ({ changes: 0 }), executeRaw: async () => undefined,
      transaction: async <T>(fn: (tx: DbAdapter) => Promise<T>) => fn(db as DbAdapter), close: async () => undefined,
    } as DbAdapter;
    const receipt = { jobId: 'job-1', executionId: 'exec-1', workerIdentity: 'worker-1', outputArtifacts: artifacts } as Parameters<typeof committedCommercialOutputIssues>[0]['receipt'];
    await expect(committedCommercialOutputIssues({ db, receipt })).resolves.toEqual([]);
    rows[2]!.content_sha256 = 'f'.repeat(64);
    await expect(committedCommercialOutputIssues({ db, receipt })).resolves.toContain('output_binding_mismatch:verification');
  });
});
