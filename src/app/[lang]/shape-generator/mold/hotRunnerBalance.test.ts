import { describe, it, expect } from 'vitest';
import {
  analyze,
  pressureDrop,
  isNaturallyBalanced,
  summarize,
  type RunnerBranch,
} from './hotRunnerBalance';

const balanced: RunnerBranch[] = [
  { id: 'd1', lengthMm: 100, diameterMm: 8 },
  { id: 'd2', lengthMm: 100, diameterMm: 8 },
  { id: 'd3', lengthMm: 100, diameterMm: 8 },
  { id: 'd4', lengthMm: 100, diameterMm: 8 },
];

const unbalanced: RunnerBranch[] = [
  { id: 'd1', lengthMm: 80, diameterMm: 8 },
  { id: 'd2', lengthMm: 150, diameterMm: 8 },
];

describe('analyze', () => {
  it('empty branches → warning', () => {
    const r = analyze({ branches: [], meltViscosityPaS: 500, flowRateMm3PerS: 1000 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('equal-length branches → naturally balanced, near-zero imbalance', () => {
    const r = analyze({ branches: balanced, meltViscosityPaS: 500, flowRateMm3PerS: 1000 });
    expect(r.naturallyBalanced).toBe(true);
    expect(r.imbalancePercent).toBeCloseTo(0, 4);
  });

  it('different lengths → imbalance > 0', () => {
    const r = analyze({ branches: unbalanced, meltViscosityPaS: 500, flowRateMm3PerS: 1000 });
    expect(r.imbalancePercent).toBeGreaterThan(0);
    expect(r.naturallyBalanced).toBe(false);
  });

  it('longer branch → higher pressure drop', () => {
    const r = analyze({ branches: unbalanced, meltViscosityPaS: 500, flowRateMm3PerS: 1000 });
    const short = r.branches.find(b => b.id === 'd1')!;
    const long = r.branches.find(b => b.id === 'd2')!;
    expect(long.pressureDropMpa).toBeGreaterThan(short.pressureDropMpa);
  });

  it('tuned diameters differ for unequal lengths', () => {
    const r = analyze({ branches: unbalanced, meltViscosityPaS: 500, flowRateMm3PerS: 1000 });
    const d1 = r.branches.find(b => b.id === 'd1')!;
    const d2 = r.branches.find(b => b.id === 'd2')!;
    expect(d2.tunedDiameterMm).toBeGreaterThan(d1.tunedDiameterMm); // longer needs bigger bore
  });

  it('tuning equalises pressure drop (D⁴ ∝ L check)', () => {
    const r = analyze({ branches: unbalanced, meltViscosityPaS: 500, flowRateMm3PerS: 1000 });
    const d1 = r.branches.find(b => b.id === 'd1')!;
    const d2 = r.branches.find(b => b.id === 'd2')!;
    // D⁴ should scale with L → (D2/D1)⁴ ≈ L2/L1
    const ratio = Math.pow(d2.tunedDiameterMm / d1.tunedDiameterMm, 4);
    expect(ratio).toBeCloseTo(150 / 80, 1);
  });
});

describe('pressureDrop', () => {
  it('Δp ∝ length', () => {
    const dp1 = pressureDrop({ id: 'a', lengthMm: 100, diameterMm: 8 }, 500, 1000);
    const dp2 = pressureDrop({ id: 'b', lengthMm: 200, diameterMm: 8 }, 500, 1000);
    expect(dp2).toBeCloseTo(2 * dp1, 6);
  });

  it('Δp ∝ 1/D⁴', () => {
    const dpSmall = pressureDrop({ id: 'a', lengthMm: 100, diameterMm: 4 }, 500, 1000);
    const dpBig = pressureDrop({ id: 'b', lengthMm: 100, diameterMm: 8 }, 500, 1000);
    expect(dpSmall / dpBig).toBeCloseTo(16, 1);
  });

  it('zero diameter → Infinity', () => {
    expect(pressureDrop({ id: 'a', lengthMm: 100, diameterMm: 0 }, 500, 1000)).toBe(Infinity);
  });
});

describe('isNaturallyBalanced', () => {
  it('equal lengths → true', () => {
    expect(isNaturallyBalanced(balanced)).toBe(true);
  });

  it('unequal lengths → false', () => {
    expect(isNaturallyBalanced(unbalanced)).toBe(false);
  });
});

describe('summarize', () => {
  it('reports branch count + imbalance', () => {
    const r = analyze({ branches: balanced, meltViscosityPaS: 500, flowRateMm3PerS: 1000 });
    const s = summarize(r);
    expect(s.branchCount).toBe(4);
    expect(s.naturallyBalanced).toBe(true);
  });
});
