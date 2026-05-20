import { describe, it, expect } from 'vitest';
import {
  generateSupportTree,
  computeStats,
  summarize,
  type OverhangPoint,
} from './supportTreeGenerator';

function downward(id: string, x: number, y: number, z: number): OverhangPoint {
  return { id, position: { x, y, z }, normal: { x: 0, y: 0, z: -1 } };
}

function upward(id: string, x: number, y: number, z: number): OverhangPoint {
  return { id, position: { x, y, z }, normal: { x: 0, y: 0, z: 1 } };
}

describe('generateSupportTree', () => {
  it('empty input → empty result', () => {
    const r = generateSupportTree([]);
    expect(r.nodes).toEqual([]);
    expect(r.supportedCount).toBe(0);
  });

  it('downward-facing points get supports', () => {
    const r = generateSupportTree([downward('p1', 0, 0, 10)]);
    expect(r.nodes.length).toBeGreaterThan(0);
    expect(r.supportedCount).toBe(1);
  });

  it('upward-facing points filtered out', () => {
    const r = generateSupportTree([upward('p1', 0, 0, 10)]);
    expect(r.supportedCount).toBe(0);
    expect(r.skippedCount).toBe(1);
  });

  it('multiple nearby tips merge into shared trunk', () => {
    const r = generateSupportTree(
      [downward('a', 0, 0, 10), downward('b', 1, 0, 10), downward('c', 0, 1, 10)],
      { mergeRadiusMm: 5 },
    );
    const branchNodes = r.nodes.filter(n => !n.isLeaf);
    expect(branchNodes.length).toBeGreaterThan(0);
  });

  it('disjoint tips do not merge', () => {
    const r = generateSupportTree(
      [downward('a', 0, 0, 10), downward('b', 100, 100, 10)],
      { mergeRadiusMm: 1 },
    );
    const roots = r.nodes.filter(n => n.parentId === null);
    expect(roots.length).toBe(2);
  });

  it('roots reach build plate', () => {
    const r = generateSupportTree([downward('a', 0, 0, 10)], { buildPlateZ: 0 });
    const roots = r.nodes.filter(n => n.parentId === null);
    for (const root of roots) {
      expect(root.bottom.z).toBeCloseTo(0, 1);
    }
  });

  it('total volume > 0 for supported points', () => {
    const r = generateSupportTree([downward('a', 0, 0, 20)]);
    expect(r.totalVolumeMm3).toBeGreaterThan(0);
  });

  it('overhang angle filters mild slopes', () => {
    // Normal 30° from -Z: x=sin30, z=-cos30.
    const mildSlope: OverhangPoint = {
      id: 's', position: { x: 0, y: 0, z: 10 }, normal: { x: Math.sin(30 * Math.PI / 180), y: 0, z: -Math.cos(30 * Math.PI / 180) },
    };
    const lenient = generateSupportTree([mildSlope], { overhangAngleDeg: 89 });
    const strict = generateSupportTree([mildSlope], { overhangAngleDeg: 5 });
    expect(strict.skippedCount).toBeGreaterThan(lenient.skippedCount);
  });

  it('tip radius respected', () => {
    const r = generateSupportTree([downward('a', 0, 0, 10)], { tipRadiusMm: 1.5 });
    const leaf = r.nodes.find(n => n.isLeaf);
    expect(leaf!.radiusMm).toBeCloseTo(1.5, 5);
  });
});

describe('computeStats', () => {
  it('empty result → all zeros', () => {
    const r = generateSupportTree([]);
    const s = computeStats(r);
    expect(s.nodeCount).toBe(0);
    expect(s.leafCount).toBe(0);
    expect(s.rootCount).toBe(0);
  });

  it('counts leaves and roots', () => {
    const r = generateSupportTree(
      [downward('a', 0, 0, 10), downward('b', 1, 0, 10)],
      { mergeRadiusMm: 5 },
    );
    const s = computeStats(r);
    expect(s.leafCount).toBe(2);
    expect(s.rootCount).toBeGreaterThanOrEqual(1);
  });

  it('max depth ≥ 0', () => {
    const r = generateSupportTree([downward('a', 0, 0, 10)]);
    const s = computeStats(r);
    expect(s.maxDepth).toBeGreaterThanOrEqual(0);
  });
});

describe('summarize', () => {
  it('empty input → zero supported', () => {
    const r = generateSupportTree([]);
    const s = summarize([], r);
    expect(s.supportedPointCount).toBe(0);
    expect(s.totalVolumeMm3).toBe(0);
  });

  it('reports material saving fraction for trees vs pillars', () => {
    const points = [
      downward('a', 0, 0, 20),
      downward('b', 0.5, 0, 20),
      downward('c', 0, 0.5, 20),
    ];
    const r = generateSupportTree(points, { mergeRadiusMm: 5 });
    const s = summarize(points, r);
    expect(s.estimatedMaterialSavingPct).toBeGreaterThanOrEqual(0);
    expect(s.estimatedMaterialSavingPct).toBeLessThanOrEqual(100);
  });

  it('counts roots', () => {
    const r = generateSupportTree([downward('a', 0, 0, 10), downward('b', 100, 100, 10)]);
    const s = summarize([downward('a', 0, 0, 10), downward('b', 100, 100, 10)], r);
    expect(s.rootCount).toBe(2);
  });
});
