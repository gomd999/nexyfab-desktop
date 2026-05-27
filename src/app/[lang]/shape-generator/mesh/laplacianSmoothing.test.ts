import { describe, it, expect } from 'vitest';
import {
  smoothMesh,
  summarize,
  type MeshArrays,
} from './laplacianSmoothing';

function flatGridMesh(): MeshArrays {
  // 3x3 vertex grid at z=0 with noise on the center vertex.
  return {
    positions: [
      0, 0, 0,  1, 0, 0,  2, 0, 0,
      0, 1, 0,  1, 1, 0.5,  2, 1, 0,
      0, 2, 0,  1, 2, 0,  2, 2, 0,
    ],
    indices: [
      0, 1, 3,  1, 4, 3,  1, 2, 4,  2, 5, 4,
      3, 4, 6,  4, 7, 6,  4, 5, 7,  5, 8, 7,
    ],
  };
}

function singleTriangle(): MeshArrays {
  return { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };
}

describe('smoothMesh', () => {
  it('empty mesh → empty result', () => {
    const r = smoothMesh({ positions: [], indices: [] });
    expect(r.mesh.positions).toEqual([]);
    expect(r.iterationsRun).toBe(0);
  });

  it('flat mesh remains flat (boundary preserved)', () => {
    const r = smoothMesh(flatGridMesh(), { kind: 'uniform', preserveBoundary: true });
    // Boundary corners shouldn't move.
    expect(r.mesh.positions[0]).toBe(0);
    expect(r.mesh.positions[1]).toBe(0);
  });

  it('center vertex is pulled toward flat plane', () => {
    const r = smoothMesh(flatGridMesh(), { kind: 'uniform', iterations: 20, preserveBoundary: true });
    const centerZ = r.mesh.positions[4 * 3 + 2]!;
    expect(centerZ).toBeLessThan(0.5);
    expect(centerZ).toBeGreaterThan(-0.5);
  });

  it('cotangent variant also smooths', () => {
    const r = smoothMesh(flatGridMesh(), { kind: 'cotangent', iterations: 10 });
    const centerZ = r.mesh.positions[4 * 3 + 2]!;
    expect(centerZ).toBeLessThan(0.5);
  });

  it('iterations parameter respected', () => {
    const r = smoothMesh(flatGridMesh(), { iterations: 3, toleranceMm: 0 });
    expect(r.iterationsRun).toBeLessThanOrEqual(3);
  });

  it('preserveBoundary=false moves boundary vertices', () => {
    // With 1 triangle (all vertices on boundary), no smoothing happens
    // when preserveBoundary=true. With false, vertices move toward centroid.
    const mesh = singleTriangle();
    const preserved = smoothMesh(mesh, { preserveBoundary: true });
    const movable = smoothMesh(mesh, { preserveBoundary: false });
    expect(preserved.mesh.positions).toEqual(mesh.positions);
    expect(movable.mesh.positions).not.toEqual(mesh.positions);
  });

  it('history recorded when requested', () => {
    const r = smoothMesh(flatGridMesh(), { iterations: 3, recordHistory: true, toleranceMm: 0 });
    expect(r.history).toBeDefined();
    expect(r.history!.length).toBeGreaterThan(0);
  });

  it('finalMaxDisplacement decreases with more iterations', () => {
    const short = smoothMesh(flatGridMesh(), { iterations: 2, toleranceMm: 0 });
    const long = smoothMesh(flatGridMesh(), { iterations: 30, toleranceMm: 0 });
    expect(long.finalMaxDisplacementMm).toBeLessThanOrEqual(short.finalMaxDisplacementMm);
  });

  it('lambdaPerIter controls strength', () => {
    const soft = smoothMesh(flatGridMesh(), { lambdaPerIter: 0.05, iterations: 5, toleranceMm: 0 });
    const aggressive = smoothMesh(flatGridMesh(), { lambdaPerIter: 1.0, iterations: 5, toleranceMm: 0 });
    const softZ = soft.mesh.positions[4 * 3 + 2]!;
    const aggrZ = aggressive.mesh.positions[4 * 3 + 2]!;
    expect(Math.abs(aggrZ)).toBeLessThan(Math.abs(softZ));
  });

  it('vertex count + index count preserved', () => {
    const original = flatGridMesh();
    const r = smoothMesh(original);
    expect(r.mesh.positions.length).toBe(original.positions.length);
    expect(r.mesh.indices.length).toBe(original.indices.length);
  });

  it('converges below tolerance', () => {
    const r = smoothMesh(flatGridMesh(), { iterations: 100, toleranceMm: 1e-3, preserveBoundary: true });
    expect(r.finalMaxDisplacementMm).toBeLessThan(1e-2);
  });
});

describe('summarize', () => {
  it('empty result', () => {
    const r = smoothMesh({ positions: [], indices: [] });
    const s = summarize({ positions: [], indices: [] }, r);
    expect(s.iterationsRun).toBe(0);
  });

  it('reports boundary vertex count', () => {
    const r = smoothMesh(flatGridMesh());
    const s = summarize(flatGridMesh(), r);
    expect(s.boundaryVertexCount).toBeGreaterThan(0);
  });

  it('converged flag matches tolerance', () => {
    const r = smoothMesh(flatGridMesh(), { iterations: 100, toleranceMm: 0.01 });
    const s = summarize(flatGridMesh(), r, 0.01);
    expect(s.converged).toBe(true);
  });
});
