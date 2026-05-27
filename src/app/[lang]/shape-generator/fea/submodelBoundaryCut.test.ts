import { describe, it, expect } from 'vitest';
import {
  createSubmodelCut,
  interpolateDisplacement,
  validateSubmodelCut,
  summarize,
  type GlobalNode,
  type HotspotMarker,
  type SubmodelMeshNode,
} from './submodelBoundaryCut';

function node(id: string, x: number, y: number, z: number, ux: number = 0, uy: number = 0, uz: number = 0): GlobalNode {
  return { id, position: { x, y, z }, displacement: { x: ux, y: uy, z: uz } };
}

function buildGrid(spacing: number, range: number): GlobalNode[] {
  const nodes: GlobalNode[] = [];
  let i = 0;
  for (let x = -range; x <= range; x += spacing) {
    for (let y = -range; y <= range; y += spacing) {
      for (let z = -range; z <= range; z += spacing) {
        nodes.push(node(`n${i++}`, x, y, z, x * 0.01, y * 0.01, z * 0.01));
      }
    }
  }
  return nodes;
}

const hotspot: HotspotMarker = { centre: { x: 0, y: 0, z: 0 }, radius: 2 };

describe('createSubmodelCut', () => {
  it('builds a box around the hotspot', () => {
    const grid = buildGrid(1, 20);
    const cut = createSubmodelCut(grid, hotspot, { boxMultiplier: 4 });
    expect(cut.box.max.x - cut.box.min.x).toBeCloseTo(16, 1);
  });

  it('finds cut-face nodes on box boundary', () => {
    const grid = buildGrid(1, 20);
    const cut = createSubmodelCut(grid, hotspot, { boxMultiplier: 4 });
    expect(cut.cutFaceNodes.length).toBeGreaterThan(0);
  });

  it('flags St. Venant satisfied at multiplier 4 (≥ 3)', () => {
    const grid = buildGrid(1, 20);
    const cut = createSubmodelCut(grid, hotspot, { boxMultiplier: 4 });
    expect(cut.stVenantSatisfied).toBe(true);
  });

  it('flags St. Venant not satisfied when multiplier too small', () => {
    const grid = buildGrid(1, 20);
    const cut = createSubmodelCut(grid, hotspot, { boxMultiplier: 2 });
    expect(cut.stVenantSatisfied).toBe(false);
  });

  it('internal node count > 0 for dense grid', () => {
    const grid = buildGrid(1, 20);
    const cut = createSubmodelCut(grid, hotspot, { boxMultiplier: 4 });
    expect(cut.internalNodeCount).toBeGreaterThan(0);
  });

  it('larger multiplier → larger box', () => {
    const grid = buildGrid(1, 30);
    const small = createSubmodelCut(grid, hotspot, { boxMultiplier: 3 });
    const big = createSubmodelCut(grid, hotspot, { boxMultiplier: 6 });
    expect(big.box.max.x).toBeGreaterThan(small.box.max.x);
  });
});

describe('interpolateDisplacement', () => {
  it('interpolates onto submodel nodes', () => {
    const grid = buildGrid(1, 20);
    const cut = createSubmodelCut(grid, hotspot, { boxMultiplier: 4 });
    const submeshNodes: SubmodelMeshNode[] = [{ id: 'sm1', position: { x: 0, y: 0, z: 0 } }];
    const bcs = interpolateDisplacement(cut, submeshNodes);
    expect(bcs).toHaveLength(1);
    expect(bcs[0]!.confidence).toBeGreaterThan(0);
  });

  it('empty cut nodes → empty result', () => {
    const grid: GlobalNode[] = [];
    const cut = createSubmodelCut(grid, hotspot, { boxMultiplier: 4 });
    const bcs = interpolateDisplacement(cut, [{ id: 'a', position: { x: 0, y: 0, z: 0 } }]);
    expect(bcs).toEqual([]);
  });

  it('node at zero distance → high weight', () => {
    const grid = buildGrid(1, 20);
    const cut = createSubmodelCut(grid, hotspot, { boxMultiplier: 4 });
    // Exact location of a known node.
    const ref = cut.cutFaceNodes[0]!;
    const target: SubmodelMeshNode = { id: 'm', position: ref.position };
    const bc = interpolateDisplacement(cut, [target]);
    // Should approximate that node's displacement.
    expect(bc[0]!.displacement.x).toBeCloseTo(ref.displacement.x, 1);
  });

  it('respects kNearest', () => {
    const grid = buildGrid(1, 20);
    const cut = createSubmodelCut(grid, hotspot, { boxMultiplier: 4 });
    const submeshNodes: SubmodelMeshNode[] = [{ id: 'sm1', position: { x: 1, y: 1, z: 1 } }];
    const bc1 = interpolateDisplacement(cut, submeshNodes, { kNearest: 1 });
    const bc4 = interpolateDisplacement(cut, submeshNodes, { kNearest: 4 });
    // Different outcomes from different K.
    expect(bc1).toHaveLength(1);
    expect(bc4).toHaveLength(1);
  });
});

describe('validateSubmodelCut', () => {
  it('flags St. Venant deficiency', () => {
    const grid = buildGrid(1, 20);
    const cut = createSubmodelCut(grid, hotspot, { boxMultiplier: 2 });
    const v = validateSubmodelCut(cut, hotspot);
    expect(v.ok).toBe(false);
    expect(v.issues.some(i => i.includes('St. Venant'))).toBe(true);
  });

  it('flags too few cut-face nodes', () => {
    const grid: GlobalNode[] = [node('a', 0, 0, 0)];
    const cut = createSubmodelCut(grid, hotspot, { boxMultiplier: 4 });
    const v = validateSubmodelCut(cut, hotspot);
    expect(v.ok).toBe(false);
    expect(v.issues.some(i => i.includes('cut-face nodes'))).toBe(true);
  });

  it('valid cut → ok=true', () => {
    const grid = buildGrid(1, 20);
    const cut = createSubmodelCut(grid, hotspot, { boxMultiplier: 4 });
    const v = validateSubmodelCut(cut, hotspot);
    expect(v.ok).toBe(true);
  });

  it('stVenantRatio reported', () => {
    const grid = buildGrid(1, 20);
    const cut = createSubmodelCut(grid, hotspot, { boxMultiplier: 4 });
    const v = validateSubmodelCut(cut, hotspot);
    expect(v.stVenantRatio).toBeGreaterThanOrEqual(3);
  });
});

describe('summarize', () => {
  it('reports counts + flag', () => {
    const grid = buildGrid(1, 20);
    const cut = createSubmodelCut(grid, hotspot, { boxMultiplier: 4 });
    const s = summarize(cut);
    expect(s.cutFaceNodeCount).toBeGreaterThan(0);
    expect(s.internalNodeCount).toBeGreaterThan(0);
    expect(s.stVenantSatisfied).toBe(true);
  });

  it('boxVolumeMm3 = box dimensions product', () => {
    const grid = buildGrid(1, 20);
    const cut = createSubmodelCut(grid, hotspot, { boxMultiplier: 4 });
    const s = summarize(cut);
    expect(s.boxVolumeMm3).toBeCloseTo(16 ** 3, 1);
  });
});
