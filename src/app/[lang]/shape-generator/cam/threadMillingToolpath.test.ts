import { describe, it, expect } from 'vitest';
import {
  generateThreadMillPath,
  pitchDiameter,
  minorDiameter,
  summarize,
  type ThreadSpec,
  type ThreadMillTool,
} from './threadMillingToolpath';

const m12: ThreadSpec = {
  nominalDiameterMm: 12,
  pitchMm: 1.75,
  lengthMm: 15,
  direction: 'internal',
  hand: 'right-hand',
};

const tool: ThreadMillTool = { diameterMm: 6, flutes: 3, multiTooth: true };

describe('generateThreadMillPath', () => {
  it('internal M12 produces positive thread radius', () => {
    const r = generateThreadMillPath(m12, tool, 0, { passes: 1, climb: true, feedMmMin: 200, approachAngleDeg: 90 });
    expect(r.threadRadiusMm).toBeGreaterThan(0);
  });

  it('tool too large for internal thread → warning', () => {
    const bigTool: ThreadMillTool = { diameterMm: 20, flutes: 3, multiTooth: true };
    const r = generateThreadMillPath(m12, bigTool, 0);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.pathPoints).toEqual([]);
  });

  it('external thread radius > nominal/2', () => {
    const ext: ThreadSpec = { ...m12, direction: 'external' };
    const r = generateThreadMillPath(ext, tool, 0);
    expect(r.threadRadiusMm).toBeGreaterThan(m12.nominalDiameterMm / 2);
  });

  it('path points include rapid and feed motions', () => {
    const r = generateThreadMillPath(m12, tool, 0);
    const motions = new Set(r.pathPoints.map(p => p.motion));
    expect(motions.has('rapid')).toBe(true);
    expect(motions.has('feed')).toBe(true);
  });

  it('passes parameter respected', () => {
    const r1 = generateThreadMillPath(m12, tool, 0, { passes: 1, climb: true, feedMmMin: 200, approachAngleDeg: 90 });
    const r3 = generateThreadMillPath(m12, tool, 0, { passes: 3, climb: true, feedMmMin: 200, approachAngleDeg: 90 });
    expect(r3.pathPoints.length).toBeGreaterThan(r1.pathPoints.length);
  });

  it('multi-tooth tool produces fewer revolutions', () => {
    const single: ThreadMillTool = { diameterMm: 6, flutes: 1, multiTooth: false };
    const r1 = generateThreadMillPath(m12, single, 0);
    const r2 = generateThreadMillPath(m12, tool, 0);
    expect(r2.revolutions).toBeLessThanOrEqual(r1.revolutions);
  });

  it('time positive', () => {
    const r = generateThreadMillPath(m12, tool, 0);
    expect(r.estimatedTimeSec).toBeGreaterThan(0);
  });

  it('warning when many passes', () => {
    const r = generateThreadMillPath(m12, tool, 0, { passes: 6, climb: true, feedMmMin: 200, approachAngleDeg: 90 });
    expect(r.warnings.some(w => w.includes('passes'))).toBe(true);
  });

  it('single-flute warning', () => {
    const single: ThreadMillTool = { diameterMm: 6, flutes: 1, multiTooth: false };
    const r = generateThreadMillPath(m12, single, 0);
    expect(r.warnings.some(w => w.toLowerCase().includes('flute'))).toBe(true);
  });

  it('long thread → high revolution warning', () => {
    const longSpec: ThreadSpec = { ...m12, lengthMm: 200, pitchMm: 0.5 };
    const r = generateThreadMillPath(longSpec, { diameterMm: 6, flutes: 1, multiTooth: false }, 0);
    expect(r.warnings.some(w => w.includes('revolution') || w.includes('tapping'))).toBe(true);
  });
});

describe('pitchDiameter', () => {
  it('M12×1.75 → ~10.86', () => {
    expect(pitchDiameter(12, 1.75)).toBeCloseTo(12 - 0.6495 * 1.75, 3);
  });
});

describe('minorDiameter', () => {
  it('M12×1.75 → ~9.85', () => {
    expect(minorDiameter(12, 1.75)).toBeCloseTo(12 - 1.2269 * 1.75, 3);
  });
});

describe('summarize', () => {
  it('reports key metrics', () => {
    const r = generateThreadMillPath(m12, tool, 0);
    const s = summarize(r);
    expect(s.threadRadiusMm).toBeGreaterThan(0);
    expect(s.pathPointCount).toBeGreaterThan(0);
  });
});
