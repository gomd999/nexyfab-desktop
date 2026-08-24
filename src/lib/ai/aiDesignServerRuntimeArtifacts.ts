import 'server-only';

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
  type AiDesignCandidateArtifactV1,
  type AiDesignArtifactOwnershipScope,
} from './aiDesignCandidateArtifact';

const MAX_ITEM_BYTES = 1024 * 1024;
const MAX_COMPLEX_ITEM_BYTES = 8 * 1024 * 1024;

export interface AiDesignServerEvidenceReceiptSink {
  putImmutable(receipt: AiDesignServerEvidenceReceiptV1): Promise<void>;
}

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
  getProductStructureSidecar(artifactId: string): AiDesignProductStructureSidecarArtifactV1 | null;
  putCrossDomainSidecarImmutable(artifact: AiDesignCrossDomainSidecarArtifactV1): Promise<void>;
  getCrossDomainSidecar(artifactId: string): AiDesignCrossDomainSidecarArtifactV1 | null;
  putGraphPartitionImmutable(partition: AiDesignGraphPartitionV1): Promise<void>;
  getGraphPartition(partitionId: string): AiDesignGraphPartitionV1 | null;
  putGaugeBindingsImmutable(artifact: AiDesignGaugeBindingsArtifactV1): Promise<void>;
  getGaugeBindings(artifactId: string): AiDesignGaugeBindingsArtifactV1 | null;
  putConstraintBindingsImmutable(artifact: AiDesignConstraintBindingsArtifactV1): Promise<void>;
  getConstraintBindings(artifactId: string): AiDesignConstraintBindingsArtifactV1 | null;
  putIntentResolutionImmutable(artifact: AiDesignIntentResolutionArtifactV1): Promise<void>;
  getIntentResolution(artifactId: string): AiDesignIntentResolutionArtifactV1 | null;
  putPrecisionRequestImmutable(request: AiDesignPrecisionVerificationRequestV1): Promise<void>;
  getPrecisionRequest(requestId: string): AiDesignPrecisionVerificationRequestV1 | null;
  putPrecisionReceiptImmutable(receipt: AiDesignPrecisionVerificationReceiptV1): Promise<void>;
  getPrecisionReceipt(receiptId: string): AiDesignPrecisionVerificationReceiptV1 | null;
  listCandidateArtifacts(scope: AiDesignArtifactOwnershipScope): readonly AiDesignCandidateArtifactV1[];
  putCriticBundleImmutable(bundle: AiDesignMultiCriticBundleV1): Promise<void>;
  getCriticBundle(bundleId: string): AiDesignMultiCriticBundleV1 | null;
}

/**
 * Non-commercial single-process reference repository. Commercial mode is
 * already rejected by the authoritative workspace store until integration
 * supplies PostgreSQL/object-storage implementations of these interfaces.
 */
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

export const aiDesignServerRuntimeArtifacts = new InMemoryAiDesignServerRuntimeArtifacts();
