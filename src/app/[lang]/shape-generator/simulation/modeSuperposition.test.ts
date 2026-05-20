import { describe, it, expect } from 'vitest';
import {
  modeSuperposition,
  summarize,
  type Mode,
  type ForceTimeHistory,
} from './modeSuperposition';

function singleModeStep(omega: number = 10, zeta: number = 0.05): Mode[] {
  return [{ index: 1, omega, zeta, eigenvector: [1, 0, 0] }];
}

function constantForceHistory(steps: number, dt: number = 0.01, force: number = 1): ForceTimeHistory {
  const time: number[] = [];
  const modalForces: number[][] = [[]];
  for (let i = 0; i < steps; i++) {
    time.push(i * dt);
    modalForces[0]!.push(force);
  }
  return { time, modalForces };
}

describe('modeSuperposition', () => {
  it('empty modes → empty snapshots', () => {
    const r = modeSuperposition([], { time: [0, 0.1], modalForces: [] });
    expect(r.snapshots).toEqual([]);
  });

  it('empty time → empty snapshots', () => {
    const r = modeSuperposition(singleModeStep(), { time: [], modalForces: [[]] });
    expect(r.snapshots).toEqual([]);
  });

  it('snapshot count = time step count', () => {
    const modes = singleModeStep();
    const forcing = constantForceHistory(50);
    const r = modeSuperposition(modes, forcing);
    expect(r.snapshots).toHaveLength(50);
  });

  it('initial displacement is zero', () => {
    const r = modeSuperposition(singleModeStep(), constantForceHistory(10));
    expect(r.snapshots[0]!.maxAbsDisplacement).toBeCloseTo(0, 5);
  });

  it('constant force causes growing then oscillating displacement', () => {
    const r = modeSuperposition(singleModeStep(20, 0.05), constantForceHistory(200, 0.001));
    // Some snapshot displacement should be > 0.
    const maxSnap = r.snapshots.reduce((m, s) => Math.max(m, s.maxAbsDisplacement), 0);
    expect(maxSnap).toBeGreaterThan(0);
  });

  it('two modes superimpose displacements', () => {
    const modes: Mode[] = [
      { index: 1, omega: 10, zeta: 0.05, eigenvector: [1, 0] },
      { index: 2, omega: 30, zeta: 0.05, eigenvector: [0, 1] },
    ];
    const forcing: ForceTimeHistory = {
      time: [0, 0.001, 0.002, 0.003],
      modalForces: [[1, 1, 1, 1], [0.5, 0.5, 0.5, 0.5]],
    };
    const r = modeSuperposition(modes, forcing);
    const last = r.snapshots[r.snapshots.length - 1]!;
    expect(last.displacement).toHaveLength(2);
  });

  it('dominant mode reported when only one mode forced', () => {
    const modes: Mode[] = [
      { index: 1, omega: 10, zeta: 0.05, eigenvector: [1, 0] },
      { index: 2, omega: 30, zeta: 0.05, eigenvector: [0, 1] },
    ];
    const forcing: ForceTimeHistory = {
      time: Array.from({ length: 50 }, (_, i) => i * 0.001),
      modalForces: [Array(50).fill(1), Array(50).fill(0)],
    };
    const r = modeSuperposition(modes, forcing);
    expect(r.dominantModeIndex).toBe(1);
  });

  it('higher damping reduces peak', () => {
    const lo = modeSuperposition(singleModeStep(10, 0.01), constantForceHistory(500, 0.001));
    const hi = modeSuperposition(singleModeStep(10, 0.5), constantForceHistory(500, 0.001));
    expect(hi.peakDisplacementMm).toBeLessThan(lo.peakDisplacementMm);
  });

  it('snapshot times match input time series', () => {
    const forcing = constantForceHistory(5, 0.1);
    const r = modeSuperposition(singleModeStep(), forcing);
    for (let i = 0; i < r.snapshots.length; i++) {
      expect(r.snapshots[i]!.timeSec).toBeCloseTo(i * 0.1, 5);
    }
  });

  it('modal Q tracked per mode', () => {
    const modes = singleModeStep();
    const forcing = constantForceHistory(20);
    const r = modeSuperposition(modes, forcing);
    expect(r.snapshots[10]!.modalQ).toHaveLength(1);
  });

  it('peakDisplacement non-negative', () => {
    const r = modeSuperposition(singleModeStep(), constantForceHistory(20));
    expect(r.peakDisplacementMm).toBeGreaterThanOrEqual(0);
  });
});

describe('summarize', () => {
  it('empty result', () => {
    const s = summarize({ snapshots: [], dominantModeIndex: -1, peakDisplacementMm: 0 });
    expect(s.snapshotCount).toBe(0);
  });

  it('reports duration', () => {
    const r = modeSuperposition(singleModeStep(), constantForceHistory(10, 0.05));
    const s = summarize(r);
    expect(s.durationSec).toBeCloseTo(9 * 0.05, 5);
  });

  it('peak displacement forwarded', () => {
    const r = modeSuperposition(singleModeStep(), constantForceHistory(50));
    const s = summarize(r);
    expect(s.peakDisplacementMm).toBe(r.peakDisplacementMm);
  });
});
