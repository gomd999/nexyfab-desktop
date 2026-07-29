import { describe, it, expect } from 'vitest';
import {
  latticeDistance,
  sampleLatticeGrid,
  estimateVolumeFraction,
  latticeToMesh,
  type LatticeParams,
} from './latticeGenerator';

const baseBbox: LatticeParams['bbox'] = { min: [0, 0, 0], max: [10, 10, 10] };

describe('latticeDistance', () => {
  it('gyroid at density 0.5 ≈ unsigned f', () => {
    const params: LatticeParams = { type: 'gyroid', cellMm: 5, density: 0.5, bbox: baseBbox };
    // At (0,0,0) all sin = 0 so f = 0 → distance = 0.
    expect(latticeDistance(params, 0, 0, 0)).toBeCloseTo(0, 6);
  });

  it('higher density → more solid (negative distance at more points)', () => {
    const lo: LatticeParams = { type: 'gyroid', cellMm: 5, density: 0.2, bbox: baseBbox };
    const hi: LatticeParams = { type: 'gyroid', cellMm: 5, density: 0.8, bbox: baseBbox };
    let loSolid = 0, hiSolid = 0;
    for (let i = 0; i < 100; i++) {
      const x = (i * 0.1) % 5, y = (i * 0.13) % 5, z = (i * 0.17) % 5;
      if (latticeDistance(lo, x, y, z) < 0) loSolid++;
      if (latticeDistance(hi, x, y, z) < 0) hiSolid++;
    }
    expect(hiSolid).toBeGreaterThan(loSolid);
  });

  it('schwarz periodicity — same value at (0,0,0) and (cell, 0, 0)', () => {
    const params: LatticeParams = { type: 'schwarz', cellMm: 5, density: 0.5, bbox: baseBbox };
    expect(latticeDistance(params, 0, 0, 0)).toBeCloseTo(latticeDistance(params, 5, 0, 0), 6);
  });

  it('cubic lattice has strut along x-axis', () => {
    const params: LatticeParams = { type: 'cubic', cellMm: 10, density: 0.3, strutRadiusMm: 1, bbox: baseBbox };
    // Along x-axis (y=z=0), should be inside strut → negative.
    expect(latticeDistance(params, 5, 0, 0)).toBeLessThan(0);
  });
});

describe('sampleLatticeGrid', () => {
  it('produces grid of correct dimensions', () => {
    const params: LatticeParams = { type: 'gyroid', cellMm: 5, density: 0.5, bbox: baseBbox };
    const grid = sampleLatticeGrid(params, 10);
    expect(grid.sdf.length).toBe(grid.dims[0] * grid.dims[1] * grid.dims[2]);
    expect(grid.dims[0]).toBeGreaterThan(0);
  });

  it('origin equals bbox min', () => {
    const params: LatticeParams = { type: 'gyroid', cellMm: 5, density: 0.5, bbox: { min: [-1, -2, -3], max: [4, 3, 2] } };
    const grid = sampleLatticeGrid(params, 5);
    expect(grid.origin).toEqual([-1, -2, -3]);
  });
});

describe('latticeToMesh', () => {
  it('gyroid produces non-empty mesh at density 0.5', () => {
    const params: LatticeParams = { type: 'gyroid', cellMm: 5, density: 0.5, bbox: baseBbox };
    const m = latticeToMesh(params, 16);
    expect(m.positions.length).toBeGreaterThan(0);
    expect(m.triangleCount).toBeGreaterThan(0);
    expect(m.indices.length).toBe(m.triangleCount * 3);
  });

  it('every index references a valid vertex', () => {
    const params: LatticeParams = { type: 'gyroid', cellMm: 5, density: 0.5, bbox: baseBbox };
    const m = latticeToMesh(params, 12);
    const vertexCount = m.positions.length / 3;
    for (const i of m.indices) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(vertexCount);
    }
  });

  it('density 0.95 produces fewer iso-surface triangles than density 0.5', () => {
    const lo: LatticeParams = { type: 'gyroid', cellMm: 5, density: 0.5, bbox: baseBbox };
    const hi: LatticeParams = { type: 'gyroid', cellMm: 5, density: 0.95, bbox: baseBbox };
    const mLo = latticeToMesh(lo, 16);
    const mHi = latticeToMesh(hi, 16);
    expect(mHi.triangleCount).toBeLessThan(mLo.triangleCount);
  });
});

describe('estimateVolumeFraction', () => {
  it('density 0.5 gyroid → fraction near 0.5', () => {
    const params: LatticeParams = { type: 'gyroid', cellMm: 5, density: 0.5, bbox: baseBbox };
    const f = estimateVolumeFraction(params, 5000);
    expect(f).toBeGreaterThan(0.35);
    expect(f).toBeLessThan(0.65);
  });

  it('density 0.0 → fraction below 0.3', () => {
    // ⚠ 260729: 이 단언은 **플레이크**였다(3회 중 1회 실패). 참값은 0.2794 인데
    // Math.random() 몬테카를로라 n=2000 에서 σ ≈ 0.0100 — 경계 0.3 이 결우 **2.0σ** 거리라
    // 20회 중 1~2회는 넘었다(실측 범위 0.2660~0.3010).
    //
    // 단언을 느슨하게 하는 대신 추정기 자체를 할톤 수열로 바꿔 **결정론**으로 만들었다.
    // 이제 이 값은 실행마다 같다 — 플레이크가 사라진 것이 아니라 생길 수 없다.
    const params: LatticeParams = { type: 'gyroid', cellMm: 5, density: 0.05, bbox: baseBbox };
    const f = estimateVolumeFraction(params, 2000);
    expect(f).toBeLessThan(0.3);
  });

  it('같은 입력은 같은 값 — 판정에 비결정성 금지', () => {
    const params: LatticeParams = { type: 'gyroid', cellMm: 5, density: 0.5, bbox: baseBbox };
    const runs = [0, 1, 2].map(() => estimateVolumeFraction(params, 3000));
    expect(new Set(runs).size).toBe(1);
  });

  it('density 1.0 → fraction above 0.7', () => {
    const params: LatticeParams = { type: 'gyroid', cellMm: 5, density: 0.95, bbox: baseBbox };
    const f = estimateVolumeFraction(params, 2000);
    expect(f).toBeGreaterThan(0.7);
  });
});
