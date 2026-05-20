import { describe, it, expect } from 'vitest';
import {
  marchSdfField,
  marchSampleGrid,
  weldVertices,
  pickResolution,
} from './sdfMarchingCubes';
import { sphere, box, sampleField } from './sdfModeling';

describe('marchSdfField — sphere', () => {
  it('produces triangles for a sphere', () => {
    const r = marchSdfField(sphere(1), { x: -1.5, y: -1.5, z: -1.5 }, { x: 1.5, y: 1.5, z: 1.5 }, 16);
    expect(r.triangleCount).toBeGreaterThan(0);
  });

  it('higher resolution → more triangles', () => {
    const lo = marchSdfField(sphere(1), { x: -1.5, y: -1.5, z: -1.5 }, { x: 1.5, y: 1.5, z: 1.5 }, 8);
    const hi = marchSdfField(sphere(1), { x: -1.5, y: -1.5, z: -1.5 }, { x: 1.5, y: 1.5, z: 1.5 }, 24);
    expect(hi.triangleCount).toBeGreaterThan(lo.triangleCount);
  });

  it('outside-only bounds → 0 triangles', () => {
    // Bounds well outside the sphere → no surface crossing.
    const r = marchSdfField(sphere(1), { x: 10, y: 10, z: 10 }, { x: 20, y: 20, z: 20 }, 8);
    expect(r.triangleCount).toBe(0);
  });

  it('cellsActive reflects surface coverage', () => {
    const r = marchSdfField(sphere(1), { x: -1.5, y: -1.5, z: -1.5 }, { x: 1.5, y: 1.5, z: 1.5 }, 16);
    expect(r.cellsActive).toBeGreaterThan(0);
    expect(r.cellsActive).toBeLessThanOrEqual(r.cellsExamined);
  });

  it('cellsExamined = (n-1)³', () => {
    const r = marchSdfField(sphere(1), { x: -1.5, y: -1.5, z: -1.5 }, { x: 1.5, y: 1.5, z: 1.5 }, 8);
    expect(r.cellsExamined).toBe(7 * 7 * 7);
  });
});

describe('marchSdfField — box', () => {
  it('emits triangles for a box', () => {
    const r = marchSdfField(box({ x: 1, y: 1, z: 1 }), { x: -2, y: -2, z: -2 }, { x: 2, y: 2, z: 2 }, 16);
    expect(r.triangleCount).toBeGreaterThan(0);
  });
});

describe('marchSampleGrid', () => {
  it('operates on a pre-sampled grid', () => {
    const grid = sampleField(sphere(1), { x: -1.5, y: -1.5, z: -1.5 }, { x: 1.5, y: 1.5, z: 1.5 }, 16);
    const r = marchSampleGrid(grid);
    expect(r.triangleCount).toBeGreaterThan(0);
  });
});

describe('weldVertices', () => {
  it('coincident vertices get merged', () => {
    const mesh = {
      positions: [
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        0, 0, 0, // dup
        1, 0, 0, // dup
        1, 1, 0,
      ],
      indices: [0, 1, 2, 3, 4, 5],
    };
    const welded = weldVertices(mesh);
    expect(welded.positions.length / 3).toBe(4);
    expect(welded.indices).toHaveLength(6);
  });

  it('non-coincident vertices preserved', () => {
    const mesh = {
      positions: [0, 0, 0, 5, 0, 0, 0, 5, 0],
      indices: [0, 1, 2],
    };
    const welded = weldVertices(mesh);
    expect(welded.positions.length / 3).toBe(3);
  });

  it('weld + march sphere reduces vertex count', () => {
    const r = marchSdfField(sphere(1), { x: -1.5, y: -1.5, z: -1.5 }, { x: 1.5, y: 1.5, z: 1.5 }, 16);
    const before = r.mesh.positions.length / 3;
    const welded = weldVertices(r.mesh);
    const after = welded.positions.length / 3;
    expect(after).toBeLessThan(before);
  });
});

describe('pickResolution', () => {
  it('scales with bbox size / feature size', () => {
    const r = pickResolution({ x: 0, y: 0, z: 0 }, { x: 100, y: 100, z: 100 }, 1);
    expect(r).toBeGreaterThanOrEqual(8);
  });

  it('clamps to maxResolution', () => {
    const r = pickResolution({ x: 0, y: 0, z: 0 }, { x: 1000, y: 1000, z: 1000 }, 0.1, 64);
    expect(r).toBe(64);
  });

  it('floors at 8', () => {
    const r = pickResolution({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, 100);
    expect(r).toBe(8);
  });
});
