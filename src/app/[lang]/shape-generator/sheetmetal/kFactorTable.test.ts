import { describe, it, expect } from 'vitest';
import { lookupKFactor, bendAllowance, bendDeduction } from './kFactorTable';

describe('lookupKFactor', () => {
  it('returns table value at exact ratio match', () => {
    const r = lookupKFactor({ material: 'aluminum-6061', thicknessMm: 1, insideRadiusMm: 1 });
    expect(r.kFactor).toBeCloseTo(0.40, 2);
    expect(r.extrapolated).toBe(false);
  });

  it('interpolates between table rows', () => {
    // R/T = 1.5, between R/T=1 (K=0.40) and R/T=2 (K=0.44) → K ≈ 0.42.
    const r = lookupKFactor({ material: 'aluminum-6061', thicknessMm: 1, insideRadiusMm: 1.5 });
    expect(r.kFactor).toBeCloseTo(0.42, 2);
  });

  it('clamps below table minimum with extrapolated flag', () => {
    const r = lookupKFactor({ material: 'aluminum-6061', thicknessMm: 1, insideRadiusMm: 0.1 });
    expect(r.extrapolated).toBe(true);
    expect(r.kFactor).toBeCloseTo(0.35, 2);
  });

  it('clamps above table maximum with extrapolated flag', () => {
    const r = lookupKFactor({ material: 'aluminum-6061', thicknessMm: 1, insideRadiusMm: 100 });
    expect(r.extrapolated).toBe(true);
    expect(r.kFactor).toBeCloseTo(0.50, 2);
  });

  it('returns safe fallback for zero thickness', () => {
    const r = lookupKFactor({ material: 'aluminum-6061', thicknessMm: 0, insideRadiusMm: 1 });
    expect(r.kFactor).toBe(0.42);
  });

  it('honors per-shop override table', () => {
    const r = lookupKFactor(
      { material: 'aluminum-6061', thicknessMm: 1, insideRadiusMm: 1 },
      { 'aluminum-6061': [[0.5, 0.50], [10, 0.50]] },
    );
    expect(r.kFactor).toBeCloseTo(0.50, 2);
    expect(r.source).toBe('override');
  });

  it('different materials give different K at same ratio', () => {
    const alu = lookupKFactor({ material: 'aluminum-6061', thicknessMm: 1, insideRadiusMm: 1 });
    const cu = lookupKFactor({ material: 'copper-c110', thicknessMm: 1, insideRadiusMm: 1 });
    expect(alu.kFactor).not.toBeCloseTo(cu.kFactor, 2);
  });
});

describe('bendAllowance', () => {
  it('matches BA = θ × (R + K × T)', () => {
    const ba = bendAllowance(
      { material: 'aluminum-6061', thicknessMm: 1, insideRadiusMm: 1 },
      Math.PI / 2, // 90° bend
    );
    // BA = (π/2) × (1 + 0.40 × 1) = (π/2) × 1.40 ≈ 2.199
    expect(ba).toBeCloseTo(2.199, 2);
  });

  it('grows with bend angle', () => {
    const q = { material: 'steel-cold-rolled' as const, thicknessMm: 2, insideRadiusMm: 4 };
    const ba30 = bendAllowance(q, Math.PI / 6);
    const ba90 = bendAllowance(q, Math.PI / 2);
    expect(ba90).toBeGreaterThan(ba30);
  });
});

describe('bendDeduction', () => {
  it('returns positive value for 90° bend (typical case)', () => {
    const bd = bendDeduction(
      { material: 'aluminum-6061', thicknessMm: 1, insideRadiusMm: 1 },
      Math.PI / 2,
    );
    expect(bd).toBeGreaterThan(0);
  });

  it('matches 2·OSSB − BA at 90°', () => {
    const q = { material: 'aluminum-6061' as const, thicknessMm: 1, insideRadiusMm: 1 };
    const theta = Math.PI / 2;
    const ossb = (1 + 1) * Math.tan(theta / 2); // 2 × 1 = 2
    const expected = 2 * ossb - bendAllowance(q, theta);
    expect(bendDeduction(q, theta)).toBeCloseTo(expected, 5);
  });
});
