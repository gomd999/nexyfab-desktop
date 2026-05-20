import { describe, it, expect } from 'vitest';
import {
  generateProfile,
  batchProfile,
  aggregate,
  summarize,
  type MachineProfile,
  type Corner,
} from './cornerDecelerationProfile';

const fastMachine: MachineProfile = {
  maxFeedMmMin: 10000,
  maxAccelMmPerS2: 5000,
  maxJerkMmPerS3: 50000,
};

function corner(id: string, angle: number, r: number = 1, fIn: number = 5000, fOut: number = 5000): Corner {
  return { id, interiorAngleDeg: angle, cornerRadiusMm: r, feedInMmMin: fIn, feedOutMmMin: fOut };
}

describe('generateProfile', () => {
  it('zero accel → warning', () => {
    const r = generateProfile(corner('c1', 90, 1), { ...fastMachine, maxAccelMmPerS2: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('sharp corner reduces speed', () => {
    const acute = generateProfile(corner('c1', 30, 0.5), fastMachine);
    const obtuse = generateProfile(corner('c2', 170, 5), fastMachine);
    expect(acute.cornerSpeedMmMin).toBeLessThan(obtuse.cornerSpeedMmMin);
  });

  it('corner speed ≤ feed in / out', () => {
    const r = generateProfile(corner('c1', 90, 1, 2000, 2000), fastMachine);
    expect(r.cornerSpeedMmMin).toBeLessThanOrEqual(2000 + 1e-3);
  });

  it('decel distance positive when slowing down', () => {
    const r = generateProfile(corner('c1', 30, 0.1), fastMachine);
    expect(r.decelDistanceMm).toBeGreaterThan(0);
  });

  it('S-curve increases ramp distance', () => {
    const linear = generateProfile(corner('c1', 30, 0.1), fastMachine, { useSCurve: false, minCornerFeed: 50 });
    const sCurve = generateProfile(corner('c2', 30, 0.1), fastMachine, { useSCurve: true, minCornerFeed: 50 });
    expect(sCurve.decelDistanceMm).toBeGreaterThan(linear.decelDistanceMm);
  });

  it('time loss positive at sharp corner', () => {
    const r = generateProfile(corner('c1', 30, 0.1), fastMachine);
    expect(r.timeLossSec).toBeGreaterThanOrEqual(0);
  });

  it('zero radius → warning', () => {
    const r = generateProfile(corner('c1', 90, 0), fastMachine);
    expect(r.warnings.some(w => w.includes('chatter') || w.includes('zero'))).toBe(true);
  });

  it('low minCornerFeed clamp warning', () => {
    const r = generateProfile(corner('c1', 10, 0.01), fastMachine, { useSCurve: false, minCornerFeed: 1000 });
    expect(r.warnings.some(w => w.includes('minCornerFeed') || w.includes('clamped'))).toBe(true);
  });
});

describe('batchProfile', () => {
  it('produces one profile per corner', () => {
    const corners = [corner('c1', 30, 1), corner('c2', 150, 5)];
    expect(batchProfile(corners, fastMachine)).toHaveLength(2);
  });
});

describe('aggregate', () => {
  it('finds worst corner', () => {
    const profiles = batchProfile([corner('c1', 30, 0.1), corner('c2', 170, 10)], fastMachine);
    const agg = aggregate(profiles);
    expect(agg.worstCornerId).toBe('c1');
  });

  it('empty list → null worst, zero average', () => {
    const agg = aggregate([]);
    expect(agg.worstCornerId).toBeNull();
    expect(agg.averageCornerSpeedMmMin).toBe(0);
  });
});

describe('summarize', () => {
  it('reports key counts', () => {
    const profiles = batchProfile([corner('c1', 30, 0.1)], fastMachine);
    const s = summarize(profiles);
    expect(s.cornerCount).toBe(1);
    expect(s.totalTimeLossSec).toBeGreaterThanOrEqual(0);
  });
});
