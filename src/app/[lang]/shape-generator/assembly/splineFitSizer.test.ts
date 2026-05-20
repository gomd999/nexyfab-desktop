import { describe, it, expect } from 'vitest';
import {
  size,
  minEngagementLength,
  safetyFactor,
  summarize,
  type SplineInput,
} from './splineFitSizer';

const base: SplineInput = {
  numberOfTeeth: 10,
  moduleMm: 2,
  toothHeightMm: 2,
  engagementLengthMm: 30,
  allowableBearingMpa: 50,
};

describe('size', () => {
  it('involute pitch diameter = module × teeth', () => {
    const r = size(base);
    expect(r.pitchDiameterMm).toBe(20);
  });

  it('mean radius = PD / 2', () => {
    const r = size(base);
    expect(r.meanRadiusMm).toBe(10);
  });

  it('torque capacity positive', () => {
    const r = size(base);
    expect(r.torqueCapacityNm).toBeGreaterThan(0);
  });

  it('contact area = N × h × L', () => {
    const r = size(base);
    expect(r.contactAreaMm2).toBeCloseTo(10 * 2 * 30, 6);
  });

  it('torque scales with engagement length', () => {
    const short = size({ ...base, engagementLengthMm: 15 });
    const long = size({ ...base, engagementLengthMm: 30 });
    expect(long.torqueCapacityNm).toBeCloseTo(2 * short.torqueCapacityNm, 4);
  });

  it('straight-sided uses given pitch diameter', () => {
    const r = size({ ...base, type: 'straight-sided', pitchDiameterMm: 25, moduleMm: undefined });
    expect(r.pitchDiameterMm).toBe(25);
  });

  it('involute without module → warning', () => {
    const r = size({ ...base, moduleMm: undefined });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('load sharing factor scales torque', () => {
    const low = size({ ...base, loadSharingFactor: 0.5 });
    const high = size({ ...base, loadSharingFactor: 1.0 });
    expect(high.torqueCapacityNm).toBeGreaterThan(low.torqueCapacityNm);
  });

  it('zero teeth → warning', () => {
    const r = size({ ...base, numberOfTeeth: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('minEngagementLength', () => {
  it('round-trips with size', () => {
    const r = size(base);
    const L = minEngagementLength(base, r.torqueCapacityNm);
    expect(L).toBeCloseTo(30, 3);
  });

  it('higher torque → longer engagement', () => {
    const low = minEngagementLength(base, 100);
    const high = minEngagementLength(base, 400);
    expect(high).toBeGreaterThan(low);
  });
});

describe('safetyFactor', () => {
  it('capacity / applied', () => {
    const r = size(base);
    expect(safetyFactor(r, r.torqueCapacityNm / 2)).toBeCloseTo(2, 4);
  });

  it('zero applied → Infinity', () => {
    const r = size(base);
    expect(safetyFactor(r, 0)).toBe(Infinity);
  });
});

describe('summarize', () => {
  it('reports PD + capacity + type', () => {
    const r = size(base);
    const s = summarize(r);
    expect(s.pitchDiameterMm).toBe(r.pitchDiameterMm);
    expect(s.type).toBe('involute');
  });
});
