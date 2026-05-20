import { describe, it, expect } from 'vitest';
import {
  analyzeNonlinearBuckling,
  imperfectionSweep,
  checkSafety,
  summarize,
  type StructureProperties,
} from './nonlinearBuckling';

function ideal(): StructureProperties {
  return { P_linear_cr: 10000, k0: 100, imperfectionMm: 0, softeningCoeff: 0.5 };
}

describe('analyzeNonlinearBuckling', () => {
  it('zero P_cr → empty result', () => {
    const r = analyzeNonlinearBuckling({ ...ideal(), P_linear_cr: 0 });
    expect(r.curve).toEqual([]);
  });

  it('produces curve with samples', () => {
    const r = analyzeNonlinearBuckling(ideal(), { samples: 50 });
    expect(r.curve).toHaveLength(51);
  });

  it('peak load ≤ linear critical', () => {
    const r = analyzeNonlinearBuckling(ideal());
    expect(r.peakLoadN).toBeLessThanOrEqual(ideal().P_linear_cr * 1.01);
  });

  it('imperfection reduces peak load', () => {
    const perfect = analyzeNonlinearBuckling(ideal());
    const imperf = analyzeNonlinearBuckling({ ...ideal(), imperfectionMm: 5 });
    expect(imperf.peakLoadN).toBeLessThanOrEqual(perfect.peakLoadN);
  });

  it('higher softening → more post-buckling drop', () => {
    const soft = analyzeNonlinearBuckling({ ...ideal(), softeningCoeff: 0.1 });
    const hard = analyzeNonlinearBuckling({ ...ideal(), softeningCoeff: 0.9 });
    expect(hard.peakLoadN).toBeLessThanOrEqual(soft.peakLoadN);
  });

  it('curve displacement monotonically increases', () => {
    const r = analyzeNonlinearBuckling(ideal());
    for (let i = 1; i < r.curve.length; i++) {
      expect(r.curve[i]!.displacementMm).toBeGreaterThanOrEqual(r.curve[i - 1]!.displacementMm);
    }
  });

  it('peakDisplacement matches curve maximum point', () => {
    const r = analyzeNonlinearBuckling(ideal());
    const max = r.curve.reduce((m, p) => p.loadN > m.loadN ? p : m, r.curve[0]!);
    expect(r.peakDisplacementMm).toBeCloseTo(max.displacementMm, 5);
  });
});

describe('imperfectionSweep', () => {
  it('returns one result per imperfection level', () => {
    const r = imperfectionSweep(ideal(), [0, 1, 2, 5]);
    expect(r).toHaveLength(4);
  });

  it('larger imperfection → larger reduction', () => {
    const r = imperfectionSweep(ideal(), [0, 5]);
    expect(r[1]!.reductionFromIdeal).toBeGreaterThanOrEqual(r[0]!.reductionFromIdeal);
  });

  it('ideal case reduction = 0', () => {
    const r = imperfectionSweep(ideal(), [0]);
    expect(r[0]!.reductionFromIdeal).toBeCloseTo(0, 5);
  });
});

describe('checkSafety', () => {
  it('passes when SF ≥ required', () => {
    const r = analyzeNonlinearBuckling(ideal());
    const c = checkSafety(r, 1000, 2);
    expect(c.passes).toBe(true);
  });

  it('fails when applied load too high', () => {
    const r = analyzeNonlinearBuckling(ideal());
    const c = checkSafety(r, 50000, 2);
    expect(c.passes).toBe(false);
  });

  it('SF = peak / applied', () => {
    const r = analyzeNonlinearBuckling(ideal());
    const c = checkSafety(r, 5000);
    expect(c.safetyFactor).toBeCloseTo(r.peakLoadN / 5000, 3);
  });
});

describe('summarize', () => {
  it('reports peak + reduction', () => {
    const r = analyzeNonlinearBuckling(ideal());
    const s = summarize(ideal(), r);
    expect(s.linearLoadN).toBe(ideal().P_linear_cr);
    expect(s.reductionFromLinear).toBeGreaterThanOrEqual(0);
  });

  it('postBuckling flag forwarded', () => {
    const r = analyzeNonlinearBuckling(ideal());
    const s = summarize(ideal(), r);
    expect(typeof s.postBuckling).toBe('boolean');
  });
});
