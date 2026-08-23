import { GENERATION_STAGES, type GenerationRunStage, type GenerationRunState } from './generationRunState';
import { verifyAgenticCommercialQualificationReceipt, type AgenticCommercialQualificationReceipt, type AgenticCommercialQualificationVerification, type AgenticCommercialQualificationVerificationContext } from './agenticCommercialQualificationReceipt';
import { serverEvidenceSha256 } from './serverEvidence';

export type ComplexProductExecutionStatus =
  | 'ai_building'
  | 'authoritative_input_required'
  | 'precision_cad_required'
  | 'expert_review_required'
  | 'ai_design_complete';

export interface AdaptiveComplexProductExecutionPlan {
  schema: 'nexyfab.adaptive-complex-product-execution.v1';
  objective: 'complete_manufacturing_product';
  status: ComplexProductExecutionStatus;
  activeStage: GenerationRunStage | 'complete';
  designComplete: boolean;
  releaseReady: boolean;
  aiCanContinue: boolean;
  nextAction: 'continue_ai_pipeline' | 'retry_affected_with_ai' | 'request_authoritative_input' | 'run_ai_managed_precision_cad' | 'request_expert_review' | 'complete';
  achievedStages: GenerationRunStage[];
  pendingStages: GenerationRunStage[];
  affectedPartIds: string[];
  reasonCodes: string[];
  precisionCad: {
    required: boolean;
    entryStage: GenerationRunStage | null;
    reasonCodes: string[];
    scope: 'affected_parts_only' | 'assembly_or_product' | null;
    executionMode: 'standby' | 'ai_managed';
    generalUserActionRequired: false;
    expertWorkspaceAvailable: true;
    expertWorkspaceRequired: false;
  };
  audienceSupport: {
    generalUser: { supported: true; workflow: 'ai_guided' };
    expertUser: { supported: true; workflow: 'ai_or_manual_precision' };
  };
  manualDesign: {
    availableDuringAiWorkflow: true;
    exactParameterEntry: true;
    userValueLocksOverrideAi: true;
    preservedToExpertHandoff: true;
    expertDirectEditingAvailable: true;
  };
  generationAccuracy: {
    modelReportedConfidenceIsSufficient: false;
    serverValidatedProductPlan: true;
    requirementToPartTraceRequired: true;
    authoritativeInputsRequiredBeforeExactGeometry: true;
    assemblyMateConnectivityRequired: true;
    repeatedDefinitionsMustRemainIdentical: true;
    inventedEvidenceReferencesRejected: true;
  };
  externalCadInstallationRequired: false;
  commercialReceiptVerification?: AgenticCommercialQualificationVerification;
  /** Server-only binding used when a precision task is authorized. */
  generationBinding?: {
    projectId: string;
    runId: string;
    revision: number;
    stateSha256: string;
  };
}

const DESIGN_COMPLETE_STAGE: GenerationRunStage = 'roundtrip';
const PRECISION_STAGES = new Set<GenerationRunStage>(['kernel', 'topology', 'assembly_solve', 'motion', 'roundtrip']);
const EXACT_RISK = /(KERNEL|BREP|TOPOLOG|ASSEMBLY|MATE|INTERFERENCE|COLLISION|CLEARANCE|MOTION_GEOMETRY|STEP_ROUNDTRIP|EXACT_ARTIFACT)/i;
const AUTHORITATIVE_INPUT = /(REQUIREMENT|CATALOG|MATERIAL|TOLERANCE|PROCESS|HOUSING|AUTHORIZATION|EVIDENCE_MISSING|INPUT_REQUIRED|UNCONFIRMED)/i;

function passedThrough(state: GenerationRunState, finalStage: GenerationRunStage): boolean {
  const finalIndex = GENERATION_STAGES.indexOf(finalStage);
  return GENERATION_STAGES.slice(0, finalIndex + 1).every(stage => state.stages[stage].status === 'passed');
}

/**
 * Routes a complex product toward completion. AI remains the default executor;
 * precision CAD is entered only for exact geometric/assembly risk or after
 * bounded AI repair is exhausted. Missing authoritative facts are never
 * disguised as CAD work or invented by the model.
 */
