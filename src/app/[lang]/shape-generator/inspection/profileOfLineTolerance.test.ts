import { describe, it, expect } from 'vitest';
import {
  evaluate,
  summarize,
  type NominalCurvePoint,
} from './profileOfLineTolerance';

// Horizontal line y=0, x in [0,10]
const lineNominal: NominalCurvePoint[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
];

describe('evaluate', () => {
  it('measurements on the line → zero deviation', () => {
    const r = evaluate({
      nominal: lineNominal,
      measured: [{ x: 5, y: 0 }],
      toleranceMm: 0.1,
      zoneType: 'bilateral',
    });
    expect(r.maxAbsoluteDeviationMm).toBeCloseTo(0, 6);
    expect(r.passed).toBe(true);
  });

  it('above-line measurement → positive deviation', () => {
    const r = evaluate({
      nominal: lineNominal,
      measured: [{ x: 5, y: 0.05 }],
      toleranceMm: 0.2,
      zoneType: 'bilateral',
    });
    expect(r.entries[0]!.signedDeviationMm).toBeCloseTo(0.05, 5);
    expect(r.passed).toBe(true);
  });

  it('exceeds bilateral tolerance → fail', () => {
    const r = evaluate({
      nominal: lineNominal,
      measured: [{ x: 5, y: 0.3 }],
      toleranceMm: 0.2,
      zoneType: 'bilateral',
    });
    expect(r.passed).toBe(false);
    expect(r.worstIndex).toBe(0);
  });

  it('unilateral-outside accepts positive, rejects negative', () => {
    const r1 = evaluate({ nominal: lineNominal, measured: [{ x: 5, y: 0.1 }], toleranceMm: 0.2, zoneType: 'unilateral-outside' });
    const r2 = evaluate({ nominal: lineNominal, measured: [{ x: 5, y: -0.05 }], toleranceMm: 0.2, zoneType: 'unilateral-outside' });
    expect(r1.passed).toBe(true);
    expect(r2.passed).toBe(false);
  });

  it('unilateral-inside accepts negative, rejects positive', () => {
    const r1 = evaluate({ nominal: lineNominal, measured: [{ x: 5, y: -0.1 }], toleranceMm: 0.2, zoneType: 'unilateral-inside' });
    const r2 = evaluate({ nominal: lineNominal, measured: [{ x: 5, y: 0.05 }], toleranceMm: 0.2, zoneType: 'unilateral-inside' });
    expect(r1.passed).toBe(true);
    expect(r2.passed).toBe(false);
  });

  it('mean across symmetric scatter ≈ 0', () => {
    const r = evaluate({
      nominal: lineNominal,
      measured: [{ x: 2, y: 0.1 }, { x: 4, y: -0.1 }, { x: 6, y: 0.1 }, { x: 8, y: -0.1 }],
      toleranceMm: 1.0,
      zoneType: 'bilateral',
    });
    expect(r.meanDeviationMm).toBeCloseTo(0, 6);
  });

  it('std-dev positive for scattered points', () => {
    const r = evaluate({
      nominal: lineNominal,
      measured: [{ x: 2, y: 0.05 }, { x: 6, y: -0.05 }],
      toleranceMm: 1.0,
      zoneType: 'bilateral',
    });
    expect(r.stdDeviationMm).toBeGreaterThan(0);
  });

  it('insufficient nominal points → warning', () => {
    const r = evaluate({
      nominal: [{ x: 0, y: 0 }],
      measured: [{ x: 1, y: 1 }],
      toleranceMm: 0.1,
      zoneType: 'bilateral',
    });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('worstIndex points to largest deviation', () => {
    const r = evaluate({
      nominal: lineNominal,
      measured: [{ x: 2, y: 0.01 }, { x: 4, y: 0.5 }, { x: 6, y: 0.02 }],
      toleranceMm: 1.0,
      zoneType: 'bilateral',
    });
    expect(r.worstIndex).toBe(1);
  });
});

describe('summarize', () => {
  it('reports pass + max + count', () => {
    const r = evaluate({
      nominal: lineNominal,
      measured: [{ x: 5, y: 0.05 }],
      toleranceMm: 0.2,
      zoneType: 'bilateral',
    });
    const s = summarize(r);
    expect(s.passed).toBe(true);
    expect(s.pointCount).toBe(1);
  });
});
