import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import type { DbAdapter, SqlParam } from '@/lib/db-adapter';
import { canonicalCommercialExecution, type CommercialExecutionJob, type CommercialWorkerReceipt } from '../../../packages/job-contracts/src/commercialPrecisionExecution';
import { canonicalCommercialWorkerReceiptPayload, commercialWorkerReceiptHash } from './commercialWorkerReceipt';
import { canonicalNativeParserReceipt, type NativeParserReceipt, type TrustedNativeParser } from './commercialPersistenceReceipt';
import type { WorkerArtifactMetadata } from './commercialWorkerArtifactSnapshot';
import { InMemoryImmutableArtifactStore } from './commercialWorkerArtifactSnapshot';
import { DurableExecutionJournal, hashCommand, hashWorkspaceBinding, type ExecutionJournalReceipt } from './executionJournal';
import { CAD_WORKSPACE_ENVELOPE_SCHEMA, hashCadPayload, hashCadWorkspaceEnvelope, type CadWorkspaceEnvelopeInput, type StoredCadWorkspaceEnvelope } from '@/lib/cad/workspaceRevisionStore';
import { DESIGN_ARTIFACT_GRAPH_SCHEMA, type DesignArtifactGraph } from '@/lib/ai/designArtifactGraph';
import { DESIGN_WORKSPACE_REVISION_SCHEMA, type DesignWorkspaceRevision } from '@/lib/ai/designWorkspaceRevision';

export const FIXTURE_NOW = Date.parse('2026-08-22T12:00:00.000Z');
const shaBytes = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const shaText = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const keyPair = () => generateKeyPairSync('ed25519');

export type CommercialPersistenceFixture = {
  db: TransactionalPostgresMock;
  artifactStore: InMemoryImmutableArtifactStore;
  workerReceipt: CommercialWorkerReceipt;
  parserReceipt: NativeParserReceipt;
  job: CommercialExecutionJob;
  journal: ExecutionJournalReceipt;
  workerMetadata: WorkerArtifactMetadata[];
  trustedWorkers: Record<string, { workerIdentity: string; publicKeyPem: string; fingerprintSha256: string }>;
  trustedParser: TrustedNativeParser;
  expected: Record<string, unknown>;
  snapshotKeys: string[];
};

type DbState = {
  journal: ExecutionJournalReceipt;
  outbox: Record<string, unknown>;
  callback: Record<string, unknown>;
  head: { revision: number; content_hash: string };
  workerArtifacts: Record<string, unknown>[];
  snapshots: Record<string, unknown>[];
  parserReceipts: Record<string, unknown>[];
  persistenceReceipts: Record<string, unknown>[];
  workspaceCommits: Record<string, unknown>[];
  revisions: Record<string, unknown>[];
  events: Record<string, unknown>[];
  workerReceiptRows: Record<string, unknown>[];
};

