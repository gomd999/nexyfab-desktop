import { describe, it, expect } from 'vitest';
import {
  stressBoolean,
  weldVertices,
  snapToGrid,
  jitterPositions,
  summarize,
  DEFAULT_PASSES,
  type MeshArrays,
} from './booleanStressTest';

function unitMesh(): MeshArrays {
  return {
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    indices: [0, 1, 2],
  };
}

describe('weldVertices', () => {
  it('merges coincident vertices within tolerance', () => {
    const mesh: MeshArrays = {
      positions: [0, 0, 0, 0.00001, 0, 0, 1, 0, 0],
      indices: [0, 1, 2],
    };
    const r = weldVertices(mesh, 0.001);
    expect(r.positions.length / 3).toBe(2);
  });

  it('non-coincident vertices preserved', () => {
    const r = weldVertices(unitMesh(), 0.001);
    expect(r.positions.length / 3).toBe(3);
  });

  it('drops degenerate triangles after weld', () => {
    const mesh: MeshArrays = {
      positions: [0, 0, 0, 0, 0, 0, 1, 0, 0], // duplicate
      indices: [0, 1, 2],
    };
    const r = weldVertices(mesh, 0.001);
    expect(r.indices.length).toBe(0);
  });
});

describe('snapToGrid', () => {
  it('rounds positions to grid', () => {
    const mesh: MeshArrays = {
      positions: [0.123, 0.456, 0.789],
      indices: [],
    };
    const r = snapToGrid(mesh, 0.01);
    expect(r.positions[0]).toBeCloseTo(0.1, 4);
  });
});

describe('jitterPositions', () => {
  it('positions shift by < tolerance', () => {
    const mesh = unitMesh();
    const r = jitterPositions(mesh, 0.001);
    for (let i = 0; i < r.positions.length; i++) {
      expect(Math.abs(r.positions[i]! - mesh.positions[i]!)).toBeLessThan(0.001);
    }
  });
});

describe('stressBoolean — happy path', () => {
  it('returns success on first pass when boolean works', () => {
    const r = stressBoolean(unitMesh(), unitMesh(), 'union', (a, _b, _op) => ({ ...a }));
    expect(r.succeeded).toBe(true);
    expect(r.successPass).toBe(0);
  });

  it('reports per-pass diagnostics', () => {
    const r = stressBoolean(unitMesh(), unitMesh(), 'union', () => ({ positions: [0, 0, 0], indices: [0, 0, 0] }));
    // Triangle is degenerate so first pass fails; downstream may succeed depending on transform.
    expect(r.passReports.length).toBeGreaterThan(0);
  });
});

describe('stressBoolean — retry ladder', () => {
  it('retries when boolean throws', () => {
    let calls = 0;
    const r = stressBoolean(unitMesh(), unitMesh(), 'union', () => {
      calls++;
      if (calls < 3) throw new Error('boom');
      return { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };
    });
    expect(r.succeeded).toBe(true);
    expect(r.successPass).toBeGreaterThanOrEqual(2);
  });

  it('returns null when all passes fail', () => {
    const r = stressBoolean(unitMesh(), unitMesh(), 'union', () => null);
    expect(r.succeeded).toBe(false);
    expect(r.mesh).toBeNull();
  });
});

describe('stressBoolean — time budget', () => {
  it('respects maxTotalTimeMs', () => {
    const r = stressBoolean(unitMesh(), unitMesh(), 'union', () => null, { maxTotalTimeMs: 0 });
    expect(r.passReports.length).toBeLessThanOrEqual(DEFAULT_PASSES.length);
  });
});

describe('summarize', () => {
  it('reports successPassName when found', () => {
    const r = stressBoolean(unitMesh(), unitMesh(), 'union', () => ({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }));
    const s = summarize(r);
    expect(s.successPassName).toBe('baseline');
  });

  it('null successPassName when all failed', () => {
    const r = stressBoolean(unitMesh(), unitMesh(), 'union', () => null);
    const s = summarize(r);
    expect(s.successPassName).toBeNull();
  });
});
