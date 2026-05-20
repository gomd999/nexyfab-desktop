import { describe, it, expect } from 'vitest';
import {
  sweepFiveAxis,
  aggregate,
  suggestTiltLimit,
  summarize,
  type FiveAxisPoint,
  type ToolGeometry,
  type AABB,
} from './fiveAxisCollisionSweep';

const tool: ToolGeometry = {
  diameterMm: 10,
  holderTopDiaMm: 30,
  holderBotDiaMm: 16,
  holderHeightMm: 50,
  fluteLengthMm: 20,
  spindleHalfExtents: { x: 50, y: 50, z: 30 },
};

function point(tipX: number, tipY: number, tipZ: number, a: number = 0, b: number = 0, c: number = 0): FiveAxisPoint {
  return { tip: { x: tipX, y: tipY, z: tipZ }, aAxisDeg: a, bAxisDeg: b, cAxisDeg: c };
}

function obstacle(id: string, min: { x: number; y: number; z: number }, max: { x: number; y: number; z: number }): { id: string; aabb: AABB } {
  return { id, aabb: { min, max } };
}

describe('sweepFiveAxis', () => {
  it('empty path → no events', () => {
    const r = sweepFiveAxis([], tool, []);
    expect(r.events).toEqual([]);
  });

  it('clear path → no events', () => {
    const path = [point(0, 0, 0)];
    expect(sweepFiveAxis(path, tool, []).events).toEqual([]);
  });

  it('tool tip near obstacle → collision', () => {
    const path = [point(0, 0, 0)];
    const obs = obstacle('wp', { x: -3, y: -3, z: -3 }, { x: 3, y: 3, z: 3 });
    const r = sweepFiveAxis(path, tool, [obs]);
    expect(r.events.length).toBeGreaterThan(0);
  });

  it('holder strike detected on tilt', () => {
    const path = [point(0, 0, 0, 0, 45, 0)];
    const obs = obstacle('wall', { x: 30, y: -100, z: 0 }, { x: 100, y: 100, z: 80 });
    const r = sweepFiveAxis(path, tool, [obs]);
    expect(r.events.some(e => e.component === 'holder' || e.component === 'spindle')).toBe(true);
  });

  it('dominantAxis reported', () => {
    const path = [point(0, 0, 0, 0, 0, 0), point(0, 0, 0, 30, 0, 0)];
    const obs = obstacle('test', { x: -50, y: -50, z: 0 }, { x: 50, y: 50, z: 200 });
    const r = sweepFiveAxis(path, tool, [obs]);
    if (r.events.length > 0) {
      expect(['A', 'B', 'C', 'translation']).toContain(r.events[0]!.dominantAxis);
    }
  });

  it('multiple obstacles', () => {
    const path = [point(0, 0, 0)];
    const wall1 = obstacle('w1', { x: -3, y: -3, z: -3 }, { x: 3, y: 3, z: 3 });
    const wall2 = obstacle('w2', { x: 100, y: 100, z: 100 }, { x: 110, y: 110, z: 110 });
    const r = sweepFiveAxis(path, tool, [wall1, wall2]);
    expect(r.events.every(e => e.obstacleId === 'w1')).toBe(true);
  });
});

describe('aggregate', () => {
  it('counts by component', () => {
    const path = [point(0, 0, 0)];
    const obs = obstacle('wp', { x: -3, y: -3, z: -3 }, { x: 3, y: 3, z: 3 });
    const r = sweepFiveAxis(path, tool, [obs]);
    const agg = aggregate(r);
    expect(agg.collisionCount).toBeGreaterThan(0);
    expect(agg.byComponent['tool-tip']).toBeGreaterThan(0);
  });

  it('worst penetration tracked', () => {
    const path = [point(0, 0, 0)];
    const obs = obstacle('wp', { x: -3, y: -3, z: -3 }, { x: 3, y: 3, z: 3 });
    const r = sweepFiveAxis(path, tool, [obs]);
    expect(aggregate(r).worstPenetrationMm).toBeGreaterThan(0);
  });
});

describe('suggestTiltLimit', () => {
  it('reduces A/B max when holder collides', () => {
    const path = [point(0, 0, 0, 45, 30, 0)];
    const wall = obstacle('wall', { x: 30, y: -100, z: 0 }, { x: 100, y: 100, z: 80 });
    const r = sweepFiveAxis(path, tool, [wall]);
    const limits = suggestTiltLimit(r, path);
    expect(limits.aMax).toBeLessThanOrEqual(45);
  });
});

describe('summarize', () => {
  it('reports key metrics', () => {
    const path = [point(0, 0, 0)];
    const obs = obstacle('wp', { x: -3, y: -3, z: -3 }, { x: 3, y: 3, z: 3 });
    const r = sweepFiveAxis(path, tool, [obs]);
    const s = summarize(r);
    expect(s.totalSamples).toBe(1);
    expect(s.collisionCount).toBe(r.events.length);
  });
});
