import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import type { AiDesignConceptPreviewRequestV1 } from './aiDesignChatActionCommandAdapterV1';
import type { AiDesignPreviewEvidenceV1 } from './aiDesignPreviewLifecycleV1';

const TTL_MS = 10 * 60_000;
const MAX_PROPOSALS = 5_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

export interface AiDesignConceptProposalV1 {
  proposalId: string;
  proposalDigest: string;
  ownerKey: string;
  requestId: string;
  projectId: string;
  sessionId: string;
  runtimeRevision: number;
  complexRevision: number;
  gaugeId: string;
  adjustment: { mode: 'fine' | 'coarse'; direction: 1 | -1 };
  expiresAt: number;
}

const proposals = new Map<string, AiDesignConceptProposalV1>();

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function prune(now: number): void {
  for (const [id, proposal] of proposals) if (proposal.expiresAt <= now) proposals.delete(id);
}

export function isAiDesignConceptPreviewRequestV1(value: unknown): value is AiDesignConceptPreviewRequestV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const request = value as Partial<AiDesignConceptPreviewRequestV1>;
  return request.schema === 'nexyfab.ai-design-concept-preview-request.v1'
    && request.kind === 'concept-preview-request'
    && [request.requestId, request.projectId, request.sessionId, request.gaugeId].every(item => typeof item === 'string' && SAFE_ID.test(item))
    && Number.isSafeInteger(request.expectedRuntimeRevision) && Number(request.expectedRuntimeRevision) >= 0
    && request.adjustment !== undefined && ['fine', 'coarse'].includes(request.adjustment.mode)
    && (request.adjustment.direction === 1 || request.adjustment.direction === -1)
    && Object.keys(request.adjustment).every(key => ['mode', 'direction'].includes(key))
    && request.previewOnly === true && request.persistent === false
    && request.exactExecution === false && request.verificationPass === false
    && Object.keys(request as object).every(key => ['schema', 'kind', 'requestId', 'projectId', 'sessionId', 'expectedRuntimeRevision', 'gaugeId', 'adjustment', 'previewOnly', 'persistent', 'exactExecution', 'verificationPass'].includes(key));
}

export function createAiDesignConceptProposalV1(input: {
  ownerKey: string;
  request: AiDesignConceptPreviewRequestV1;
  complexRevision: number;
  now?: number;
}): { proposal: AiDesignConceptProposalV1; evidence: AiDesignPreviewEvidenceV1 } {
  const now = input.now ?? Date.now();
  prune(now);
  const proposalId = `proposal:${randomUUID()}`;
  const body = {
    proposalId,
    requestId: input.request.requestId,
    projectId: input.request.projectId,
    sessionId: input.request.sessionId,
    runtimeRevision: input.request.expectedRuntimeRevision,
    complexRevision: input.complexRevision,
    gaugeId: input.request.gaugeId,
    adjustment: input.request.adjustment,
  };
  const proposal: AiDesignConceptProposalV1 = {
    ...body,
    proposalDigest: digest(body),
    ownerKey: input.ownerKey,
    expiresAt: now + TTL_MS,
  };
  if (proposals.size >= MAX_PROPOSALS) {
    const oldest = [...proposals.values()].sort((left, right) => left.expiresAt - right.expiresAt)[0];
    if (oldest) proposals.delete(oldest.proposalId);
  }
  proposals.set(proposalId, proposal);
  return {
    proposal,
    evidence: {
      proposalId,
      proposalDigest: proposal.proposalDigest,
      baseRuntimeRevision: proposal.runtimeRevision,
      baseRevisionToken: `runtime-${proposal.runtimeRevision}:complex-${proposal.complexRevision}`,
      affectedRefs: [{ kind: 'parameter', id: proposal.gaugeId }],
      summaryCodes: [`gauge_${proposal.adjustment.mode}_${proposal.adjustment.direction > 0 ? 'increase' : 'decrease'}`, 'concept_preview_only'],
      previewOnly: true,
      verification: { geometry: 'NOT_RUN', topology: 'NOT_RUN', manufacturing: 'NOT_RUN' },
    },
  };
}

export function getAiDesignConceptProposalV1(ownerKey: string, proposalId: string, now = Date.now()): AiDesignConceptProposalV1 | null {
  prune(now);
  const proposal = proposals.get(proposalId);
  return proposal?.ownerKey === ownerKey ? proposal : null;
}

export function consumeAiDesignConceptProposalV1(proposalId: string): void {
  proposals.delete(proposalId);
}

export function resetAiDesignConceptProposalStoreForTests(): void {
  proposals.clear();
}
