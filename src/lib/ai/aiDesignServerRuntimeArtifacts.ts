import 'server-only';

import { getDbAdapter, type DbAdapter } from '@/lib/db-adapter';
import type { AiDesignServerEvidenceReceiptV1 } from './aiDesignServerEvidenceReceipt';
import type { AiDesignGeneratedStageArtifactSink, AiDesignGeneratedStageArtifactV1 } from './aiDesignServerGenerationWorker';
import type { AiDesignMultiCriticBundleV1 } from './aiDesignMultiCriticEvaluation';
import { validateAiDesignIntentResolutionArtifact, type AiDesignIntentResolutionArtifactV1 } from './aiDesignIntentResolution';
import {
  AiDesignCrossDomainSidecarArtifactV1,
  AiDesignProductStructureSidecarArtifactV1,
  validateAiDesignCrossDomainSidecarArtifact,
  validateAiDesignProductStructureSidecarArtifact,
} from './aiDesignComplexSidecarArtifact';
import {
  AiDesignPrecisionVerificationReceiptV1,
  AiDesignPrecisionVerificationRequestV1,
  validateAiDesignPrecisionVerificationRequest,
} from './aiDesignPrecisionVerification';
import { validateAiDesignGraphPartition, type AiDesignGraphPartitionV1 } from './aiDesignHierarchicalCandidatePartition';
import {
  validateAiDesignConstraintBindingsArtifact,
  validateAiDesignGaugeBindingsArtifact,
  type AiDesignConstraintBindingsArtifactV1,
  type AiDesignGaugeBindingsArtifactV1,
} from './aiDesignComplexProjectionBindings';
import { serverEvidenceSha256 } from './serverEvidence';
import {
  InMemoryAiDesignCandidateArtifactStore,
  validateAiDesignCandidateArtifact,
  type AiDesignCandidateArtifactV1,
  type AiDesignArtifactOwnershipScope,
} from './aiDesignCandidateArtifact';
import { assertAiDesignPostgresAuthority } from './aiDesignPostgresAuthority';
import { aiDesignDurablePersistenceEnabled } from './aiDesignDeploymentMode';

const MAX_ITEM_BYTES = 1024 * 1024;
const MAX_COMPLEX_ITEM_BYTES = 8 * 1024 * 1024;

export interface AiDesignServerEvidenceReceiptSink {
  putImmutable(receipt: AiDesignServerEvidenceReceiptV1): Promise<void>;
}

type Awaitable<T> = T | Promise<T>;

function clone<T>(value: T): T { return structuredClone(value); }
function boundedDigest(value: unknown, maxBytes = MAX_ITEM_BYTES): string {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, 'utf8') > maxBytes) throw new Error('AI_DESIGN_SERVER_ARTIFACT_TOO_LARGE');
  return serverEvidenceSha256(value);
}

export function aiDesignGraphPartitionStorageId(partition: Pick<AiDesignGraphPartitionV1, 'artifactId' | 'partitionId'>): string {
  return `graph-partition:${serverEvidenceSha256({ artifactId: partition.artifactId, partitionId: partition.partitionId }).slice(0, 48)}`;
}

export interface AiDesignComplexArtifactRepository {
  putProductStructureSidecarImmutable(artifact: AiDesignProductStructureSidecarArtifactV1): Promise<void>;
  getProductStructureSidecar(artifactId: string): Awaitable<AiDesignProductStructureSidecarArtifactV1 | null>;
  putCrossDomainSidecarImmutable(artifact: AiDesignCrossDomainSidecarArtifactV1): Promise<void>;
  getCrossDomainSidecar(artifactId: string): Awaitable<AiDesignCrossDomainSidecarArtifactV1 | null>;
  putGraphPartitionImmutable(partition: AiDesignGraphPartitionV1): Promise<void>;
  getGraphPartition(partitionId: string): Awaitable<AiDesignGraphPartitionV1 | null>;
  putGaugeBindingsImmutable(artifact: AiDesignGaugeBindingsArtifactV1): Promise<void>;
  getGaugeBindings(artifactId: string): Awaitable<AiDesignGaugeBindingsArtifactV1 | null>;
  putConstraintBindingsImmutable(artifact: AiDesignConstraintBindingsArtifactV1): Promise<void>;
  getConstraintBindings(artifactId: string): Awaitable<AiDesignConstraintBindingsArtifactV1 | null>;
  putIntentResolutionImmutable(artifact: AiDesignIntentResolutionArtifactV1): Promise<void>;
  getIntentResolution(artifactId: string): Awaitable<AiDesignIntentResolutionArtifactV1 | null>;
  putPrecisionRequestImmutable(request: AiDesignPrecisionVerificationRequestV1): Promise<void>;
  getPrecisionRequest(requestId: string): Awaitable<AiDesignPrecisionVerificationRequestV1 | null>;
  putPrecisionReceiptImmutable(receipt: AiDesignPrecisionVerificationReceiptV1): Promise<void>;
  getPrecisionReceipt(receiptId: string): Awaitable<AiDesignPrecisionVerificationReceiptV1 | null>;
  listCandidateArtifacts(scope: AiDesignArtifactOwnershipScope): Awaitable<readonly AiDesignCandidateArtifactV1[]>;
  putCriticBundleImmutable(bundle: AiDesignMultiCriticBundleV1): Promise<void>;
  getCriticBundle(bundleId: string): Awaitable<AiDesignMultiCriticBundleV1 | null>;
}

