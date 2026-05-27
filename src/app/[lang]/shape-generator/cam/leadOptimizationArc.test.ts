import { describe, it, expect } from 'vitest';
import {
  generateLeadIn,
  generateLeadOut,
  optimiseSweep,
  compareStyles,
  summarize,
  type CutSegment,
} from './leadOptimizationArc';

const segment: CutSegment = {
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
  startDirection: { x: 1, y: 0 },
};

describe('generateLeadIn', () => {
  it('produces a polyline of points', () => {
    const r = generateLeadIn(segment, { toolDiameterMm: 10, style: 'tangent-arc', sweepDeg: 90, radiusFactor: 0.5 });
    expect(r.points.length).toBeGreaterThan(2);
  });

  it('ends at segment start', () => {
    const r = generateLeadIn(segment);
    const last = r.points[r.points.length - 1]!;
    expect(last.x).toBeCloseTo(segment.start.x, 1);
    expect(last.y).toBeCloseTo(segment.start.y, 1);
  });

  it('arc length = R · sweep', () => {
    const r = generateLeadIn(segment, { toolDiameterMm: 10, style: 'tangent-arc', sweepDeg: 90, radiusFactor: 0.5 });
    expect(r.lengthMm).toBeCloseTo(5 * (Math.PI / 2), 2);
  });

  it('larger radius factor → longer arc', () => {
    const small = generateLeadIn(segment, { toolDiameterMm: 10, style: 'tangent-arc', sweepDeg: 90, radiusFactor: 0.3 });
    const big = generateLeadIn(segment, { toolDiameterMm: 10, style: 'tangent-arc', sweepDeg: 90, radiusFactor: 1.0 });
    expect(big.lengthMm).toBeGreaterThan(small.lengthMm);
  });

  it('larger sweep → longer arc', () => {
    const small = generateLeadIn(segment, { toolDiameterMm: 10, style: 'tangent-arc', sweepDeg: 45, radiusFactor: 0.5 });
    const big = generateLeadIn(segment, { toolDiameterMm: 10, style: 'tangent-arc', sweepDeg: 180, radiusFactor: 0.5 });
    expect(big.lengthMm).toBeGreaterThan(small.lengthMm);
  });
});

describe('generateLeadOut', () => {
  it('starts at segment end', () => {
    const r = generateLeadOut(segment);
    expect(r.points[0]!.x).toBeCloseTo(segment.end.x, 1);
  });

  it('arc length positive', () => {
    const r = generateLeadOut(segment);
    expect(r.lengthMm).toBeGreaterThan(0);
  });
});

describe('optimiseSweep', () => {
  it('inconel suggests larger sweep', () => {
    const al = optimiseSweep(10, 'aluminum');
    const inc = optimiseSweep(10, 'inconel');
    expect(inc.bestSweepDeg).toBeGreaterThan(al.bestSweepDeg);
  });

  it('aluminum estimates fine Ra', () => {
    const r = optimiseSweep(10, 'aluminum');
    expect(r.estimatedSurfaceRaMicron).toBeLessThan(2);
  });
});

describe('compareStyles', () => {
  it('returns entry per style', () => {
    const r = compareStyles(segment, 10);
    expect(r).toHaveLength(3);
  });

  it('arc lengths positive', () => {
    const r = compareStyles(segment, 10);
    expect(r.every(s => s.arcLengthMm > 0)).toBe(true);
  });
});

describe('summarize', () => {
  it('reports total overhead', () => {
    const lin = generateLeadIn(segment);
    const lout = generateLeadOut(segment);
    const s = summarize(lin, lout);
    expect(s.totalOverhead).toBeCloseTo(lin.lengthMm + lout.lengthMm, 5);
  });
});
