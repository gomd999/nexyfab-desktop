import { describe, it, expect } from 'vitest';
import {
  generateHelical,
  helixPolyline,
  summarize,
  type HelicalParams,
} from './helicalInterpolationGen';

function params(boreDia: number, toolDia: number, depth: number = 10, ramp: number = 3): HelicalParams {
  return {
    centre: { x: 0, y: 0 },
    finalZ: -depth,
    startZ: 0,
    boreDiameterMm: boreDia,
    toolDiameterMm: toolDia,
    rampAngleDeg: ramp,
    direction: 'climb',
    feedMmMin: 200,
  };
}

describe('generateHelical', () => {
  it('bore <= tool → warning, no gcode', () => {
    const r = generateHelical(params(8, 10));
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.gcode.length).toBe(0);
  });

  it('valid bore → radius = (bore-tool)/2', () => {
    const r = generateHelical(params(20, 10));
    expect(r.radiusMm).toBeCloseTo(5, 5);
  });

  it('descendPerRev derived from rampAngle', () => {
    const r = generateHelical(params(20, 10, 10, 3));
    // descend = 2π·5·tan(3°) ≈ 1.65
    expect(r.descendPerRevMm).toBeCloseTo(2 * Math.PI * 5 * Math.tan(3 * Math.PI / 180), 2);
  });

  it('revolutions = depth / descendPerRev', () => {
    const r = generateHelical(params(20, 10, 10, 3));
    expect(r.revolutions).toBeCloseTo(10 / r.descendPerRevMm, 3);
  });

  it('time positive when feed > 0', () => {
    const r = generateHelical(params(20, 10));
    expect(r.estimatedTimeSec).toBeGreaterThan(0);
  });

  it('emits G03 for climb', () => {
    const r = generateHelical(params(20, 10));
    expect(r.gcode.some(l => l.startsWith('G03'))).toBe(true);
  });

  it('emits G02 for conventional', () => {
    const p = params(20, 10);
    p.direction = 'conventional';
    const r = generateHelical(p);
    expect(r.gcode.some(l => l.startsWith('G02'))).toBe(true);
  });

  it('descendPerRevMm override respected', () => {
    const r = generateHelical({
      centre: { x: 0, y: 0 }, finalZ: -10, startZ: 0,
      boreDiameterMm: 20, toolDiameterMm: 10, descendPerRevMm: 2,
      direction: 'climb', feedMmMin: 200,
    });
    expect(r.descendPerRevMm).toBe(2);
  });

  it('warning when ramp angle > 5°', () => {
    const r = generateHelical(params(20, 10, 10, 10));
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('warning when finalZ ≥ startZ', () => {
    const r = generateHelical({
      centre: { x: 0, y: 0 }, finalZ: 5, startZ: 0,
      boreDiameterMm: 20, toolDiameterMm: 10, rampAngleDeg: 3,
      direction: 'climb', feedMmMin: 200,
    });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('helixPolyline', () => {
  it('produces a list of points', () => {
    const pts = helixPolyline(params(20, 10, 10, 3));
    expect(pts.length).toBeGreaterThan(0);
  });

  it('z decreases monotonically from startZ', () => {
    const pts = helixPolyline(params(20, 10, 10, 3));
    expect(pts[0]!.z).toBeGreaterThanOrEqual(pts[pts.length - 1]!.z);
  });

  it('radial distance ≈ helix radius', () => {
    const pts = helixPolyline(params(20, 10, 10, 3));
    for (const p of pts) {
      const r = Math.hypot(p.x, p.y);
      expect(r).toBeCloseTo(5, 1);
    }
  });

  it('bore <= tool → empty', () => {
    expect(helixPolyline(params(8, 10))).toEqual([]);
  });
});

describe('summarize', () => {
  it('reports key metrics', () => {
    const r = generateHelical(params(20, 10));
    const s = summarize(r);
    expect(s.radiusMm).toBeCloseTo(5, 1);
    expect(s.revolutions).toBeGreaterThan(0);
  });

  it('warningCount tallies', () => {
    const r = generateHelical(params(8, 10));
    expect(summarize(r).warningCount).toBeGreaterThan(0);
  });
});
