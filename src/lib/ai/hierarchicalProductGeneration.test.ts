import { describe, expect, it, vi } from 'vitest';
import type { ProductDecompositionPlan } from './productDecomposition';
import { geometryNumericParameters } from './productDecompositionAccuracy';
import { runHierarchicalProductGeneration } from './hierarchicalProductGeneration';

const tree = (id: string, depth = 10): ProductDecompositionPlan['definitions'][number]['featureTree'] => ({ nodes: [{ id, name: id, dependencies: [], payload: { kind: 'extrude', loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], depth, direction: 'one_sided', mode: 'add' } }] });
const evidence = (featureTree: ReturnType<typeof tree>) => geometryNumericParameters(featureTree).map(parameter => ({ ...parameter, unit: 'mm' as const, tolerance: 0.01, status: 'confirmed' as const, sourceRef: 'user:prompt', locked: true }));
const plan = (): ProductDecompositionPlan => ({
  version: 1, units: 'mm', productName: 'Drive', requirements: [{ id: 'r', text: 'drive', category: 'function', source: 'user', sourceRef: 'user:prompt' }],
  definitions: ['base', 'shaft'].map(id => ({ id, name: id, responsibility: id, makeOrBuy: 'make' as const, featureTree: tree(id), parameterEvidence: evidence(tree(id)), requirementIds: ['r'], metadata: { partNumber: id, revision: 'A', material: 'steel', process: 'CNC', source: 'confirmed' as const } })),
  instances: [{ id: 'base-1', definitionId: 'base', positionMm: [0, 0, 0], fixed: true }, { id: 'shaft-1', definitionId: 'shaft', positionMm: [0, 0, 0] }], mates: [],
  subassemblies: [{ id: 'drive', name: 'Drive', instanceIds: ['base-1', 'shaft-1'], rigid: false }], observations: [], assumptions: [], unresolved: [],
});

describe('hierarchical product generation', () => {
  it('repairs only the failed part, preserves passed checkpoints, then solves hierarchy', async () => {
    const attempts = new Map<string, number>();
    const solveSubassembly = vi.fn(async () => ({ passed: true, errors: [], artifact: { solved: 'drive' } }));
    const result = await runHierarchicalProductGeneration({ runId: 'h1', plan: plan(), deps: {
      generatePart: async ({ definition, attempt }) => { attempts.set(definition.id, (attempts.get(definition.id) ?? 0) + 1); return { definitionId: definition.id, featureTree: tree(definition.id), artifact: { id: definition.id, attempt } }; },
      verifyPart: async ({ definition, generated }) => definition.id === 'shaft' && (generated.artifact as { attempt: number }).attempt === 1 ? { passed: false, errors: ['kernel_invalid'] } : { passed: true, errors: [] },
      solveSubassembly, solveFinalAssembly: async () => ({ passed: true, errors: [], artifact: { assembly: true } }),
    } });
    expect(result.status).toBe('passed'); expect(attempts.get('base')).toBe(1); expect(attempts.get('shaft')).toBe(2);
    expect(result.state.parts.base.checkpointHash).toHaveLength(64); expect(solveSubassembly).toHaveBeenCalledOnce();
  });

  it('rejects a repair that changes a locked dimension', async () => {
    const result = await runHierarchicalProductGeneration({ runId: 'h2', plan: plan(), maxPartAttempts: 1, deps: {
      generatePart: async ({ definition }) => ({ definitionId: definition.id, featureTree: tree(definition.id, definition.id === 'base' ? 11 : 10), artifact: {} }),
      verifyPart: async () => ({ passed: true, errors: [] }), solveSubassembly: async () => ({ passed: true, errors: [], artifact: {} }), solveFinalAssembly: async () => ({ passed: true, errors: [], artifact: {} }),
    } });
    expect(result).toMatchObject({ status: 'stopped', stoppedAt: 'part:base' });
    expect(result.errors.join(' ')).toContain('locked_parameter_changed');
  });

  it('stops for manual review at an assembly interface without rebuilding verified parts', async () => {
    const generatePart = vi.fn(async ({ definition }: { definition: ProductDecompositionPlan['definitions'][number] }) => ({ definitionId: definition.id, featureTree: definition.featureTree, artifact: {} }));
    const result = await runHierarchicalProductGeneration({ runId: 'h3', plan: plan(), deps: {
      generatePart, verifyPart: async () => ({ passed: true, errors: [] }), solveSubassembly: async () => ({ passed: false, errors: ['mate_conflict'] }), solveFinalAssembly: async () => ({ passed: true, errors: [], artifact: {} }),
    } });
    expect(result).toMatchObject({ status: 'manual_review', stoppedAt: 'subassembly:drive' }); expect(generatePart).toHaveBeenCalledTimes(2);
  });
});
