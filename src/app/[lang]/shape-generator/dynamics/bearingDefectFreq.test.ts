import { describe, it, expect } from 'vitest';
import { compute, harmonics, summarize, type BearingDefectInput } from './bearingDefectFreq';

// 6205-style: 9 balls, d=7.94, D=39, φ=0, 1800 rpm → fr=30 Hz.
const base: BearingDefectInput = {
  shaftRpm: 1800, elementCount: 9, elementDiameterMm: 7.94, pitchDiameterMm: 39, contactAngleDeg: 0,
};

describe('compute', () => {
  it('shaft freq = rpm / 60', () => {
    expect(compute(base).shaftFreqHz).toBeCloseTo(30, 5);
  });

  it('BPFO = (N/2)·fr·(1 − r)', () => {
    const r = compute(base);
    const ratio = 7.94 / 39;
    expect(r.bpfoHz).toBeCloseTo((9 / 2) * 30 * (1 - ratio), 5);
  });

  it('BPFI = (N/2)·fr·(1 + r)', () => {
    const r = compute(base);
    const ratio = 7.94 / 39;
    expect(r.bpfiHz).toBeCloseTo((9 / 2) * 30 * (1 + ratio), 5);
  });

  it('BPFI > BPFO', () => {
    const r = compute(base);
    expect(r.bpfiHz).toBeGreaterThan(r.bpfoHz);
  });

  it('FTF = (1/2)·fr·(1 − r) and is below shaft freq', () => {
    const r = compute(base);
    const ratio = 7.94 / 39;
    expect(r.ftfHz).toBeCloseTo(0.5 * 30 * (1 - ratio), 5);
    expect(r.ftfHz).toBeLessThan(r.shaftFreqHz);
  });

  it('BSF formula', () => {
    const r = compute(base);
    const ratio = 7.94 / 39;
    expect(r.bsfHz).toBeCloseTo((39 / (2 * 7.94)) * 30 * (1 - ratio * ratio), 5);
  });

  it('contact angle reduces effective ratio (BPFO rises toward N/2·fr)', () => {
    const flat = compute(base);
    const angled = compute({ ...base, contactAngleDeg: 40 });
    expect(angled.bpfoHz).toBeGreaterThan(flat.bpfoHz);
  });

  it('orders scale with shaft speed-independently', () => {
    const a = compute(base);
    const b = compute({ ...base, shaftRpm: 3600 });
    expect(a.bpfoOrders).toBeCloseTo(b.bpfoOrders, 5);
  });

  it('element ≥ pitch → warning', () => {
    expect(compute({ ...base, elementDiameterMm: 40 }).warnings.length).toBeGreaterThan(0);
  });

  it('double rpm doubles BPFO', () => {
    const a = compute(base);
    const b = compute({ ...base, shaftRpm: 3600 });
    expect(b.bpfoHz).toBeCloseTo(a.bpfoHz * 2, 4);
  });
});

describe('harmonics', () => {
  it('returns n× multiples', () => {
    expect(harmonics(50, 3)).toEqual([50, 100, 150]);
  });
});

describe('summarize', () => {
  it('reports the four defect frequencies', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.bpfoHz).toBe(r.bpfoHz);
    expect(s.ftfHz).toBe(r.ftfHz);
  });
});
