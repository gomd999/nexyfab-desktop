import { describe, expect, it } from 'vitest';
import { createGenerationRun } from '@/lib/ai/generationRunState';
import { handleGenerationRefine } from './handler';

const context = { request: 'robot arm', stage: 'intent' as const, attempt: 1, priorOutputs: {}, priorCheckpointHashes: {}, feedback: [], immutableEvidenceRefs: [] };
describe('generation refinement handler', () => {
  it('records one accepted AI refinement checkpoint', async () => {
    const result = await handleGenerationRefine({ state: createGenerationRun('api-refine'), context }, async () => JSON.stringify({ stage: 'intent', output: { requirements: ['move'] }, completeness: 1, confidence: 0.9, unresolved: [], conflicts: [], affectedPartIds: [], evidenceRefs: ['user:prompt'] }));
    expect(result).toMatchObject({ status: 200, payload: { ok: true, decision: { disposition: 'advance' }, state: { stages: { intent: { status: 'passed' } } }, quoteOrRfqSideEffects: false } });
  });
  it('never accepts malformed or unsupported model output', async () => {
    const result = await handleGenerationRefine({ state: createGenerationRun('bad'), context }, async () => '{"confidence":1}');
    expect(result).toMatchObject({ status: 422, payload: { code: 'INVALID_REFINEMENT_DRAFT' } });
  });
  it('returns needs-input without advancing the next stage', async () => {
    const result = await handleGenerationRefine({ state: createGenerationRun('ask'), context }, async () => ({ stage: 'intent', output: {}, completeness: 0.5, confidence: 0.7, unresolved: ['load required'], conflicts: [], affectedPartIds: [], evidenceRefs: ['user:prompt'] }));
    expect(result).toMatchObject({ status: 200, payload: { decision: { disposition: 'request_input' }, state: { stages: { intent: { status: 'blocked' }, decomposition: { status: 'pending' } } } } });
  });
});