export function buildAdaptiveComplexProductExecutionPlan(state: GenerationRunState, commercialReceipt?: AgenticCommercialQualificationReceipt, commercialReceiptContext?: AgenticCommercialQualificationVerificationContext): AdaptiveComplexProductExecutionPlan {
  if (state.schema !== 'nexyfab.generation-run.v1') throw new Error('Generation run schema is invalid.');
  const commercialReceiptVerification = commercialReceiptContext
    ? verifyAgenticCommercialQualificationReceipt(commercialReceipt, commercialReceiptContext)
    : { ok: false, releaseReady: false, status: 'HOLD' as const, targetSha256: '', issues: ['commercial_receipt_context_missing'] };
  const achievedStages = GENERATION_STAGES.filter(stage => state.stages[stage].status === 'passed');
  const activeStage = GENERATION_STAGES.find(stage => state.stages[stage].status !== 'passed') ?? 'complete';
  const pendingStages = activeStage === 'complete' ? [] : GENERATION_STAGES.slice(GENERATION_STAGES.indexOf(activeStage));
  const designComplete = passedThrough(state, DESIGN_COMPLETE_STAGE);
  const releaseReady = passedThrough(state, 'release') && commercialReceiptVerification.releaseReady;

  if (releaseReady) return plan('ai_design_complete', 'complete', true, true, false, 'complete', achievedStages, [], [], [], false, null, [], null, commercialReceiptVerification);

  if (designComplete) {
    const release = state.stages.release;
    return plan('expert_review_required', 'release', true, false, false, 'request_expert_review', achievedStages, ['release'], release.affectedPartIds, [...release.errorCodes, ...commercialReceiptVerification.issues], false, null, [], null, commercialReceiptVerification);
  }

  const stage = activeStage as GenerationRunStage;
  const record = state.stages[stage];
  const reasons = [...new Set([...record.errorCodes, ...record.unresolved])];
  const joined = reasons.join(' ');
  const missingAuthority = record.unresolved.length > 0 && (['intent', 'decomposition', 'interfaces'].includes(stage) || AUTHORITATIVE_INPUT.test(joined));
  if (missingAuthority) return plan('authoritative_input_required', stage, false, false, false, 'request_authoritative_input', achievedStages, pendingStages, record.affectedPartIds, reasons, false, null, [], null, commercialReceiptVerification);

  const exactRisk = (record.status === 'failed' || record.status === 'blocked')
    && PRECISION_STAGES.has(stage)
    && (EXACT_RISK.test(joined) || record.attempt >= 3);
  if (exactRisk) {
    const scope = stage === 'assembly_solve' || stage === 'motion' ? 'assembly_or_product' : 'affected_parts_only';
    return plan('precision_cad_required', stage, false, false, true, 'run_ai_managed_precision_cad', achievedStages, pendingStages, record.affectedPartIds, reasons, true, stage, reasons, scope, commercialReceiptVerification);
  }

  const retry = record.status === 'failed' || record.status === 'blocked';
  return plan('ai_building', stage, false, false, true, retry ? 'retry_affected_with_ai' : 'continue_ai_pipeline', achievedStages, pendingStages, record.affectedPartIds, reasons, false, null, [], null, commercialReceiptVerification);
}

/** Adds the server-owned generation identity without changing the plan verdict. */
export function bindAdaptiveComplexProductExecutionPlan(
  plan: AdaptiveComplexProductExecutionPlan,
  state: GenerationRunState,
  projectId: string | undefined,
): AdaptiveComplexProductExecutionPlan {
  const project = projectId?.trim() || state.projectId?.trim();
  if (!project) return plan;
  return {
    ...plan,
    generationBinding: {
      projectId: project,
      runId: state.runId,
      revision: state.revision,
      stateSha256: serverEvidenceSha256(state),
    },
  };
}

function plan(
  status: ComplexProductExecutionStatus,
  activeStage: GenerationRunStage | 'complete',
  designComplete: boolean,
  releaseReady: boolean,
  aiCanContinue: boolean,
  nextAction: AdaptiveComplexProductExecutionPlan['nextAction'],
  achievedStages: GenerationRunStage[],
  pendingStages: GenerationRunStage[],
  affectedPartIds: string[],
  reasonCodes: string[],
  precisionRequired: boolean,
  precisionStage: GenerationRunStage | null,
  precisionReasons: string[],
  precisionScope: AdaptiveComplexProductExecutionPlan['precisionCad']['scope'],
  commercialReceiptVerification?: AgenticCommercialQualificationVerification,
): AdaptiveComplexProductExecutionPlan {
  return {
    schema: 'nexyfab.adaptive-complex-product-execution.v1', objective: 'complete_manufacturing_product', status, activeStage,
    designComplete, releaseReady, aiCanContinue, nextAction, achievedStages, pendingStages,
    affectedPartIds: [...new Set(affectedPartIds)].sort(), reasonCodes: [...new Set(reasonCodes)].sort(),
    precisionCad: {
      required: precisionRequired,
      entryStage: precisionStage,
      reasonCodes: [...new Set(precisionReasons)].sort(),
      scope: precisionScope,
      executionMode: precisionRequired ? 'ai_managed' : 'standby',
      generalUserActionRequired: false,
      expertWorkspaceAvailable: true,
      expertWorkspaceRequired: false,
    },
    audienceSupport: {
      generalUser: { supported: true, workflow: 'ai_guided' },
      expertUser: { supported: true, workflow: 'ai_or_manual_precision' },
    },
    manualDesign: {
      availableDuringAiWorkflow: true,
      exactParameterEntry: true,
      userValueLocksOverrideAi: true,
      preservedToExpertHandoff: true,
      expertDirectEditingAvailable: true,
    },
    generationAccuracy: {
      modelReportedConfidenceIsSufficient: false,
      serverValidatedProductPlan: true,
      requirementToPartTraceRequired: true,
      authoritativeInputsRequiredBeforeExactGeometry: true,
      assemblyMateConnectivityRequired: true,
      repeatedDefinitionsMustRemainIdentical: true,
      inventedEvidenceReferencesRejected: true,
    },
    externalCadInstallationRequired: false,
    commercialReceiptVerification,
  };
}
