import { describe, expect, it } from 'vitest';
import { issueApprovalChallenge, type ApprovalBindingInput } from './commercialAgentExecutionBoundary';
import { executeTransactionalCommercial } from './transactionalCommercialExecution';
import type { DbAdapter } from '@/lib/db-adapter';

const SECRET = 'transactional-commercial-secret-012345678901234567';
const NOW = 1_800_000_000_000;
const base: ApprovalBindingInput = { actorId: 'user-1', role: 'editor', projectId: 'project-1', workspaceId: 'workspace-1', workspaceRevision: 7, workspaceContentHash: 'a'.repeat(64), tool: 'build_assembly', scope: 'apply', callId: 'call-1', arguments: { amount: 2 } };

class TransactionDb implements DbAdapter {
  readonly backend = 'postgres' as const;
  challenge: Record<string, unknown> | undefined;
  headHash = 'a'.repeat(64);
  claims = 0;
  journal = 0;
  challengeConsumed = false;
  failJournal = false;
  claimChanges = 1;
  operations: string[] = [];
  async queryOne<T>(sql: string, ..._params: unknown[]): Promise<T | undefined> {
    if (sql.includes('nf_schema_migrations')) return { version: 2026082202, checksum: 'f'.repeat(64) } as T;
    if (sql.includes('nf_cad_workspace_heads')) return { revision: 7, content_hash: this.headHash } as T;
    if (sql.includes('nf_precision_cad_approval_challenges')) return this.challengeConsumed ? undefined : this.challenge as T | undefined;
    if (sql.includes('nf_precision_cad_execution_journal')) return undefined;
    if (sql.includes('nf_precision_cad_tool_claims')) return undefined;
    return undefined;
  }
  async queryAll<T>(_sql: string, ..._params: unknown[]): Promise<T[]> { return []; }
  async execute(sql: string, ..._params: unknown[]): Promise<{ changes: number }> {
    if (sql.startsWith('UPDATE nf_precision_cad_approval_challenges')) { this.challengeConsumed = true; this.operations.push('consume'); return { changes: 1 }; }
    if (sql.startsWith('INSERT INTO nf_precision_cad_tool_claims')) { this.operations.push('claim'); if (this.claimChanges === 1) this.claims += 1; return { changes: this.claimChanges }; }
    if (sql.startsWith('INSERT INTO nf_precision_cad_execution_journal')) { this.operations.push('journal'); if (this.failJournal) throw new Error('journal insert failed'); this.journal += 1; return { changes: 1 }; }
    if (sql.startsWith('INSERT INTO nf_precision_cad_execution_events')) return { changes: 1 };
    return { changes: 0 };
  }
  async executeRaw(): Promise<void> { throw new Error('request-time DDL forbidden'); }
  async transaction<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T> {
    const snapshot = { claims: this.claims, journal: this.journal, challengeConsumed: this.challengeConsumed, operations: [...this.operations] };
    try { return await fn(this); } catch (error) { Object.assign(this, snapshot); throw error; }
  }
  async close(): Promise<void> { /* no-op */ }
}

async function setup() {
  const db = new TransactionDb();
  const issued = await issueApprovalChallenge({ insert: challenge => { db.challenge = { challenge_id: challenge.challengeId, nonce: challenge.nonce, actor_id: challenge.actorId, role: challenge.role, project_id: challenge.projectId, workspace_id: challenge.workspaceId, workspace_revision: challenge.workspaceRevision, workspace_content_hash: challenge.workspaceContentHash, tool: challenge.tool, scope: challenge.scope, call_id: challenge.callId, arguments_hash: challenge.argumentsHash, command_hash: challenge.commandHash, issued_at: challenge.issuedAt, expires_at: challenge.expiresAt, mac: challenge.mac }; return true; }, get: () => null, consume: () => null }, base, SECRET, NOW);
  if (!issued.ok) throw new Error('challenge setup failed');
  return { db, challenge: issued.challenge };
}

