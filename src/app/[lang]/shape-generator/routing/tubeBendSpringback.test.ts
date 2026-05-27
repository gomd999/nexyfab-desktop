import { describe, it, expect } from 'vitest';
import {
  compute,
  developedLength,
  summarize,
  type TubeBendInput,
} from './tubeBendSpringback';

const base: TubeBendInput = {
  centerlineRadiusMm: 50,
  bendAngleDeg: 90,
  tubeODmm: 25,
  wallThicknessMm: 2,
  youngMpa: 200000,
  yieldMpa: 300,
};

describe('compute', () => {
  it('springback ratio in (0, 1]', () => {
    const r = compute(base);
    expect(r.springbackRatio).toBeGreaterThan(0);
    expect(r.springbackRatio).toBeLessThanOrEqual(1);
  });

  it('overbend angle ≥ target', () => {
    const r = compute(base);
    expect(r.overbendAngleDeg).toBeGreaterThanOrEqual(base.bendAngleDeg);
  });

  it('corrected die radius ≥ target', () => {
    const r = compute(base);
    expect(r.correctedDieRadiusMm).toBeLessThanOrEqual(base.centerlineRadiusMm);
  });

  it('springback angle = overbend − target', () => {
    const r = compute(base);
    expect(r.springbackAngleDeg).toBeCloseTo(r.overbendAngleDeg - base.bendAngleDeg, 6);
  });

  it('higher yield → more springback (lower Ks)', () => {
    const low = compute({ ...base, yieldMpa: 200 });
    const high = compute({ ...base, yieldMpa: 600 });
    expect(high.springbackRatio).toBeLessThan(low.springbackRatio);
  });

  it('tight CLR/OD < 1.5 → warning', () => {
    const r = compute({ ...base, centerlineRadiusMm: 30 }); // 30/25 = 1.2
    expect(r.wallFactorOk).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('generous CLR/OD → ok', () => {
    const r = compute({ ...base, centerlineRadiusMm: 80 });
    expect(r.wallFactorOk).toBe(true);
  });

  it('zero wall → warning', () => {
    const r = compute({ ...base, wallThicknessMm: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('developedLength', () => {
  it('straight + arc + straight', () => {
    const L = developedLength(100, 100, 50, 90);
    const arc = 50 * (Math.PI / 2);
    expect(L).toBeCloseTo(200 + arc, 6);
  });

  it('larger angle → longer arc', () => {
    expect(developedLength(0, 0, 50, 180)).toBeGreaterThan(developedLength(0, 0, 50, 90));
  });
});

describe('summarize', () => {
  it('reports ratio + overbend', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.springbackRatio).toBe(r.springbackRatio);
    expect(s.overbendAngleDeg).toBe(r.overbendAngleDeg);
  });
});
