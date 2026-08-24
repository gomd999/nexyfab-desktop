import type { DbAdapter, SqlParam } from '@/lib/db-adapter';
import type { CommercialExecutionJob } from '../../../packages/job-contracts/src/commercialPrecisionExecution';
import { hashBoundaryArguments, issueApprovalChallenge, type ApprovalBindingInput, type ApprovalChallenge, type ApprovalConsumeInput } from './commercialAgentExecutionBoundary';
import { enqueueCommercialExecutionTransaction } from './commercialExecutionOutboxStore';
import { canonicalJson, DurableExecutionJournal, hashReceipt } from './executionJournal';

const SECRET = 's'.repeat(32);
export const NOW = Date.now();

type EnqueueState = { challenge: Record<string, unknown>; head: { revision: number; content_hash: string }; journal?: Record<string, unknown>; claim?: Record<string, unknown>; outbox?: Record<string, unknown>; inputArtifact?: Record<string, unknown> };

export class EnqueuePostgresMock implements DbAdapter {
  readonly backend = 'postgres' as const;
  migrationAvailable = true;
  failOn: string | null = null;
  failCommit = false;
  ddlCalls = 0;
  lastError: string | null = null;
  private state: EnqueueState;
  private tail: Promise<void> = Promise.resolve();
  constructor(state: EnqueueState) { this.state = state; }
  snapshot(): EnqueueState { return structuredClone(this.state); }
  restore(value: EnqueueState): void { this.state = value; }
  readState(): EnqueueState { return this.snapshot(); }
  async queryOne<T = Record<string, unknown>>(sql: string, ..._params: SqlParam[]): Promise<T | undefined> {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    if (this.failOn && normalized.includes(this.failOn)) throw new Error(`injected_failure:${this.failOn}`);
    if (normalized.includes('FROM nf_schema_migrations')) { const version = Number(_params[0]); return this.migrationAvailable ? { version, checksum: 'f'.repeat(64) } as T : undefined; }
    if (normalized.includes('FROM nf_cad_workspace_heads')) return this.state.head as T;
    if (normalized.includes('FROM nf_precision_cad_commercial_outbox') && normalized.includes('JOIN nf_precision_cad_execution_journal')) return this.state.journal?.idempotency_key === _params[0] ? this.state.outbox as T | undefined : undefined;
    if (normalized.includes('FROM nf_precision_cad_execution_journal')) return this.state.journal as T | undefined;
    if (normalized.includes('FROM nf_precision_cad_tool_claims')) return this.state.claim as T | undefined;
    if (normalized.includes('FROM nf_precision_cad_approval_challenges')) return this.state.challenge.challenge_id === _params[0] ? this.state.challenge as T : undefined;
    if (normalized.includes('FROM nf_precision_cad_commercial_input_artifacts')) return this.state.inputArtifact?.job_id === _params[0] ? this.state.inputArtifact as T : undefined;
    if (normalized.includes('FROM nf_precision_cad_commercial_outbox')) {
      if (!this.state.outbox) return undefined;
      if (_params.length && String(_params[0]) !== String(this.state.outbox.job_id)) return undefined;
      return this.state.outbox as T;
    }
    return undefined;
  }
  async queryAll<T = Record<string, unknown>>(_sql: string, ..._params: SqlParam[]): Promise<T[]> { return []; }
  async execute(sql: string, ...params: SqlParam[]): Promise<{ changes: number }> {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    if (this.failOn && normalized.includes(this.failOn)) throw new Error(`injected_failure:${this.failOn}`);
    if (normalized.startsWith('UPDATE nf_precision_cad_approval_challenges')) { if (this.state.challenge.consumed_at !== null || Number(this.state.challenge.expires_at) <= Number(params[2])) return { changes: 0 }; this.state.challenge.consumed_at = params[0]; return { changes: 1 }; }
    if (normalized.startsWith('INSERT INTO nf_precision_cad_execution_journal')) { if (this.state.journal) return { changes: 0 }; this.state.journal = { execution_id: params[0], idempotency_key: params[1], project_id: params[2], workspace_id: params[3], workspace_revision: params[4], workspace_content_hash: params[5], command_hash: params[6], approval_hash: params[7], lifecycle: params[8], version: params[9], receipt_json: params[10], receipt_hash: params[11], created_at: params[12], updated_at: params[13] }; return { changes: 1 }; }
    if (normalized.startsWith('INSERT INTO nf_precision_cad_tool_claims')) { if (this.state.claim) return { changes: 0 }; this.state.claim = { project_id: params[0], workspace_revision: params[1], call_id: params[2], arguments_hash: params[3], challenge_id: params[4], execution_id: params[5], claimed_at: params[6] }; return { changes: 1 }; }
    if (normalized.startsWith('INSERT INTO nf_precision_cad_commercial_outbox')) { if (this.state.outbox) return { changes: 0 }; this.state.outbox = { job_id: params[0], tenant_id: params[1], project_id: params[2], execution_id: params[3], generation_run_id: params[4], job_hash: params[5], job_json: params[6], status: params[7], attempt: params[8], lease_generation: params[9], available_at: params[10], created_at: params[11], updated_at: params[12] }; return { changes: 1 }; }
    if (normalized.startsWith('INSERT INTO nf_precision_cad_commercial_input_artifacts')) { if (this.state.inputArtifact) return { changes: 0 }; this.state.inputArtifact = { job_id: params[0], execution_id: params[1], tenant_id: params[2], project_id: params[3], artifact_id: params[4], object_key: params[5], content_sha256: params[6], byte_length: params[7], media_type: params[8], created_at: params[9] }; return { changes: 1 }; }
    return { changes: 1 };
  }
  async executeRaw(_sql: string): Promise<void> { this.ddlCalls++; throw new Error('REQUEST_TIME_DDL_FORBIDDEN'); }
  async transaction<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => { const before = this.snapshot(); try { const result = await fn(this); if (this.failCommit) throw new Error('injected_commit_failure'); return result; } catch (error) { this.lastError = String(error); this.restore(before); throw error; } });
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }
  async close(): Promise<void> {}
}

