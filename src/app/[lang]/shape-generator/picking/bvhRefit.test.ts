import { describe, it, expect } from 'vitest';
import {
  refitBvh,
  refitWithAdvice,
  imbalanceStats,
  findStaleSubtrees,
  rebuildSubtree,
  type BvhNode,
  type MeshArrays,
} from './bvhRefit';

function squareMesh(): MeshArrays {
  return {
    positions: [
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0, 1, 0,
    ],
    indices: [0, 1, 2, 0, 2, 3],
  };
}

function makeBvhLeaf(triIndices: number[], bounds = { min: [0, 0, 0] as [number, number, number], max: [1, 1, 0] as [number, number, number] }): BvhNode {
  return { bounds, triangleIndices: triIndices };
}

describe('refitBvh', () => {
  it('updates leaf bounds to match current positions', () => {
    const mesh = squareMesh();
    const leaf = makeBvhLeaf([0]);
    refitBvh(leaf, mesh);
    expect(leaf.bounds.min[0]).toBe(0);
    expect(leaf.bounds.max[0]).toBe(1);
  });

  it('internal node bounds = merged child bounds', () => {
    const mesh = squareMesh();
    const left = makeBvhLeaf([0]);
    const right = makeBvhLeaf([1]);
    const root: BvhNode = { bounds: { min: [-100, -100, -100], max: [100, 100, 100] }, left, right };
    refitBvh(root, mesh);
    expect(root.bounds.min[0]).toBe(0);
    expect(root.bounds.max[0]).toBe(1);
  });

  it('after position update, refit shrinks bounds', () => {
    const mesh = squareMesh();
    const leaf = makeBvhLeaf([0]);
    refitBvh(leaf, mesh);
    // Move vertex.
    mesh.positions[0] = -5;
    refitBvh(leaf, mesh);
    expect(leaf.bounds.min[0]).toBe(-5);
  });
});

describe('imbalanceStats', () => {
  it('reports tree depth', () => {
    const leaf = makeBvhLeaf([0]);
    const stats = imbalanceStats(leaf);
    expect(stats.maxDepth).toBe(0);
  });

  it('two-level tree has depth 1', () => {
    const left = makeBvhLeaf([0]);
    const right = makeBvhLeaf([1]);
    const root: BvhNode = { bounds: { min: [0, 0, 0], max: [1, 1, 0] }, left, right };
    expect(imbalanceStats(root).maxDepth).toBe(1);
  });

  it('reports tri-per-leaf stats', () => {
    const left = makeBvhLeaf([0]);
    const right = makeBvhLeaf([1, 2, 3]);
    const root: BvhNode = { bounds: { min: [0, 0, 0], max: [1, 1, 0] }, left, right };
    const stats = imbalanceStats(root);
    expect(stats.trianglesPerLeaf.min).toBe(1);
    expect(stats.trianglesPerLeaf.max).toBe(3);
  });
});

describe('refitWithAdvice', () => {
  it('recommendRebuild = false for tight tree', () => {
    const mesh = squareMesh();
    const root = makeBvhLeaf([0, 1]);
    const r = refitWithAdvice(root, mesh, { rebuildThreshold: 5 });
    expect(r.recommendRebuild).toBe(false);
  });

  it('reason is informative', () => {
    const mesh = squareMesh();
    const root = makeBvhLeaf([0, 1]);
    const r = refitWithAdvice(root, mesh);
    expect(r.reason).toMatch(/SAH/);
  });
});

describe('findStaleSubtrees', () => {
  it('returns empty for tight tree', () => {
    const left = makeBvhLeaf([0]);
    const right = makeBvhLeaf([1]);
    const root: BvhNode = { bounds: { min: [0, 0, 0], max: [1, 1, 0] }, left, right };
    const stale = findStaleSubtrees(root, 100);
    expect(stale).toEqual([]);
  });
});

describe('rebuildSubtree', () => {
  it('preserves all triangle ids', () => {
    const mesh = squareMesh();
    const left = makeBvhLeaf([0]);
    const right = makeBvhLeaf([1]);
    const root: BvhNode = { bounds: { min: [0, 0, 0], max: [1, 1, 0] }, left, right };
    rebuildSubtree(root, mesh, 1);
    const collectTris = (node: BvhNode): number[] => {
      if (node.triangleIndices) return node.triangleIndices;
      const out: number[] = [];
      if (node.left) out.push(...collectTris(node.left));
      if (node.right) out.push(...collectTris(node.right));
      return out;
    };
    expect(collectTris(root).sort()).toEqual([0, 1]);
  });

  it('respects leafSize', () => {
    const mesh = squareMesh();
    const root = makeBvhLeaf([0, 1]);
    rebuildSubtree(root, mesh, 1);
    // With leafSize=1 and 2 tris, root should split.
    expect(root.triangleIndices).toBeUndefined();
  });
});
