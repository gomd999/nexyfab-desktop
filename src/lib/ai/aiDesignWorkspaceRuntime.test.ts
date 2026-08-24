import { describe, expect, it } from 'vitest';
import { createGaugeViewModel } from './gaugeViewModel';
import { DIRECT_MANIPULATION_INTENT_SCHEMA, type DirectManipulationIntent } from './directManipulation';
import {
  createAiDesignWorkspaceRuntime,
  dispatchAiDesignWorkspaceAction,
  runtimeToAiDesignWorkspaceViewModel,
  type AiDesignWorkspaceRuntimeV1,
} from './aiDesignWorkspaceRuntime';

const hash = (char: string) => char.repeat(64);
const timestamp = (second: number) => `2026-08-24T01:00:${String(second).padStart(2, '0')}.000Z`;
const evidence = (kind: 'understanding' | 'candidate', id: string) => ({
  id, kind, checkpointId: 'project-1:0:input', revision: 0, status: 'PASS' as const,
  digest: hash('f'), source: 'runtime-worker',
});

function input(sourceId = 'text-1', sourceHash = hash('a')) {
  return {
    projectId: 'project-1', revision: 0, sourceId, sourceHash, projectContentHash: hash('f'),
    kind: 'text' as const, mimeType: 'text/plain', sizeBytes: 100,
    authority: 'user_confirmed' as const,
    provenance: { rights: 'user_owned' as const, origin: 'user' },
    fields: [{ key: 'purpose', value: 'bracket', category: 'requirement' as const }],
  };
}

function dispatch(state: AiDesignWorkspaceRuntimeV1, action: Parameters<typeof dispatchAiDesignWorkspaceAction>[1]) {
  const result = dispatchAiDesignWorkspaceAction(state, action);
  if (!result.ok) throw new Error(`${result.error}:${result.issues?.join(',') ?? ''}`);
  return result.state;
}

function readyRuntime() {
  const created = createAiDesignWorkspaceRuntime({ projectId: 'project-1', revisionToken: 'rev-0', sessionId: 'session-1', inputs: [input()], now: timestamp(0) });
  if (!created.ok) throw new Error(created.issues.join(','));
  return dispatch(created.state, { type: 'UNDERSTANDING_CONFIRMED', actionId: 'understanding-1', expectedRevision: 0, missingInput: false, evidence: evidence('understanding', 'understanding-evidence'), timestamp: timestamp(1) });
}

function generationReadyRuntime() {
  let state = readyRuntime();
  state = dispatch(state, { type: 'START_GENERATION', actionId: 'start-1', expectedRevision: state.runtimeRevision, runId: 'run-1', modelSelection: { mode: 'auto', plan: 'enterprise', task: 'simple-execution' }, timestamp: timestamp(2) });
  for (const [index, stage] of (['understanding', 'planning', 'candidate_generation', 'candidate_validation'] as const).entries()) {
    state = dispatch(state, { type: 'COMPLETE_GENERATION_STAGE', actionId: `stage-${stage}`, expectedRevision: state.runtimeRevision, stage, outputDigest: hash(String(index + 1)), source: 'runtime-worker', timestamp: timestamp(index + 3) });
  }
  return state;
}