/** Non-commercial single-process reference repository used by tests and local development. */
export class InMemoryAiDesignServerRuntimeArtifacts implements AiDesignGeneratedStageArtifactSink, AiDesignServerEvidenceReceiptSink {
  private readonly stageArtifacts = new Map<string, { digest: string; value: AiDesignGeneratedStageArtifactV1 }>();
  private readonly receipts = new Map<string, { digest: string; value: AiDesignServerEvidenceReceiptV1 }>();
  private readonly candidateArtifacts = new InMemoryAiDesignCandidateArtifactStore();
  private readonly criticBundles = new Map<string, { digest: string; value: AiDesignMultiCriticBundleV1 }>();
  private readonly productStructures = new Map<string, { digest: string; value: AiDesignProductStructureSidecarArtifactV1 }>();
  private readonly crossDomainGraphs = new Map<string, { digest: string; value: AiDesignCrossDomainSidecarArtifactV1 }>();
  private readonly graphPartitions = new Map<string, { digest: string; value: AiDesignGraphPartitionV1 }>();
  private readonly gaugeBindings = new Map<string, { digest: string; value: AiDesignGaugeBindingsArtifactV1 }>();
  private readonly constraintBindings = new Map<string, { digest: string; value: AiDesignConstraintBindingsArtifactV1 }>();
  private readonly resolutions = new Map<string, { digest: string; value: AiDesignIntentResolutionArtifactV1 }>();
  private readonly precisionRequests = new Map<string, { digest: string; value: AiDesignPrecisionVerificationRequestV1 }>();
  private readonly precisionReceipts = new Map<string, { digest: string; value: AiDesignPrecisionVerificationReceiptV1 }>();

  async putImmutable(artifactOrReceipt: AiDesignGeneratedStageArtifactV1 | AiDesignServerEvidenceReceiptV1): Promise<void> {
    if (artifactOrReceipt.schema === 'nexyfab.ai-design-generated-stage-artifact.v1') {
      const digest = boundedDigest(artifactOrReceipt);
      const prior = this.stageArtifacts.get(artifactOrReceipt.artifactId);
      if (prior && prior.digest !== digest) throw new Error('AI_DESIGN_STAGE_ARTIFACT_OVERWRITE_FORBIDDEN');
      if (!prior) this.stageArtifacts.set(artifactOrReceipt.artifactId, { digest, value: clone(artifactOrReceipt) });
      return;
    }
    const digest = boundedDigest(artifactOrReceipt);
    const prior = this.receipts.get(artifactOrReceipt.receiptId);
    if (prior && prior.digest !== digest) throw new Error('AI_DESIGN_EVIDENCE_OVERWRITE_FORBIDDEN');
    if (!prior) this.receipts.set(artifactOrReceipt.receiptId, { digest, value: clone(artifactOrReceipt) });
  }