export class TransactionalPostgresMock implements DbAdapter {
  readonly backend = 'postgres' as const;
  failOn: string | null = null;
  private state: DbState;
  constructor(state: DbState) { this.state = state; }
  snapshot(): DbState { return structuredClone(this.state); }
  restore(state: DbState): void { this.state = state; }
  readState(): DbState { return this.snapshot(); }
  async queryOne<T = Record<string, unknown>>(sql: string, ..._params: SqlParam[]): Promise<T | undefined> {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    if (this.failOn && normalized.includes(this.failOn)) throw new Error(`injected_failure:${this.failOn}`);
    if (normalized.includes('FROM nf_schema_migrations')) return { version: 2026082205, checksum: 'f'.repeat(64) } as T;
    if (normalized.includes('FROM nf_precision_cad_commercial_persistence_receipts') && normalized.includes('JOIN nf_precision_cad_commercial_native_parser_receipts')) { const persistence = this.state.persistenceReceipts[0]; const parser = this.state.parserReceipts[0]; return persistence ? { ...persistence, parser_receipt_json: parser?.receipt_json } as T : undefined; }
    if (normalized.includes('FROM nf_precision_cad_commercial_persistence_receipts')) return this.state.persistenceReceipts[0] as T | undefined;
    if (normalized.includes('FROM nf_precision_cad_commercial_outbox')) return this.state.outbox as T;
    if (normalized.includes('FROM nf_precision_cad_commercial_callbacks')) return this.state.callback as T;
    if (normalized.includes('FROM nf_precision_cad_execution_journal')) return { receipt_json: canonicalCommercialExecution(this.state.journal) } as T;
    if (normalized.includes('FROM nf_cad_workspace_heads')) return this.state.head as T;
    if (normalized.includes('capability_hash')) return { capability_hash: this.state.outbox.capability_hash } as T;
    return undefined;
  }
  async queryAll<T = Record<string, unknown>>(sql: string, ..._params: SqlParam[]): Promise<T[]> {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    if (normalized.includes('FROM nf_precision_cad_commercial_worker_artifacts')) return this.state.workerArtifacts as T[];
    return [];
  }
  async execute(sql: string, ...params: SqlParam[]): Promise<{ changes: number }> {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    if (this.failOn && normalized.includes(this.failOn)) throw new Error(`injected_failure:${this.failOn}`);
    if (normalized.startsWith('INSERT INTO nf_precision_cad_commercial_artifact_snapshots')) { this.state.snapshots.push({ execution_id: params[0], artifact_id: params[2], artifact_role: params[3], snapshot_object_key: params[5] }); return { changes: 1 }; }
    if (normalized.startsWith('INSERT INTO nf_precision_cad_commercial_native_parser_receipts')) { this.state.parserReceipts.push({ execution_id: params[0], parser_receipt_hash: params[2], receipt_json: params[3] }); return { changes: 1 }; }
    if (normalized.startsWith('INSERT INTO nf_precision_cad_commercial_persistence_receipts')) { this.state.persistenceReceipts.push({ execution_id: params[0], worker_receipt_hash: params[4], parser_receipt_hash: params[5], persistence_receipt_hash: params[6] }); return { changes: 1 }; }
    if (normalized.startsWith('UPDATE nf_cad_workspace_heads')) { if (this.state.head.revision !== Number(params[4]) || this.state.head.content_hash !== params[5]) return { changes: 0 }; this.state.head = { revision: Number(params[0]), content_hash: String(params[1]) }; return { changes: 1 }; }
    if (normalized.startsWith('INSERT INTO nf_precision_cad_commercial_workspace_commits')) { this.state.workspaceCommits.push({ execution_id: params[0] }); return { changes: 1 }; }
    if (normalized.startsWith('INSERT INTO nf_cad_workspace_revisions')) { this.state.revisions.push({ id: params[0], project_id: params[1], revision: params[3], content_hash: params[6], payload_json: params[7] }); return { changes: 1 }; }
    if (normalized.startsWith('UPDATE nf_precision_cad_execution_journal')) { this.state.journal = JSON.parse(String(params[2])) as ExecutionJournalReceipt; return { changes: 1 }; }
    if (normalized.startsWith('INSERT INTO nf_precision_cad_execution_events')) { this.state.events.push({ execution_id: params[0], sequence: params[1] }); return { changes: 1 }; }
    if (normalized.startsWith('UPDATE nf_precision_cad_commercial_outbox')) { this.state.outbox.status = params[0]; return { changes: 1 }; }
    if (normalized.startsWith('INSERT INTO nf_precision_cad_worker_receipts')) { this.state.workerReceiptRows.push({ execution_id: params[0], worker_receipt_hash: params[1] }); return { changes: 1 }; }
    return { changes: 1 };
  }
  async executeRaw(_sql: string): Promise<void> { throw new Error('REQUEST_TIME_DDL_FORBIDDEN'); }
  async transaction<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T> { const before = this.snapshot(); try { const result = await fn(this); return result; } catch (error) { this.restore(before); throw error; } }
  async close(): Promise<void> {}
}