describe('AI Design workspace runtime', () => {
  it('runs intake through candidate publication with explicit model and evidence bindings', () => {
    let state = generationReadyRuntime();
    expect(state.generation).toMatchObject({ status: 'CANDIDATE_READY', modelReceipt: { selectedModelId: 'gpt-luna' } });
    state = dispatch(state, {
      type: 'PUBLISH_CANDIDATES', actionId: 'publish-1', expectedRevision: state.runtimeRevision,
      evidence: evidence('candidate', 'candidate-evidence'), timestamp: timestamp(8),
      candidates: [{ candidateId: 'candidate-1', revision: 'candidate-rev-1', baseRevision: 'rev-0', title: 'Bracket', summary: 'Editable concept', modelId: 'gpt-luna', featureIds: ['feature-1'], metrics: [{ metricId: 'fit', label: 'Requirement fit', value: 1, status: 'verified', evidenceId: 'candidate-check' }], evidence: [{ evidenceId: 'candidate-check', label: 'Candidate validation', status: 'verified', source: 'runtime-worker' }] }],
    });
    expect(state.workflow.status).toBe('CANDIDATE_REVIEW');
    expect(runtimeToAiDesignWorkspaceViewModel(state)).toMatchObject({ header: { selectedModelId: 'gpt-luna' }, candidates: { count: 1 } });
  });

  it('is idempotent and rejects stale runtime actions', () => {
    const state = readyRuntime();
    const action = { type: 'START_GENERATION' as const, actionId: 'start-1', expectedRevision: state.runtimeRevision, runId: 'run-1', modelSelection: { mode: 'auto' as const, plan: 'enterprise', task: 'simple-execution' }, timestamp: timestamp(2) };
    const first = dispatchAiDesignWorkspaceAction(state, action);
    if (!first.ok) throw new Error(first.error);
    expect(dispatchAiDesignWorkspaceAction(first.state, action)).toMatchObject({ ok: true, replayed: true, state: { runtimeRevision: first.state.runtimeRevision } });
    expect(dispatchAiDesignWorkspaceAction(first.state, { ...action, actionId: 'start-2' })).toMatchObject({ ok: false, error: 'runtime_revision_conflict' });
  });

  it('keeps cancellation and runtime fallback bound to the exact generation stage', () => {
    let state = readyRuntime();
    state = dispatch(state, { type: 'START_GENERATION', actionId: 'start-1', expectedRevision: state.runtimeRevision, runId: 'run-1', modelSelection: { mode: 'auto', plan: 'enterprise', task: 'simple-execution' }, timestamp: timestamp(2) });
    state = dispatch(state, { type: 'FAIL_GENERATION_STAGE', actionId: 'fail-1', expectedRevision: state.runtimeRevision, stage: 'understanding', reason: 'provider_unavailable', retryable: true, timestamp: timestamp(3) });
    state = dispatch(state, { type: 'FALLBACK_MODEL', actionId: 'fallback-1', expectedRevision: state.runtimeRevision, reason: 'provider_unavailable', timestamp: timestamp(4) });
    expect(state.generation?.modelChanges[0]).toMatchObject({ fromModelId: 'gpt-luna', reason: 'provider_unavailable' });
    state = dispatch(state, { type: 'CANCEL', actionId: 'cancel-1', expectedRevision: state.runtimeRevision, reason: 'offline', timestamp: timestamp(5) });
    expect(state).toMatchObject({ workflow: { status: 'CANCELLED', resumeStatus: 'GENERATING' }, generation: { status: 'CANCELLED', resumeStage: 'understanding' } });
    state = dispatch(state, { type: 'RESUME', actionId: 'resume-1', expectedRevision: state.runtimeRevision, timestamp: timestamp(6) });
    expect(state).toMatchObject({ workflow: { status: 'GENERATING' }, generation: { status: 'RUNNING', currentStage: 'understanding' } });
  });

  it('updates a bound gauge through an auditable reversible action', () => {
    let state = generationReadyRuntime();
    state = dispatch(state, {
      type: 'PUBLISH_CANDIDATES', actionId: 'publish-1', expectedRevision: state.runtimeRevision, evidence: evidence('candidate', 'candidate-evidence'), timestamp: timestamp(8),
      candidates: [{ candidateId: 'candidate-1', revision: 'candidate-rev-1', baseRevision: 'rev-0', title: 'Bracket', summary: 'Editable concept', modelId: 'gpt-luna', featureIds: ['feature-1'], metrics: [{ metricId: 'fit', label: 'Fit', value: 1, status: 'verified' }], evidence: [{ evidenceId: 'e-1', label: 'Check', status: 'verified' }] }],
    });
    state = dispatch(state, { type: 'BEGIN_PARAMETRIC_EDIT', actionId: 'edit-1', expectedRevision: state.runtimeRevision, timestamp: timestamp(9) });
    const intent: DirectManipulationIntent = {
      schema: DIRECT_MANIPULATION_INTENT_SCHEMA, version: 1, intentId: 'intent-1', gestureId: 'gesture-1', sessionId: 'session-1', sequence: 1, idempotencyKey: 'edit-1', phase: 'preview', createdAt: timestamp(9), projectId: 'project-1', baseRevision: 'rev-0', coordinateFrame: 'world', viewportRevision: 'view-1', device: { platform: 'desktop', pointer: 'mouse', pointerCount: 1 }, origin: 'user_gauge', userCommand: 'width', selection: { version: 1, projectRevision: 'rev-0', assemblyPath: ['main'], partInstanceId: 'part-1', topology: [], sketchEntityIds: [], mateIds: [], coordinateFrame: 'world', units: 'mm' }, binding: { kind: 'feature_parameter', partId: 'part-1', featureId: 'feature-1', parameter: 'width', unit: 'mm' }, measurement: { semantics: 'absolute', startValue: 10, targetValue: 10, delta: 0, unit: 'mm', snapIncrement: 0.5 },
    };
    const gauge = createGaugeViewModel(intent, { gaugeId: 'gauge-1', min: 5, max: 20 });
    state = dispatch(state, { type: 'ATTACH_GAUGES', actionId: 'gauges-1', expectedRevision: state.runtimeRevision, gauges: [gauge], timestamp: timestamp(10) });
    state = dispatch(state, { type: 'ADJUST_GAUGE', actionId: 'gauge-step-1', expectedRevision: state.runtimeRevision, gaugeId: 'gauge-1', mode: 'fine', direction: 1, timestamp: timestamp(11) });
    expect(state.gauges[0]?.targetValue).toBe(10.5);
    expect(state.session.audit.at(-1)).toMatchObject({ eventId: 'gauge-step-1', type: 'ADJUST_GAUGE' });
  });
});
