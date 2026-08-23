import { describe, expect, it } from 'vitest';
import { createGenerationRun } from './generationRunState';
import { serverEvidenceSha256 } from './serverEvidence';
import { parsePrecisionCadAgentTask, validatePrecisionCadAgentTask, isPrecisionCadAgentTaskBoundToOwnership, precisionCadAgentTaskMatchesPlan } from './precisionCadAgentTask';
import { precisionCadGenerationBindingMatchesState } from './precisionCadAgentTaskServer';

const plan = {
  schema: 'nexyfab.adaptive-complex-product-execution.v1',
  nextAction: 'run_ai_managed_precision_cad',
  activeStage: 'assembly_solve',
  affectedPartIds: ['arm', 'housing'],
  reasonCodes: ['PRECISE_INTERFERENCE_PRESENT'],
  precisionCad: { required: true, executionMode: 'ai_managed', scope: 'assembly_or_product' },
};

describe('precision CAD agent task', () => {
  it('converts a governed adaptive execution plan', () => {
    expect(parsePrecisionCadAgentTask(plan)).toEqual({
      schema: 'nexyfab.precision-cad-agent-task.v1',
      activeStage: 'assembly_solve',
      affectedPartIds: ['arm', 'housing'],
      reasonCodes: ['PRECISE_INTERFERENCE_PRESENT'],
      scope: 'assembly_or_product',
    });
  });

  it('rejects plans that do not request AI-managed precision CAD', () => {
    expect(parsePrecisionCadAgentTask({ ...plan, nextAction: 'continue_ai_pipeline' })).toBeNull();
    expect(validatePrecisionCadAgentTask({ schema: 'nexyfab.precision-cad-agent-task.v1', activeStage: 'kernel' })).toBeNull();
  });

  const ownership = {
    schema: 'nexyfab.cad-session-ownership.v1' as const,
    partIds: ['arm', 'housing'],
    brepHandles: { 'occt:arm': 'arm', 'occt:housing': 'housing' },
  };

  it('rejects a forged task whose affected part is absent from signed ownership', () => {
    const normalized = validatePrecisionCadAgentTask({
      schema: 'nexyfab.precision-cad-agent-task.v1', activeStage: 'assembly_solve',
      affectedPartIds: ['secret-part'], reasonCodes: ['TEST'], scope: 'affected_parts_only',
    });
    expect(normalized).not.toBeNull();
    expect(isPrecisionCadAgentTaskBoundToOwnership(normalized!, ownership)).toBe(false);
  });

  it('accepts only an affected part proven by the signed ownership index', () => {
    const normalized = validatePrecisionCadAgentTask({
      schema: 'nexyfab.precision-cad-agent-task.v1', activeStage: 'kernel',
      affectedPartIds: ['arm'], reasonCodes: ['TEST'], scope: 'affected_parts_only',
    });
    expect(isPrecisionCadAgentTaskBoundToOwnership(normalized!, ownership)).toBe(true);
    expect(isPrecisionCadAgentTaskBoundToOwnership(normalized!, null)).toBe(false);
  });

  it('requires the server plan to agree with scope, stage, and exact affected/reason parts', () => {
    const plan = {
      nextAction: 'run_ai_managed_precision_cad' as const,
      activeStage: 'assembly_solve',
      affectedPartIds: ['arm', 'housing'],
      reasonCodes: ['PRECISE_INTERFERENCE_PRESENT'],
      precisionCad: { required: true as const, executionMode: 'ai_managed' as const, scope: 'assembly_or_product' as const },
    };
    const valid = validatePrecisionCadAgentTask({ schema: 'nexyfab.precision-cad-agent-task.v1', activeStage: plan.activeStage, affectedPartIds: plan.affectedPartIds, reasonCodes: plan.reasonCodes, scope: plan.precisionCad.scope });
    expect(valid).not.toBeNull();
    expect(precisionCadAgentTaskMatchesPlan(valid!, plan as never)).toBe(true);
    expect(precisionCadAgentTaskMatchesPlan({ ...valid!, scope: 'affected_parts_only' }, plan as never)).toBe(false);
    expect(precisionCadAgentTaskMatchesPlan({ ...valid!, affectedPartIds: ['arm'] }, plan as never)).toBe(false);
  });

  it('binds a task to one project revision and rejects cross-project, stale, and replayed revisions', () => {
    const state = createGenerationRun('run-1', 'project-1');
    const binding = { projectId: 'project-1', runId: state.runId, revision: state.revision, stateSha256: serverEvidenceSha256(state) };
    expect(precisionCadGenerationBindingMatchesState(binding, state, 'project-1')).toBe(true);
    expect(precisionCadGenerationBindingMatchesState(binding, state, 'project-2')).toBe(false);
    const advanced = { ...state, revision: state.revision + 1 };
    expect(precisionCadGenerationBindingMatchesState(binding, advanced, 'project-1')).toBe(false);
    expect(precisionCadGenerationBindingMatchesState(binding, state, 'project-1')).toBe(true);
  });
});
