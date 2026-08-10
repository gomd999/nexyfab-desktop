import { describe, expect, it, vi } from 'vitest';
import { REFINEMENT_STAGES, refinementPromptContract, runMultiStageRefinement } from '../multiStageRefinement';
import type { ProductDecompositionPlan } from '../productDecomposition';
import { geometryNumericParameters } from '../productDecompositionAccuracy';

const solidTree = (id: string, size: number, depth: number): ProductDecompositionPlan['definitions'][number]['featureTree'] => ({ nodes: [{
  id: `${id}-solid`, name: id, dependencies: [], payload: { kind: 'extrude', loop: [{ x: 0, y: 0 }, { x: size, y: 0 }, { x: size, y: size }, { x: 0, y: size }], depth, direction: 'one_sided', mode: 'add' },
}] });
const evidence = (tree: ProductDecompositionPlan['definitions'][number]['featureTree']) => geometryNumericParameters(tree).map(parameter => ({
  ...parameter, unit: 'mm' as const, tolerance: 0.01, status: 'confirmed' as const, sourceRef: 'user:prompt', locked: true,
}));

const finalPlan = (): ProductDecompositionPlan => ({
  version: 1, units: 'mm', productName: 'Connected product',
  requirements: [{ id: 'r1', text: 'Transmit rotation', category: 'motion', source: 'user', sourceRef: 'user:prompt', acceptance: '360 degree rotation without collision' }],
  definitions: [
    { id: 'base', name: 'Base', responsibility: 'Anchor product', makeOrBuy: 'make', featureTree: solidTree('base', 20, 10), metadata: { partNumber: 'B1', revision: 'A', material: 'AL6061', process: 'CNC milling', source: 'confirmed' }, requirementIds: ['r1'], parameterEvidence: evidence(solidTree('base', 20, 10)) },
    { id: 'shaft', name: 'Shaft', responsibility: 'Transmit rotation', makeOrBuy: 'make', featureTree: solidTree('shaft', 5, 20), metadata: { partNumber: 'S1', revision: 'A', material: 'S45C', process: 'CNC turning', source: 'confirmed' }, requirementIds: ['r1'], parameterEvidence: evidence(solidTree('shaft', 5, 20)) },
  ],
  instances: [{ id: 'base-1', definitionId: 'base', positionMm: [0, 0, 0], fixed: true }, { id: 'shaft-1', definitionId: 'shaft', positionMm: [0, 0, 0] }],
  mates: [{ id: 'm1', kind: 'concentric', a: { partId: 'base-1', refId: 'axis', refKind: 'axis' }, b: { partId: 'shaft-1', refId: 'axis', refKind: 'axis' } }],
  subassemblies: [], observations: [], assumptions: [], unresolved: [],
});

describe('multi-stage AI refinement', () => {
  it('refines a weak draft in-place then advances through immutable checkpoints', async () => {
    const calls: Array<{ stage: string; attempt: number; prior: string[] }> = [];
    const generate = vi.fn(async (context) => {
      calls.push({ stage: context.stage, attempt: context.attempt, prior: Object.keys(context.priorOutputs) });
      const weak = context.stage === 'decomposition' && context.attempt === 1;
      return {
        stage: context.stage, output: context.stage === 'part_programs' ? finalPlan() : { stage: context.stage, revision: context.attempt },
        completeness: weak ? 0.8 : 1, confidence: weak ? 0.7 : 0.99,
        unresolved: [], conflicts: [], affectedPartIds: context.stage === 'part_programs' ? ['p1'] : [],
        evidenceRefs: ['user:prompt'],
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
    expect(prompt).toContain('evidenceRefs may contain only');
  });

  it('rejects an evidence reference invented by the model', async () => {
    const result = await runMultiStageRefinement({ runId: 'invented-evidence', request: 'gearbox', maxAttemptsPerStage: 1, generate: async stage => ({
      stage: stage.stage, output: {}, completeness: 1, confidence: 1, unresolved: [], conflicts: [], affectedPartIds: [], evidenceRefs: ['web:made-up-source'],
    }) });
    expect(result).toMatchObject({ status: 'stopped', stoppedAt: 'intent' });
    expect(result.reasons.join(' ')).toContain('Untrusted evidence references');
  });
});
