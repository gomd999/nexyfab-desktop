import { describe, expect, it, vi } from 'vitest';
import { geometryNumericParameters } from '@/lib/ai/productDecompositionAccuracy';
import type { FeatureTree } from '@/lib/cad/featureTree';
import { handleProductDecomposition } from './handler';

const tree = { nodes: [{ id: 'base', name: 'Base', dependencies: [], payload: { kind: 'extrude', loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], depth: 5, direction: 'one_sided', mode: 'add' } }] } satisfies FeatureTree;
const parameterEvidence = geometryNumericParameters(tree).map(parameter => ({ ...parameter, unit: 'mm', tolerance: 0.01, status: 'confirmed', sourceRef: 'user:prompt', locked: true }));
const valid = {
  version: 1, units: 'mm', productName: 'Clamp',
  requirements: [{ id: 'r1', text: 'clamp', category: 'function', source: 'user', sourceRef: 'user:prompt' }],
  definitions: [
    { id: 'jaw', name: 'Jaw', responsibility: 'grip', makeOrBuy: 'make', featureTree: tree, requirementIds: ['r1'], parameterEvidence, metadata: { partNumber: 'NX-JAW', revision: 'A', material: 'AL6061', process: 'CNC milling', source: 'confirmed' } },
    { id: 'screw', name: 'Screw', responsibility: 'apply force', makeOrBuy: 'make', featureTree: tree, requirementIds: ['r1'], parameterEvidence, metadata: { partNumber: 'NX-SCR', revision: 'A', material: 'S45C', process: 'CNC turning', source: 'confirmed' } },
  ],
  instances: [
    { id: 'jaw-1', definitionId: 'jaw', positionMm: [0, 0, 0], fixed: true },
    { id: 'screw-1', definitionId: 'screw', positionMm: [20, 0, 0] },
  ],
  mates: [{ id: 'screw-axis', kind: 'concentric', a: { partId: 'jaw-1', refId: 'bore', refKind: 'axis' }, b: { partId: 'screw-1', refId: 'axis', refKind: 'axis' } }], subassemblies: [{ id: 'clamp-main', name: 'Clamp', instanceIds: ['jaw-1', 'screw-1'], rigid: false }],
  observations: [], assumptions: [], unresolved: [],
};

describe('handleProductDecomposition', () => {
  it('returns a validated canonical multi-part program', async () => {
    const generator = vi.fn(async (_prompt: string, _signal: AbortSignal) => `\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``);
    const result = await handleProductDecomposition({ text: '10mm parts clamp' }, generator);
    expect(result.status).toBe(200);
    expect(result.payload.ok).toBe(true);
    expect((result.payload.program as { parts: unknown[] }).parts).toHaveLength(2);
    expect(generator.mock.calls[0]?.[0]).toContain('Never merge distinct functional components into one body');
  });

  it('rejects AI output with empty manufactured geometry', async () => {
    const invalid = structuredClone(valid);
    invalid.definitions[0]!.featureTree.nodes = [];
    const result = await handleProductDecomposition({ text: 'clamp' }, async () => invalid);
    expect(result.status).toBe(422);
    expect(result.payload.code).toBe('DECOMPOSITION_NEEDS_REVIEW');
  });

  it('does not call AI for an empty request', async () => {
    const generator = vi.fn();
    const result = await handleProductDecomposition({ text: ' ' }, generator);
    expect(result.status).toBe(400);
    expect(generator).not.toHaveBeenCalled();
  });
});
