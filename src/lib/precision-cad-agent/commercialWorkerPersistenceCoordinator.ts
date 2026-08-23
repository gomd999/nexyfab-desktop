import type { DbAdapter } from '@/lib/db-adapter';
import { canonicalCommercialExecution, type CommercialWorkerReceipt } from '../../../packages/job-contracts/src/commercialPrecisionExecution';
import { hashReceipt, verifyExecutionJournalChain, appendJournalEvent, type ExecutionJournalReceipt } from './executionJournal';
import { verifyCommercialWorkerReceipt, type CommercialReceiptBinding, type TrustedCommercialWorker } from './commercialWorkerReceipt';
import { snapshotCommercialWorkerArtifacts, hashSnapshotManifest, type ImmutableArtifactStore, type WorkerArtifactMetadata, type CommercialArtifactSnapshot } from './commercialWorkerArtifactSnapshot';
import { buildPersistenceReceiptHash, nativeParserReceiptHash, verifyNativeParserReceipt, type NativeParserReceipt, type TrustedNativeParser, type PersistenceReceiptBinding } from './commercialPersistenceReceipt';
import { hashCadWorkspaceEnvelope, validateCadWorkspaceEnvelope, type CadWorkspaceEnvelopeInput, type StoredCadWorkspaceEnvelope } from '@/lib/cad/workspaceRevisionStore';

export const COMMERCIAL_PERSISTENCE_MIGRATION_VERSION = 2026082205;
const MAX_RECEIPT_BYTES = 512 * 1024;

export type PersistenceOutcome =
  | { ok: true; status: 'COMMITTED' | 'REPLAY'; executionId: string; workerReceiptHash: string; persistenceReceiptHash: string; snapshots: readonly CommercialArtifactSnapshot[] }
  | { ok: false; status: 'HOLD'; code: 'MIGRATION_REQUIRED' | 'RECEIPT_INVALID' | 'PARSER_INVALID' | 'ARTIFACT_INVALID' | 'WORKSPACE_STALE' | 'OUTBOX_ORDER_INVALID' | 'JOURNAL_INVALID' | 'PERSISTENCE_CONFLICT' | 'SIZE_LIMIT'; issues: string[]; orphanKeys?: string[] };

export async function assertCommercialPersistenceMigration(db: DbAdapter): Promise<void> {
  if (db.backend !== 'postgres') throw new Error(`commercial_persistence_migration_required:v${COMMERCIAL_PERSISTENCE_MIGRATION_VERSION}`);
  const row = await db.queryOne<{ version: number; checksum?: string }>('SELECT version, checksum FROM nf_schema_migrations WHERE version = ?', COMMERCIAL_PERSISTENCE_MIGRATION_VERSION).catch(() => undefined);
  const expected = process.env.POSTGRES_MIGRATION_CHECKSUM_2026082205;
  if (!row || Number(row.version) !== COMMERCIAL_PERSISTENCE_MIGRATION_VERSION || (process.env.NEXYFAB_COMMERCIAL_MODE === '1' && (!expected || row.checksum !== expected))) throw new Error(`commercial_persistence_migration_required:v${COMMERCIAL_PERSISTENCE_MIGRATION_VERSION}`);
}

function parseJournal(row: Record<string, unknown> | undefined): ExecutionJournalReceipt | null {
  if (!row || typeof row.receipt_json !== 'string' || Buffer.byteLength(row.receipt_json, 'utf8') > MAX_RECEIPT_BYTES) return null;
  try { const receipt = JSON.parse(row.receipt_json) as ExecutionJournalReceipt; return verifyExecutionJournalChain(receipt) ? receipt : null; } catch { return null; }
}

async function loadWorkspaceEnvelope(store: ImmutableArtifactStore, snapshots: readonly CommercialArtifactSnapshot[], receipt: NativeParserReceipt): Promise<StoredCadWorkspaceEnvelope | null> {
  const artifact = snapshots.find(item => item.artifactId === receipt.workspaceEnvelopeArtifactId && item.role === 'report');
  if (!artifact || artifact.byteLength > 2 * 1024 * 1024) return null;
  const bytes = await store.read(artifact.snapshotObjectKey);
  if (!bytes || bytes.byteLength !== artifact.byteLength) return null;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const parsed = JSON.parse(text) as StoredCadWorkspaceEnvelope;
    const { contentHash: storedHash, ...input } = parsed;
    const envelope = input as CadWorkspaceEnvelopeInput;
    if (validateCadWorkspaceEnvelope(envelope).length || storedHash !== hashCadWorkspaceEnvelope(envelope) || storedHash !== receipt.workspaceAfter.contentHash || envelope.workspace.projectId !== receipt.workspaceAfter.projectId || envelope.workspace.revision !== receipt.workspaceAfter.revision) return null;
    return parsed;
  } catch { return null; }
}

