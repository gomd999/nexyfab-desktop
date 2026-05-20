import { describe, it, expect } from 'vitest';
import {
  generatePath,
  recommendPitch,
  estimateTime,
  summarize,
  type TrochoidalInput,
} from './trochoidalSlotPath';

const base: TrochoidalInput = {
  slotStartMm: { x: 0, y: 0 },
  slotEndMm: { x: 100, y: 0 },
  slotWidthMm: 12,
  toolDiameterMm: 6,
  pitchMm: 1,
};

describe('generatePath', () => {
  it('produces loops along the slot', () => {
    const r = generatePath(base);
    expect(r.loopCount).toBeGreaterThan(1);
    expect(r.path.length).toBeGreaterThan(r.loopCount);
  });

  it('loop radius = (slotWidth − toolDiameter)/2', () => {
    const r = generatePath(base);
    expect(r.loopRadiusMm).toBeCloseTo(3, 6);
  });

  it('loop count ≈ slotLength / pitch', () => {
    const r = generatePath(base);
    expect(r.loopCount).toBe(Math.ceil(100 / 1));
  });

  it('tool ≥ slot width → warning', () => {
    const r = generatePath({ ...base, toolDiameterMm: 12 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('zero-length slot → warning + empty path', () => {
    const r = generatePath({ ...base, slotEndMm: { x: 0, y: 0 } });
    expect(r.path).toEqual([]);
    expect(r.warnings.some(w => w.includes('zero length'))).toBe(true);
  });

  it('some points marked engaged, some not', () => {
    const r = generatePath(base);
    expect(r.path.some(p => p.engaged)).toBe(true);
    expect(r.path.some(p => !p.engaged)).toBe(true);
  });

  it('total path length positive', () => {
    expect(generatePath(base).totalPathLengthMm).toBeGreaterThan(0);
  });

  it('smaller pitch → more loops', () => {
    const coarse = generatePath({ ...base, pitchMm: 2 });
    const fine = generatePath({ ...base, pitchMm: 0.5 });
    expect(fine.loopCount).toBeGreaterThan(coarse.loopCount);
  });

  it('diagonal slot handled', () => {
    const r = generatePath({ ...base, slotEndMm: { x: 70, y: 70 } });
    expect(r.path.length).toBeGreaterThan(0);
  });
});

describe('recommendPitch', () => {
  it('default 10% of tool diameter', () => {
    expect(recommendPitch(10)).toBeCloseTo(1, 6);
  });

  it('custom fraction', () => {
    expect(recommendPitch(10, 0.05)).toBeCloseTo(0.5, 6);
  });
});

describe('estimateTime', () => {
  it('time = length / feed', () => {
    const r = generatePath(base);
    const t = estimateTime(r, 1000);
    expect(t).toBeCloseTo(r.totalPathLengthMm / 1000, 6);
  });

  it('zero feed → 0', () => {
    expect(estimateTime(generatePath(base), 0)).toBe(0);
  });
});

describe('summarize', () => {
  it('reports loop count + radius', () => {
    const r = generatePath(base);
    const s = summarize(r);
    expect(s.loopCount).toBe(r.loopCount);
    expect(s.loopRadiusMm).toBe(r.loopRadiusMm);
  });
});