function signedWorkerReceipt(executionId: string, journalVersion: number, commandHash: string, reportBody = new TextEncoder().encode('{"report":"PASS"}')): { receipt: CommercialWorkerReceipt; publicKeyPem: string; fingerprint: string; bodies: Uint8Array[] } {
  const keys = keyPair(); const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(); const fingerprint = createHash('sha256').update(keys.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
  const bodies = [new TextEncoder().encode('STEP native model'), reportBody, new TextEncoder().encode('{"verification":true}')];
  const roles = ['model', 'report', 'verification'] as const;
  const receipt: CommercialWorkerReceipt = { schema: 'nexyfab.precision-cad-commercial-execution.v3', tenantId: 'tenant-1', projectId: 'project-1', executionId, generationRunId: 'run-1', generationStateRevision: 11, generationProgramSha256: '8'.repeat(64), workspaceId: 'workspace-1', workspaceRevision: 4, workspaceContentHash: 'a'.repeat(64), journalVersion, leaseGeneration: 1, leaseCapabilityHash: 'c'.repeat(64), attempt: 1, jobId: 'job-1', commandHash, targetHash: 'd'.repeat(64), inputArtifactSha256: 'e'.repeat(64), workerIdentity: 'worker-1', workerPublicKeyFingerprint: fingerprint, status: 'PASS', startedAt: '2026-08-22T11:59:00.000Z', completedAt: '2026-08-22T12:00:00.000Z', outputArtifacts: bodies.map((body, index) => ({ artifactId: `${roles[index]}-1`, role: roles[index], contentSha256: shaBytes(body), byteLength: body.byteLength, objectKey: `private/worker/${roles[index]}` })), failureReasons: [], signatureBase64: '' };
  receipt.signatureBase64 = sign(null, Buffer.from(canonicalCommercialWorkerReceiptPayload(receipt)), keys.privateKey).toString('base64');
  return { receipt, publicKeyPem, fingerprint, bodies };
}

function canonicalWorkspaceEnvelope(): StoredCadWorkspaceEnvelope {
  const requirementsPayload = { title: 'commercial fixture' };
  const semanticPayload = { schema: 'nexyfab.product-decomposition.v1', parts: ['fixture-part'] };
  const relationsPayload = { relations: [] };
  const modelBytes = new TextEncoder().encode('STEP native model');
  const semanticHash = hashCadPayload(semanticPayload);
  const workspace: DesignWorkspaceRevision = { schema: DESIGN_WORKSPACE_REVISION_SCHEMA, projectId: 'project-1', lineageId: 'lineage-1', revision: 5, domain: 'mechanical', experience: 'expert', workMode: 'precision_cad', documentHash: semanticHash, locks: [], history: [{ revision: 5, actor: 'expert', mode: 'precision_cad', documentHash: semanticHash, changedTargets: [{ kind: 'workspace', objectId: 'workspace-1' }], retainedLockIds: [] }] };
  const graph: DesignArtifactGraph = { schema: DESIGN_ARTIFACT_GRAPH_SCHEMA, projectId: 'project-1', revision: 5, artifacts: [{ id: 'model', kind: 'model', revision: 5, contentHash: shaBytes(modelBytes), state: 'current', inputs: [], verification: { status: 'passed', verifierId: 'occt', evidenceHash: 'e'.repeat(64), issues: [] }, staleBecause: [] }], dependencies: [] };
  const input: CadWorkspaceEnvelopeInput = { schema: CAD_WORKSPACE_ENVELOPE_SCHEMA, workspace, requirements: { contentHash: hashCadPayload(requirementsPayload), payload: requirementsPayload }, semanticDocument: { schema: 'nexyfab.product-decomposition.v1', contentHash: semanticHash, payload: semanticPayload }, geometry: { fidelity: 'exact_brep', contentHash: shaBytes(modelBytes), shapeIdentityHash: 'f'.repeat(64) }, objectRelations: { contentHash: hashCadPayload(relationsPayload), payload: relationsPayload }, artifactGraph: graph, provenance: [{ sourceId: 'fixture-source', kind: 'expert', contentHash: '1'.repeat(64) }], kernelIdentity: { mode: 'wasm', kernelId: 'occt-7.8.1', buildSha256: '2'.repeat(64), wasmSha256: '3'.repeat(64), stubFallback: false } };
  return { ...input, contentHash: hashCadWorkspaceEnvelope(input) };
}

export function makeCommercialPersistenceFixture(): CommercialPersistenceFixture {
  const command = { domain: 'mechanical', operation: 'apply', arguments: { feature: 'fillet', radiusMm: 2 } };
  const workspace = { workspaceId: 'workspace-1', projectId: 'project-1', revision: 4, contentHash: 'a'.repeat(64) };
  const journalEngine = new DurableExecutionJournal(undefined, () => new Date(FIXTURE_NOW).toISOString());
  const planned = journalEngine.plan({ idempotencyKey: 'idem-1', command, workspace }); if (!planned.ok) throw new Error('fixture_plan_failed');
  const approved = journalEngine.approve(planned.receipt.executionId, { approvalId: 'approval-1', actorId: 'designer-1', approved: true, approvedAt: new Date(FIXTURE_NOW).toISOString(), commandHash: hashCommand(command), workspaceBindingHash: hashWorkspaceBinding(workspace), userInitiated: true }); if (!approved.ok) throw new Error('fixture_approval_failed');
  const executing = journalEngine.begin(planned.receipt.executionId, 'worker-1', 300_000); if (!executing.ok) throw new Error('fixture_begin_failed');
  const journal = executing.receipt;
  const envelope = canonicalWorkspaceEnvelope();
  const worker = signedWorkerReceipt(journal.executionId, journal.version, hashCommand(command), new TextEncoder().encode(canonicalCommercialExecution(envelope)));
  const job: CommercialExecutionJob = { contractVersion: 'nexyfab.precision-cad-commercial-execution.v3', jobId: 'job-1', tenantId: worker.receipt.tenantId, projectId: worker.receipt.projectId, executionId: worker.receipt.executionId, generationRunId: worker.receipt.generationRunId, generationStateRevision: worker.receipt.generationStateRevision, generationProgramSha256: worker.receipt.generationProgramSha256, workspaceId: worker.receipt.workspaceId, workspaceRevision: worker.receipt.workspaceRevision, workspaceContentHash: worker.receipt.workspaceContentHash, tool: 'apply', scope: 'apply', callId: 'call-1', argumentsHash: shaText(canonicalCommercialExecution(command.arguments)), commandHash: worker.receipt.commandHash, targetHash: worker.receipt.targetHash, journalVersion: journal.version, attempt: worker.receipt.attempt, leaseGeneration: worker.receipt.leaseGeneration, inputArtifact: { artifactId: 'input-1', objectKey: 'private/commercial-precision-inputs/tenant-1/project-1/job-1/input.json', contentSha256: worker.receipt.inputArtifactSha256!, byteLength: 256, mediaType: 'application/json' } };
  const workerReceipt = worker.receipt;
  const workerHash = commercialWorkerReceiptHash(worker.receipt);
  const parserKeys = keyPair(); const parserPublicKeyPem = parserKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString(); const parserFingerprint = createHash('sha256').update(parserKeys.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
  const snapshots = worker.receipt.outputArtifacts.map(artifact => ({ artifactId: artifact.artifactId, role: artifact.role, objectKey: `private/commercial-snapshots/${worker.receipt.tenantId}/${worker.receipt.projectId}/${worker.receipt.executionId}/${workerHash}/${artifact.artifactId}`, contentSha256: artifact.contentSha256, byteLength: artifact.byteLength }));
  const parser: NativeParserReceipt = { schema: 'nexyfab.precision-cad-native-parser-receipt.v1', parserIdentity: 'occt-parser', parserPublicKeyFingerprint: parserFingerprint, parserRole: 'native_parser', format: 'STEP', kernelIdentity: 'OCCT-7.8.1', modelArtifactId: 'model-1', workspaceEnvelopeArtifactId: 'report-1', modelContentSha256: worker.receipt.outputArtifacts[0]!.contentSha256, targetHash: worker.receipt.targetHash, workspaceAfter: { workspaceId: worker.receipt.workspaceId, projectId: worker.receipt.projectId, revision: worker.receipt.workspaceRevision + 1, contentHash: envelope.contentHash }, manifest: snapshots.map(item => ({ ...item, objectKey: item.objectKey })), issuedAt: '2026-08-22T11:59:30.000Z', completedAt: '2026-08-22T12:00:00.000Z', signatureBase64: '' };
  parser.signatureBase64 = sign(null, Buffer.from(canonicalNativeParserReceipt(parser)), parserKeys.privateKey).toString('base64');
  const artifactStore = new InMemoryImmutableArtifactStore(); worker.receipt.outputArtifacts.forEach((artifact, index) => artifactStore.seed(artifact.objectKey, worker.bodies[index]!));
  const metadata = worker.receipt.outputArtifacts.map(item => ({ ...item }));
  const state: DbState = { journal, outbox: { status: 'VERIFIED_UNKNOWN', attempt: 1, lease_generation: 1, capability_hash: worker.receipt.leaseCapabilityHash }, callback: { receipt_hash: workerHash, receipt_json: canonicalCommercialExecution(worker.receipt), status: 'PASS' }, head: { revision: workspace.revision, content_hash: workspace.contentHash }, workerArtifacts: metadata.map(item => ({ artifact_id: item.artifactId, artifact_role: item.role, object_key: item.objectKey, content_sha256: item.contentSha256, byte_length: item.byteLength })), snapshots: [], parserReceipts: [], persistenceReceipts: [], workspaceCommits: [], revisions: [], events: [], workerReceiptRows: [] };
  const db = new TransactionalPostgresMock(state);
  const expected = { ...job, inputArtifactSha256: job.inputArtifact!.contentSha256, leaseCapabilityHash: worker.receipt.leaseCapabilityHash };
  return { db, artifactStore, workerReceipt: workerReceipt, parserReceipt: parser, job, journal, workerMetadata: metadata, trustedWorkers: { 'worker-1': { workerIdentity: 'worker-1', publicKeyPem: worker.publicKeyPem, fingerprintSha256: worker.fingerprint } }, trustedParser: { parserIdentity: 'occt-parser', publicKeyPem: parserPublicKeyPem, fingerprintSha256: parserFingerprint }, expected, snapshotKeys: [] };
}