  getStageArtifact(artifactId: string): AiDesignGeneratedStageArtifactV1 | null { return clone(this.stageArtifacts.get(artifactId)?.value ?? null); }
  getStageArtifactByOutputDigest(outputDigest: string): AiDesignGeneratedStageArtifactV1 | null {
    const match = [...this.stageArtifacts.values()].find(item => item.value.outputDigest === outputDigest);
    return clone(match?.value ?? null);
  }
  getReceipt(receiptId: string): AiDesignServerEvidenceReceiptV1 | null { return clone(this.receipts.get(receiptId)?.value ?? null); }
  async putCandidateArtifactImmutable(artifact: AiDesignCandidateArtifactV1): Promise<void> {
    const prior = this.candidateArtifacts.get(artifact.artifactId);
    if (prior?.manifestDigest === artifact.manifestDigest) return;
    const result = this.candidateArtifacts.append(artifact);
    if (!result.ok) throw new Error(`AI_DESIGN_CANDIDATE_ARTIFACT_STORE_FAILED:${result.issues.join(',')}`);
  }
  listCandidateArtifacts(scope: AiDesignArtifactOwnershipScope): readonly AiDesignCandidateArtifactV1[] { return this.candidateArtifacts.list(scope); }
  async putCriticBundleImmutable(bundle: AiDesignMultiCriticBundleV1): Promise<void> {
    const digest = boundedDigest(bundle);
    const prior = this.criticBundles.get(bundle.bundleId);
    if (prior && prior.digest !== digest) throw new Error('AI_DESIGN_CRITIC_BUNDLE_OVERWRITE_FORBIDDEN');
    if (!prior) this.criticBundles.set(bundle.bundleId, { digest, value: clone(bundle) });
  }
  getCriticBundle(bundleId: string): AiDesignMultiCriticBundleV1 | null { return clone(this.criticBundles.get(bundleId)?.value ?? null); }
  listCriticBundles(scope: AiDesignArtifactOwnershipScope): readonly AiDesignMultiCriticBundleV1[] { return [...this.criticBundles.values()].map(item => item.value).filter(item => item.projectId === scope.projectId && item.sessionId === scope.sessionId).map(clone); }
  async putProductStructureSidecarImmutable(artifact: AiDesignProductStructureSidecarArtifactV1): Promise<void> {
    const issues = validateAiDesignProductStructureSidecarArtifact(artifact);
    if (issues.length) throw new Error(`AI_DESIGN_PRODUCT_STRUCTURE_SIDECAR_INVALID:${issues.join(',')}`);
    this.putComplexImmutable(this.productStructures, artifact.artifactId, artifact, 'AI_DESIGN_PRODUCT_STRUCTURE_SIDECAR_OVERWRITE_FORBIDDEN');
  }
  getProductStructureSidecar(artifactId: string): AiDesignProductStructureSidecarArtifactV1 | null { return clone(this.productStructures.get(artifactId)?.value ?? null); }
  async putCrossDomainSidecarImmutable(artifact: AiDesignCrossDomainSidecarArtifactV1): Promise<void> {
    const issues = validateAiDesignCrossDomainSidecarArtifact(artifact);
    if (issues.length) throw new Error(`AI_DESIGN_CROSS_DOMAIN_SIDECAR_INVALID:${issues.join(',')}`);
    this.putComplexImmutable(this.crossDomainGraphs, artifact.artifactId, artifact, 'AI_DESIGN_CROSS_DOMAIN_SIDECAR_OVERWRITE_FORBIDDEN');
  }
  getCrossDomainSidecar(artifactId: string): AiDesignCrossDomainSidecarArtifactV1 | null { return clone(this.crossDomainGraphs.get(artifactId)?.value ?? null); }
  async putGraphPartitionImmutable(partition: AiDesignGraphPartitionV1): Promise<void> {
    const issues = validateAiDesignGraphPartition(partition);
    if (issues.length) throw new Error(`AI_DESIGN_GRAPH_PARTITION_INVALID:${issues.join(',')}`);
    this.putComplexImmutable(this.graphPartitions, aiDesignGraphPartitionStorageId(partition), partition, 'AI_DESIGN_GRAPH_PARTITION_OVERWRITE_FORBIDDEN');
  }
  getGraphPartition(partitionId: string): AiDesignGraphPartitionV1 | null { return clone(this.graphPartitions.get(partitionId)?.value ?? null); }
  async putGaugeBindingsImmutable(artifact: AiDesignGaugeBindingsArtifactV1): Promise<void> {
    const issues = validateAiDesignGaugeBindingsArtifact(artifact);
    if (issues.length) throw new Error(`AI_DESIGN_GAUGE_BINDINGS_INVALID:${issues.join(',')}`);
    this.putComplexImmutable(this.gaugeBindings, artifact.artifactId, artifact, 'AI_DESIGN_GAUGE_BINDINGS_OVERWRITE_FORBIDDEN');
  }
  getGaugeBindings(artifactId: string): AiDesignGaugeBindingsArtifactV1 | null { return clone(this.gaugeBindings.get(artifactId)?.value ?? null); }
  async putConstraintBindingsImmutable(artifact: AiDesignConstraintBindingsArtifactV1): Promise<void> {
    const issues = validateAiDesignConstraintBindingsArtifact(artifact);
    if (issues.length) throw new Error(`AI_DESIGN_CONSTRAINT_BINDINGS_INVALID:${issues.join(',')}`);
    this.putComplexImmutable(this.constraintBindings, artifact.artifactId, artifact, 'AI_DESIGN_CONSTRAINT_BINDINGS_OVERWRITE_FORBIDDEN');
  }
  getConstraintBindings(artifactId: string): AiDesignConstraintBindingsArtifactV1 | null { return clone(this.constraintBindings.get(artifactId)?.value ?? null); }
  async putIntentResolutionImmutable(artifact: AiDesignIntentResolutionArtifactV1): Promise<void> {
    const issues = validateAiDesignIntentResolutionArtifact(artifact);
    if (issues.length) throw new Error(`AI_DESIGN_INTENT_RESOLUTION_INVALID:${issues.join(',')}`);
    this.putComplexImmutable(this.resolutions, artifact.artifactId, artifact, 'AI_DESIGN_INTENT_RESOLUTION_OVERWRITE_FORBIDDEN');
  }
  getIntentResolution(artifactId: string): AiDesignIntentResolutionArtifactV1 | null { return clone(this.resolutions.get(artifactId)?.value ?? null); }
  async putPrecisionRequestImmutable(request: AiDesignPrecisionVerificationRequestV1): Promise<void> {
    const issues = validateAiDesignPrecisionVerificationRequest(request);
    if (issues.length) throw new Error(`AI_DESIGN_PRECISION_REQUEST_INVALID:${issues.join(',')}`);
    this.putComplexImmutable(this.precisionRequests, request.requestId, request, 'AI_DESIGN_PRECISION_REQUEST_OVERWRITE_FORBIDDEN');
  }
  getPrecisionRequest(requestId: string): AiDesignPrecisionVerificationRequestV1 | null { return clone(this.precisionRequests.get(requestId)?.value ?? null); }
  async putPrecisionReceiptImmutable(receipt: AiDesignPrecisionVerificationReceiptV1): Promise<void> {
    this.putComplexImmutable(this.precisionReceipts, receipt.receiptId, receipt, 'AI_DESIGN_PRECISION_RECEIPT_OVERWRITE_FORBIDDEN');
  }
  getPrecisionReceipt(receiptId: string): AiDesignPrecisionVerificationReceiptV1 | null { return clone(this.precisionReceipts.get(receiptId)?.value ?? null); }
  private putComplexImmutable<T>(store: Map<string, { digest: string; value: T }>, id: string, value: T, errorCode: string): void {
    const digest = boundedDigest(value, MAX_COMPLEX_ITEM_BYTES);
    const prior = store.get(id);
    if (prior && prior.digest !== digest) throw new Error(errorCode);
    if (!prior) store.set(id, { digest, value: clone(value) });
  }
  reset(): void {
    this.stageArtifacts.clear(); this.receipts.clear(); this.candidateArtifacts.reset(); this.criticBundles.clear();
    this.productStructures.clear(); this.crossDomainGraphs.clear(); this.graphPartitions.clear(); this.gaugeBindings.clear(); this.constraintBindings.clear(); this.resolutions.clear(); this.precisionRequests.clear(); this.precisionReceipts.clear();
  }
}

