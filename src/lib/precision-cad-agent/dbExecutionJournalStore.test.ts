import { describe, expect, it } from 'vitest';
import { DbExecutionJournalStore, COMMERCIAL_EXECUTION_MIGRATION_VERSION } from './dbExecutionJournalStore';
import { hashCommand, hashWorkspaceBinding } from './executionJournal';
import type { DbAdapter } from '@/lib/db-adapter';

class FakeDb implements DbAdapter {
  readonly backend = 'postgres' as const;
  readonly rows = new Map<string, Record<string, unknown>>();
  events: unknown[] = [];
  async queryOne<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    if (sql.includes('nf_schema_migrations')) return { version: COMMERCIAL_EXECUTION_MIGRATION_VERSION, checksum: 'f'.repeat(64) } as T;
    if (sql.includes('WHERE idempotency_key')) return [...this.rows.values()].find(row => row.idempotency_key === params[0])?.receipt_json ? { receipt_json: [...this.rows.values()].find(row => row.idempotency_key === params[0])!.receipt_json } as T : undefined;
    if (sql.includes('WHERE execution_id')) return this.rows.get(String(params[0])) as T | undefined;
    return undefined;
  }
  async queryAll<T>(_sql: string, ..._params: unknown[]): Promise<T[]> { return []; }
  async execute(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    if (sql.startsWith('INSERT INTO nf_precision_cad_execution_journal')) {
      const [execution_id, idempotency_key, project_id, workspace_id, workspace_revision, workspace_content_hash, command_hash, approval_hash, persistence_receipt_hash, verification_receipt_hash, lifecycle, version, receipt_json, receipt_hash, lease_owner_id, lease_expires_at, created_at, updated_at] = params;
      this.rows.set(String(execution_id), { execution_id, idempotency_key, project_id, workspace_id, workspace_revision, workspace_content_hash, command_hash, approval_hash, persistence_receipt_hash, verification_receipt_hash, lifecycle, version, receipt_json, receipt_hash, lease_owner_id, lease_expires_at, created_at, updated_at }); return { changes: 1 };
    }
    if (sql.startsWith('INSERT INTO nf_precision_cad_execution_events')) { this.events.push(params); return { changes: 1 }; }
    if (sql.startsWith('UPDATE nf_precision_cad_execution_journal')) {
      const current = this.rows.get(String(params[10])); if (!current || Number(current.version) !== Number(params[11])) return { changes: 0 };
      current.lifecycle = params[0]; current.version = params[1]; current.receipt_json = params[2]; current.receipt_hash = params[3]; current.approval_hash = params[4]; current.persistence_receipt_hash = params[5]; current.verification_receipt_hash = params[6]; current.lease_owner_id = params[7]; current.lease_expires_at = params[8]; current.updated_at = params[9]; return { changes: 1 };
    }
    return { changes: 0 };
  }
  async executeRaw(_sql?: string): Promise<void> { throw new Error('request-time DDL forbidden'); }
  async transaction<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T> { return fn(this); }
  async close(): Promise<void> { /* no-op */ }
}

const hash = (letter: string) => letter.repeat(64);

describe('Postgres durable execution journal store', () => {
  it('writes canonical approved journal/events and enforces version CAS', async () => {
    const db = new FakeDb(); const store = new DbExecutionJournalStore(db);
    const command = { domain: 'mechanical', operation: 'edit', arguments: { amount: 1 } } as const;
    const workspace = { workspaceId: 'workspace-1', projectId: 'project-1', revision: 7, contentHash: hash('a') };
    const approved = await store.createApproved({ executionId: 'exec-1', idempotencyKey: 'idem-1', command, workspace, approval: { approvalId: 'approval-1', actorId: 'user-1', approved: true, approvedAt: '2026-08-22T00:00:00.000Z', commandHash: hashCommand(command), workspaceBindingHash: hashWorkspaceBinding(workspace), userInitiated: true }, now: '2026-08-22T00:00:00.000Z' });
    expect(approved.ok).toBe(true); expect(db.events).toHaveLength(2);
    if (!approved.ok) return;
    const replay = await store.getByIdempotencyKey('idem-1'); expect(replay?.executionId).toBe('exec-1');
    const updated = await store.beginExecuting('exec-1', approved.receipt.version, 'worker-1', '2026-08-22T00:00:01.000Z');
    expect(updated.ok).toBe(true);
    expect(updated.ok && updated.receipt.events.at(-1)?.type).toBe('LEASE_ACQUIRED');
    expect(await store.beginExecuting('exec-1', approved.receipt.version, 'worker-2', '2026-08-22T00:00:02.000Z')).toMatchObject({ ok: false, code: 'STALE_CAS' });
  });

  it('fails closed when the versioned migration is unavailable and never emits request DDL', async () => {
    const db = new FakeDb(); db.queryOne = async () => undefined;
    const store = new DbExecutionJournalStore(db);
    await expect(store.get('missing')).rejects.toThrow('commercial_execution_migration_required');
    await expect(db.executeRaw('CREATE TABLE')).rejects.toThrow('request-time DDL forbidden');
  });
});
