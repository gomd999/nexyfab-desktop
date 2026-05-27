import { describe, it, expect } from 'vitest';
import {
  unwrapMesh,
  partitionCharts,
  computeMeanStretch,
  type MeshArrays,
} from './uvUnwrap';

// Unit quad (one chart).
function unitQuad(): MeshArrays {
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

// Two coplanar triangles (one chart) + one perpendicular triangle (chart #2).
function bentMesh(): MeshArrays {
  return {
    positions: [
      0, 0, 0,  // 0
      1, 0, 0,  // 1
      1, 1, 0,  // 2
      0, 1, 0,  // 3
      0, 0, 1,  // 4 — top of bent triangle
      1, 0, 1,  // 5
    ],
    indices: [
      0, 1, 2,
      0, 2, 3,
      0, 1, 4, // bent perpendicular
    ],
  };
}

describe('partitionCharts', () => {
  it('coplanar quad → 1 chart', () => {
    const ids = partitionCharts(unitQuad(), 45);
    expect(new Set(ids).size).toBe(1);
  });

  it('hard-edge mesh → ≥ 2 charts when angle > threshold', () => {
    const ids = partitionCharts(bentMesh(), 30);
    expect(new Set(ids).size).toBeGreaterThanOrEqual(2);
  });

  it('chart count grows as threshold tightens', () => {
    const loose = new Set(partitionCharts(bentMesh(), 89)).size;
    const tight = new Set(partitionCharts(bentMesh(), 10)).size;
    expect(tight).toBeGreaterThanOrEqual(loose);
  });
});

describe('unwrapMesh — angle-based', () => {
  it('produces UVs for every triangle vertex', () => {
    const r = unwrapMesh(unitQuad());
    expect(r.uvs.length).toBe(2 * 6); // 2 triangles × 6 floats
  });

  it('all UVs within [0, 1]', () => {
    const r = unwrapMesh(unitQuad());
    for (const v of r.uvs) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('chartCount matches partition', () => {
    const r = unwrapMesh(unitQuad());
    expect(r.chartCount).toBe(1);
  });

  it('packingEfficiency between 0 and 1', () => {
    const r = unwrapMesh(unitQuad());
    expect(r.packingEfficiency).toBeGreaterThan(0);
    expect(r.packingEfficiency).toBeLessThanOrEqual(1);
  });

  it('meanStretch defined', () => {
    const r = unwrapMesh(unitQuad());
    expect(r.meanStretch).toBeGreaterThanOrEqual(0);
    expect(isFinite(r.meanStretch)).toBe(true);
  });

  it('empty mesh → empty result', () => {
    const r = unwrapMesh({ positions: [], indices: [] });
    expect(r.chartCount).toBe(0);
    expect(r.uvs.length).toBe(0);
  });
});

describe('unwrapMesh — box projection', () => {
  it('produces UVs for every triangle vertex', () => {
    const r = unwrapMesh(unitQuad(), { algorithm: 'box-projection' });
    expect(r.uvs.length).toBe(2 * 6);
  });
});

describe('unwrapMesh — multi-chart', () => {
  it('bent mesh produces ≥ 2 charts', () => {
    const r = unwrapMesh(bentMesh(), { hardEdgeDeg: 30 });
    expect(r.chartCount).toBeGreaterThanOrEqual(2);
  });

  it('every triangle has a chart id', () => {
    const r = unwrapMesh(bentMesh(), { hardEdgeDeg: 30 });
    expect(r.triangleChartIds).toHaveLength(3);
    for (const id of r.triangleChartIds) {
      expect(id).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('computeMeanStretch', () => {
  it('returns a finite number', () => {
    const m = unitQuad();
    const r = unwrapMesh(m);
    expect(computeMeanStretch(m, r.uvs)).toBeGreaterThanOrEqual(0);
  });

  it('empty mesh → 0', () => {
    expect(computeMeanStretch({ positions: [], indices: [] }, new Float32Array(0))).toBe(0);
  });
});
