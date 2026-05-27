import { describe, it, expect } from 'vitest';
import { compute, feedForTargetRa, summarize, type TurningFinishInput } from './turningSurfaceFinish';

const base: TurningFinishInput = { feedMmPerRev: 0.2, noseRadiusMm: 0.8 };

describe('compute', () => {
  it('Ra = f²/(32·rε) in µm', () => {
    const r = compute(base);
    expect(r.raMicrometer).toBeCloseTo((0.2 * 0.2) / (32 * 0.8) * 1000, 5);
  });

  it('Rmax = f²/(8·rε) = 4·Ra', () => {
    const r = compute(base);
    expect(r.rmaxMicrometer).toBeCloseTo(r.raMicrometer * 4, 5);
  });

  it('finer feed → smaller Ra (quadratic)', () => {
    const fine = compute({ ...base, feedMmPerRev: 0.1 });
    const coarse = compute({ ...base, feedMmPerRev: 0.4 });
    expect(coarse.raMicrometer).toBeCloseTo(fine.raMicrometer * 16, 4);
  });

  it('larger nose radius → smaller Ra', () => {
    const sharp = compute({ ...base, noseRadiusMm: 0.4 });
    const round = compute({ ...base, noseRadiusMm: 1.6 });
    expect(round.raMicrometer).toBeLessThan(sharp.raMicrometer);
  });

  it('assigns an ISO N-grade', () => {
    expect(compute(base).isoGradeN).toBeGreaterThanOrEqual(1);
    expect(compute(base).isoGradeN).toBeLessThanOrEqual(12);
  });

  it('meets target when Ra ≤ target', () => {
    const r = compute({ ...base, targetRaMicrometer: 10 });
    expect(r.meetsTarget).toBe(true);
  });

  it('fails + warns when Ra > target', () => {
    const r = compute({ feedMmPerRev: 0.5, noseRadiusMm: 0.4, targetRaMicrometer: 1.6 });
    expect(r.meetsTarget).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('very low feed warns about built-up edge', () => {
    expect(compute({ ...base, feedMmPerRev: 0.02 }).warnings.length).toBeGreaterThan(0);
  });

  it('zero nose radius → warning', () => {
    expect(compute({ ...base, noseRadiusMm: 0 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('feedForTargetRa', () => {
  it('inverts the Ra formula', () => {
    const f = feedForTargetRa(0.8, compute(base).raMicrometer);
    expect(f).toBeCloseTo(0.2, 5);
  });
});

describe('summarize', () => {
  it('reports Ra + grade + target', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.raMicrometer).toBe(r.raMicrometer);
    expect(s.isoGradeN).toBe(r.isoGradeN);
  });
});
