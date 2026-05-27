import { describe, it, expect } from 'vitest';
import {
  generateTrochoidalPath,
  estimateTime,
  compareWithConventional,
  summarize,
  type TrochoidalInput,
} from './trochoidalMilling';

function basicInput(): TrochoidalInput {
  return {
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
    widthMm: 10,
    toolDiameterMm: 6,
    stepoverMm: 2,
    radialEngagement: 0.15,
    samplesPerCircle: 32,
    direction: 'climb',
  };
}

describe('generateTrochoidalPath', () => {
  it('empty length → empty points', () => {
    const r = generateTrochoidalPath({ ...basicInput(), start: { x: 0, y: 0 }, end: { x: 0, y: 0 } });
    expect(r.points).toEqual([]);
  });

  it('slot narrower than tool → empty', () => {
    const r = generateTrochoidalPath({ ...basicInput(), widthMm: 1 });
    expect(r.points).toEqual([]);
  });

  it('produces a non-empty point list', () => {
    const r = generateTrochoidalPath(basicInput());
    expect(r.points.length).toBeGreaterThan(0);
  });

  it('circle count proportional to length / stepover', () => {
    const r = generateTrochoidalPath(basicInput());
    expect(r.circleCount).toBeGreaterThanOrEqual(50);
  });

  it('total length > slot length', () => {
    const r = generateTrochoidalPath(basicInput());
    const slotLen = 100;
    expect(r.totalLengthMm).toBeGreaterThan(slotLen);
  });

  it('low radial engagement applied', () => {
    const r = generateTrochoidalPath({ ...basicInput(), radialEngagement: 0.1 });
    expect(r.appliedEngagement).toBeLessThanOrEqual(0.5);
  });

  it('climb vs conventional produce different paths', () => {
    const climb = generateTrochoidalPath({ ...basicInput(), direction: 'climb' });
    const conv = generateTrochoidalPath({ ...basicInput(), direction: 'conventional' });
    expect(climb.points).not.toEqual(conv.points);
  });

  it('smaller stepover → more circles', () => {
    const small = generateTrochoidalPath({ ...basicInput(), stepoverMm: 1 });
    const big = generateTrochoidalPath({ ...basicInput(), stepoverMm: 5 });
    expect(small.circleCount).toBeGreaterThan(big.circleCount);
  });
});

describe('estimateTime', () => {
  it('time scales with length / feed', () => {
    const r = generateTrochoidalPath(basicInput());
    const t = estimateTime(r, 1500);
    expect(t.cuttingTimeSec).toBeCloseTo((r.totalLengthMm / 1500) * 60, 3);
  });

  it('zero feed → zero time', () => {
    const r = generateTrochoidalPath(basicInput());
    expect(estimateTime(r, 0).cuttingTimeSec).toBe(0);
  });
});

describe('compareWithConventional', () => {
  it('trochoidal much longer than conventional', () => {
    const input = basicInput();
    const r = generateTrochoidalPath(input);
    const c = compareWithConventional(input, r);
    expect(c.lengthRatio).toBeGreaterThan(2);
  });

  it('returns recommendation reason text', () => {
    const input = basicInput();
    const r = generateTrochoidalPath(input);
    const c = compareWithConventional(input, r);
    expect(c.recommendedReason.length).toBeGreaterThan(0);
  });
});

describe('summarize', () => {
  it('empty', () => {
    const s = summarize({ points: [], circleCount: 0, totalLengthMm: 0, appliedEngagement: 0 });
    expect(s.pointCount).toBe(0);
  });

  it('low engagement flag', () => {
    const r = generateTrochoidalPath({ ...basicInput(), radialEngagement: 0.1 });
    const s = summarize(r);
    expect(s.isLowEngagement).toBe(true);
  });

  it('reports total length', () => {
    const r = generateTrochoidalPath(basicInput());
    const s = summarize(r);
    expect(s.totalLengthMm).toBe(r.totalLengthMm);
  });
});
