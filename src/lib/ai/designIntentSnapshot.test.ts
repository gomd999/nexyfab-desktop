import { describe, expect, it } from 'vitest';
import { compileProductDecomposition, type ProductDecompositionPlan } from './productDecomposition';
import { buildDesignIntentSnapshot, verifyProgramPreservesIntent } from './designIntentSnapshot';

const plan = (): ProductDecompositionPlan => ({
  version: 1, units: 'mm', productName: 'pump skid',
  requirements: [{ id: 'flow', text: 'move water', category: 'function', source: 'user', sourceRef: 'user:prompt', acceptance: 'connected inlet to outlet' }],
  definitions: [{ id: 'pump', name: 'Pump', responsibility: 'Move water', makeOrBuy: 'make', requirementIds: ['flow'], parameterEvidence: [], metadata: { partNumber: 'P-1', revision: 'A', source: 'confirmed', material: 'steel', process: 'machining' }, featureTree: { nodes: [{ id: 'body', name: 'body', dependencies: [], payload: { kind: 'extrude', loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], depth: 10, direction: 'one_sided', mode: 'add' } }] } }],
  instances: [{ id: 'pump-1', definitionId: 'pump', positionMm: [0, 0, 0], fixed: true }], mates: [], subassemblies: [], observations: [], assumptions: [], unresolved: [],
});

describe('design intent preservation', () => {
  it('accepts the deterministic compiled program', () => {
    const source = plan(), compiled = compileProductDecomposition(source);
    if (!compiled.ok) throw new Error('fixture failed');
    expect(verifyProgramPreservesIntent(buildDesignIntentSnapshot(source), compiled.program)).toEqual({ passed: true, errors: [] });
  });

  it('blocks deleted parts and feature simplification', () => {
    const source = plan(), compiled = compileProductDecomposition(source);
    if (!compiled.ok) throw new Error('fixture failed');
    const missing = structuredClone(compiled.program); missing.parts = [];
    expect(verifyProgramPreservesIntent(buildDesignIntentSnapshot(source), missing).errors).toContain('UNAPPROVED_COMPONENT_REMOVAL:pump-1');
    const simplified = structuredClone(compiled.program); simplified.parts[0]!.featureTree.nodes[0]!.id = 'proxy-box';
    expect(verifyProgramPreservesIntent(buildDesignIntentSnapshot(source), simplified).errors).toContain('CRITICAL_FEATURE_INVENTORY_MISMATCH:pump');
  });

  it('blocks a physical route that is silently removed after intent acceptance', () => {
    const source = plan();
    source.physicalNetworks = [{
      id: 'water',
      ports: [{ id: 'inlet', ownerObjectId: 'pump-1', system: 'hot_water', connector: 'DN25', positionMm: [0, 0, 0], required: true, direction: 'inlet', nominalDiameterMm: 25, axis: [1, 0, 0] }],
      nodes: [{ id: 'n0', system: 'hot_water', connector: 'DN25', positionMm: [0, 0, 0] }, { id: 'n1', system: 'hot_water', connector: 'DN25', positionMm: [100, 0, 0] }],
      connections: [{ id: 'c0', portId: 'inlet', nodeId: 'n0' }],
      runs: [{ id: 'r0', system: 'hot_water', fromNodeId: 'n0', toNodeId: 'n1', lengthMm: 100, diameterMm: 25, pathMm: [[0, 0, 0], [100, 0, 0]] }],
      rules: { maximumConnectionDistanceMm: 1, minimumDrainSlopePercent: 0, requireMatchingConnector: true, requirePhysicalRouteGeometry: true, requireRunFromConnectedPort: true, requireDiameterMatch: true },
    }];
    const compiled = compileProductDecomposition(source);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.issues));
    const stripped = structuredClone(compiled.program); stripped.physicalNetworks = [];
    expect(verifyProgramPreservesIntent(buildDesignIntentSnapshot(source), stripped).errors).toContain('PHYSICAL_NETWORK_TOPOLOGY_CHANGED');
  });
});
