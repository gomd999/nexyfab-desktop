import { describe, it, expect } from 'vitest';
import {
  generateFacing,
  estimateMrr,
  emitGcode,
  summarize,
  type RectangularFace,
  type CircularFace,
} from './facingStrategySpiral';

const rect: RectangularFace = { kind: 'rect', min: { x: 0, y: 0 }, max: { x: 100, y: 80 } };
const circle: CircularFace = { kind: 'circle', centre: { x: 50, y: 50 }, radiusMm: 40 };

describe('generateFacing', () => {
  it('rectangular face → many points', () => {
    const r = generateFacing(rect);
    expect(r.pathPoints.length).toBeGreaterThan(10);
  });

  it('circular face → spiral points', () => {
    const r = generateFacing(circle);
    expect(r.pathPoints.length).toBeGreaterThan(50);
  });

  it('total length positive', () => {
    expect(generateFacing(rect).totalLengthMm).toBeGreaterThan(0);
  });

  it('time positive', () => {
    expect(generateFacing(rect).estimatedTimeSec).toBeGreaterThan(0);
  });

  it('inside-out reverses path', () => {
    const outIn = generateFacing(rect, { direction: 'outside-in', stepoverMm: 4, feedMmMin: 800, finishOverlapMm: 1 });
    const inOut = generateFacing(rect, { direction: 'inside-out', stepoverMm: 4, feedMmMin: 800, finishOverlapMm: 1 });
    expect(inOut.pathPoints[0]).not.toEqual(outIn.pathPoints[0]);
  });

  it('larger stepover → fewer passes', () => {
    const fine = generateFacing(rect, { stepoverMm: 2, feedMmMin: 800, direction: 'outside-in', finishOverlapMm: 1 });
    const coarse = generateFacing(rect, { stepoverMm: 10, feedMmMin: 800, direction: 'outside-in', finishOverlapMm: 1 });
    expect(coarse.passCount).toBeLessThan(fine.passCount);
  });

  it('circular spiral points lie within radius', () => {
    const r = generateFacing(circle);
    for (const p of r.pathPoints) {
      const d = Math.hypot(p.x - circle.centre.x, p.y - circle.centre.y);
      expect(d).toBeLessThanOrEqual(circle.radiusMm + 0.01);
    }
  });
});

describe('estimateMrr', () => {
  it('positive MRR for valid input', () => {
    const r = estimateMrr(rect, 1);
    expect(r.mrrMm3PerMin).toBeGreaterThan(0);
  });

  it('larger area → more total volume', () => {
    const small = estimateMrr({ kind: 'rect', min: { x: 0, y: 0 }, max: { x: 10, y: 10 } }, 1);
    const big = estimateMrr(rect, 1);
    expect(big.totalVolumeMm3).toBeGreaterThan(small.totalVolumeMm3);
  });

  it('circular area = π·R²·depth', () => {
    const r = estimateMrr({ kind: 'circle', centre: { x: 0, y: 0 }, radiusMm: 10 }, 2);
    expect(r.totalVolumeMm3).toBeCloseTo(Math.PI * 100 * 2, 1);
  });
});

describe('emitGcode', () => {
  it('starts with G0 rapid', () => {
    const r = generateFacing(rect);
    const lines = emitGcode(r);
    expect(lines[0]).toMatch(/^G0/);
  });

  it('subsequent moves are G1', () => {
    const r = generateFacing(rect);
    const lines = emitGcode(r);
    expect(lines[1]).toMatch(/^G1/);
  });
});

describe('summarize', () => {
  it('reports face kind', () => {
    const r = generateFacing(rect);
    expect(summarize(rect, r).faceKind).toBe('rect');
  });
});
