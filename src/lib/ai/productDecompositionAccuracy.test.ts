import { describe, expect, it } from 'vitest';
import type { ProductDecompositionPlan } from './productDecomposition';
import { assessProductDecompositionAccuracy, geometryNumericParameters, isProductDecompositionPlan } from './productDecompositionAccuracy';

const tree = (id: string) => ({ nodes: [{
  id: `${id}-base`, name: 'Base', dependencies: [],
  payload: { kind: 'extrude' as const, loop: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }], depth: 10, direction: 'one_sided' as const, mode: 'add' as const },
}] });

const evidence = (featureTree: ReturnType<typeof tree>) => geometryNumericParameters(featureTree).map(parameter => ({
  ...parameter, unit: 'mm' as const, tolerance: 0.01, status: 'confirmed' as const,
  sourceRef: 'user:prompt', locked: true,
}));

const plan = (): ProductDecompositionPlan => ({
  version: 1, units: 'mm', productName: 'Verified actuator',
  requirements: [{ id: 'r-motion', text: 'Shaft rotates relative to housing', category: 'motion', source: 'user', sourceRef: 'user:prompt', acceptance: 'Continuous rotation through 360 degrees without collision' }],
  definitions: [
    { id: 'housing', name: 'Housing', responsibility: 'Support shaft', makeOrBuy: 'make', featureTree: tree('housing'), requirementIds: ['r-motion'], parameterEvidence: evidence(tree('housing')), metadata: { partNumber: 'H-1', revision: 'A', material: 'AL6061', process: 'CNC milling', source: 'confirmed' } },
    { id: 'shaft', name: 'Shaft', responsibility: 'Transmit torque', makeOrBuy: 'make', featureTree: tree('shaft'), requirementIds: ['r-motion'], parameterEvidence: evidence(tree('shaft')), metadata: { partNumber: 'S-1', revision: 'A', material: 'S45C', process: 'CNC turning', source: 'confirmed' } },
  ],
  instances: [
    { id: 'housing-1', definitionId: 'housing', positionMm: [0, 0, 0], fixed: true },
    { id: 'shaft-1', definitionId: 'shaft', positionMm: [0, 0, 0] },
  ],
  mates: [{ id: 'shaft-axis', kind: 'concentric', a: { partId: 'housing-1', refId: 'bore-axis', refKind: 'axis' }, b: { partId: 'shaft-1', refId: 'axis', refKind: 'axis' } }],
  subassemblies: [], observations: [], assumptions: [], unresolved: [],
});

describe('product decomposition accuracy gate', () => {
  it('admits a traced, authoritative and connected editable product plan', () => {
    const result = assessProductDecompositionAccuracy(plan());
    expect(result).toMatchObject({ readyForGeometry: true, requiresAuthoritativeInput: false, metrics: { connectedInstances: 2, tracedRequirements: 1 } });
  });

  it('requests authoritative input for hidden assumptions and missing manufacturing facts', () => {
    const value = plan();
    value.assumptions = ['shaft diameter inferred from image'];
    value.definitions[0]!.metadata.process = undefined;
    const result = assessProductDecompositionAccuracy(value);
    expect(result.readyForGeometry).toBe(false);
    expect(result.requiresAuthoritativeInput).toBe(true);
    expect(result.gates.find(gate => gate.id === 'authoritative-inputs')?.reasons).toEqual(expect.arrayContaining([expect.stringContaining('shaft diameter'), expect.stringContaining('process')]));
  });

  it('rejects disconnected occurrences and invalid quaternions even at model confidence 100%', () => {
    const value = plan();
    value.mates = [];
    value.instances[1]!.orientation = { x: 0, y: 0, z: 0, w: 2 };
    const result = assessProductDecompositionAccuracy(value);
    expect(result.gates.find(gate => gate.id === 'assembly-connectivity')?.status).toBe('refine');
    expect(result.gates.find(gate => gate.id === 'transforms')?.status).toBe('refine');
  });

  it('blocks geometry when any numeric parameter loses evidence or changes after review', () => {
    const missing = plan();
    missing.definitions[0]!.parameterEvidence.pop();
    expect(assessProductDecompositionAccuracy(missing).gates.find(gate => gate.id === 'parameter-provenance')?.status).toBe('input_required');

    const changed = plan();
    changed.definitions[0]!.parameterEvidence[0]!.value = 999;
    expect(assessProductDecompositionAccuracy(changed).gates.find(gate => gate.id === 'parameter-provenance')?.reasons)
      .toEqual(expect.arrayContaining([expect.stringContaining('does not match geometry value')]));
  });

  it('guards untrusted model JSON before typed validation', () => {
    expect(isProductDecompositionPlan({ version: 1, units: 'mm' })).toBe(false);
    const malformed = plan() as unknown as { definitions: Array<{ featureTree: { nodes: Array<{ payload: Record<string, unknown> }> } }> };
    malformed.definitions[0]!.featureTree.nodes[0]!.payload.depth = 'ten';
    expect(isProductDecompositionPlan(malformed)).toBe(false);
  });
});
