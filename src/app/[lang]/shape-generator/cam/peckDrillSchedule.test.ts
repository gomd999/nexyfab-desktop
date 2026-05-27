import { describe, it, expect } from 'vitest';
import {
  generateSchedule,
  emitGcode,
  summarize,
  type DrillSpec,
  type HoleSpec,
  type MaterialSpec,
} from './peckDrillSchedule';

const drill: DrillSpec = { diameterMm: 5, fluteLengthMm: 50, pilotDiameterMm: 0 };
const aluminum: MaterialSpec = { kc11Mpa: 800, evacuationFactor: 1.5 };
const steel: MaterialSpec = { kc11Mpa: 2200, evacuationFactor: 1.0 };

describe('generateSchedule', () => {
  it('zero diameter → warning, no steps', () => {
    const r = generateSchedule({ depthMm: 30 }, { diameterMm: 0, fluteLengthMm: 50, pilotDiameterMm: 0 }, aluminum);
    expect(r.peckSteps).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('shallow hole (L/D ≤ 3) → chip-break', () => {
    const r = generateSchedule({ depthMm: 10 }, drill, aluminum);
    expect(r.scheme).toBe('chip-break');
  });

  it('medium hole (L/D 5-10) → decremental when allowed', () => {
    const r = generateSchedule({ depthMm: 40 }, drill, aluminum, { feedMmMin: 150, allowDecremental: true, chipBreakRetractMm: 0.5, fullRetractClearanceMm: 2 });
    expect(r.scheme).toBe('decremental');
  });

  it('medium hole without decremental → full-retract', () => {
    const r = generateSchedule({ depthMm: 40 }, drill, aluminum, { feedMmMin: 150, allowDecremental: false, chipBreakRetractMm: 0.5, fullRetractClearanceMm: 2 });
    expect(r.scheme).toBe('full-retract');
  });

  it('very deep hole (L/D > 10) → decremental', () => {
    const r = generateSchedule({ depthMm: 70 }, drill, steel);
    expect(r.scheme).toBe('decremental');
  });

  it('warning for very deep + no pilot', () => {
    const r = generateSchedule({ depthMm: 70 }, drill, steel);
    expect(r.warnings.some(w => w.includes('pilot'))).toBe(true);
  });

  it('peck steps reach target depth', () => {
    const r = generateSchedule({ depthMm: 30 }, drill, aluminum);
    const lastDepth = r.peckSteps[r.peckSteps.length - 1]!.depthAtEndMm;
    expect(lastDepth).toBeCloseTo(30, 3);
  });

  it('finishAllowance subtracted from effective depth', () => {
    const r = generateSchedule({ depthMm: 30, finishAllowanceMm: 5 }, drill, aluminum);
    const lastDepth = r.peckSteps[r.peckSteps.length - 1]!.depthAtEndMm;
    expect(lastDepth).toBeCloseTo(25, 3);
  });

  it('chip-break steps not full-retract', () => {
    const r = generateSchedule({ depthMm: 10 }, drill, aluminum);
    expect(r.peckSteps.every(p => !p.fullRetract)).toBe(true);
  });

  it('full-retract steps flagged', () => {
    const r = generateSchedule({ depthMm: 40 }, drill, aluminum, { feedMmMin: 150, allowDecremental: false, chipBreakRetractMm: 0.5, fullRetractClearanceMm: 2 });
    expect(r.peckSteps.every(p => p.fullRetract)).toBe(true);
  });

  it('time positive for valid input', () => {
    const r = generateSchedule({ depthMm: 30 }, drill, aluminum);
    expect(r.estimatedTimeSec).toBeGreaterThan(0);
  });
});

describe('emitGcode', () => {
  it('chip-break emits G73', () => {
    const sched = generateSchedule({ depthMm: 10 }, drill, aluminum);
    const lines = emitGcode(sched, 2, -10, 150);
    expect(lines[0]).toMatch(/^G73/);
  });

  it('full-retract emits G83', () => {
    const sched = generateSchedule({ depthMm: 40 }, drill, aluminum, { feedMmMin: 150, allowDecremental: false, chipBreakRetractMm: 0.5, fullRetractClearanceMm: 2 });
    const lines = emitGcode(sched, 2, -40, 150);
    expect(lines[0]).toMatch(/^G83/);
  });

  it('ends with G80', () => {
    const sched = generateSchedule({ depthMm: 10 }, drill, aluminum);
    const lines = emitGcode(sched, 2, -10, 150);
    expect(lines[lines.length - 1]).toBe('G80');
  });
});

describe('summarize', () => {
  it('reports scheme + peck count + time', () => {
    const sched = generateSchedule({ depthMm: 30 }, drill, aluminum);
    const s = summarize(sched);
    expect(s.scheme).toBe(sched.scheme);
    expect(s.peckCount).toBe(sched.peckSteps.length);
    expect(s.estimatedTimeSec).toBeGreaterThan(0);
  });
});
