import 'server-only';

import type { AiDesignServerEvidenceReceiptV1 } from './aiDesignServerEvidenceReceipt';
import type { AiDesignGeneratedStageArtifactSink, AiDesignGeneratedStageArtifactV1 } from './aiDesignServerGenerationWorker';
import { serverEvidenceSha256 } from './serverEvidence';
import {
  InMemoryAiDesignCandidateArtifactStore,
  type AiDesignCandidateArtifactV1,
  type AiDesignArtifactOwnershipScope,
} from './aiDesignCandidateArtifact';

const MAX_ITEM_BYTES = 1024 * 1024;

export interface AiDesignServerEvidenceReceiptSink {
  putImmutable(receipt: AiDesignServerEvidenceReceiptV1): Promise<void>;
}

function clone<T>(value: T): T { return structuredClone(value); }
function boundedDigest(value: unknown): string {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, 'utf8') > MAX_ITEM_BYTES) throw new Error('AI_DESIGN_SERVER_ARTIFACT_TOO_LARGE');
  return serverEvidenceSha256(value);
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
  reset(): void { this.stageArtifacts.clear(); this.receipts.clear(); this.candidateArtifacts.reset(); }
}

export const aiDesignServerRuntimeArtifacts = new InMemoryAiDesignServerRuntimeArtifacts();
