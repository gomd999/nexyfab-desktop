import { describe, it, expect } from 'vitest';
import {
  generatePath,
  multiPassPlan,
  heatInputKjPerMm,
  summarize,
  type SeamPoint,
} from './weldBeadPathGenerator';

function seamPoint(x: number, y: number, z: number, nz: number = 1): SeamPoint {
  return { position: { x, y, z }, normal: { x: 0, y: 0, z: nz } };
}

describe('generatePath', () => {
  it('< 2 points → warning', () => {
    const r = generatePath([seamPoint(0, 0, 0)]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('straight seam → N waypoints', () => {
    const seam = [seamPoint(0, 0, 0), seamPoint(50, 0, 0), seamPoint(100, 0, 0)];
    const r = generatePath(seam);
    expect(r.waypoints).toHaveLength(3);
  });

  it('totalSeamLength sum of segments', () => {
    const seam = [seamPoint(0, 0, 0), seamPoint(100, 0, 0)];
    const r = generatePath(seam);
    expect(r.totalSeamLengthMm).toBeCloseTo(100, 1);
  });

  it('arc-on flag set', () => {
    const r = generatePath([seamPoint(0, 0, 0), seamPoint(10, 0, 0)]);
    expect(r.waypoints[0]!.arcOn).toBe(true);
  });

  it('weave triangular shifts position', () => {
    const seam = Array.from({ length: 5 }, (_, i) => seamPoint(i * 10, 0, 0));
    const noWeave = generatePath(seam, { weave: 'none', weaveAmplitudeMm: 0, weaveFreqHz: 0, beadHeightMm: 2, beadWidthMm: 5, travelAngleDeg: 0, workAngleDeg: 45, travelSpeedMmMin: 300 });
    const weave = generatePath(seam, { weave: 'triangular', weaveAmplitudeMm: 2, weaveFreqHz: 1, beadHeightMm: 2, beadWidthMm: 5, travelAngleDeg: 0, workAngleDeg: 45, travelSpeedMmMin: 300 });
    expect(weave.waypoints[1]!.position).not.toEqual(noWeave.waypoints[1]!.position);
  });

  it('weave sinusoidal pattern supported', () => {
    const seam = [seamPoint(0, 0, 0), seamPoint(10, 0, 0), seamPoint(20, 0, 0)];
    const r = generatePath(seam, { weave: 'sinusoidal', weaveAmplitudeMm: 1, weaveFreqHz: 1, beadHeightMm: 2, beadWidthMm: 5, travelAngleDeg: 10, workAngleDeg: 45, travelSpeedMmMin: 300 });
    expect(r.waypoints.length).toBe(3);
  });

  it('travel direction normalised', () => {
    const seam = [seamPoint(0, 0, 0), seamPoint(100, 0, 0)];
    const r = generatePath(seam);
    expect(Math.hypot(r.waypoints[0]!.travelDirection.x, r.waypoints[0]!.travelDirection.y, r.waypoints[0]!.travelDirection.z)).toBeCloseTo(1, 3);
  });

  it('estimated time positive', () => {
    const seam = [seamPoint(0, 0, 0), seamPoint(100, 0, 0)];
    expect(generatePath(seam).estimatedTimeSec).toBeGreaterThan(0);
  });

  it('warning when bead height > width', () => {
    const seam = [seamPoint(0, 0, 0), seamPoint(10, 0, 0)];
    const r = generatePath(seam, { beadWidthMm: 2, beadHeightMm: 5, travelAngleDeg: 10, workAngleDeg: 45, travelSpeedMmMin: 300, weave: 'none', weaveAmplitudeMm: 0, weaveFreqHz: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('multiPassPlan', () => {
  it('narrow groove → 1 pass', () => {
    const plan = multiPassPlan(3, { beadWidthMm: 5, beadHeightMm: 2, travelAngleDeg: 0, workAngleDeg: 45, travelSpeedMmMin: 300, weave: 'none', weaveAmplitudeMm: 0, weaveFreqHz: 0 });
    expect(plan.passes).toBe(1);
  });

  it('wide groove → multiple passes', () => {
    const plan = multiPassPlan(20, { beadWidthMm: 5, beadHeightMm: 2, travelAngleDeg: 0, workAngleDeg: 45, travelSpeedMmMin: 300, weave: 'none', weaveAmplitudeMm: 0, weaveFreqHz: 0 });
    expect(plan.passes).toBeGreaterThan(1);
  });

  it('offsets count matches passes', () => {
    const plan = multiPassPlan(15);
    expect(plan.perPassOffsetMm).toHaveLength(plan.passes);
  });
});

describe('heatInputKjPerMm', () => {
  it('Q = V·I·η / travel speed', () => {
    const q = heatInputKjPerMm(200, 25, 300);
    // V·I·η = 200·25·0.8 = 4000 W; travel = 300/60 = 5 mm/s; Q = 4000/(1000·5) = 0.8 kJ/mm.
    expect(q).toBeCloseTo(0.8, 2);
  });

  it('zero travel speed → infinity', () => {
    expect(heatInputKjPerMm(200, 25, 0)).toBe(Infinity);
  });

  it('higher travel speed → lower heat input', () => {
    expect(heatInputKjPerMm(200, 25, 600)).toBeLessThan(heatInputKjPerMm(200, 25, 300));
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const seam = [seamPoint(0, 0, 0), seamPoint(100, 0, 0)];
    const r = generatePath(seam);
    const s = summarize(r);
    expect(s.waypointCount).toBe(2);
    expect(s.totalSeamLengthMm).toBeGreaterThan(0);
  });
});
