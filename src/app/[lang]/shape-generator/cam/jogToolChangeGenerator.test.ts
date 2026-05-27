import { describe, it, expect } from 'vitest';
import {
  generateJog,
  generateFastJog,
  diagnose,
  summarize,
  type MachineConfig,
  type OperationContext,
} from './jogToolChangeGenerator';

const machine: MachineConfig = {
  zHomeMm: 100,
  toolChangePosition: { x: 500, y: 500, z: 100 },
  rapidMmMin: 10000,
  workClearanceMm: 5,
};

const op: OperationContext = {
  startPosition: { x: 10, y: 20, z: -5 },
  nextOperationStart: { x: 50, y: 60, z: -3 },
  newToolNumber: 5,
};

describe('generateJog', () => {
  it('emits ordered waypoints', () => {
    const r = generateJog(machine, op);
    expect(r.waypoints.length).toBeGreaterThan(3);
  });

  it('first move retracts Z to home', () => {
    const r = generateJog(machine, op);
    expect(r.waypoints[0]!.z).toBe(machine.zHomeMm);
  });

  it('includes tool change M06', () => {
    const r = generateJog(machine, op);
    expect(r.gcode.some(l => l.includes('M06'))).toBe(true);
  });

  it('tool number ≤ 0 → warning', () => {
    const r = generateJog(machine, { ...op, newToolNumber: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('warns when next operation Z above home', () => {
    const r = generateJog(machine, { ...op, nextOperationStart: { x: 50, y: 60, z: 200 } });
    expect(r.warnings.some(w => w.includes('Z-home'))).toBe(true);
  });

  it('total length positive', () => {
    const r = generateJog(machine, op);
    expect(r.totalLengthMm).toBeGreaterThan(0);
  });

  it('time positive', () => {
    const r = generateJog(machine, op);
    expect(r.estimatedTimeSec).toBeGreaterThan(0);
  });

  it('last waypoint is next-op start', () => {
    const r = generateJog(machine, op);
    expect(r.waypoints[r.waypoints.length - 1]).toEqual(op.nextOperationStart);
  });
});

describe('generateFastJog', () => {
  it('shorter than full home jog', () => {
    const full = generateJog(machine, op);
    const fast = generateFastJog(machine, op, 10);
    expect(fast.totalLengthMm).toBeLessThan(full.totalLengthMm);
  });

  it('does not retract to home', () => {
    const r = generateFastJog(machine, op, 10);
    expect(r.waypoints[0]!.z).toBeLessThan(machine.zHomeMm);
  });

  it('retract delta larger than home → warning', () => {
    const r = generateFastJog(machine, op, 200);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('diagnose', () => {
  it('counts M06 calls', () => {
    const r = generateJog(machine, op);
    const d = diagnose(r);
    expect(d.toolChangeCallCount).toBe(1);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const r = generateJog(machine, op);
    const s = summarize(r);
    expect(s.waypointCount).toBe(r.waypoints.length);
    expect(s.totalLengthMm).toBe(r.totalLengthMm);
  });
});
