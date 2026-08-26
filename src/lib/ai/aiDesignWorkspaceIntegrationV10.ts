import { createAiDesignChatActionCard, type AiDesignChatActionCardV1 } from './aiDesignChatActionCards';
import { createUnifiedWorkspaceClientStateV1, type UnifiedWorkspaceServerSnapshotV1 } from './aiDesignUnifiedWorkspaceClientStateV1';
import type { AiDesignComplexWorkspaceReadModelV4 } from './aiDesignComplexWorkspaceService';
import type { AiDesignPreviewEvidenceV1 } from './aiDesignPreviewLifecycleV1';
import type { AiDesignUnifiedWorkspaceV9 } from './aiDesignUnifiedWorkspaceV9';
import { getAiDesignWorkspaceCopy } from './aiDesignWorkspaceI18n';

export interface AiDesignComplexWorkspaceResponseV10 {
  model: AiDesignComplexWorkspaceReadModelV4;
  unified: AiDesignUnifiedWorkspaceV9;
}
export interface AiDesignConceptNodeV10 {
  id: string;
  kind: 'part' | 'candidate';
  label: string;
  depth: number;
  heat: 'none' | 'attention' | 'high' | 'critical';
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Binds the authoritative V4 model to its V9 renderer projection. Creating the
 * client state is intentional: it runs the complete revision/authority checks
 * before any browser controller is allowed to consume the response.
 */
export function createAiDesignUnifiedWorkspaceSnapshotV10(value: unknown): UnifiedWorkspaceServerSnapshotV1 {
  if (!record(value) || !record(value.model) || !record(value.unified)) throw new Error('workspace_response_invalid');
  const model = value.model as unknown as AiDesignComplexWorkspaceReadModelV4;
  const unified = value.unified as unknown as AiDesignUnifiedWorkspaceV9;
  const snapshot: UnifiedWorkspaceServerSnapshotV1 = {
    projectId: model.projectId,
    sessionId: model.sessionId,
    runtimeRevision: model.runtimeRevision,
    complexRevision: model.complexRevision,
    source: model,
    workspace: unified,
  };
  createUnifiedWorkspaceClientStateV1(snapshot);
  return snapshot;
}

/** Stable IDs are shared by both concept renderers; no geometry mapping is guessed. */
export function createAiDesignConceptNodesV10(model: AiDesignComplexWorkspaceReadModelV4): readonly AiDesignConceptNodeV10[] {
  const structure = model.workspace.assemblyTree.slice(0, 80).map(node => ({
    id: node.nodeId,
    kind: 'part' as const,
    label: node.label,
    depth: node.depth,
    heat: node.heat,
  }));
  if (structure.length) return structure;
  return model.workspace.candidateEvaluations.slice(0, 12).map((candidate, index) => ({
    id: candidate.candidateId,
    kind: 'candidate' as const,
    label: `Candidate ${index + 1}`,
    depth: 0,
    heat: candidate.status === 'FAIL' ? 'critical' as const : candidate.status === 'INCOMPLETE' ? 'attention' as const : 'none' as const,
  }));
}

/** The server creates the apply/reject actions after producing a proposal. */
export function createAiDesignPreviewDecisionCardV10(input: {
  projectId: string;
  sessionId: string;
  runtimeRevision: number;
  evidence: AiDesignPreviewEvidenceV1;
  locale?: string;
}): AiDesignChatActionCardV1 {
  const text = getAiDesignWorkspaceCopy(input.locale).previewDecision;
  return createAiDesignChatActionCard({
    cardId: `preview-card:${input.evidence.proposalId}`,
    projectId: input.projectId,
    sessionId: input.sessionId,
    runtimeRevision: input.runtimeRevision,
    kind: 'change_preview',
    title: text.title,
    summary: text.summary,
    status: 'attention',
    references: {
      questionId: null,
      candidateId: null,
      gaugeId: null,
      proposalId: input.evidence.proposalId,
      verificationReceiptId: null,
    },
    actions: [
      { id: 'APPLY_CONCEPT_CHANGE', label: text.apply, enabled: true, reason: null, primary: true, requiresConfirmation: true },
      { id: 'REJECT_PREVIEW', label: text.discard, enabled: true, reason: null, primary: false, requiresConfirmation: false },
    ],
  });
}