type AiDesignArtifactKind =
  | 'stage' | 'evidence_receipt' | 'candidate' | 'critic_bundle'
  | 'product_structure' | 'cross_domain_graph' | 'graph_partition'
  | 'gauge_bindings' | 'constraint_bindings' | 'intent_resolution'
  | 'precision_request' | 'precision_receipt';

type ArtifactRow = {
  artifact_id: string;
  project_id: string;
  session_id: string;
  artifact_kind: AiDesignArtifactKind;
  content_sha256: string;
  value_json: string;
  byte_length: number;
  created_at: number;
};

type RuntimeArtifactStore = AiDesignComplexArtifactRepository & AiDesignGeneratedStageArtifactSink & AiDesignServerEvidenceReceiptSink & {
  getStageArtifact(artifactId: string): Awaitable<AiDesignGeneratedStageArtifactV1 | null>;
  getStageArtifactByOutputDigest(outputDigest: string): Awaitable<AiDesignGeneratedStageArtifactV1 | null>;
  getReceipt(receiptId: string): Awaitable<AiDesignServerEvidenceReceiptV1 | null>;
  putCandidateArtifactImmutable(artifact: AiDesignCandidateArtifactV1): Promise<void>;
  reset(): void;
};

/** Immutable PostgreSQL artifact journal for commercial multi-instance runs. */
export class PostgresAiDesignServerRuntimeArtifacts implements RuntimeArtifactStore {
  constructor(private readonly db: DbAdapter = getDbAdapter()) {}

