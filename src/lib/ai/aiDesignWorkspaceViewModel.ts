import {
  assertAiDesignInteractionState,
  toLowDataPayload,
  type AiDesignInteractionState,
  type ChangeExplanation,
} from './aiDesignInteractionContract';
import { assertAiDesignWorkflowState, type AiDesignWorkflowState } from './aiDesignWorkflow';
import { assertAiDesignMobileRecoveryState, type AiDesignMobileRecoveryState } from './aiDesignMobileRecovery';
import { validateDesignIntentCheckpoint, type DesignIntentCheckpointV1 } from './designIntentCheckpoint';
import type { CandidateComparisonViewModel } from './designCandidateComparison';
import type { GaugeViewModelV1 } from './gaugeViewModel';
import type { ModelSelectionReceipt } from './modelSelectionPolicy';
import type { DirectManipulationProposal } from './directManipulation';
import {
  guardPrecisionCadDirectEditReceipt,
  type PrecisionCadDirectEditReceipt,
  type PrecisionCadVerificationStatus,
} from './precisionCadDirectEditReceipt';

export const AI_DESIGN_WORKSPACE_VIEW_MODEL_SCHEMA = 'nexyfab.ai-design-workspace-view-model.v1' as const;

export type WorkspaceSafetyState = 'READY' | 'ATTENTION' | 'BLOCKED';
export type WorkspaceVerificationState = PrecisionCadVerificationStatus | 'STALE';
export type WorkspacePanelState = 'hidden' | 'ready' | 'attention' | 'busy' | 'verified' | 'stale' | 'blocked';

export interface AiDesignWorkspaceViewModelInput {
  projectId: string;
  revision: number;
  /** Optional explicit base; revisionToken remains the compatibility input. */
  baseRevisionToken?: string;
  revisionToken: string;
  checkpoint: DesignIntentCheckpointV1;
  workflow: AiDesignWorkflowState;
  interaction: AiDesignInteractionState;
  mobile?: AiDesignMobileRecoveryState;
  modelSelection?: ModelSelectionReceipt | null;
  candidates?: CandidateComparisonViewModel | null;
  gauges?: readonly GaugeViewModelV1[];
  activeProposal?: DirectManipulationProposal | null;
  proposalDigestSha256?: string | null;
  precisionReceipt?: PrecisionCadDirectEditReceipt | null;
  change?: ChangeExplanation | null;
}

