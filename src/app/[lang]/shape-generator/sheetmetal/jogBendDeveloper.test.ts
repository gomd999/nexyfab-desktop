import { describe, it, expect } from 'vitest';
import {
  develop,
  bendDeduction,
  springbackCompensation,
  summarize,
  type JogBendInput,
} from './jogBendDeveloper';

const base: JogBendInput = {
  offsetHeightMm: 10,
  insideRadiusMm: 1,
  thicknessMm: 1.5,
  flangeBeforeMm: 20,
  flangeAfterMm: 20,
};

describe('develop', () => {
  it('bend allowance per bend positive', () => {
    const r = develop(base);
    expect(r.bendAllowancePerBendMm).toBeGreaterThan(0);
  });

  it('90° web length = offset / sin(90) = offset', () => {
    const r = develop(base);
    expect(r.webLengthMm).toBeCloseTo(10, 5);
  });

  it('45° web length = offset / sin(45)', () => {
    const r = develop({ ...base, bendAngleDeg: 45 });
    expect(r.webLengthMm).toBeCloseTo(10 / Math.sin(Math.PI / 4), 5);
  });

  it('flat length includes both bend allowances + web + flanges', () => {
    const r = develop(base);
    const expected = 20 + r.bendAllowancePerBendMm + r.webLengthMm + r.bendAllowancePerBendMm + 20;
    expect(r.flatLengthMm).toBeCloseTo(expected, 5);
  });

  it('formable for adequate offset', () => {
    expect(develop(base).formable).toBe(true);
  });

  it('tiny offset → not formable + warning', () => {
    const r = develop({ ...base, offsetHeightMm: 1 }); // < 2.5×1.5 = 3.75
    expect(r.formable).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('min offset = 2.5 × thickness', () => {
    const r = develop(base);
    expect(r.minOffsetMm).toBeCloseTo(2.5 * 1.5, 6);
  });

  it('larger inside radius → larger bend allowance', () => {
    const small = develop({ ...base, insideRadiusMm: 1 });
    const big = develop({ ...base, insideRadiusMm: 3 });
    expect(big.bendAllowancePerBendMm).toBeGreaterThan(small.bendAllowancePerBendMm);
  });

  it('zero thickness → warning', () => {
    const r = develop({ ...base, thicknessMm: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('90° formed projection ≈ flanges only (web vertical)', () => {
    const r = develop(base);
    // cos(90°) ≈ 0 → web contributes ~0 horizontally
    expect(r.formedLengthMm).toBeCloseTo(40, 4);
  });
});

describe('bendDeduction', () => {
  it('returns a finite number', () => {
    const r = develop(base);
    expect(Number.isFinite(bendDeduction(r, base))).toBe(true);
  });
});

describe('springbackCompensation', () => {
  it('overbends beyond nominal', () => {
    expect(springbackCompensation(90)).toBeGreaterThan(90);
  });

  it('custom springback factor', () => {
    expect(springbackCompensation(90, 0.9)).toBeCloseTo(100, 4);
  });
});

describe('summarize', () => {
  it('reports flat length + formable', () => {
    const r = develop(base);
    const s = summarize(r);
    expect(s.flatLengthMm).toBe(r.flatLengthMm);
    expect(s.formable).toBe(r.formable);
  });
});
