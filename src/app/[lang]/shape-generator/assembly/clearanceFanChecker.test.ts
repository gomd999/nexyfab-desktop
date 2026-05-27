import { describe, it, expect } from 'vitest';
import {
  checkSweep,
  maxSafeAngleDeg,
  summarize,
  type Polygon,
} from './clearanceFanChecker';

describe('checkSweep', () => {
  it('clear sweep with no obstacles', () => {
    const r = checkSweep({
      pivot: { x: 0, y: 0 },
      sweptPoints: [{ x: 10, y: 0 }],
      startAngleDeg: 0,
      endAngleDeg: 90,
      obstacles: [],
    });
    expect(r.clear).toBe(true);
    expect(r.firstCollisionAngleDeg).toBeNull();
  });

  it('collision with obstacle in path', () => {
    const obstacle: Polygon = [
      { x: 5, y: 5 }, { x: 12, y: 5 }, { x: 12, y: 12 }, { x: 5, y: 12 },
    ];
    const r = checkSweep({
      pivot: { x: 0, y: 0 },
      sweptPoints: [{ x: 10, y: 0 }],
      startAngleDeg: 0,
      endAngleDeg: 90,
      obstacles: [{ id: 'obs1', polygon: obstacle }],
    });
    expect(r.clear).toBe(false);
    expect(r.collisions.length).toBeGreaterThan(0);
    expect(r.collisions[0]!.obstacleId).toBe('obs1');
  });

  it('arc extents = angle (rad) × max radius', () => {
    const r = checkSweep({
      pivot: { x: 0, y: 0 },
      sweptPoints: [{ x: 10, y: 0 }],
      startAngleDeg: 0,
      endAngleDeg: 180,
      obstacles: [],
    });
    expect(r.arcExtentsMm).toBeCloseTo(Math.PI * 10, 1);
  });

  it('multiple swept points, all clear', () => {
    const r = checkSweep({
      pivot: { x: 0, y: 0 },
      sweptPoints: [{ x: 10, y: 0 }, { x: 0, y: 10 }],
      startAngleDeg: 0,
      endAngleDeg: 45,
      obstacles: [],
    });
    expect(r.clear).toBe(true);
  });

  it('zero range → warning', () => {
    const r = checkSweep({
      pivot: { x: 0, y: 0 },
      sweptPoints: [{ x: 10, y: 0 }],
      startAngleDeg: 30,
      endAngleDeg: 30,
      obstacles: [],
    });
    expect(r.warnings.some(w => w.toLowerCase().includes('zero'))).toBe(true);
  });

  it('no swept points → warning', () => {
    const r = checkSweep({
      pivot: { x: 0, y: 0 },
      sweptPoints: [],
      startAngleDeg: 0,
      endAngleDeg: 90,
      obstacles: [],
    });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('obstacle outside sweep arc → clear', () => {
    const obstacle: Polygon = [
      { x: 0, y: -20 }, { x: 5, y: -20 }, { x: 5, y: -15 }, { x: 0, y: -15 },
    ];
    const r = checkSweep({
      pivot: { x: 0, y: 0 },
      sweptPoints: [{ x: 10, y: 0 }],
      startAngleDeg: 0,
      endAngleDeg: 90,
      obstacles: [{ id: 'far', polygon: obstacle }],
    });
    expect(r.clear).toBe(true);
  });
});

describe('maxSafeAngleDeg', () => {
  it('all clear → returns full range', () => {
    expect(maxSafeAngleDeg({
      pivot: { x: 0, y: 0 },
      sweptPoints: [{ x: 10, y: 0 }],
      startAngleDeg: 0,
      endAngleDeg: 90,
      obstacles: [],
    })).toBeCloseTo(90, 1);
  });

  it('collision reduces safe angle', () => {
    const obstacle: Polygon = [
      { x: 5, y: 5 }, { x: 12, y: 5 }, { x: 12, y: 12 }, { x: 5, y: 12 },
    ];
    const safe = maxSafeAngleDeg({
      pivot: { x: 0, y: 0 },
      sweptPoints: [{ x: 10, y: 0 }],
      startAngleDeg: 0,
      endAngleDeg: 90,
      obstacles: [{ id: 'obs1', polygon: obstacle }],
    });
    expect(safe).toBeLessThan(90);
  });
});

describe('summarize', () => {
  it('reports clear + counts', () => {
    const r = checkSweep({
      pivot: { x: 0, y: 0 },
      sweptPoints: [{ x: 10, y: 0 }],
      startAngleDeg: 0,
      endAngleDeg: 90,
      obstacles: [],
    });
    const s = summarize(r);
    expect(s.clear).toBe(true);
    expect(s.collisionCount).toBe(0);
  });
});
