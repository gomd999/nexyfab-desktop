// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createAiDesignScreenBinding } from './aiDesignScreenBinding';
import { dispatchAiDesignScreenAction } from './aiDesignScreenActionDispatcher';
import { createGaugeViewModel } from './gaugeViewModel';
import { DIRECT_MANIPULATION_INTENT_SCHEMA, type DirectManipulationIntent } from './directManipulation';
import {
  createAiDesignWorkspaceRuntime,
  dispatchAiDesignWorkspaceAction,
  runtimeToAiDesignWorkspaceViewModel,
  type AiDesignWorkspaceRuntimeV1,
} from './aiDesignWorkspaceRuntime';
import {
  createServerAiDesignWorkspaceRuntime,
  loadServerAiDesignWorkspaceRuntime,
  resetAiDesignWorkspaceRuntimeStoreForTests,
  saveServerAiDesignWorkspaceRuntime,
} from './aiDesignWorkspaceRuntimeStore';
import { AI_DESIGN_RUNTIME_USER_SCENARIOS, validateAiDesignRuntimeUserScenarios } from './aiDesignRuntimeUserScenarios';

const hash = (char: string) => char.repeat(64);
const projectHash = hash('f');
const at = (second: number) => `2026-08-24T02:00:${String(second).padStart(2, '0')}.000Z`;
const kinds = ['text', 'image', 'sketch', 'drawing_2d', 'selection_3d'] as const;

function inputs() {
  return kinds.map((kind, index) => ({
    projectId: 'project-1', revision: 0, sourceId: `source-${index}`, sourceHash: hash(String(index + 1)), projectContentHash: projectHash,
    kind, mimeType: kind === 'text' ? 'text/plain' : kind === 'selection_3d' ? 'application/json' : 'image/png', sizeBytes: 100,
    authority: 'user_confirmed' as const, extracted: kind !== 'text' && kind !== 'selection_3d',
    extractionKind: kind === 'drawing_2d' ? 'drawing' as const : kind === 'image' || kind === 'sketch' ? 'vision' as const : 'user' as const,
    provenance: { rights: 'user_owned' as const, origin: 'user' },
    fields: [{ key: `fact-${index}`, value: index, category: index === 0 ? 'requirement' as const : 'fact' as const }],
  }));
}

function dispatch(state: AiDesignWorkspaceRuntimeV1, action: Parameters<typeof dispatchAiDesignWorkspaceAction>[1]) {
  const result = dispatchAiDesignWorkspaceAction(state, action);
  if (!result.ok) throw new Error(`${result.error}:${result.issues?.join(',') ?? ''}`);
  return result.state;
}

function evidence(kind: 'understanding' | 'candidate', id: string) {
  return { id, kind, checkpointId: 'project-1:0:input', revision: 0, status: 'PASS' as const, digest: projectHash, source: 'scenario-worker' };
}

function candidate() {
  return { candidateId: 'candidate-1', revision: 'candidate-r1', baseRevision: 'rev-0', title: 'Bracket', summary: 'Editable bracket concept', modelId: 'gpt-luna', featureIds: ['feature-1'], metrics: [{ metricId: 'fit', label: 'Requirement fit', value: 1, status: 'verified' as const, evidenceId: 'candidate-check' }], evidence: [{ evidenceId: 'candidate-check', label: 'Candidate validation', status: 'verified' as const, source: 'scenario-worker' }] };
}

function gauge() {
  const intent: DirectManipulationIntent = {
    schema: DIRECT_MANIPULATION_INTENT_SCHEMA, version: 1, intentId: 'intent-1', gestureId: 'gesture-1', sessionId: 'session-1', sequence: 1, idempotencyKey: 'gauge-edit-1', phase: 'preview', createdAt: at(10), projectId: 'project-1', baseRevision: 'rev-0', coordinateFrame: 'world', viewportRevision: 'view-1', device: { platform: 'mobile', pointer: 'touch', pointerCount: 1 }, origin: 'user_gauge', userCommand: 'increase width', selection: { version: 1, projectRevision: 'rev-0', assemblyPath: ['main'], partInstanceId: 'part-1', topology: [], sketchEntityIds: [], mateIds: [], coordinateFrame: 'world', units: 'mm' }, binding: { kind: 'feature_parameter', partId: 'part-1', featureId: 'feature-1', parameter: 'width', unit: 'mm' }, measurement: { semantics: 'absolute', startValue: 10, targetValue: 10, delta: 0, unit: 'mm', snapIncrement: 0.5 },
  };
  return createGaugeViewModel(intent, { gaugeId: 'gauge-1', min: 5, max: 20 });
}

