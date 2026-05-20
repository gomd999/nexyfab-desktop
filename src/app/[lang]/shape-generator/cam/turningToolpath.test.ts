import { describe, it, expect } from 'vitest';
import {
  generateTurning,
  passStats,
  emitGcode,
  summarize,
  type TurnPoint,
} from './turningToolpath';

const odProfile: TurnPoint[] = [
  { z: 0, x: 15 },
  { z: 30, x: 15 },
  { z: 30, x: 10 },
  { z: 50, x: 10 },
];

describe('generateTurning', () => {
  it('< 2 points → warning', () => {
    const r = generateTurning([{ z: 0, x: 15 }]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('OD generates rough + finish passes', () => {
    const r = generateTurning(odProfile);
    expect(r.passes.length).toBeGreaterThanOrEqual(2);
    expect(r.passes.some(p => p.kind === 'rough')).toBe(true);
    expect(r.passes.some(p => p.kind === 'finish')).toBe(true);
  });

  it('finish pass matches profile', () => {
    const r = generateTurning(odProfile);
    const finish = r.passes.find(p => p.kind === 'finish')!;
    expect(finish.points).toEqual(odProfile);
  });

  it('time positive', () => {
    expect(generateTurning(odProfile).estimatedTimeSec).toBeGreaterThan(0);
  });

  it('smaller radialDoc → more rough passes', () => {
    const fine = generateTurning(odProfile, { stockRadiusMm: 25, axialDocMm: 2, radialDocMm: 0.5, finishAllowanceMm: 0.3, roughFeedMmRev: 0.2, finishFeedMmRev: 0.08, spindleRpm: 2000, side: 'OD' });
    const coarse = generateTurning(odProfile, { stockRadiusMm: 25, axialDocMm: 2, radialDocMm: 5, finishAllowanceMm: 0.3, roughFeedMmRev: 0.2, finishFeedMmRev: 0.08, spindleRpm: 2000, side: 'OD' });
    expect(fine.passes.length).toBeGreaterThan(coarse.passes.length);
  });

  it('ID side processes profile', () => {
    const idProfile: TurnPoint[] = [
      { z: 0, x: 10 },
      { z: 30, x: 10 },
      { z: 30, x: 15 },
      { z: 50, x: 15 },
    ];
    const r = generateTurning(idProfile, { stockRadiusMm: 5, axialDocMm: 2, radialDocMm: 1, finishAllowanceMm: 0.3, roughFeedMmRev: 0.2, finishFeedMmRev: 0.08, spindleRpm: 2000, side: 'ID' });
    expect(r.passes.length).toBeGreaterThanOrEqual(1);
  });

  it('removed volume positive', () => {
    expect(generateTurning(odProfile).removedVolumeMm3).toBeGreaterThan(0);
  });
});

describe('passStats', () => {
  it('counts rough and finish', () => {
    const r = generateTurning(odProfile);
    const stats = passStats(r);
    expect(stats.roughCount).toBeGreaterThanOrEqual(1);
    expect(stats.finishCount).toBe(1);
  });
});

describe('emitGcode', () => {
  it('emits G0 for first move of each pass', () => {
    const r = generateTurning(odProfile);
    const lines = emitGcode(r);
    expect(lines.some(l => l.startsWith('G0'))).toBe(true);
  });

  it('emits G1 with feed', () => {
    const r = generateTurning(odProfile);
    const lines = emitGcode(r);
    expect(lines.some(l => l.startsWith('G1') && l.includes('F'))).toBe(true);
  });

  it('emits pass comments', () => {
    const r = generateTurning(odProfile);
    const lines = emitGcode(r);
    expect(lines.some(l => l.includes('ROUGH'))).toBe(true);
  });
});

describe('summarize', () => {
  it('reports counts + time', () => {
    const r = generateTurning(odProfile);
    const s = summarize(r);
    expect(s.passCount).toBe(r.passes.length);
    expect(s.estimatedTimeSec).toBe(r.estimatedTimeSec);
  });
});
