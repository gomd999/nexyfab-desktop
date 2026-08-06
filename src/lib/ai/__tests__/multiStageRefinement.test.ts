import { describe, expect, it, vi } from 'vitest';
import { REFINEMENT_STAGES, refinementPromptContract, runMultiStageRefinement } from '../multiStageRefinement';

describe('multi-stage AI refinement', () => {
  it('refines a weak draft in-place then advances through immutable checkpoints', async () => {
    const calls: Array<{ stage: string; attempt: number; prior: string[] }> = [];
    const generate = vi.fn(async (context) => {
      calls.push({ stage: context.stage, attempt: context.attempt, prior: Object.keys(context.priorOutputs) });
      const weak = context.stage === 'decomposition' && context.attempt === 1;
      return {
        stage: context.stage, output: { stage: context.stage, revision: context.attempt },
        completeness: weak ? 0.8 : 1, confidence: weak ? 0.7 : 0.99,
        unresolved: [], conflicts: [], affectedPartIds: context.stage === 'part_programs' ? ['p1'] : [],
        evidenceRefs: [`e:${context.stage}`],
      };
    });
    const result = await runMultiStageRefinement({ runId: 'complex-1', request: 'robot arm', generate });
    expect(result.status).toBe('ready_for_geometry');
    expect(REFINEMENT_STAGES.every(stage => result.state.stages[stage].status === 'passed')).toBe(true);
    expect(calls.filter(call => call.stage === 'decomposition')).toHaveLength(2);
    expect(calls.find(call => call.stage === 'interfaces')?.prior).toEqual(['intent', 'decomposition']);
  });

  it('stops for authoritative input instead of guessing a missing dimension', async () => {
    const result = await runMultiStageRefinement({ runId: 'needs-input', request: 'jet engine', generate: async context => ({
      stage: context.stage, output: {}, completeness: 0.5, confidence: 0.4,
      unresolved: ['shaft diameter is not specified'], conflicts: [], affectedPartIds: [], evidenceRefs: ['user:req'],
    }) });
    expect(result).toMatchObject({ status: 'needs_input', stoppedAt: 'intent' });
    expect(result.state.stages.intent.status).toBe('blocked');
    expect(result.state.stages.decomposition.status).toBe('pending');
  });

  it('bounds repeated low-confidence refinement and never advances downstream', async () => {
    const result = await runMultiStageRefinement({ runId: 'bounded', request: 'factory', maxAttemptsPerStage: 2, generate: async context => ({
      stage: context.stage, output: {}, completeness: 0.9, confidence: 0.6,
      unresolved: [], conflicts: [], affectedPartIds: [], evidenceRefs: ['manual:1'],
    }) });
    expect(result).toMatchObject({ status: 'stopped', stoppedAt: 'intent' });
    expect(result.state.stages.intent.attempt).toBe(2);
    expect(result.reasons.at(-1)).toMatch(/exhausted 2/);
  });

  it('produces a prompt contract that preserves upstream evidence and forbids invented dimensions', () => {
    const prompt = refinementPromptContract({ request: 'gearbox', stage: 'interfaces', attempt: 2, priorOutputs: {}, priorCheckpointHashes: {}, feedback: ['bearing interface missing'], immutableEvidenceRefs: ['manual:iso'], });
    expect(prompt).toContain('Change only fields required');
    expect(prompt).toContain('never invent a manufacturing dimension');
    expect(prompt).toContain('not one merged body');
  });
});