export type EnqueueFixture = { db: EnqueuePostgresMock; input: Parameters<typeof enqueueCommercialExecutionTransaction>[0]; approvalBinding: ApprovalBindingInput; challenge: ApprovalChallenge };

export async function makeEnqueueFixture(): Promise<EnqueueFixture> {
  const approvalBinding: ApprovalBindingInput = { actorId: 'owner-1', role: 'owner', projectId: 'project-1', workspaceId: 'workspace-1', workspaceRevision: 7, workspaceContentHash: 'a'.repeat(64), tool: 'apply', scope: 'apply', callId: 'call-1', arguments: { feature: 'fillet', radiusMm: 2 } };
  const issued = await issueApprovalChallenge({ insert: () => true, get: () => null, consume: () => null }, approvalBinding, SECRET, NOW); if (!issued.ok) throw new Error('challenge_fixture_failed');
  const challenge = issued.challenge;
  const approval: ApprovalConsumeInput = { ...approvalBinding, challengeId: challenge.challengeId, nonce: challenge.nonce, mac: challenge.mac };
  const argumentsHash = hashBoundaryArguments(approvalBinding.arguments); const targetHash = 'd'.repeat(64); const generationProgramSha256 = 'b'.repeat(64);
  const command = { domain: 'precision-cad-agent', operation: approvalBinding.tool, arguments: { toolArguments: approvalBinding.arguments, tenantId: 'tenant-1', projectId: approvalBinding.projectId, workspaceId: approvalBinding.workspaceId, workspaceRevision: approvalBinding.workspaceRevision, modelContentHash: approvalBinding.workspaceContentHash, generationRunId: 'run-1', generationStateRevision: 1, generationProgramSha256, targetSha256: targetHash } };
  const nowIso = new Date(NOW).toISOString(); const engine = new DurableExecutionJournal(undefined, () => nowIso); const planned = engine.plan({ idempotencyKey: 'idem-1', command, workspace: { workspaceId: approvalBinding.workspaceId, projectId: approvalBinding.projectId, revision: approvalBinding.workspaceRevision, contentHash: approvalBinding.workspaceContentHash } }); if (!planned.ok) throw new Error('journal_plan_failed'); const approved = engine.approve(planned.receipt.executionId, { approvalId: `boundary:${challenge.challengeId}`, actorId: approval.actorId, approved: true, approvedAt: nowIso, commandHash: planned.receipt.commandHash, workspaceBindingHash: planned.receipt.workspaceBindingHash, userInitiated: true }); if (!approved.ok || !approved.receipt.approvalHash) throw new Error('journal_approval_failed');
  const job: CommercialExecutionJob = { contractVersion: 'nexyfab.precision-cad-commercial-execution.v3', jobId: 'job-1', tenantId: 'tenant-1', projectId: 'project-1', executionId: approved.receipt.executionId, generationRunId: 'run-1', generationStateRevision: 1, generationProgramSha256, workspaceId: 'workspace-1', workspaceRevision: 7, workspaceContentHash: approvalBinding.workspaceContentHash, tool: approvalBinding.tool, scope: approvalBinding.scope, callId: approvalBinding.callId, argumentsHash, commandHash: approved.receipt.commandHash, targetHash, journalVersion: approved.receipt.version, attempt: 1, leaseGeneration: 1, inputArtifact: { artifactId: 'input-1', objectKey: 'private/commercial-precision-inputs/tenant-1/project-1/job-1/input.json', contentSha256: 'e'.repeat(64), byteLength: 256, mediaType: 'application/json' } };
  const receiptJson = canonicalJson(approved.receipt);
  const journal = { idempotencyKey: approved.receipt.idempotencyKey, receiptJson, receiptHash: hashReceipt(approved.receipt), approvalHash: approved.receipt.approvalHash, createdAt: Date.parse(approved.receipt.createdAt), updatedAt: Date.parse(approved.receipt.updatedAt) };
  const db = new EnqueuePostgresMock({ challenge: { challenge_id: challenge.challengeId, nonce: challenge.nonce, actor_id: challenge.actorId, role: challenge.role, project_id: challenge.projectId, workspace_id: challenge.workspaceId, workspace_revision: challenge.workspaceRevision, workspace_content_hash: challenge.workspaceContentHash, tool: challenge.tool, scope: challenge.scope, call_id: challenge.callId, arguments_hash: challenge.argumentsHash, command_hash: challenge.commandHash, issued_at: challenge.issuedAt, expires_at: challenge.expiresAt, mac: challenge.mac, consumed_at: null }, head: { revision: 7, content_hash: 'a'.repeat(64) } });
  return { db, input: { db, approval, approvalSecret: SECRET, job, journal }, approvalBinding, challenge };
}
