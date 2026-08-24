import { describe, expect, it } from 'vitest';
import { CommercialExecutionOutboxStore } from './commercialExecutionOutboxStore';
import type { DbAdapter } from '@/lib/db-adapter';
import type { CommercialExecutionJob } from '../../../packages/job-contracts/src/commercialPrecisionExecution';

const job: CommercialExecutionJob = { contractVersion: 'nexyfab.precision-cad-commercial-execution.v3', jobId: 'job-1', tenantId: 'tenant-1', projectId: 'project-1', executionId: 'exec-1', generationRunId: 'run-1', generationStateRevision: 11, generationProgramSha256: '9'.repeat(64), workspaceId: 'workspace-1', workspaceRevision: 7, workspaceContentHash: 'a'.repeat(64), tool: 'build_assembly', scope: 'apply', callId: 'call-1', argumentsHash: 'b'.repeat(64), commandHash: 'c'.repeat(64), targetHash: 'd'.repeat(64), journalVersion: 3, attempt: 1, leaseGeneration: 1, inputArtifact: { artifactId: 'input-1', objectKey: 'private/commercial-precision-inputs/tenant-1/project-1/job-1/input.json', contentSha256: 'e'.repeat(64), byteLength: 256, mediaType: 'application/json' } };
class OutboxDb implements DbAdapter {
  readonly backend = 'postgres' as const; row: Record<string, unknown> | undefined;
  async queryOne<T>(sql: string): Promise<T | undefined> { if (sql.includes('nf_schema_migrations')) return { version: 2026082203, checksum: 'f'.repeat(64) } as T; return this.row as T | undefined; }
  async queryAll<T>(): Promise<T[]> { return []; }
  async execute(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    if (sql.startsWith('INSERT INTO nf_precision_cad_commercial_outbox')) { this.row = { job_json: params[6], job_hash: params[5], status: params[7], attempt: params[8], lease_generation: params[9], lease_owner: params[10], lease_expires_at: params[11], capability: params[12] }; return { changes: 1 }; }
    if (sql.startsWith('UPDATE nf_precision_cad_commercial_outbox SET status = ?, attempt')) { if (!this.row) return { changes: 0 }; this.row.status = params[0]; this.row.attempt = params[1]; this.row.lease_generation = params[2]; this.row.lease_owner = params[3]; this.row.lease_expires_at = params[4]; this.row.capability_hash = params[5]; return { changes: 1 }; }
    if (sql.startsWith('UPDATE nf_precision_cad_commercial_outbox SET status')) { if (this.row) this.row.status = params[0]; return { changes: 1 }; }
    return { changes: 0 };
  }
  async executeRaw(): Promise<void> { throw new Error('request-time DDL forbidden'); }
  async transaction<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T> { return fn(this); }
  async close(): Promise<void> { /* no-op */ }
}
describe('commercial execution outbox', () => {
  it('enqueues deterministic jobs, replays exact identity, and binds lease capability', async () => { const db = new OutboxDb(); const store = new CommercialExecutionOutboxStore(db); const first = await store.enqueue(job, 1000); expect(first.ok).toBe(true); const replay = await store.enqueue(job, 1001); expect(replay).toMatchObject({ ok: true, replayed: true }); const claimed = await store.claim('outbox-worker', 's'.repeat(32), 2000); expect(claimed).toMatchObject({ ok: true, row: { status: 'CLAIMED', attempt: 1, leaseGeneration: 2 } }); if (!claimed.ok) return; expect(await store.markSent(job.jobId, 'wrong-owner', claimed.row.capability)).toMatchObject({ ok: false, code: 'CAPABILITY_INVALID' }); expect(await store.markSent(job.jobId, 'outbox-worker', claimed.row.capability)).toMatchObject({ ok: true, row: { status: 'SENT' } }); });
  it('fails closed when migration is not present', async () => { const db = new OutboxDb(); db.queryOne = async () => undefined; const result = await new CommercialExecutionOutboxStore(db).enqueue(job); expect(result).toMatchObject({ ok: false, code: 'MIGRATION_REQUIRED' }); });
});
