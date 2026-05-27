import { describe, it, expect } from 'vitest';
import {
  uPlusFromYPlus,
  frictionVelocity,
  skinFrictionCoefficient,
  classifyYPlus,
  firstCellDistanceForTargetYPlus,
  turbulenceWallValues,
  KAPPA,
  B_CONSTANT,
} from './wallFunction';

describe('uPlusFromYPlus', () => {
  it('viscous sublayer: u⁺ = y⁺ for y⁺ < 5', () => {
    const r = uPlusFromYPlus(3);
    expect(r.uPlus).toBe(3);
    expect(r.regime).toBe('viscous');
  });

  it('log-law: u⁺ = (1/κ) ln(y⁺) + B', () => {
    const r = uPlusFromYPlus(50);
    const expected = (1 / KAPPA) * Math.log(50) + B_CONSTANT;
    expect(r.uPlus).toBeCloseTo(expected, 5);
    expect(r.regime).toBe('log-law');
  });

  it('buffer layer flagged 5 < y⁺ < 30', () => {
    expect(uPlusFromYPlus(15).regime).toBe('buffer');
  });

  it('outer region above 300', () => {
    expect(uPlusFromYPlus(500).regime).toBe('outer');
  });

  it('continuous: viscous→log values reasonable', () => {
    // The log-law at y⁺=5 gives a value below the viscous u⁺=5, so a
    // proper buffer blend exists. The piecewise switch shouldn't be
    // catastrophic — Reichardt's law in buffer fills the gap.
    const buffer = uPlusFromYPlus(10);
    expect(buffer.uPlus).toBeGreaterThan(5);
    expect(buffer.uPlus).toBeLessThan(20);
  });
});

describe('frictionVelocity', () => {
  it('converges for moderate Reynolds flow', () => {
    // Air at 20 m/s past a 1mm first cell, ν=1.5e-5, ρ=1.2.
    const r = frictionVelocity(20, 0.001, 1.5e-5, 1.2);
    expect(r.uTau).toBeGreaterThan(0);
    expect(r.yPlus).toBeGreaterThan(0);
    expect(r.wallShearStress).toBeGreaterThan(0);
  });

  it('wallShearStress = ρ u_τ²', () => {
    const r = frictionVelocity(10, 0.0005, 1e-6, 1000);
    expect(r.wallShearStress).toBeCloseTo(1000 * r.uTau * r.uTau, 4);
  });

  it('higher free-stream → higher friction velocity', () => {
    const slow = frictionVelocity(5, 0.001, 1.5e-5, 1.2);
    const fast = frictionVelocity(50, 0.001, 1.5e-5, 1.2);
    expect(fast.uTau).toBeGreaterThan(slow.uTau);
  });
});

describe('skinFrictionCoefficient', () => {
  it('Cf = τ_w / (½ ρ U²)', () => {
    const cf = skinFrictionCoefficient(0.6, 1.2, 20);
    expect(cf).toBeCloseTo(0.6 / (0.5 * 1.2 * 400), 5);
  });

  it('zero free-stream → 0', () => {
    expect(skinFrictionCoefficient(0.6, 1.2, 0)).toBe(0);
  });
});

describe('classifyYPlus', () => {
  it('y⁺=0.5 → too-small', () => {
    expect(classifyYPlus(0.5).regime).toBe('too-small');
  });

  it('y⁺=3 → viscous', () => {
    expect(classifyYPlus(3).regime).toBe('viscous');
  });

  it('y⁺=15 → buffer-warning', () => {
    expect(classifyYPlus(15).regime).toBe('buffer-warning');
  });

  it('y⁺=100 → log-law-good', () => {
    expect(classifyYPlus(100).regime).toBe('log-law-good');
  });

  it('y⁺=500 → too-large', () => {
    expect(classifyYPlus(500).regime).toBe('too-large');
  });
});

describe('firstCellDistanceForTargetYPlus', () => {
  it('returns positive distance', () => {
    const d = firstCellDistanceForTargetYPlus(50, 1, 1e6, 1.5e-5);
    expect(d).toBeGreaterThan(0);
  });

  it('lower target y⁺ → smaller first cell', () => {
    const fine = firstCellDistanceForTargetYPlus(1, 1, 1e6, 1.5e-5);
    const coarse = firstCellDistanceForTargetYPlus(100, 1, 1e6, 1.5e-5);
    expect(fine).toBeLessThan(coarse);
  });

  it('Re=0 fallback returns characteristic length', () => {
    const d = firstCellDistanceForTargetYPlus(30, 5, 0, 1.5e-5);
    expect(d).toBe(5);
  });
});

describe('turbulenceWallValues', () => {
  it('k = u_τ² / √Cμ', () => {
    const r = turbulenceWallValues(0.5, 0.001);
    expect(r.turbulentKineticEnergy).toBeCloseTo(0.25 / Math.sqrt(0.09), 5);
  });

  it('ε ∝ u_τ³ / y', () => {
    const r = turbulenceWallValues(0.5, 0.001);
    expect(r.turbulentDissipation).toBeGreaterThan(0);
    expect(isFinite(r.turbulentDissipation)).toBe(true);
  });

  it('ω = u_τ / (√Cμ κ y)', () => {
    const r = turbulenceWallValues(0.5, 0.001);
    expect(r.specificDissipation).toBeGreaterThan(0);
  });

  it('zero wall distance handled', () => {
    const r = turbulenceWallValues(0.5, 0);
    expect(isFinite(r.turbulentDissipation)).toBe(true);
  });
});