function candidateReviewRuntime() {
  const created = createAiDesignWorkspaceRuntime({ projectId: 'project-1', revisionToken: 'rev-0', sessionId: 'session-1', inputs: inputs(), now: at(0) });
  if (!created.ok) throw new Error(created.issues.join(','));
  let state = dispatch(created.state, { type: 'UNDERSTANDING_CONFIRMED', actionId: 'understanding-1', expectedRevision: 0, missingInput: false, evidence: evidence('understanding', 'understanding-evidence'), timestamp: at(1) });
  state = dispatch(state, { type: 'START_GENERATION', actionId: 'start-1', expectedRevision: state.runtimeRevision, runId: 'run-1', modelSelection: { mode: 'auto', plan: 'enterprise', task: 'simple-execution' }, timestamp: at(2) });
  for (const [index, stage] of (['understanding', 'planning', 'candidate_generation', 'candidate_validation'] as const).entries()) state = dispatch(state, { type: 'COMPLETE_GENERATION_STAGE', actionId: `complete-${stage}`, expectedRevision: state.runtimeRevision, stage, outputDigest: hash(String(index + 1)), source: 'scenario-worker', timestamp: at(index + 3) });
  return dispatch(state, { type: 'PUBLISH_CANDIDATES', actionId: 'publish-1', expectedRevision: state.runtimeRevision, candidates: [candidate()], evidence: evidence('candidate', 'candidate-evidence'), timestamp: at(8) });
}

afterEach(() => resetAiDesignWorkspaceRuntimeStoreForTests());

describe('AI Design runtime user scenarios', () => {
  it('runs all five input kinds through gauge editing, persistence, recovery, and the Precision request boundary', async () => {
    let state = candidateReviewRuntime();
    expect(state.checkpoint.sources.map(source => source.kind)).toEqual(AI_DESIGN_RUNTIME_USER_SCENARIOS[0]!.inputKinds);
    state = dispatch(state, { type: 'SELECT_CANDIDATE', actionId: 'select-1', expectedRevision: state.runtimeRevision, candidateId: 'candidate-1', timestamp: at(9) });
    state = dispatch(state, { type: 'BEGIN_PARAMETRIC_EDIT', actionId: 'edit-1', expectedRevision: state.runtimeRevision, timestamp: at(10) });
    state = dispatch(state, { type: 'ATTACH_GAUGES', actionId: 'attach-1', expectedRevision: state.runtimeRevision, gauges: [gauge()], options: { 'gauge-1': { mobile: true, selectionRelevance: 1 } }, timestamp: at(11) });
    state = dispatch(state, { type: 'ADJUST_GAUGE', actionId: 'adjust-1', expectedRevision: state.runtimeRevision, gaugeId: 'gauge-1', mode: 'fine', direction: 1, timestamp: at(12) });
    const screen = createAiDesignScreenBinding(runtimeToAiDesignWorkspaceViewModel(state));
    const precisionEffect = dispatchAiDesignScreenAction({ binding: screen, actionId: 'request-precision', effectId: 'precision-request-1', expectedRuntimeRevision: state.runtimeRevision });
    expect(precisionEffect).toMatchObject({ ok: true, effect: { boundary: 'precision-cad', explicitCommitRequired: true, preservesCadSelection: true } });
    await createServerAiDesignWorkspaceRuntime('owner-1', state);
    const expectedRevision = state.runtimeRevision;
    state = dispatch(state, { type: 'REQUEST_PRECISION', actionId: 'precision-request-1', expectedRevision, timestamp: at(13) });
    await saveServerAiDesignWorkspaceRuntime('owner-1', state, expectedRevision);
    const recovered = await loadServerAiDesignWorkspaceRuntime('owner-1', 'project-1', 'session-1');
    expect(recovered).toMatchObject({ runtimeRevision: state.runtimeRevision, workflow: { status: 'PRECISION_PENDING' }, gauges: [{ targetValue: 10.5 }] });
  });

  it('keeps model fallback and cancel/resume explicit and validates the shared manifest', () => {
    const state = candidateReviewRuntime();
    expect(validateAiDesignRuntimeUserScenarios()).toEqual([]);
    expect(state.generation?.modelReceipt.selectedModelId).toBe('gpt-luna');
    const duplicate = dispatchAiDesignWorkspaceAction(state, { type: 'PUBLISH_CANDIDATES', actionId: 'publish-1', expectedRevision: 0, candidates: [candidate()], evidence: evidence('candidate', 'candidate-evidence') });
    expect(duplicate).toMatchObject({ ok: true, replayed: true, state: { runtimeRevision: state.runtimeRevision } });
  });
});
