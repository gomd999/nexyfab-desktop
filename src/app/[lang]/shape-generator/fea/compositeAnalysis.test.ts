import { describe, it, expect } from 'vitest';
import {
  transformedQ,
  computeABD,
  tsaiWuIndex,
  maxStressIndex,
  quasiIsotropic,
  crossPly,
  anglePly,
  effectiveConstants,
  STANDARD_MATERIALS,
} from './compositeAnalysis';

const carbon = STANDARD_MATERIALS['carbon-T700']!;

describe('transformedQ', () => {
  it('0° → Qxx ≈ E1', () => {
    const Q = transformedQ(carbon, 0);
    expect(Q[0]![0]!).toBeGreaterThan(carbon.E1 * 0.95);
  });

  it('90° → Qxx ≈ E2', () => {
    const Q = transformedQ(carbon, 90);
    // After 90°, fiber-aligned axis is Y, so Qxx ≈ E2.
    expect(Q[0]![0]!).toBeGreaterThan(carbon.E2 * 0.8);
    expect(Q[0]![0]!).toBeLessThan(carbon.E1 * 0.5);
  });

  it('45° → off-diagonals (Qxs, Qys) non-zero', () => {
    const Q = transformedQ(carbon, 45);
    expect(Math.abs(Q[0]![2]!)).toBeGreaterThan(0);
    expect(Math.abs(Q[1]![2]!)).toBeGreaterThan(0);
  });

  it('Q is symmetric', () => {
    const Q = transformedQ(carbon, 30);
    expect(Q[0]![1]).toBeCloseTo(Q[1]![0]!, 5);
    expect(Q[0]![2]).toBeCloseTo(Q[2]![0]!, 5);
  });
});

describe('computeABD', () => {
  it('symmetric layup → B matrix ≈ 0', () => {
    const plies = quasiIsotropic(carbon, 0.125);
    const abd = computeABD(plies);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(Math.abs(abd.B[i]![j]!)).toBeLessThan(1);
      }
    }
  });

  it('total thickness = ply count × ply thickness', () => {
    const plies = crossPly(carbon, 0.2, 8);
    const abd = computeABD(plies);
    expect(abd.totalThicknessMm).toBeCloseTo(8 * 0.2, 5);
  });

  it('A matrix positive definite (diagonal positive)', () => {
    const abd = computeABD(crossPly(carbon, 0.125));
    for (let i = 0; i < 3; i++) {
      expect(abd.A[i]![i]!).toBeGreaterThan(0);
    }
  });

  it('ply z-coords are monotonically increasing', () => {
    const abd = computeABD(quasiIsotropic(carbon, 0.125));
    for (let i = 1; i < abd.plyTopZ.length; i++) {
      expect(abd.plyTopZ[i]!).toBeGreaterThan(abd.plyTopZ[i - 1]!);
    }
  });
});

describe('tsaiWuIndex', () => {
  it('zero stress → 0', () => {
    expect(tsaiWuIndex(carbon, 0, 0, 0)).toBe(0);
  });

  it('stress at ply Xt → index ≈ 1', () => {
    expect(tsaiWuIndex(carbon, carbon.Xt, 0, 0)).toBeCloseTo(1, 2);
  });

  it('index grows with stress', () => {
    const lo = tsaiWuIndex(carbon, 500, 0, 0);
    const hi = tsaiWuIndex(carbon, 1500, 0, 0);
    expect(hi).toBeGreaterThan(lo);
  });
});

describe('maxStressIndex', () => {
  it('zero stress → 0', () => {
    expect(maxStressIndex(carbon, 0, 0, 0)).toBe(0);
  });

  it('uniaxial fiber-direction at Xt → index = 1', () => {
    expect(maxStressIndex(carbon, carbon.Xt, 0, 0)).toBeCloseTo(1, 5);
  });

  it('transverse compression scales by Yc', () => {
    expect(maxStressIndex(carbon, 0, -carbon.Yc, 0)).toBeCloseTo(1, 5);
  });

  it('returns max of normalized stresses', () => {
    const r = maxStressIndex(carbon, 100, -50, 30);
    expect(r).toBeGreaterThan(0);
  });
});

describe('layup builders', () => {
  it('quasi-isotropic returns 8 plies [0/45/-45/90]ₛ', () => {
    const plies = quasiIsotropic(carbon, 0.125);
    expect(plies).toHaveLength(8);
    expect(plies[0]!.angleDeg).toBe(0);
    expect(plies[7]!.angleDeg).toBe(0);
  });

  it('cross-ply alternates 0 / 90', () => {
    const plies = crossPly(carbon, 0.2, 4);
    expect(plies[0]!.angleDeg).toBe(0);
    expect(plies[1]!.angleDeg).toBe(90);
    expect(plies[2]!.angleDeg).toBe(0);
    expect(plies[3]!.angleDeg).toBe(90);
  });

  it('angle-ply alternates +θ / -θ', () => {
    const plies = anglePly(carbon, 0.2, 30, 4);
    expect(plies[0]!.angleDeg).toBe(30);
    expect(plies[1]!.angleDeg).toBe(-30);
  });
});

describe('effectiveConstants', () => {
  it('symmetric quasi-isotropic: Ex ≈ Ey', () => {
    const abd = computeABD(quasiIsotropic(carbon, 0.125));
    const eng = effectiveConstants(abd);
    expect(eng.Ex).toBeCloseTo(eng.Ey, -1);
  });

  it('0°-only layup: Ex >> Ey', () => {
    const plies = [
      { material: carbon, angleDeg: 0, thicknessMm: 0.125 },
      { material: carbon, angleDeg: 0, thicknessMm: 0.125 },
      { material: carbon, angleDeg: 0, thicknessMm: 0.125 },
      { material: carbon, angleDeg: 0, thicknessMm: 0.125 },
    ];
    const abd = computeABD(plies);
    const eng = effectiveConstants(abd);
    expect(eng.Ex).toBeGreaterThan(eng.Ey * 5);
  });

  it('engineering constants positive', () => {
    const abd = computeABD(crossPly(carbon, 0.125));
    const eng = effectiveConstants(abd);
    expect(eng.Ex).toBeGreaterThan(0);
    expect(eng.Gxy).toBeGreaterThan(0);
  });
});