export async function persistCommercialWorkerResult(input: {
  db: DbAdapter;
  artifactStore: ImmutableArtifactStore;
  receipt: CommercialWorkerReceipt;
  expected: CommercialReceiptBinding;
  trustedWorkers: Readonly<Record<string, TrustedCommercialWorker>>;
  metadata: readonly WorkerArtifactMetadata[];
  parserReceipt: NativeParserReceipt;
  trustedParser: TrustedNativeParser;
  now?: number;
}): Promise<PersistenceOutcome> {
  let migrationError = false;
  try { await assertCommercialPersistenceMigration(input.db); } catch { migrationError = true; }
  if (migrationError) return { ok: false, status: 'HOLD', code: 'MIGRATION_REQUIRED', issues: ['commercial_postgres_migration_required'] };
  const worker = verifyCommercialWorkerReceipt({ receipt: input.receipt, expected: input.expected, trustedWorkers: input.trustedWorkers });
  if (!worker.ok) return { ok: false, status: 'HOLD', code: 'RECEIPT_INVALID', issues: worker.issues };
  const parserBinding: PersistenceReceiptBinding = { tenantId: input.expected.tenantId, projectId: input.expected.projectId, executionId: input.expected.executionId, generationRunId: input.expected.generationRunId, jobId: input.expected.jobId, targetHash: input.expected.targetHash, workspaceId: input.expected.workspaceId, workspaceRevision: input.expected.workspaceRevision, workspaceContentHash: input.expected.workspaceContentHash };
  // An already committed row is an exact replay only; never copy or execute again.
  const committed = await input.db.queryOne<{ worker_receipt_hash: string; parser_receipt_hash: string; persistence_receipt_hash: string; execution_id: string; parser_receipt_json: string }>('SELECT p.worker_receipt_hash, p.parser_receipt_hash, p.persistence_receipt_hash, p.execution_id, n.receipt_json AS parser_receipt_json FROM nf_precision_cad_commercial_persistence_receipts p JOIN nf_precision_cad_commercial_native_parser_receipts n ON n.execution_id = p.execution_id WHERE p.execution_id = ?', input.receipt.executionId).catch(() => undefined);
  if (committed) {
    const parserHash = nativeParserReceiptHash(input.parserReceipt);
    if (committed.worker_receipt_hash === worker.receiptHash && committed.parser_receipt_hash === parserHash && committed.parser_receipt_json === canonicalCommercialExecution(input.parserReceipt) && input.parserReceipt.parserIdentity === input.trustedParser.parserIdentity && input.parserReceipt.parserPublicKeyFingerprint === input.trustedParser.fingerprintSha256) return { ok: true, status: 'REPLAY', executionId: input.receipt.executionId, workerReceiptHash: worker.receiptHash, persistenceReceiptHash: String(committed.persistence_receipt_hash), snapshots: [] };
    return { ok: false, status: 'HOLD', code: 'PERSISTENCE_CONFLICT', issues: ['committed_receipt_binding_conflict'] };
  }
  if (input.receipt.status !== 'PASS') return { ok: false, status: 'HOLD', code: 'RECEIPT_INVALID', issues: ['worker_receipt_not_pass'] };
  const snapshot = await snapshotCommercialWorkerArtifacts({ store: input.artifactStore, receipt: input.receipt, expected: input.expected, trustedWorkers: input.trustedWorkers, metadata: input.metadata, receiptHash: worker.receiptHash });
  if (!snapshot.ok) return { ok: false, status: 'HOLD', code: snapshot.code === 'SIZE_LIMIT' ? 'SIZE_LIMIT' : 'ARTIFACT_INVALID', issues: snapshot.issues, orphanKeys: snapshot.orphanKeys };
  const parser = verifyNativeParserReceipt({ receipt: input.parserReceipt, expected: parserBinding, snapshots: snapshot.snapshots, trustedParser: input.trustedParser });
  if (!parser.ok) return { ok: false, status: 'HOLD', code: 'PARSER_INVALID', issues: parser.issues, orphanKeys: snapshot.snapshots.map(item => item.snapshotObjectKey) };
  const workspaceEnvelope = await loadWorkspaceEnvelope(input.artifactStore, snapshot.snapshots, input.parserReceipt);
  if (!workspaceEnvelope) return { ok: false, status: 'HOLD', code: 'PARSER_INVALID', issues: ['canonical_workspace_envelope_missing_or_invalid'], orphanKeys: snapshot.snapshots.map(item => item.snapshotObjectKey) };
  const manifestHash = hashSnapshotManifest(snapshot.snapshots);
  const persistenceReceiptHash = buildPersistenceReceiptHash({ workerReceiptHash: worker.receiptHash, parserReceiptHash: parser.receiptHash, manifestHash, workspaceAfter: input.parserReceipt.workspaceAfter, targetHash: input.expected.targetHash });
  const now = input.now ?? Date.now();
  try {
    return await input.db.transaction(async tx => {
      const outbox = await tx.queryOne<Record<string, unknown>>('SELECT * FROM nf_precision_cad_commercial_outbox WHERE execution_id = ?', input.receipt.executionId);
      if (!outbox || (outbox.status !== 'VERIFIED_UNKNOWN' && outbox.status !== 'SENT') || Number(outbox.attempt) !== input.receipt.attempt || Number(outbox.lease_generation) !== input.receipt.leaseGeneration) return { ok: false, status: 'HOLD', code: 'OUTBOX_ORDER_INVALID', issues: ['outbox_must_be_worker_verified_unknown'] };
      const callback = await tx.queryOne<Record<string, unknown>>('SELECT receipt_hash, receipt_json, status FROM nf_precision_cad_commercial_callbacks WHERE execution_id = ?', input.receipt.executionId);
      if (!callback || callback.receipt_hash !== worker.receiptHash || callback.status !== 'PASS' || callback.receipt_json !== canonicalCommercialExecution(input.receipt)) return { ok: false, status: 'HOLD', code: 'RECEIPT_INVALID', issues: ['authoritative_worker_callback_missing_or_mismatch'] };
      const journal = parseJournal(await tx.queryOne<Record<string, unknown>>('SELECT receipt_json FROM nf_precision_cad_execution_journal WHERE execution_id = ?', input.receipt.executionId));
      if (!journal || journal.executionId !== input.receipt.executionId || (journal.lifecycle !== 'EXECUTING' && journal.lifecycle !== 'VERIFIED_UNKNOWN')) return { ok: false, status: 'HOLD', code: 'JOURNAL_INVALID', issues: ['journal_not_persistence_ready'] };
      if (journal.workspace.before.workspaceId !== input.expected.workspaceId || journal.workspace.before.revision !== input.expected.workspaceRevision || journal.workspace.before.contentHash !== input.expected.workspaceContentHash) return { ok: false, status: 'HOLD', code: 'JOURNAL_INVALID', issues: ['journal_workspace_binding_mismatch'] };
      const head = await tx.queryOne<{ revision: number; content_hash: string }>('SELECT revision, content_hash FROM nf_cad_workspace_heads WHERE project_id = ?', input.expected.projectId);
      if (!head || Number(head.revision) !== input.expected.workspaceRevision || head.content_hash !== input.expected.workspaceContentHash) return { ok: false, status: 'HOLD', code: 'WORKSPACE_STALE', issues: ['workspace_head_cas_mismatch'] };
      const dbArtifacts = await tx.queryAll<Record<string, unknown>>('SELECT artifact_id, artifact_role, object_key, content_sha256, byte_length FROM nf_precision_cad_commercial_worker_artifacts WHERE execution_id = ?', input.receipt.executionId);
      const suppliedManifest = input.metadata.map(item => `${item.artifactId}|${item.role}|${item.objectKey}|${item.contentSha256}|${item.byteLength}`).sort().join('\n');
      const dbManifest = dbArtifacts.map(item => `${String(item.artifact_id)}|${String(item.artifact_role)}|${String(item.object_key)}|${String(item.content_sha256)}|${Number(item.byte_length)}`).sort().join('\n');
      if (dbManifest !== suppliedManifest || dbArtifacts.length !== input.metadata.length) return { ok: false, status: 'HOLD', code: 'ARTIFACT_INVALID', issues: ['worker_artifact_metadata_transplant'] };
      for (const artifact of snapshot.snapshots) {
        const inserted = await tx.execute('INSERT INTO nf_precision_cad_commercial_artifact_snapshots (execution_id, worker_receipt_hash, artifact_id, artifact_role, source_object_key, snapshot_object_key, content_sha256, byte_length, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (execution_id, artifact_id) DO NOTHING', input.receipt.executionId, worker.receiptHash, artifact.artifactId, artifact.role, artifact.objectKey, artifact.snapshotObjectKey, artifact.contentSha256, artifact.byteLength, now);
        if (inserted.changes !== 1) throw new Error('artifact_snapshot_duplicate');
      }
      await tx.execute('INSERT INTO nf_precision_cad_commercial_native_parser_receipts (execution_id, worker_receipt_hash, parser_receipt_hash, receipt_json, manifest_sha256, model_artifact_id, workspace_envelope_artifact_id, format, kernel_identity, target_hash, workspace_after_revision, workspace_after_content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ', input.receipt.executionId, worker.receiptHash, parser.receiptHash, canonicalCommercialExecution(input.parserReceipt), manifestHash, input.parserReceipt.modelArtifactId, input.parserReceipt.workspaceEnvelopeArtifactId, input.parserReceipt.format, input.parserReceipt.kernelIdentity, input.parserReceipt.targetHash, input.parserReceipt.workspaceAfter.revision, input.parserReceipt.workspaceAfter.contentHash, now);
      await tx.execute('INSERT INTO nf_precision_cad_commercial_persistence_receipts (execution_id, tenant_id, project_id, generation_run_id, worker_receipt_hash, parser_receipt_hash, persistence_receipt_hash, manifest_sha256, workspace_before_revision, workspace_before_content_hash, workspace_after_revision, workspace_after_content_hash, target_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ', input.receipt.executionId, input.expected.tenantId, input.expected.projectId, input.expected.generationRunId, worker.receiptHash, parser.receiptHash, persistenceReceiptHash, manifestHash, input.expected.workspaceRevision, input.expected.workspaceContentHash, input.parserReceipt.workspaceAfter.revision, input.parserReceipt.workspaceAfter.contentHash, input.expected.targetHash, now);
      const revisionInsert = await tx.execute('INSERT INTO nf_cad_workspace_revisions (id, project_id, lineage_id, revision, parent_revision, domain, content_hash, payload_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', `commercial:${input.receipt.executionId}`, input.expected.projectId, workspaceEnvelope.workspace.lineageId, workspaceEnvelope.workspace.revision, input.expected.workspaceRevision, workspaceEnvelope.workspace.domain, workspaceEnvelope.contentHash, JSON.stringify(workspaceEnvelope), `commercial-parser:${input.parserReceipt.parserIdentity}`, now);
      if (revisionInsert.changes !== 1) throw new Error('workspace_revision_insert_failed');
      const headUpdate = await tx.execute('UPDATE nf_cad_workspace_heads SET revision = ?, content_hash = ?, updated_at = ? WHERE project_id = ? AND revision = ? AND content_hash = ?', input.parserReceipt.workspaceAfter.revision, input.parserReceipt.workspaceAfter.contentHash, now, input.expected.projectId, input.expected.workspaceRevision, input.expected.workspaceContentHash);
      if (headUpdate.changes !== 1) throw new Error('workspace_head_cas_failed');
      await tx.execute('INSERT INTO nf_precision_cad_commercial_workspace_commits (execution_id, project_id, workspace_id, before_revision, before_content_hash, after_revision, after_content_hash, target_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ', input.receipt.executionId, input.expected.projectId, input.expected.workspaceId, input.expected.workspaceRevision, input.expected.workspaceContentHash, input.parserReceipt.workspaceAfter.revision, input.parserReceipt.workspaceAfter.contentHash, input.expected.targetHash, now);
      const artifacts = snapshot.snapshots.map(item => ({ artifactId: item.artifactId, sha256: item.contentSha256, kind: item.role, objectKey: item.snapshotObjectKey }));
      const committedReceipt = appendJournalEvent({ ...journal, lifecycle: 'COMMITTED', workspace: { ...journal.workspace, after: input.parserReceipt.workspaceAfter }, artifacts, persistenceReceiptHash, verificationReceiptHash: parser.receiptHash }, 'COMMITTED', new Date(now).toISOString(), { workerReceiptHash: worker.receiptHash, parserReceiptHash: parser.receiptHash, persistenceReceiptHash });
      const journalUpdate = await tx.execute('UPDATE nf_precision_cad_execution_journal SET lifecycle = ?, version = ?, receipt_json = ?, receipt_hash = ?, persistence_receipt_hash = ?, verification_receipt_hash = ?, lease_owner_id = NULL, lease_expires_at = NULL, updated_at = ? WHERE execution_id = ? AND lifecycle IN (?, ?) AND version = ?', 'COMMITTED', committedReceipt.version, canonicalCommercialExecution(committedReceipt), hashReceipt(committedReceipt), persistenceReceiptHash, parser.receiptHash, now, input.receipt.executionId, 'EXECUTING', 'VERIFIED_UNKNOWN', journal.version);
      if (journalUpdate.changes !== 1) throw new Error('journal_commit_cas_failed');
      await tx.execute('INSERT INTO nf_precision_cad_execution_events (execution_id, sequence, event_type, event_at, data_json, previous_hash, event_hash) VALUES (?, ?, ?, ?, ?, ?, ?)', committedReceipt.executionId, committedReceipt.events.at(-1)!.sequence, 'COMMITTED', committedReceipt.events.at(-1)!.at, canonicalCommercialExecution(committedReceipt.events.at(-1)!.data), committedReceipt.events.at(-1)!.previousHash, committedReceipt.events.at(-1)!.hash);
      const done = await tx.execute('UPDATE nf_precision_cad_commercial_outbox SET status = ?, last_error = NULL, updated_at = ? WHERE execution_id = ? AND status IN (?, ?) AND attempt = ? AND lease_generation = ?', 'DONE', now, input.receipt.executionId, 'VERIFIED_UNKNOWN', 'SENT', input.receipt.attempt, input.receipt.leaseGeneration);
      if (done.changes !== 1) throw new Error('outbox_done_cas_failed');
      const existingWorkerReceipt = await tx.queryOne<Record<string, unknown>>('SELECT worker_receipt_hash, receipt_json FROM nf_precision_cad_worker_receipts WHERE execution_id = ?', input.receipt.executionId);
      const workerReceiptUpdate = existingWorkerReceipt
        ? existingWorkerReceipt.worker_receipt_hash === worker.receiptHash && existingWorkerReceipt.receipt_json === canonicalCommercialExecution(input.receipt)
          ? await tx.execute('UPDATE nf_precision_cad_worker_receipts SET persistence_receipt_hash = ?, verification_receipt_hash = ?, worker_status = ? WHERE execution_id = ? AND worker_receipt_hash = ? AND receipt_json = ?', persistenceReceiptHash, parser.receiptHash, 'COMMITTED', input.receipt.executionId, worker.receiptHash, canonicalCommercialExecution(input.receipt))
          : { changes: 0 }
        : await tx.execute('INSERT INTO nf_precision_cad_worker_receipts (execution_id, worker_receipt_hash, persistence_receipt_hash, verification_receipt_hash, worker_status, receipt_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', input.receipt.executionId, worker.receiptHash, persistenceReceiptHash, parser.receiptHash, 'COMMITTED', canonicalCommercialExecution(input.receipt), now);
      if (workerReceiptUpdate.changes !== 1) throw new Error('worker_receipt_persistence_conflict');
      return { ok: true, status: 'COMMITTED', executionId: input.receipt.executionId, workerReceiptHash: worker.receiptHash, persistenceReceiptHash, snapshots: snapshot.snapshots } as PersistenceOutcome;
    });
  } catch (error) {
    return { ok: false, status: 'HOLD', code: 'PERSISTENCE_CONFLICT', issues: [error instanceof Error ? error.message : 'persistence_transaction_failed'], orphanKeys: snapshot.snapshots.map(item => item.snapshotObjectKey) };
  }
}
