import { describe, it, expect } from 'vitest';
import {
  buildMillTurnProgram,
  buildThreadPasses,
  planRoughTurning,
  planCrossHolePattern,
  buildPickoffSequence,
  type MillTurnStep,
} from './millTurnToolpath';

describe('buildMillTurnProgram', () => {
  it('empty steps → zero cycle time + transitions', () => {
    const r = buildMillTurnProgram([]);
    expect(r.totalCycleTimeSec).toBe(0);
    expect(r.phaseTransitions).toBe(0);
  });

  it('single-phase program: no transitions', () => {
    const steps: MillTurnStep[] = [
      { phase: 'turn', op: { kind: 'rough-turn', spindleRpm: 2000, feedMmPerRev: 0.2, depthOfCutMm: 1, startZ: 0, endZ: -50, finalRadiusMm: 20 } },
      { phase: 'turn', op: { kind: 'finish-turn', spindleRpm: 3000, feedMmPerRev: 0.1, depthOfCutMm: 0.3, startZ: 0, endZ: -50, finalRadiusMm: 19.7 } },
    ];
    const r = buildMillTurnProgram(steps);
    expect(r.phaseTransitions).toBe(0);
  });

  it('phase change counted', () => {
    const steps: MillTurnStep[] = [
      { phase: 'turn', op: { kind: 'face', spindleRpm: 1500, feedMmPerRev: 0.15, depthOfCutMm: 1, startZ: 0, endZ: -5, finalRadiusMm: 25 } },
      { phase: 'mill', op: { kind: 'cross-drill', cAngleDeg: 0, driveSpindleRpm: 4000, feedMmPerMin: 200, toolDiameterMm: 5, depthMm: 10, entryPoint: [25, 0] } },
    ];
    const r = buildMillTurnProgram(steps);
    expect(r.phaseTransitions).toBe(1);
  });

  it('cycle time positive when steps run', () => {
    const r = buildMillTurnProgram([
      { phase: 'turn', op: { kind: 'rough-turn', spindleRpm: 1500, feedMmPerRev: 0.2, depthOfCutMm: 1.5, startZ: 0, endZ: -100, finalRadiusMm: 18 } },
    ]);
    expect(r.totalCycleTimeSec).toBeGreaterThan(0);
  });
});

describe('buildThreadPasses', () => {
  it('emits the requested pass count', () => {
    const passes = buildThreadPasses({
      pitchMm: 1.5, spindleRpm: 800,
      majorDiameterMm: 20, minorDiameterMm: 18,
      startZ: 0, endZ: -30, threadAngleDeg: 60, passCount: 6,
    });
    expect(passes).toHaveLength(6);
  });

  it('final radius ≈ minor diameter / 2', () => {
    const passes = buildThreadPasses({
      pitchMm: 1, spindleRpm: 1000,
      majorDiameterMm: 12, minorDiameterMm: 10,
      startZ: 0, endZ: -20, threadAngleDeg: 60, passCount: 5,
    });
    const last = passes[passes.length - 1]!;
    expect(last.radiusMm).toBeCloseTo(5, 4);
  });

  it('per-pass depth decreases monotonically (constant chip area)', () => {
    const passes = buildThreadPasses({
      pitchMm: 1.5, spindleRpm: 800,
      majorDiameterMm: 20, minorDiameterMm: 18,
      startZ: 0, endZ: -30, threadAngleDeg: 60, passCount: 6,
    });
    for (let i = 1; i < passes.length; i++) {
      expect(passes[i]!.depthMm).toBeLessThanOrEqual(passes[i - 1]!.depthMm);
    }
  });
});

describe('planRoughTurning', () => {
  it('passes cover the full radial allowance', () => {
    const r = planRoughTurning(25, 10, 2);
    expect(r.totalRadialMm).toBe(15);
    // Last pass ends at 10.
    expect(r.passes[r.passes.length - 1]!.endRadiusMm).toBe(10);
  });

  it('each pass DOC ≤ maxDoc + finishing tolerance', () => {
    const r = planRoughTurning(25, 10, 2);
    for (const p of r.passes.slice(0, -1)) {
      expect(p.depthMm).toBeLessThanOrEqual(2 + 1e-6);
    }
  });

  it('finishing pass shaves the last 0.5 mm', () => {
    const r = planRoughTurning(25, 10, 2);
    const last = r.passes[r.passes.length - 1]!;
    expect(last.depthMm).toBeCloseTo(0.5, 5);
  });
});

describe('planCrossHolePattern', () => {
  it('emits hole count requested', () => {
    const r = planCrossHolePattern(6, 4000, 200, 5, 10, 25);
    expect(r).toHaveLength(6);
  });

  it('angles spaced 360 / N', () => {
    const r = planCrossHolePattern(4, 4000, 200, 5, 10, 25);
    expect(r[0]!.cAngleDeg).toBe(0);
    expect(r[1]!.cAngleDeg).toBe(90);
    expect(r[2]!.cAngleDeg).toBe(180);
    expect(r[3]!.cAngleDeg).toBe(270);
  });

  it('startAngleDeg shifts all angles', () => {
    const r = planCrossHolePattern(4, 4000, 200, 5, 10, 25, 30);
    expect(r[0]!.cAngleDeg).toBe(30);
  });

  it('entry point at correct radius', () => {
    const r = planCrossHolePattern(2, 4000, 200, 5, 10, 25);
    expect(Math.hypot(r[0]!.entryPoint[0], r[0]!.entryPoint[1])).toBeCloseTo(25, 5);
  });
});

describe('buildPickoffSequence', () => {
  it('first step is the transfer', () => {
    const r = buildPickoffSequence({
      transferLengthMm: 40, phaseSync: false,
      backOps: [
        { phase: 'turn', op: { kind: 'face', spindleRpm: 1500, feedMmPerRev: 0.15, depthOfCutMm: 1, startZ: 0, endZ: -5, finalRadiusMm: 20 } },
      ],
    });
    expect(r[0]!.phase).toBe('transfer');
    expect(r).toHaveLength(2);
  });
});
