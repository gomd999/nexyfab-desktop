import { describe, expect, it } from 'vitest';
import { buildAdaptiveComplexProductExecutionPlan } from './adaptiveComplexProductExecution';
import { createGenerationRun, GENERATION_STAGES, recordGenerationStage, type GenerationRunStage, type GenerationRunState } from './generationRunState';

function pass(state: GenerationRunState, through: GenerationRunStage): GenerationRunState {
  let next = state;
  for (const stage of GENERATION_STAGES.slice(0, GENERATION_STAGES.indexOf(through) + 1)) {
    if (next.stages[stage].status === 'passed') continue;
    next = recordGenerationStage(next, { stage, input: stage, output: { stage }, status: 'passed', timestamp: '2026-08-09T00:00:00.000Z' });
  }
  return next;
}

describe('adaptive complex-product execution', () => {
  it('keeps AI running through the complete product pipeline instead of stopping at a draft', () => {
    const state = pass(createGenerationRun('complex-ai-build'), 'part_programs');
    expect(buildAdaptiveComplexProductExecutionPlan(state)).toMatchObject({
      objective: 'complete_manufacturing_product', status: 'ai_building', activeStage: 'kernel', aiCanContinue: true,
      nextAction: 'continue_ai_pipeline', designComplete: false, precisionCad: { required: false }, externalCadInstallationRequired: false,
      manualDesign: { availableDuringAiWorkflow: true, exactParameterEntry: true, userValueLocksOverrideAi: true, preservedToExpertHandoff: true, expertDirectEditingAvailable: true },
      generationAccuracy: { modelReportedConfidenceIsSufficient: false, serverValidatedProductPlan: true, requirementToPartTraceRequired: true, authoritativeInputsRequiredBeforeExactGeometry: true, assemblyMateConnectivityRequired: true, repeatedDefinitionsMustRemainIdentical: true, inventedEvidenceReferencesRejected: true },
    });
  });

  it('runs precision CAD through AI for general users while keeping the expert workspace optional', () => {
    let state = pass(createGenerationRun('complex-precision'), 'topology');
    state = recordGenerationStage(state, { stage: 'assembly_solve', input: {}, status: 'failed', errorCodes: ['PRECISE_INTERFERENCE_PRESENT'], affectedPartIds: ['arm', 'motor'], timestamp: '2026-08-09T00:00:00.000Z' });
    expect(buildAdaptiveComplexProductExecutionPlan(state)).toMatchObject({
      status: 'precision_cad_required', activeStage: 'assembly_solve', aiCanContinue: true, nextAction: 'run_ai_managed_precision_cad',
      affectedPartIds: ['arm', 'motor'],
      precisionCad: {
        required: true, entryStage: 'assembly_solve', scope: 'assembly_or_product', executionMode: 'ai_managed',
        generalUserActionRequired: false, expertWorkspaceAvailable: true, expertWorkspaceRequired: false,
      },
      audienceSupport: {
        generalUser: { supported: true, workflow: 'ai_guided' },
        expertUser: { supported: true, workflow: 'ai_or_manual_precision' },
      },
    });
  });

  it('requests authoritative facts without misclassifying them as precision CAD', () => {
    let state = pass(createGenerationRun('complex-input'), 'motion');
    state = recordGenerationStage(state, { stage: 'manufacturing', input: {}, status: 'failed', errorCodes: ['CATALOG_EVIDENCE_MISSING'], unresolved: ['Traceable material and catalog input required.'], affectedPartIds: ['drive'], timestamp: '2026-08-09T00:00:00.000Z' });
    expect(buildAdaptiveComplexProductExecutionPlan(state)).toMatchObject({ status: 'authoritative_input_required', nextAction: 'request_authoritative_input', precisionCad: { required: false } });
  });

  it('separates a complete AI engineering design from final expert release authorization', () => {
    let state = pass(createGenerationRun('complex-review'), 'roundtrip');
    state = recordGenerationStage(state, { stage: 'release', input: {}, status: 'blocked', errorCodes: ['EXACT_ARTIFACT_AUTHORIZATION_REQUIRED'], timestamp: '2026-08-09T00:00:00.000Z' });
    expect(buildAdaptiveComplexProductExecutionPlan(state)).toMatchObject({ status: 'expert_review_required', designComplete: true, releaseReady: false, nextAction: 'request_expert_review', precisionCad: { required: false } });
  });

  it('recognizes a fully completed AI product when every governed stage passes', () => {
    const state = pass(createGenerationRun('complex-complete'), 'release');
    expect(buildAdaptiveComplexProductExecutionPlan(state)).toMatchObject({ status: 'ai_design_complete', activeStage: 'complete', designComplete: true, releaseReady: true, nextAction: 'complete' });
  });
});