  private async ready(): Promise<void> { await assertAiDesignPostgresAuthority(this.db); }

  private async put<T>(input: {
    id: string; projectId: string; sessionId: string; kind: AiDesignArtifactKind;
    value: T; createdAt?: string; overwriteCode: string;
  }): Promise<void> {
    await this.ready();
    const valueJson = JSON.stringify(input.value);
    const byteLength = Buffer.byteLength(valueJson, 'utf8');
    const contentSha256 = boundedDigest(input.value, MAX_COMPLEX_ITEM_BYTES);
    const existing = await this.db.queryOne<ArtifactRow>(
      `SELECT artifact_id, project_id, session_id, artifact_kind, content_sha256, value_json, byte_length, created_at
       FROM nf_ai_design_artifacts WHERE artifact_id = ?`, input.id,
    );
    if (existing) {
      if (existing.project_id === input.projectId && existing.session_id === input.sessionId
        && existing.artifact_kind === input.kind && existing.content_sha256 === contentSha256
        && existing.byte_length === byteLength) return;
      throw new Error(input.overwriteCode);
    }
    try {
      await this.db.execute(
        `INSERT INTO nf_ai_design_artifacts
         (artifact_id, project_id, session_id, artifact_kind, content_sha256, value_json, byte_length, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        input.id, input.projectId, input.sessionId, input.kind, contentSha256,
        valueJson, byteLength, Date.parse(input.createdAt ?? '') || Date.now(),
      );
    } catch {
      const raced = await this.db.queryOne<ArtifactRow>(
        `SELECT artifact_id, project_id, session_id, artifact_kind, content_sha256, value_json, byte_length, created_at
         FROM nf_ai_design_artifacts WHERE artifact_id = ?`, input.id,
      );
      if (raced?.project_id === input.projectId && raced.session_id === input.sessionId
        && raced.artifact_kind === input.kind && raced.content_sha256 === contentSha256
        && raced.byte_length === byteLength) return;
      throw new Error(input.overwriteCode);
    }
  }

  private async get<T>(id: string, kind: AiDesignArtifactKind): Promise<T | null> {
    await this.ready();
    const row = await this.db.queryOne<ArtifactRow>(
      `SELECT artifact_id, project_id, session_id, artifact_kind, content_sha256, value_json, byte_length, created_at
       FROM nf_ai_design_artifacts WHERE artifact_id = ? AND artifact_kind = ?`, id, kind,
    );
    if (!row || Buffer.byteLength(row.value_json, 'utf8') !== Number(row.byte_length)) return null;
    let value: T;
    try { value = JSON.parse(row.value_json) as T; } catch { return null; }
    if (boundedDigest(value, MAX_COMPLEX_ITEM_BYTES) !== row.content_sha256) return null;
    return clone(value);
  }

  async putImmutable(value: AiDesignGeneratedStageArtifactV1 | AiDesignServerEvidenceReceiptV1): Promise<void> {
    if (value.schema === 'nexyfab.ai-design-generated-stage-artifact.v1') {
      await this.put({ id: value.artifactId, projectId: value.projectId, sessionId: `generation:${value.runId}`, kind: 'stage', value, createdAt: value.createdAt, overwriteCode: 'AI_DESIGN_STAGE_ARTIFACT_OVERWRITE_FORBIDDEN' });
      return;
    }
    await this.put({ id: value.receiptId, projectId: value.projectId, sessionId: value.sessionId, kind: 'evidence_receipt', value, createdAt: value.issuedAt, overwriteCode: 'AI_DESIGN_EVIDENCE_OVERWRITE_FORBIDDEN' });
  }

  getStageArtifact(artifactId: string) { return this.get<AiDesignGeneratedStageArtifactV1>(artifactId, 'stage'); }
  async getStageArtifactByOutputDigest(outputDigest: string) {
    const value = await this.get<AiDesignGeneratedStageArtifactV1>(`ai-stage:${outputDigest.slice(0, 48)}`, 'stage');
    return value?.outputDigest === outputDigest ? value : null;
  }
  getReceipt(receiptId: string) { return this.get<AiDesignServerEvidenceReceiptV1>(receiptId, 'evidence_receipt'); }

  async putCandidateArtifactImmutable(artifact: AiDesignCandidateArtifactV1): Promise<void> {
    const issues = validateAiDesignCandidateArtifact(artifact);
    if (issues.length) throw new Error(`AI_DESIGN_CANDIDATE_ARTIFACT_STORE_FAILED:${issues.join(',')}`);
    await this.put({ id: artifact.artifactId, projectId: artifact.projectId, sessionId: artifact.sessionId, kind: 'candidate', value: artifact, createdAt: artifact.createdAt, overwriteCode: 'AI_DESIGN_CANDIDATE_ARTIFACT_OVERWRITE_FORBIDDEN' });
  }
  async listCandidateArtifacts(scope: AiDesignArtifactOwnershipScope): Promise<readonly AiDesignCandidateArtifactV1[]> {
    await this.ready();
    const rows = await this.db.queryAll<ArtifactRow>(
      `SELECT artifact_id, project_id, session_id, artifact_kind, content_sha256, value_json, byte_length, created_at
       FROM nf_ai_design_artifacts
       WHERE project_id = ? AND session_id = ? AND artifact_kind = ? ORDER BY created_at, artifact_id`,
      scope.projectId, scope.sessionId, 'candidate',
    );
    const values: AiDesignCandidateArtifactV1[] = [];
    for (const row of rows) {
      let value: AiDesignCandidateArtifactV1;
      try { value = JSON.parse(row.value_json) as AiDesignCandidateArtifactV1; } catch { continue; }
      if (Buffer.byteLength(row.value_json, 'utf8') === Number(row.byte_length)
        && boundedDigest(value, MAX_COMPLEX_ITEM_BYTES) === row.content_sha256
        && validateAiDesignCandidateArtifact(value).length === 0) values.push(clone(value));
    }
    return values;
  }

  putCriticBundleImmutable(value: AiDesignMultiCriticBundleV1) { return this.put({ id: value.bundleId, projectId: value.projectId, sessionId: value.sessionId, kind: 'critic_bundle', value, overwriteCode: 'AI_DESIGN_CRITIC_BUNDLE_OVERWRITE_FORBIDDEN' }); }
  getCriticBundle(id: string) { return this.get<AiDesignMultiCriticBundleV1>(id, 'critic_bundle'); }
  async putProductStructureSidecarImmutable(value: AiDesignProductStructureSidecarArtifactV1) { const issues = validateAiDesignProductStructureSidecarArtifact(value); if (issues.length) throw new Error(`AI_DESIGN_PRODUCT_STRUCTURE_SIDECAR_INVALID:${issues.join(',')}`); await this.put({ id: value.artifactId, projectId: value.projectId, sessionId: value.sessionId, kind: 'product_structure', value, createdAt: value.createdAt, overwriteCode: 'AI_DESIGN_PRODUCT_STRUCTURE_SIDECAR_OVERWRITE_FORBIDDEN' }); }
  getProductStructureSidecar(id: string) { return this.get<AiDesignProductStructureSidecarArtifactV1>(id, 'product_structure'); }
  async putCrossDomainSidecarImmutable(value: AiDesignCrossDomainSidecarArtifactV1) { const issues = validateAiDesignCrossDomainSidecarArtifact(value); if (issues.length) throw new Error(`AI_DESIGN_CROSS_DOMAIN_SIDECAR_INVALID:${issues.join(',')}`); await this.put({ id: value.artifactId, projectId: value.projectId, sessionId: value.sessionId, kind: 'cross_domain_graph', value, createdAt: value.createdAt, overwriteCode: 'AI_DESIGN_CROSS_DOMAIN_SIDECAR_OVERWRITE_FORBIDDEN' }); }
  getCrossDomainSidecar(id: string) { return this.get<AiDesignCrossDomainSidecarArtifactV1>(id, 'cross_domain_graph'); }
  async putGraphPartitionImmutable(value: AiDesignGraphPartitionV1) {
    const issues = validateAiDesignGraphPartition(value); if (issues.length) throw new Error(`AI_DESIGN_GRAPH_PARTITION_INVALID:${issues.join(',')}`);
    await this.ready();
    const parent = await this.db.queryOne<Pick<ArtifactRow, 'project_id' | 'session_id'>>('SELECT project_id, session_id FROM nf_ai_design_artifacts WHERE artifact_id = ? AND artifact_kind = ?', value.artifactId, 'product_structure');
    if (!parent) throw new Error('AI_DESIGN_GRAPH_PARTITION_PARENT_REQUIRED');
    await this.put({ id: aiDesignGraphPartitionStorageId(value), projectId: parent.project_id, sessionId: parent.session_id, kind: 'graph_partition', value, overwriteCode: 'AI_DESIGN_GRAPH_PARTITION_OVERWRITE_FORBIDDEN' });
  }
  getGraphPartition(id: string) { return this.get<AiDesignGraphPartitionV1>(id, 'graph_partition'); }
  async putGaugeBindingsImmutable(value: AiDesignGaugeBindingsArtifactV1) { const issues = validateAiDesignGaugeBindingsArtifact(value); if (issues.length) throw new Error(`AI_DESIGN_GAUGE_BINDINGS_INVALID:${issues.join(',')}`); await this.put({ id: value.artifactId, projectId: value.projectId, sessionId: value.sessionId, kind: 'gauge_bindings', value, createdAt: value.createdAt, overwriteCode: 'AI_DESIGN_GAUGE_BINDINGS_OVERWRITE_FORBIDDEN' }); }
  getGaugeBindings(id: string) { return this.get<AiDesignGaugeBindingsArtifactV1>(id, 'gauge_bindings'); }
  async putConstraintBindingsImmutable(value: AiDesignConstraintBindingsArtifactV1) { const issues = validateAiDesignConstraintBindingsArtifact(value); if (issues.length) throw new Error(`AI_DESIGN_CONSTRAINT_BINDINGS_INVALID:${issues.join(',')}`); await this.put({ id: value.artifactId, projectId: value.projectId, sessionId: value.sessionId, kind: 'constraint_bindings', value, createdAt: value.createdAt, overwriteCode: 'AI_DESIGN_CONSTRAINT_BINDINGS_OVERWRITE_FORBIDDEN' }); }
  getConstraintBindings(id: string) { return this.get<AiDesignConstraintBindingsArtifactV1>(id, 'constraint_bindings'); }
  async putIntentResolutionImmutable(value: AiDesignIntentResolutionArtifactV1) { const issues = validateAiDesignIntentResolutionArtifact(value); if (issues.length) throw new Error(`AI_DESIGN_INTENT_RESOLUTION_INVALID:${issues.join(',')}`); await this.put({ id: value.artifactId, projectId: value.projectId, sessionId: value.sessionId, kind: 'intent_resolution', value, createdAt: value.createdAt, overwriteCode: 'AI_DESIGN_INTENT_RESOLUTION_OVERWRITE_FORBIDDEN' }); }
  getIntentResolution(id: string) { return this.get<AiDesignIntentResolutionArtifactV1>(id, 'intent_resolution'); }
  async putPrecisionRequestImmutable(value: AiDesignPrecisionVerificationRequestV1) { const issues = validateAiDesignPrecisionVerificationRequest(value); if (issues.length) throw new Error(`AI_DESIGN_PRECISION_REQUEST_INVALID:${issues.join(',')}`); await this.put({ id: value.requestId, projectId: value.projectId, sessionId: value.sessionId, kind: 'precision_request', value, createdAt: value.requestedAt, overwriteCode: 'AI_DESIGN_PRECISION_REQUEST_OVERWRITE_FORBIDDEN' }); }
  getPrecisionRequest(id: string) { return this.get<AiDesignPrecisionVerificationRequestV1>(id, 'precision_request'); }
  putPrecisionReceiptImmutable(value: AiDesignPrecisionVerificationReceiptV1) { return this.put({ id: value.receiptId, projectId: value.projectId, sessionId: value.sessionId, kind: 'precision_receipt', value, createdAt: value.issuedAt, overwriteCode: 'AI_DESIGN_PRECISION_RECEIPT_OVERWRITE_FORBIDDEN' }); }
  getPrecisionReceipt(id: string) { return this.get<AiDesignPrecisionVerificationReceiptV1>(id, 'precision_receipt'); }
  reset(): void { /* PostgreSQL owns all state; there is no process-local cache. */ }
}

class AiDesignServerRuntimeArtifactRouter implements RuntimeArtifactStore {
  private readonly reference = new InMemoryAiDesignServerRuntimeArtifacts();
  private commercial: PostgresAiDesignServerRuntimeArtifacts | null = null;
  private selected(): RuntimeArtifactStore {
    if (!aiDesignDurablePersistenceEnabled()) return this.reference;
    this.commercial ??= new PostgresAiDesignServerRuntimeArtifacts();
    return this.commercial;
  }
  putImmutable(value: AiDesignGeneratedStageArtifactV1 | AiDesignServerEvidenceReceiptV1) {
    return value.schema === 'nexyfab.ai-design-generated-stage-artifact.v1'
      ? this.selected().putImmutable(value)
      : this.selected().putImmutable(value);
  }
  getStageArtifact(id: string) { return this.selected().getStageArtifact(id); }
  getStageArtifactByOutputDigest(digest: string) { return this.selected().getStageArtifactByOutputDigest(digest); }
  getReceipt(id: string) { return this.selected().getReceipt(id); }
  putCandidateArtifactImmutable(value: AiDesignCandidateArtifactV1) { return this.selected().putCandidateArtifactImmutable(value); }
  listCandidateArtifacts(scope: AiDesignArtifactOwnershipScope) { return this.selected().listCandidateArtifacts(scope); }
  putCriticBundleImmutable(value: AiDesignMultiCriticBundleV1) { return this.selected().putCriticBundleImmutable(value); }
  getCriticBundle(id: string) { return this.selected().getCriticBundle(id); }
  putProductStructureSidecarImmutable(value: AiDesignProductStructureSidecarArtifactV1) { return this.selected().putProductStructureSidecarImmutable(value); }
  getProductStructureSidecar(id: string) { return this.selected().getProductStructureSidecar(id); }
  putCrossDomainSidecarImmutable(value: AiDesignCrossDomainSidecarArtifactV1) { return this.selected().putCrossDomainSidecarImmutable(value); }
  getCrossDomainSidecar(id: string) { return this.selected().getCrossDomainSidecar(id); }
  putGraphPartitionImmutable(value: AiDesignGraphPartitionV1) { return this.selected().putGraphPartitionImmutable(value); }
  getGraphPartition(id: string) { return this.selected().getGraphPartition(id); }
  putGaugeBindingsImmutable(value: AiDesignGaugeBindingsArtifactV1) { return this.selected().putGaugeBindingsImmutable(value); }
  getGaugeBindings(id: string) { return this.selected().getGaugeBindings(id); }
  putConstraintBindingsImmutable(value: AiDesignConstraintBindingsArtifactV1) { return this.selected().putConstraintBindingsImmutable(value); }
  getConstraintBindings(id: string) { return this.selected().getConstraintBindings(id); }
  putIntentResolutionImmutable(value: AiDesignIntentResolutionArtifactV1) { return this.selected().putIntentResolutionImmutable(value); }
  getIntentResolution(id: string) { return this.selected().getIntentResolution(id); }
  putPrecisionRequestImmutable(value: AiDesignPrecisionVerificationRequestV1) { return this.selected().putPrecisionRequestImmutable(value); }
  getPrecisionRequest(id: string) { return this.selected().getPrecisionRequest(id); }
  putPrecisionReceiptImmutable(value: AiDesignPrecisionVerificationReceiptV1) { return this.selected().putPrecisionReceiptImmutable(value); }
  getPrecisionReceipt(id: string) { return this.selected().getPrecisionReceipt(id); }
  reset(): void { this.reference.reset(); this.commercial = null; }
}

export const aiDesignServerRuntimeArtifacts = new AiDesignServerRuntimeArtifactRouter();
