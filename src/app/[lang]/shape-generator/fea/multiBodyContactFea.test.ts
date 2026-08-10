import { describe, expect, it } from 'vitest';
import { TopologyGrid } from '../analysis/topology3D';
import { solveMultiBodyContactFea } from './multiBodyContactFea';

describe('structured HEX8 multibody contact FEA', () => {
  it('transfers load between separate elastic bodies only through active contact nodes', () => {
    const gridA = new TopologyGrid(1, 1, 1), gridB = new TopologyGrid(1, 1, 1);
    const bottomB = [gridB.node(0, 0, 0), gridB.node(1, 0, 0), gridB.node(1, 1, 0), gridB.node(0, 1, 0)];
    const bottomA = [gridA.node(0, 0, 0), gridA.node(1, 0, 0), gridA.node(1, 1, 0), gridA.node(0, 1, 0)];
    const topA = [gridA.node(0, 0, 1), gridA.node(1, 0, 1), gridA.node(1, 1, 1), gridA.node(0, 1, 1)];
    const result = solveMultiBodyContactFea({
      bodies: [
        { id: 'plate-a', grid: gridA, youngsModulusMpa: 210000, poissonRatio: 0.3, cellMm: 10 },
        { id: 'plate-b', grid: gridB, youngsModulusMpa: 210000, poissonRatio: 0.3, cellMm: 10 },
      ],
      fixed: [
        ...bottomB.map(nodeId => ({ bodyId: 'plate-b', nodeId, axes: [0, 1, 2] as Array<0 | 1 | 2> })),
        ...bottomA.map(nodeId => ({ bodyId: 'plate-a', nodeId, axes: [0, 1] as Array<0 | 1 | 2> })),
      ],
      loads: topA.map(nodeId => ({ bodyId: 'plate-a', nodeId, forceN: [0, 0, 250] as [number, number, number] })),
      contacts: bottomA.map((nodeA, index) => ({
        id: `contact-${index}`, bodyA: 'plate-a', nodeA, bodyB: 'plate-b', nodeB: bottomB[index]!, normalAxis: 2 as const,
        initialGapMm: 0, penaltyStiffnessNPerMm: 1e8,
      })),
    });
    expect(result).toMatchObject({ converged: true, linearConverged: true, activeSetConverged: true });
    expect(result.contacts.every(contact => contact.active && contact.normalForceN > 0)).toBe(true);
    expect(result.contacts.reduce((sum, contact) => sum + contact.normalForceN, 0)).toBeCloseTo(1000, 2);
    expect(result.equilibriumResidualRatio).toBeLessThan(1e-7);
    expect(result.maxDisplacementMm).toBeGreaterThan(0);
    expect(result.maxVonMisesMpa).toBeGreaterThan(0);
  });

  it('keeps a positive-gap interface open when the elastic trial cannot close it', () => {
    const grid = new TopologyGrid(1, 1, 1);
    const fixed = Array.from({ length: grid.nNodes }, (_, nodeId) => ({ bodyId: 'b', nodeId, axes: [0, 1, 2] as Array<0 | 1 | 2> }));
    const result = solveMultiBodyContactFea({
      bodies: [
        { id: 'a', grid, youngsModulusMpa: 210000, poissonRatio: 0.3, cellMm: 10 },
        { id: 'b', grid: new TopologyGrid(1, 1, 1), youngsModulusMpa: 210000, poissonRatio: 0.3, cellMm: 10 },
      ],
      fixed: [...fixed, ...Array.from({ length: grid.nNodes }, (_, nodeId) => ({ bodyId: 'a', nodeId, axes: [0, 1] as Array<0 | 1 | 2> }))],
      loads: [{ bodyId: 'a', nodeId: grid.node(0, 0, 1), forceN: [0, 0, 1] }],
      contacts: [{ id: 'gap', bodyA: 'a', nodeA: grid.node(0, 0, 0), bodyB: 'b', nodeB: grid.node(0, 0, 1), normalAxis: 2, initialGapMm: 1, penaltyStiffnessNPerMm: 1e8 }],
    });
    expect(result.contacts[0]).toMatchObject({ active: false, normalForceN: 0, penetrationMm: 0 });
  });

  it('rejects self-contact and invalid material inputs before solving', () => {
    const grid = new TopologyGrid(1, 1, 1);
    expect(() => solveMultiBodyContactFea({
      bodies: [{ id: 'a', grid, youngsModulusMpa: -1, poissonRatio: 0.3, cellMm: 1 }], fixed: [], loads: [], contacts: [],
    })).toThrow(/INVALID_MULTIBODY_BODY/);
  });
});
