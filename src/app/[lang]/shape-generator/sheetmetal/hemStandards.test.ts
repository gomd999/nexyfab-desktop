import { describe, it, expect } from 'vitest';
import {
  computeHem,
  defaultInsideRadius,
  bendAllowanceMm,
  compareAllStyles,
  summarize,
  type HemInput,
} from './hemStandards';

function baseInput(style: HemInput['style'] = 'closed'): HemInput {
  return {
    thicknessMm: 1.0,
    style,
    yieldStrengthMpa: 250,
    lengthMm: 100,
  };
}

describe('computeHem', () => {
  it('closed hem doubles final thickness', () => {
    const r = computeHem(baseInput('closed'));
    expect(r.finalThicknessMm).toBeCloseTo(2, 5);
  });

  it('open hem adds gap to final thickness', () => {
    const r = computeHem({ ...baseInput('open'), gapMm: 1.5 });
    expect(r.finalThicknessMm).toBeCloseTo(2 + 1.5, 5);
  });

  it('teardrop hem has positive flat extension', () => {
    const r = computeHem(baseInput('teardrop'));
    expect(r.flatBlankExtensionMm).toBeGreaterThan(0);
  });

  it('rolled hem has the largest final thickness', () => {
    const rolled = computeHem(baseInput('rolled'));
    const closed = computeHem(baseInput('closed'));
    expect(rolled.finalThicknessMm).toBeGreaterThan(closed.finalThicknessMm);
  });

  it('bending force scales with yield strength', () => {
    const low = computeHem({ ...baseInput('closed'), yieldStrengthMpa: 200 });
    const high = computeHem({ ...baseInput('closed'), yieldStrengthMpa: 800 });
    expect(high.bendingForceKn).toBeGreaterThan(low.bendingForceKn);
  });

  it('bending force scales with length', () => {
    const short = computeHem({ ...baseInput('closed'), lengthMm: 50 });
    const long = computeHem({ ...baseInput('closed'), lengthMm: 200 });
    expect(long.bendingForceKn).toBeGreaterThan(short.bendingForceKn);
  });

  it('warns when inside radius too small', () => {
    const r = computeHem({ ...baseInput('teardrop'), bendRadiusMm: 0.1 });
    expect(r.warnings.some(w => w.includes('cracking'))).toBe(true);
  });

  it('warns about rolled hem on thick sheet', () => {
    const r = computeHem({ ...baseInput('rolled'), thicknessMm: 2.0 });
    expect(r.warnings.some(w => w.includes('Rolled hem'))).toBe(true);
  });

  it('honors custom bend radius', () => {
    const r = computeHem({ ...baseInput('open'), bendRadiusMm: 3 });
    expect(r.insideRadiusMm).toBe(3);
  });
});

describe('defaultInsideRadius', () => {
  it('closed has 0 inside radius', () => {
    expect(defaultInsideRadius('closed', 1)).toBe(0);
  });

  it('rolled has largest default radius', () => {
    expect(defaultInsideRadius('rolled', 1)).toBeGreaterThan(defaultInsideRadius('teardrop', 1));
    expect(defaultInsideRadius('teardrop', 1)).toBeGreaterThan(defaultInsideRadius('open', 1));
  });
});

describe('bendAllowanceMm', () => {
  it('zero radius and zero thickness → zero allowance', () => {
    expect(bendAllowanceMm(0, 0, 0.42)).toBeCloseTo(0, 5);
  });

  it('proportional to (r + k·t)', () => {
    const a = bendAllowanceMm(1, 1, 0.4);
    expect(a).toBeCloseTo(Math.PI * 1.4, 5);
  });
});

describe('compareAllStyles', () => {
  it('produces 4 entries', () => {
    expect(compareAllStyles(1, 250, 100)).toHaveLength(4);
  });

  it('all styles produce different final thicknesses', () => {
    const r = compareAllStyles(1, 250, 100);
    const thicknesses = new Set(r.map(s => Math.round(s.finalThicknessMm * 100)));
    expect(thicknesses.size).toBeGreaterThanOrEqual(3);
  });
});

describe('summarize', () => {
  it('reports thickness increase factor', () => {
    const r = computeHem(baseInput('closed'));
    const s = summarize(r, 1.0);
    expect(s.thicknessIncreaseFactor).toBeCloseTo(2, 3);
  });

  it('feasible when no warnings', () => {
    const r = computeHem(baseInput('open'));
    const s = summarize(r, 1.0);
    expect(s.isFeasible).toBe(r.warnings.length === 0);
  });

  it('infeasible when warnings present', () => {
    const r = computeHem({ ...baseInput('teardrop'), bendRadiusMm: 0.05 });
    const s = summarize(r, 1.0);
    expect(s.isFeasible).toBe(false);
  });
});
