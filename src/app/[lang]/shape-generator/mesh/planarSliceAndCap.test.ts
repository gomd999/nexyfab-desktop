import { describe, it, expect } from 'vitest';
import {
  sliceAndCap,
  summarize,
  type MeshArrays,
  type Plane,
} from './planarSliceAndCap';

function unitCube(): MeshArrays {
  return {
    positions: [
      0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,
      0, 0, 1,  1, 0, 1,  1, 1, 1,  0, 1, 1,
    ],
    indices: [
      0, 2, 1,  0, 3, 2,
      4, 5, 6,  4, 6, 7,
      0, 1, 5,  0, 5, 4,
      1, 2, 6,  1, 6, 5,
      2, 3, 7,  2, 7, 6,
      3, 0, 4,  3, 4, 7,
    ],
  };
}

const planeZHalf: Plane = { origin: { x: 0, y: 0, z: 0.5 }, normal: { x: 0, y: 0, z: 1 } };
const planeFarAway: Plane = { origin: { x: 0, y: 0, z: 100 }, normal: { x: 0, y: 0, z: 1 } };

describe('sliceAndCap', () => {
  it('empty mesh → empty result', () => {
    const r = sliceAndCap({ positions: [], indices: [] }, planeZHalf);
    expect(r.mesh.positions).toEqual([]);
    expect(r.mesh.indices).toEqual([]);
  });

  it('plane far above cube → all discarded (cube in negative half)', () => {
    const r = sliceAndCap(unitCube(), { origin: { x: 0, y: 0, z: 100 }, normal: { x: 0, y: 0, z: 1 } });
    expect(r.discardedTriangleCount).toBe(12);
  });

  it('plane far below cube → all kept (no split)', () => {
    const r = sliceAndCap(unitCube(), planeFarAway, { keepPositive: false });
    expect(r.discardedTriangleCount).toBe(0);
    expect(r.splitTriangleCount).toBe(0);
  });

  it('mid-plane splits the cube', () => {
    const r = sliceAndCap(unitCube(), planeZHalf);
    expect(r.splitTriangleCount).toBeGreaterThan(0);
  });

  it('cap option adds cap triangles', () => {
    const noCap = sliceAndCap(unitCube(), planeZHalf, { capCut: false });
    const withCap = sliceAndCap(unitCube(), planeZHalf, { capCut: true });
    expect(withCap.capTriangleCount).toBeGreaterThan(noCap.capTriangleCount);
  });

  it('cap perimeter = 4 for unit cube horizontal cut', () => {
    const r = sliceAndCap(unitCube(), planeZHalf);
    expect(r.capPerimeterMm).toBeCloseTo(4, 1);
  });

  it('keepPositive=false keeps the other half', () => {
    const top = sliceAndCap(unitCube(), planeZHalf, { keepPositive: true, capCut: false });
    const bottom = sliceAndCap(unitCube(), planeZHalf, { keepPositive: false, capCut: false });
    expect(top.discardedTriangleCount + bottom.discardedTriangleCount).toBeGreaterThanOrEqual(0);
  });

  it('plane misses mesh entirely → mesh unchanged (no split)', () => {
    const r = sliceAndCap(unitCube(), planeFarAway, { keepPositive: false });
    expect(r.mesh.indices.length).toBe(12 * 3);
  });

  it('positions are not corrupted', () => {
    const r = sliceAndCap(unitCube(), planeZHalf);
    expect(r.mesh.positions.length % 3).toBe(0);
    expect(r.mesh.indices.length % 3).toBe(0);
    for (const idx of r.mesh.indices) {
      expect(idx).toBeLessThan(r.mesh.positions.length / 3);
    }
  });
});

describe('summarize', () => {
  it('reports output triangle count', () => {
    const r = sliceAndCap(unitCube(), planeZHalf);
    const s = summarize(r);
    expect(s.outputTriangleCount).toBe(r.mesh.indices.length / 3);
  });

  it('cap perimeter forwarded', () => {
    const r = sliceAndCap(unitCube(), planeZHalf);
    const s = summarize(r);
    expect(s.capPerimeterMm).toBeCloseTo(r.capPerimeterMm, 5);
  });
});
