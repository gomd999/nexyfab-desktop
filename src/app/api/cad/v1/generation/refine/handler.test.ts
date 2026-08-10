import { describe, expect, it } from 'vitest';
import { createGenerationRun, recordGenerationStage } from '@/lib/ai/generationRunState';
import type { ProductDecompositionPlan } from '@/lib/ai/productDecomposition';
import { geometryNumericParameters } from '@/lib/ai/productDecompositionAccuracy';
import { handleGenerationRefine } from './handler';

const solidTree = (id: string, size: number, depth: number): ProductDecompositionPlan['definitions'][number]['featureTree'] => ({ nodes: [{
  id, name: id, dependencies: [], payload: { kind: 'extrude', loop: [{ x: 0, y: 0 }, { x: size, y: 0 }, { x: size, y: size }, { x: 0, y: size }], depth, direction: 'one_sided', mode: 'add' },
}] });
const evidence = (tree: ProductDecompositionPlan['definitions'][number]['featureTree']) => geometryNumericParameters(tree).map(parameter => ({
  ...parameter, unit: 'mm' as const, tolerance: 0.01, status: 'confirmed' as const, sourceRef: 'user:prompt', locked: true,
}));

const context = { request: 'robot arm', stage: 'intent' as const, attempt: 1, priorOutputs: {}, priorCheckpointHashes: {}, feedback: [], immutableEvidenceRefs: [] };
const plan = (): ProductDecompositionPlan => ({
  version: 1, units: 'mm', productName: 'Actuator',
  requirements: [{ id: 'r1', text: 'Shaft rotates', category: 'motion', source: 'user', sourceRef: 'user:prompt', acceptance: '360 degree rotation without collision' }],
  definitions: [
    { id: 'base', name: 'Base', responsibility: 'Anchor', makeOrBuy: 'make', featureTree: solidTree('b', 10, 10), parameterEvidence: evidence(solidTree('b', 10, 10)), metadata: { partNumber: 'B1', revision: 'A', material: 'AL6061', process: 'CNC milling', source: 'confirmed' }, requirementIds: ['r1'] },
    { id: 'shaft', name: 'Shaft', responsibility: 'Rotate', makeOrBuy: 'make', featureTree: solidTree('s', 5, 20), parameterEvidence: evidence(solidTree('s', 5, 20)), metadata: { partNumber: 'S1', revision: 'A', material: 'S45C', process: 'CNC turning', source: 'confirmed' }, requirementIds: ['r1'] },
  ],
  instances: [{ id: 'base-1', definitionId: 'base', positionMm: [0, 0, 0], fixed: true }, { id: 'shaft-1', definitionId: 'shaft', positionMm: [0, 0, 0] }],
  mates: [{ id: 'm1', kind: 'concentric', a: { partId: 'base-1', refId: 'axis', refKind: 'axis' }, b: { partId: 'shaft-1', refId: 'axis', refKind: 'axis' } }],
  subassemblies: [], observations: [], assumptions: [], unresolved: [],
});
const beforePartPrograms = () => {
  let state = createGenerationRun('part-plan');
  for (const stage of ['intent', 'decomposition', 'interfaces'] as const) state = recordGenerationStage(state, { stage, input: stage, output: { accepted: true }, status: 'passed' });
  return state;
};
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
  it('independently blocks hidden assumptions despite model confidence 100%', async () => {
    const output = plan(); output.assumptions = ['shaft tolerance inferred'];
    const result = await handleGenerationRefine({ state: beforePartPrograms(), context: { ...context, stage: 'part_programs', attempt: 1 }, maxAttempts: 3 }, async () => ({ stage: 'part_programs', output, completeness: 1, confidence: 1, unresolved: [], conflicts: [], affectedPartIds: ['shaft-1'], evidenceRefs: ['user:prompt'] }));
    expect(result).toMatchObject({ status: 200, payload: { decision: { disposition: 'request_input' }, accuracyAssessment: { readyForGeometry: false, requiresAuthoritativeInput: true }, state: { stages: { part_programs: { status: 'blocked' } } } } });
    expect(result.payload).not.toHaveProperty('program');
  });
  it('compiles only a traced, authoritative and mate-connected product plan', async () => {
    const result = await handleGenerationRefine({ state: beforePartPrograms(), context: { ...context, stage: 'part_programs', attempt: 1 } }, async () => ({ stage: 'part_programs', output: plan(), completeness: 1, confidence: 1, unresolved: [], conflicts: [], affectedPartIds: [], evidenceRefs: ['user:prompt'] }));
    expect(result).toMatchObject({ status: 200, payload: { decision: { disposition: 'advance' }, accuracyAssessment: { readyForGeometry: true }, program: { classification: 'review_required' }, state: { stages: { part_programs: { status: 'passed', metrics: { accuracyGatesPassed: 9, accuracyGatesTotal: 9 } } } } } });
  });
});