export interface AiDesignWorkspaceViewModel {
  schema: typeof AI_DESIGN_WORKSPACE_VIEW_MODEL_SCHEMA;
  projectId: string;
  revision: number;
  baseRevisionToken: string;
  revisionToken: string;
  safety: WorkspaceSafetyState;
  issues: readonly string[];
  warnings: readonly string[];
  header: {
    workflowStatus: AiDesignWorkflowState['status'];
    selectedModelId: string | null;
    modelMode: ModelSelectionReceipt['mode'] | null;
    modelFallback: boolean;
    exactGeometryAuthority: false;
    precisionStatus: WorkspaceVerificationState;
  };
  intake: {
    sourceKinds: readonly string[];
    confirmedFacts: number;
    importedAuthority: number;
    assumptions: number;
    missing: number;
    conflicts: number;
    copyrightUsable: boolean;
    nextQuestions: readonly string[];
  };
  candidates: {
    count: number;
    recommendedCandidateId: string | null;
    recommendationReasons: readonly string[];
    verificationRequired: boolean;
  };
  edit: {
    gaugeCount: number;
    primaryGaugeId: string | null;
    proposalState: DirectManipulationProposal['state'] | null;
    requiresConfirmation: boolean;
  };
  verification: {
    geometry: WorkspaceVerificationState;
    topology: WorkspaceVerificationState;
    manufacturing: WorkspaceVerificationState;
    receiptAccepted: boolean;
  };
  panels: Readonly<Record<'intake' | 'candidates' | 'edit' | 'verification', WorkspacePanelState>>;
  primaryAction: AiDesignWorkflowState['nextActions'][number] | null;
  change: ChangeExplanation | null;
  presentation: {
    mode: AiDesignInteractionState['presentation']['mode'];
    mobileSheet: string;
    lowData: boolean;
  };
  lowDataPayload: ReturnType<typeof toLowDataPayload>;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function panelState(input: AiDesignWorkspaceViewModelInput, panel: 'intake' | 'candidates' | 'edit' | 'verification', blocked: boolean): WorkspacePanelState {
  if (blocked) return 'blocked';
  if (input.workflow.status === 'STALE') return 'stale';
  if (panel === 'intake') return input.checkpoint.readiness.ready ? 'ready' : 'attention';
  if (panel === 'candidates') {
    if (input.workflow.status === 'GENERATING') return 'busy';
    return input.candidates?.candidates.length ? 'ready' : 'hidden';
  }
  if (panel === 'edit') return input.gauges?.length || input.activeProposal ? 'ready' : 'hidden';
  if (input.workflow.status === 'PRECISION_PENDING' || input.workflow.status === 'PRECISION_VERIFYING') return 'busy';
  return input.workflow.status === 'VERIFIED' ? 'verified' : 'hidden';
}

function precisionStatus(
  input: AiDesignWorkspaceViewModelInput,
): { geometry: WorkspaceVerificationState; topology: WorkspaceVerificationState; manufacturing: WorkspaceVerificationState; receiptAccepted: boolean; issues: string[] } {
  if (input.workflow.status === 'STALE') return { geometry: 'STALE', topology: 'STALE', manufacturing: 'STALE', receiptAccepted: false, issues: [] };
  if (!input.precisionReceipt) return { geometry: 'NOT_RUN', topology: 'NOT_RUN', manufacturing: 'NOT_RUN', receiptAccepted: false, issues: [] };
  if (!input.activeProposal || !input.proposalDigestSha256) {
    return { geometry: 'NOT_RUN', topology: 'NOT_RUN', manufacturing: 'NOT_RUN', receiptAccepted: false, issues: ['unbound_precision_receipt'] };
  }
  const guard = guardPrecisionCadDirectEditReceipt({
    receipt: input.precisionReceipt,
    proposal: input.activeProposal,
    proposalDigestSha256: input.proposalDigestSha256,
  });
  if (!guard.accepted) return { geometry: 'NOT_RUN', topology: 'NOT_RUN', manufacturing: 'NOT_RUN', receiptAccepted: false, issues: guard.issues };
  return {
    geometry: input.precisionReceipt.verification.geometry.status,
    topology: input.precisionReceipt.verification.topology.status,
    manufacturing: input.precisionReceipt.verification.manufacturing.status,
    receiptAccepted: true,
    issues: [],
  };
}

function modelWarnings(receipt: ModelSelectionReceipt | null | undefined): string[] {
  if (!receipt) return ['model_not_selected'];
  const warnings: string[] = [];
  if (receipt.status === 'blocked') warnings.push(`model_selection_blocked:${receipt.reason ?? 'unknown'}`);
  if (receipt.fallback.applied) warnings.push(`model_fallback:${receipt.fallback.reason ?? 'unknown'}`);
  return warnings;
}

/**
 * Composes every AI-owned state into one renderable workspace model. Exact CAD
 * success remains impossible without an accepted Precision CAD receipt.
 */
export function createAiDesignWorkspaceViewModel(input: AiDesignWorkspaceViewModelInput): AiDesignWorkspaceViewModel {
  const baseRevisionToken = input.baseRevisionToken ?? input.revisionToken;
  const issues: string[] = [...validateDesignIntentCheckpoint(input.checkpoint)];
  try { assertAiDesignWorkflowState(input.workflow); } catch (error) { issues.push(error instanceof Error ? error.message : 'invalid_workflow_state'); }
  try { assertAiDesignInteractionState(input.interaction); } catch (error) { issues.push(error instanceof Error ? error.message : 'invalid_interaction_state'); }
  if (input.mobile) {
    try { assertAiDesignMobileRecoveryState(input.mobile); } catch (error) { issues.push(error instanceof Error ? error.message : 'invalid_mobile_state'); }
  }
  if (input.checkpoint.projectId !== input.projectId || input.checkpoint.revision !== input.revision) issues.push('checkpoint_workspace_binding_mismatch');
  if (input.workflow.revision !== input.revision) issues.push('workflow_workspace_revision_mismatch');
  if (input.workflow.checkpoint
    && (input.workflow.checkpoint.id !== input.checkpoint.checkpointId || input.workflow.checkpoint.revision !== input.checkpoint.revision)) {
    issues.push('workflow_checkpoint_binding_mismatch');
  }
  if (input.candidates && input.candidates.baseRevision !== baseRevisionToken) issues.push('candidate_workspace_revision_mismatch');
  if (input.gauges?.some(gauge => gauge.baseRevision !== baseRevisionToken)) issues.push('gauge_workspace_revision_mismatch');
  if (input.activeProposal
    && (input.activeProposal.projectId !== input.projectId || input.activeProposal.transaction.baseRevision !== baseRevisionToken)) {
    issues.push('proposal_workspace_binding_mismatch');
  }
  const visiblePrimary = (input.gauges ?? []).filter(gauge => gauge.visible && gauge.primary);
  if (visiblePrimary.length > 1) issues.push('multiple_primary_gauges');
  const verification = precisionStatus(input);
  issues.push(...verification.issues);
  if (input.workflow.status === 'VERIFIED'
    && (!verification.receiptAccepted || input.precisionReceipt?.status !== 'VERIFIED'
      || verification.geometry !== 'PASS' || verification.topology !== 'PASS')) {
    issues.push('verified_workspace_requires_precision_receipt');
  }
  if (input.modelSelection
    && (input.modelSelection.policy.conceptOnly !== true
      || input.modelSelection.policy.copyrightSafe !== true
      || input.modelSelection.policy.exactGeometryAuthority !== false)) issues.push('invalid_model_selection_policy');

  const warnings = [
    ...modelWarnings(input.modelSelection),
    ...input.checkpoint.readiness.blockers,
    ...(input.candidates?.recommendation.verificationRequired ? ['candidate_verification_required'] : []),
    ...(input.activeProposal?.verdict.requiresConfirmation ? ['direct_edit_confirmation_required'] : []),
  ];
  const safety: WorkspaceSafetyState = issues.length
    ? 'BLOCKED'
    : warnings.length
      ? 'ATTENTION'
      : 'READY';
  const primaryAction = input.workflow.nextActions.find(action => action.enabled) ?? null;
  const precisionHeader = input.workflow.status === 'VERIFIED'
    ? verification.geometry
    : input.workflow.status === 'STALE'
      ? 'STALE'
      : verification.geometry;
  return {
    schema: AI_DESIGN_WORKSPACE_VIEW_MODEL_SCHEMA,
    projectId: input.projectId,
    revision: input.revision,
    baseRevisionToken,
    revisionToken: verification.receiptAccepted && input.precisionReceipt
      ? input.precisionReceipt.resultRevision
      : input.revisionToken,
    safety,
    issues: unique(issues),
    warnings: unique(warnings),
    header: {
      workflowStatus: input.workflow.status,
      selectedModelId: input.modelSelection?.selectedModelId ?? null,
      modelMode: input.modelSelection?.mode ?? null,
      modelFallback: input.modelSelection?.fallback.applied ?? false,
      exactGeometryAuthority: false,
      precisionStatus: precisionHeader,
    },
    intake: {
      sourceKinds: unique(input.checkpoint.sources.map(source => source.kind)),
      confirmedFacts: input.checkpoint.userConfirmedFacts.length,
      importedAuthority: input.checkpoint.importedAuthority.length,
      assumptions: input.checkpoint.aiAssumptions.length,
      missing: input.checkpoint.missingFields.length,
      conflicts: input.checkpoint.conflicts.length,
      copyrightUsable: input.checkpoint.copyrightPolicy.usable,
      nextQuestions: input.checkpoint.readiness.nextQuestions.map(question => question.question),
    },
    candidates: {
      count: input.candidates?.candidates.length ?? 0,
      recommendedCandidateId: input.candidates?.recommendation.candidateId ?? null,
      recommendationReasons: input.candidates?.recommendation.reasons ?? [],
      verificationRequired: input.candidates?.recommendation.verificationRequired ?? true,
    },
    edit: {
      gaugeCount: input.gauges?.length ?? 0,
      primaryGaugeId: visiblePrimary[0]?.gaugeId ?? null,
      proposalState: input.activeProposal?.state ?? null,
      requiresConfirmation: Boolean(input.activeProposal?.verdict.requiresConfirmation || input.gauges?.some(gauge => gauge.requiresConfirmation)),
    },
    verification: {
      geometry: verification.geometry,
      topology: verification.topology,
      manufacturing: verification.manufacturing,
      receiptAccepted: verification.receiptAccepted,
    },
    panels: {
      intake: panelState(input, 'intake', issues.length > 0),
      candidates: panelState(input, 'candidates', issues.length > 0),
      edit: panelState(input, 'edit', issues.length > 0),
      verification: panelState(input, 'verification', issues.length > 0),
    },
    primaryAction,
    change: input.change ?? null,
    presentation: {
      mode: input.interaction.presentation.mode,
      mobileSheet: input.mobile?.snap ?? input.interaction.bottomSheet.snap,
      lowData: input.mobile?.lowData ?? false,
    },
    lowDataPayload: toLowDataPayload(input.interaction),
  };
}
