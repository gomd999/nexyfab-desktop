import { describe, expect, it } from 'vitest';
import { createDesignIntentCheckpoint, type DesignIntentCheckpointV1 } from './designIntentCheckpoint';
import {
  assertAiDesignGenerationOrchestrator,
  beginAiDesignGeneration,
  cancelAiDesignGeneration,
  completeAiDesignGenerationStage,
  createAiDesignGenerationOrchestrator,
  executeCurrentAiDesignGenerationStage,
  failAiDesignGenerationStage,
  fallbackAiDesignGenerationModel,
  resumeAiDesignGeneration,
  retryAiDesignGeneration,
} from './aiDesignGenerationOrchestrator';

const digest = (char: string) => char.repeat(64);
const now = (second: number) => `2026-08-24T00:00:${String(second).padStart(2, '0')}.000Z`;

function checkpoint(ready = true): DesignIntentCheckpointV1 {
  return createDesignIntentCheckpoint({
    checkpointId: 'checkpoint-1',
    projectId: 'project-1',
    revision: 3,
    projectContentHash: digest('a'),
    sources: [{
      id: 'source-1', kind: 'text', projectId: 'project-1', revision: 3,
      sourceHash: digest('b'), authority: 'user_confirmed',
      provenance: { rights: 'user_owned', aiUseAllowed: true, derivativeUseAllowed: true },
      fields: ready ? [{ key: 'purpose', value: 'bracket', category: 'requirement' }] : [],
    }],
    requiredFields: [{ key: 'purpose', label: 'Purpose', category: 'requirement', question: 'What should be designed?' }],
  });
}

function created() {
  return createAiDesignGenerationOrchestrator({
    runId: 'run-1', checkpoint: checkpoint(), now: now(0),
    modelSelection: { mode: 'auto', plan: 'enterprise', task: 'simple-execution' },
  });
}

describe('AiDesignGenerationOrchestratorV1', () => {
  it('routes simple execution to Luna and reports real stage counts without a fake percent', () => {
    let state = created();
    expect(state.modelReceipt.selectedModelId).toBe('gpt-luna');
    const started = beginAiDesignGeneration(state, 0, now(1));
    if (!started.ok) throw new Error(started.error);
    state = started.state;
    expect(state.progress).toMatchObject({ completedStages: 0, totalStages: 4, currentStage: 'understanding', percent: null });
    for (const [index, stage] of (['understanding', 'planning', 'candidate_generation', 'candidate_validation'] as const).entries()) {
      const result = completeAiDesignGenerationStage(state, { expectedRevision: state.revision, stage, outputDigest: digest(String(index + 1)), source: `worker-${index}`, now: now(index + 2) });
      if (!result.ok) throw new Error(result.error);
      state = result.state;
    }
    expect(state).toMatchObject({ status: 'CANDIDATE_READY', currentStage: null, progress: { completedStages: 4, percent: null } });
    expect(() => assertAiDesignGenerationOrchestrator(state)).not.toThrow();
  });

  it('rejects stale transitions and blocks an unready checkpoint', () => {
    const blocked = createAiDesignGenerationOrchestrator({ runId: 'run-2', checkpoint: checkpoint(false), modelSelection: { mode: 'auto', plan: 'free' }, now: now(0) });
    expect(blocked.status).toBe('BLOCKED');
    const state = created();
    expect(beginAiDesignGeneration(state, 9)).toMatchObject({ ok: false, error: 'generation_revision_conflict' });
  });

  it('makes runtime fallback explicit and keeps the current stage retryable', () => {
    let state = created();
    const started = beginAiDesignGeneration(state, state.revision, now(1));
    if (!started.ok) throw new Error(started.error);
    state = started.state;
    const failed = failAiDesignGenerationStage(state, { expectedRevision: state.revision, stage: 'understanding', reason: 'provider_unavailable', retryable: true, now: now(2) });
    if (!failed.ok) throw new Error(failed.error);
    state = failed.state;
    const fallback = fallbackAiDesignGenerationModel(state, {
      expectedRevision: state.revision,
      request: { mode: 'auto', plan: 'enterprise', task: 'simple-execution' },
      reason: 'provider_unavailable', now: now(3),
    });
    if (!fallback.ok) throw new Error(fallback.error);
    state = fallback.state;
    expect(state.modelChanges[0]).toMatchObject({ fromModelId: 'gpt-luna', reason: 'provider_unavailable' });
    expect(state.modelReceipt.selectedModelId).not.toBe('gpt-luna');
    const retried = retryAiDesignGeneration(state, state.revision, now(4));
    expect(retried).toMatchObject({ ok: true, state: { status: 'RUNNING', currentStage: 'understanding' } });
  });

  it('cancels and resumes the exact current stage', () => {
    const started = beginAiDesignGeneration(created(), 0, now(1));
    if (!started.ok) throw new Error(started.error);
    const cancelled = cancelAiDesignGeneration(started.state, { expectedRevision: started.state.revision, reason: 'app_backgrounded', now: now(2) });
    if (!cancelled.ok) throw new Error(cancelled.error);
    expect(cancelled.state).toMatchObject({ status: 'CANCELLED', resumeStage: 'understanding' });
    const resumed = resumeAiDesignGeneration(cancelled.state, cancelled.state.revision, now(3));
    expect(resumed).toMatchObject({ ok: true, state: { status: 'RUNNING', currentStage: 'understanding', resumeStage: null } });
  });

  it('executes an injected worker and fails a timed-out stage closed', async () => {
    const started = beginAiDesignGeneration(created(), 0, now(1));
    if (!started.ok) throw new Error(started.error);
    const passed = await executeCurrentAiDesignGenerationStage(started.state, async input => ({ outputDigest: digest('c'), source: `worker-${input.selectedModelId}` }), { now: () => now(2) });
    expect(passed).toMatchObject({ ok: true, state: { currentStage: 'planning', stages: { understanding: { status: 'PASS' } } } });
    const timeout = await executeCurrentAiDesignGenerationStage(started.state, () => new Promise(() => undefined), { timeoutMs: 2, now: () => now(2) });
    expect(timeout).toMatchObject({ ok: true, state: { status: 'RETRY_WAIT', failure: 'generation_stage_timeout' } });
    const secretError = await executeCurrentAiDesignGenerationStage(started.state, async () => { throw new Error('provider apiKey=must-not-persist'); }, { now: () => now(2) });
    expect(secretError).toMatchObject({ ok: true, state: { failure: 'generation_worker_failed' } });
    expect(JSON.stringify(secretError)).not.toContain('must-not-persist');
  });

  it('restarts a failed stage when cancellation happens during retry wait', () => {
    const started = beginAiDesignGeneration(created(), 0, now(1));
    if (!started.ok) throw new Error(started.error);
    const failed = failAiDesignGenerationStage(started.state, { expectedRevision: started.state.revision, stage: 'understanding', reason: 'temporary', retryable: true, now: now(2) });
    if (!failed.ok) throw new Error(failed.error);
    const cancelled = cancelAiDesignGeneration(failed.state, { expectedRevision: failed.state.revision, now: now(3) });
    if (!cancelled.ok) throw new Error(cancelled.error);
    const resumed = resumeAiDesignGeneration(cancelled.state, cancelled.state.revision, now(4));
    if (!resumed.ok) throw new Error(resumed.error);
    expect(resumed.state.stages.understanding).toMatchObject({ status: 'RUNNING', attempt: 2 });
    expect(() => assertAiDesignGenerationOrchestrator(resumed.state)).not.toThrow();
  });
});
