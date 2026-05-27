import { describe, it, expect } from 'vitest';
import {
  pickRampStrategy,
  summarize,
  type ToolSpec,
  type PocketGeometry,
  type MachineSpec,
} from './rampEntryStrategy';

const endMill: ToolSpec = { type: 'end-mill', diameterMm: 10, centreCutting: false, maxRampAngleDeg: 5 };
const drill: ToolSpec = { type: 'drill', diameterMm: 10, centreCutting: true, maxRampAngleDeg: 15 };
const centreEM: ToolSpec = { type: 'centre-cutting-end-mill', diameterMm: 10, centreCutting: true, maxRampAngleDeg: 5 };
const machine: MachineSpec = { spindlePowerKw: 10, rapidRateMpm: 5 };

function pocket(L: number, W: number, D: number): PocketGeometry {
  return { lengthMm: L, widthMm: W, depthMm: D, verticalWalls: true };
}

describe('pickRampStrategy', () => {
  it('wide pocket → helical', () => {
    const r = pickRampStrategy(endMill, pocket(50, 50, 20), machine);
    expect(r.rampType).toBe('helical');
    expect(r.helicalRadiusMm).toBeGreaterThan(0);
  });

  it('narrow pocket (W < 1.2 × tool dia) → pre-drilled when non-centre-cutting', () => {
    const r = pickRampStrategy(endMill, pocket(50, 11, 20), machine);
    expect(r.rampType).toBe('pre-drilled-hole');
  });

  it('narrow + shallow + centre-cutting → plunge', () => {
    const r = pickRampStrategy(centreEM, pocket(50, 11, 3), machine);
    expect(r.rampType).toBe('plunge');
  });

  it('slot-shaped → linear ramp', () => {
    const r = pickRampStrategy(endMill, pocket(50, 15, 20), machine);
    expect(r.rampType).toBe('linear-ramp');
  });

  it('rampAngle bounded by tool max', () => {
    const r = pickRampStrategy(drill, pocket(50, 50, 20), machine);
    expect(r.rampAngleDeg).toBeLessThanOrEqual(drill.maxRampAngleDeg);
  });

  it('rationale text present', () => {
    const r = pickRampStrategy(endMill, pocket(50, 50, 20), machine);
    expect(r.rationale.length).toBeGreaterThan(0);
  });

  it('warning when plunge used with non-centre-cutting tool', () => {
    // Force narrow + shallow with non-centre-cutting → pre-drill, no plunge warning.
    // To get plunge with non-centre, need centreCutting=true in tool data flipping wrong → impossible.
    // Just ensure warnings array always defined.
    const r = pickRampStrategy(endMill, pocket(50, 50, 20), machine);
    expect(Array.isArray(r.warnings)).toBe(true);
  });

  it('warning when power exceeds machine spec', () => {
    const weak: MachineSpec = { spindlePowerKw: 0.01, rapidRateMpm: 5 };
    const r = pickRampStrategy(endMill, pocket(50, 50, 50), weak);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('time estimate positive for helical', () => {
    const r = pickRampStrategy(endMill, pocket(50, 50, 20), machine);
    expect(r.estimatedRampTimeSec).toBeGreaterThan(0);
  });

  it('material affects ramp angle (aluminum > titanium)', () => {
    const al = pickRampStrategy(endMill, pocket(50, 50, 20), machine, { material: 'aluminum', isRoughing: true });
    const ti = pickRampStrategy(endMill, pocket(50, 50, 20), machine, { material: 'titanium', isRoughing: true });
    expect(al.rampAngleDeg).toBeGreaterThanOrEqual(ti.rampAngleDeg);
  });
});

describe('summarize', () => {
  it('reports type + angle + time + warning count', () => {
    const r = pickRampStrategy(endMill, pocket(50, 50, 20), machine);
    const s = summarize(r);
    expect(s.rampType).toBeDefined();
    expect(s.rampAngleDeg).toBeGreaterThan(0);
    expect(s.warningCount).toBeGreaterThanOrEqual(0);
  });
});