describe('transactional commercial execution', () => {
  it('atomically consumes approval, claims the call, journals APPROVED, then HOLDs without a durable worker', async () => {
    const { db, challenge } = await setup();
    const result = await executeTransactionalCommercial({ db, approval: { ...base, challengeId: challenge.challengeId, nonce: challenge.nonce, mac: challenge.mac }, approvalSecret: SECRET, idempotencyKey: 'idem-1', executionId: 'exec-1', command: { domain: 'precision-cad-agent', operation: 'build_assembly', arguments: base.arguments }, now: NOW });
    expect(result).toMatchObject({ ok: false, status: 'HOLD', code: 'DURABLE_WORKER_CONTRACT_REQUIRED', httpStatus: 202, executionId: 'exec-1' });
    expect(db.claims).toBe(1); expect(db.journal).toBe(1);
    expect(db.operations).toEqual(['consume', 'journal', 'claim']);
  });

  it('rolls back challenge, journal and claim when the claim conflicts', async () => {
    const { db, challenge } = await setup(); db.claimChanges = 0;
    const result = await executeTransactionalCommercial({ db, approval: { ...base, challengeId: challenge.challengeId, nonce: challenge.nonce, mac: challenge.mac }, approvalSecret: SECRET, idempotencyKey: 'idem-conflict', executionId: 'exec-conflict', command: { domain: 'precision-cad-agent', operation: 'build_assembly', arguments: base.arguments }, now: NOW });
    expect(result).toMatchObject({ ok: false, status: 'HOLD', code: 'PAYLOAD_SUBSTITUTION' });
    expect(db.challengeConsumed).toBe(false); expect(db.claims).toBe(0); expect(db.journal).toBe(0);
  });

  it('rolls back a consumed challenge when journal persistence fails', async () => {
    const { db, challenge } = await setup(); db.failJournal = true;
    const result = await executeTransactionalCommercial({ db, approval: { ...base, challengeId: challenge.challengeId, nonce: challenge.nonce, mac: challenge.mac }, approvalSecret: SECRET, idempotencyKey: 'idem-fail', executionId: 'exec-fail', command: { domain: 'precision-cad-agent', operation: 'build_assembly', arguments: base.arguments }, now: NOW });
    expect(result).toMatchObject({ ok: false, status: 'HOLD', code: 'JOURNAL_CONFLICT' });
    expect(db.challengeConsumed).toBe(false); expect(db.claims).toBe(0); expect(db.journal).toBe(0);
  });

  it('rejects tool substitution before durable execution', async () => {
    const { db, challenge } = await setup(); let workerCalls = 0;
    const result = await executeTransactionalCommercial({ db, approval: { ...base, challengeId: challenge.challengeId, nonce: challenge.nonce, mac: challenge.mac }, approvalSecret: SECRET, idempotencyKey: 'idem-sub', executionId: 'exec-sub', command: { domain: 'precision-cad-agent', operation: 'export_step', arguments: base.arguments }, durableWorker: { submit: async () => { workerCalls++; return { accepted: true, workerReceiptId: 'bad' }; } }, now: NOW });
    expect(result).toMatchObject({ ok: false, status: 'HOLD', code: 'PAYLOAD_SUBSTITUTION' }); expect(workerCalls).toBe(0); expect(db.challengeConsumed).toBe(false);
  });

  it('rejects a stale workspace before consuming approval or starting a worker', async () => {
    const { db, challenge } = await setup(); db.headHash = 'b'.repeat(64); let workerCalls = 0;
    const result = await executeTransactionalCommercial({ db, approval: { ...base, challengeId: challenge.challengeId, nonce: challenge.nonce, mac: challenge.mac }, approvalSecret: SECRET, idempotencyKey: 'idem-2', executionId: 'exec-2', command: { domain: 'precision-cad-agent', operation: 'build_assembly', arguments: base.arguments }, durableWorker: { submit: async () => { workerCalls += 1; return { accepted: true, workerReceiptId: 'worker-1' }; } }, now: NOW });
    expect(result).toMatchObject({ ok: false, status: 'HOLD', code: 'WORKSPACE_STALE', httpStatus: 409 });
    expect(workerCalls).toBe(0); expect(db.claims).toBe(0);
  });
});
