import { describe, it, expect } from 'vitest';
import {
  scrubMotion,
  refineWorst,
  summarize,
  type MovingBody,
  type ClearancePair,
} from './motionClearanceScrub';

function staticBody(id: string, x: number, y: number, z: number, r: number): MovingBody {
  return { id, radiusMm: r, trajectory: () => ({ x, y, z }) };
}

function linearBody(id: string, start: { x: number; y: number; z: number }, end: { x: number; y: number; z: number }, r: number): MovingBody {
  return {
    id, radiusMm: r,
    trajectory: (t: number) => ({
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
      z: start.z + (end.z - start.z) * t,
    }),
  };
}

describe('scrubMotion', () => {
  it('no pairs → empty events', () => {
    const r = scrubMotion([staticBody('a', 0, 0, 0, 1)], []);
    expect(r.events).toEqual([]);
  });

  it('static far apart → ok', () => {
    const pair: ClearancePair = { bodyA: 'a', bodyB: 'b', requiredMm: 1 };
    const r = scrubMotion([
      staticBody('a', 0, 0, 0, 1),
      staticBody('b', 100, 0, 0, 1),
    ], [pair]);
    expect(r.events[0]!.classification).toBe('ok');
  });

  it('static overlapping → collision', () => {
    const pair: ClearancePair = { bodyA: 'a', bodyB: 'b', requiredMm: 1 };
    const r = scrubMotion([
      staticBody('a', 0, 0, 0, 5),
      staticBody('b', 1, 0, 0, 5),
    ], [pair]);
    expect(r.events[0]!.classification).toBe('collision');
  });

  it('linear pass-through finds collision at sweep', () => {
    const pair: ClearancePair = { bodyA: 'a', bodyB: 'b', requiredMm: 0.5 };
    const r = scrubMotion([
      staticBody('a', 0, 0, 0, 1),
      linearBody('b', { x: 10, y: 0, z: 0 }, { x: -10, y: 0, z: 0 }, 1),
    ], [pair], { samples: 100, collisionTolMm: 0.01 });
    expect(r.events[0]!.classification).toBe('collision');
    expect(r.events[0]!.worstT).toBeGreaterThan(0);
    expect(r.events[0]!.worstT).toBeLessThan(1);
  });

  it('scrape category when below required clearance but above collision tol', () => {
    const pair: ClearancePair = { bodyA: 'a', bodyB: 'b', requiredMm: 5 };
    const r = scrubMotion([
      staticBody('a', 0, 0, 0, 1),
      staticBody('b', 4, 0, 0, 1),
    ], [pair], { samples: 10, collisionTolMm: 0.01 });
    expect(r.events[0]!.classification).toBe('scrape');
  });

  it('worstOverall tracks the smallest distance', () => {
    const pairs: ClearancePair[] = [
      { bodyA: 'a', bodyB: 'b', requiredMm: 1 },
      { bodyA: 'a', bodyB: 'c', requiredMm: 1 },
    ];
    const r = scrubMotion([
      staticBody('a', 0, 0, 0, 1),
      staticBody('b', 50, 0, 0, 1),
      staticBody('c', 1.5, 0, 0, 1),
    ], pairs);
    expect(r.worstOverall!.pair.bodyB).toBe('c');
  });

  it('missing body silently skipped', () => {
    const pair: ClearancePair = { bodyA: 'a', bodyB: 'nonexistent', requiredMm: 1 };
    const r = scrubMotion([staticBody('a', 0, 0, 0, 1)], [pair]);
    expect(r.events).toEqual([]);
  });

  it('respects sampling option', () => {
    const r = scrubMotion(
      [staticBody('a', 0, 0, 0, 1), staticBody('b', 10, 0, 0, 1)],
      [{ bodyA: 'a', bodyB: 'b', requiredMm: 1 }],
      { samples: 20, collisionTolMm: 0.01 },
    );
    expect(r.sampleCount).toBe(21);
  });
});

describe('refineWorst', () => {
  it('narrows in on minimum distance', () => {
    const a = staticBody('a', 0, 0, 0, 1);
    const b = linearBody('b', { x: 10, y: 0, z: 0 }, { x: -10, y: 0, z: 0 }, 1);
    const refined = refineWorst(a, b, 0.5, 12, 0.2);
    // b sweeps through a; at mid-travel (t=0.5) the centres coincide, so the
    // WORST (minimum signed) surface distance is the full -2mm penetration
    // (centreDist 0 − rA 1 − rB 1). refineWorst must converge onto that instant
    // rather than drift to a window edge.
    expect(refined.t).toBeCloseTo(0.5, 1);
    expect(refined.distanceMm).toBeCloseTo(-2, 1);
  });

  it('stays in [0, 1]', () => {
    const a = staticBody('a', 0, 0, 0, 1);
    const b = staticBody('b', 100, 0, 0, 1);
    const refined = refineWorst(a, b, 0.99, 5, 0.05);
    expect(refined.t).toBeGreaterThanOrEqual(0);
    expect(refined.t).toBeLessThanOrEqual(1);
  });
});

describe('summarize', () => {
  it('counts per classification', () => {
    const pairs: ClearancePair[] = [
      { bodyA: 'a', bodyB: 'b', requiredMm: 1 },
      { bodyA: 'a', bodyB: 'c', requiredMm: 5 },
    ];
    const r = scrubMotion([
      staticBody('a', 0, 0, 0, 1),
      staticBody('b', 100, 0, 0, 1),
      staticBody('c', 4, 0, 0, 1),
    ], pairs);
    const s = summarize(r);
    expect(s.okCount).toBe(1);
    expect(s.scrapeCount).toBe(1);
  });

  it('infinite worst when no events', () => {
    const r = scrubMotion([], []);
    expect(summarize(r).worstDistanceMm).toBe(Infinity);
  });
});
