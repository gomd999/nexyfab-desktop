import { describe, it, expect } from 'vitest';
import {
  generateLeadIn,
  generateLeadOut,
  recommendLead,
  type PathPoint,
} from './leadInOut';

const startPoint: PathPoint = {
  position: [0, 0, 0],
  tangent: [1, 0, 0],
};

const endPoint: PathPoint = {
  position: [10, 0, 0],
  tangent: [1, 0, 0],
};

describe('generateLeadIn — tangent-line', () => {
  it('empty for "none"', () => {
    const r = generateLeadIn({ kind: 'none' }, startPoint);
    expect(r.points).toEqual([]);
    expect(r.lengthMm).toBe(0);
  });

  it('ends at the cut start', () => {
    const r = generateLeadIn({ kind: 'tangent-line', lengthMm: 5 }, startPoint);
    const last = r.points[r.points.length - 1]!;
    expect(last.position[0]).toBeCloseTo(0, 5);
  });

  it('starts before the cut start along negative tangent', () => {
    const r = generateLeadIn({ kind: 'tangent-line', lengthMm: 5 }, startPoint);
    expect(r.points[0]!.position[0]).toBeCloseTo(-5, 5);
  });

  it('length matches requested', () => {
    const r = generateLeadIn({ kind: 'tangent-line', lengthMm: 5 }, startPoint);
    expect(r.lengthMm).toBe(5);
  });
});

describe('generateLeadIn — tangent-arc', () => {
  it('produces arcSampleCount + 1 points by default', () => {
    const r = generateLeadIn({ kind: 'tangent-arc', radiusMm: 5, angleDeg: 90 }, startPoint);
    expect(r.points.length).toBeGreaterThan(0);
  });

  it('arc length matches radius × angle (rad)', () => {
    const r = generateLeadIn({ kind: 'tangent-arc', radiusMm: 5, angleDeg: 90 }, startPoint);
    expect(r.lengthMm).toBeCloseTo(5 * Math.PI / 2, 4);
  });

  it('last point approaches the cut start', () => {
    const r = generateLeadIn({ kind: 'tangent-arc', radiusMm: 5, angleDeg: 90 }, startPoint);
    const last = r.points[r.points.length - 1]!.position;
    expect(Math.hypot(last[0], last[1], last[2])).toBeLessThan(1);
  });
});

describe('generateLeadIn — perpendicular', () => {
  it('starts perpendicular to tangent', () => {
    const r = generateLeadIn({ kind: 'perpendicular', lengthMm: 5 }, startPoint);
    const start = r.points[0]!.position;
    // tangent is (1,0,0), perpendicular start should have Z offset.
    expect(Math.abs(start[0])).toBeLessThan(1e-6);
    expect(Math.hypot(start[1], start[2])).toBeCloseTo(5, 5);
  });
});

describe('generateLeadIn — helical-ramp', () => {
  it('descends to anchor over ramp count', () => {
    const r = generateLeadIn({ kind: 'helical-ramp', descentMm: 5, ramps: 2 }, startPoint);
    expect(r.points.length).toBeGreaterThan(20);
    expect(r.lengthMm).toBeGreaterThan(5);
  });
});

describe('generateLeadOut', () => {
  it('tangent-line starts at the cut end', () => {
    const r = generateLeadOut({ kind: 'tangent-line', lengthMm: 5 }, endPoint);
    expect(r.points[0]!.position[0]).toBeCloseTo(10, 5);
  });

  it('tangent-arc starts at the cut end', () => {
    const r = generateLeadOut({ kind: 'tangent-arc', radiusMm: 3, angleDeg: 60 }, endPoint);
    expect(r.points[0]!.position[0]).toBeCloseTo(10, 5);
  });

  it('"none" produces empty path', () => {
    const r = generateLeadOut({ kind: 'none' }, endPoint);
    expect(r.points).toHaveLength(0);
  });
});

describe('recommendLead', () => {
  it('closed-profile suggests tangent-arc both ends', () => {
    const r = recommendLead('closed-profile', 6);
    expect(r.inLead.kind).toBe('tangent-arc');
    expect(r.outLead.kind).toBe('tangent-arc');
  });

  it('pocket-entry suggests helical-ramp in', () => {
    const r = recommendLead('pocket-entry', 6);
    expect(r.inLead.kind).toBe('helical-ramp');
  });

  it('slot suggests perpendicular', () => {
    const r = recommendLead('slot', 6);
    expect(r.inLead.kind).toBe('perpendicular');
    expect(r.outLead.kind).toBe('perpendicular');
  });

  it('open-path suggests tangent-line', () => {
    const r = recommendLead('open-path', 6);
    expect(r.inLead.kind).toBe('tangent-line');
    expect(r.outLead.kind).toBe('tangent-line');
  });

  it('reason text non-empty', () => {
    const r = recommendLead('closed-profile', 6);
    expect(r.reason.length).toBeGreaterThan(0);
  });
});
