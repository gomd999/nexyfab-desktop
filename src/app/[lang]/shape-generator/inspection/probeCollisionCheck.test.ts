import { describe, it, expect } from 'vitest';
import {
  checkProbePath,
  checkPathSegments,
  summarize,
  type Probe,
  type Triangle,
  type PathPoint,
} from './probeCollisionCheck';

const probe: Probe = {
  tipRadiusMm: 1,
  shaftRadiusMm: 2,
  shaftLengthMm: 10,
  shaftDirection: { x: 0, y: 0, z: 1 },
};

const floorTri: Triangle = {
  id: 't1',
  v0: { x: -100, y: -100, z: 0 },
  v1: { x: 100, y: -100, z: 0 },
  v2: { x: 0, y: 100, z: 0 },
};

function pt(x: number, y: number, z: number, isTouch: boolean = false): PathPoint {
  return { position: { x, y, z }, isTouch };
}

describe('checkProbePath', () => {
  it('no triangles → no collisions', () => {
    expect(checkProbePath([pt(0, 0, 5)], probe, [])).toEqual([]);
  });

  it('tip well clear → no collision', () => {
    expect(checkProbePath([pt(0, 0, 10)], probe, [floorTri], { clearanceMm: 0.5, allowTouchContact: true })).toEqual([]);
  });

  it('tip too close → collision', () => {
    const hits = checkProbePath([pt(0, 0, 1.2)], probe, [floorTri], { clearanceMm: 0.5, allowTouchContact: true });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.componentHit).toBe('tip');
  });

  it('touch point is allowed when allowTouchContact', () => {
    const hits = checkProbePath([pt(0, 0, 0, true)], probe, [floorTri], { clearanceMm: 0.5, allowTouchContact: true });
    expect(hits).toEqual([]);
  });

  it('touch point not allowed without flag', () => {
    const hits = checkProbePath([pt(0, 0, 0, true)], probe, [floorTri], { clearanceMm: 0.5, allowTouchContact: false });
    expect(hits.length).toBeGreaterThan(0);
  });

  it('reports triangle id on hit', () => {
    const hits = checkProbePath([pt(0, 0, 1.2)], probe, [floorTri], { clearanceMm: 0.5, allowTouchContact: true });
    expect(hits[0]!.triangleId).toBe('t1');
  });

  it('records minDistance for hit', () => {
    const hits = checkProbePath([pt(0, 0, 1.2)], probe, [floorTri], { clearanceMm: 0.5, allowTouchContact: true });
    expect(hits[0]!.minDistanceMm).toBeLessThan(0.5);
  });
});

describe('checkPathSegments', () => {
  it('returns checkProbePath when path too short', () => {
    const hits = checkPathSegments([pt(0, 0, 10)], probe, [floorTri]);
    expect(hits).toEqual([]);
  });

  it('detects collision along an approach segment', () => {
    const start = pt(0, 0, 10);
    const end = pt(0, 0, 1.2);
    const hits = checkPathSegments([start, end], probe, [floorTri], { clearanceMm: 0.5, allowTouchContact: true });
    expect(hits.length).toBeGreaterThan(0);
  });

  it('sample density affects hit count', () => {
    const start = pt(0, 0, 10);
    const end = pt(0, 0, 1.2);
    const few = checkPathSegments([start, end], probe, [floorTri], { clearanceMm: 0.5, allowTouchContact: true }, 2);
    const many = checkPathSegments([start, end], probe, [floorTri], { clearanceMm: 0.5, allowTouchContact: true }, 10);
    expect(many.length).toBeGreaterThanOrEqual(few.length);
  });
});

describe('summarize', () => {
  it('zero hits → infinity worst', () => {
    const s = summarize([], 5);
    expect(s.collisionCount).toBe(0);
    expect(s.worstClearanceMm).toBe(Infinity);
  });

  it('counts tip vs shaft hits separately', () => {
    const hits = [
      { pathIndex: 0, pointPosition: { x: 0, y: 0, z: 0 }, minDistanceMm: 0.1, componentHit: 'tip' as const },
      { pathIndex: 1, pointPosition: { x: 0, y: 0, z: 0 }, minDistanceMm: 0.2, componentHit: 'shaft' as const },
    ];
    const s = summarize(hits, 2);
    expect(s.tipCollisions).toBe(1);
    expect(s.shaftCollisions).toBe(1);
  });

  it('worstClearanceMm is the minimum', () => {
    const hits = [
      { pathIndex: 0, pointPosition: { x: 0, y: 0, z: 0 }, minDistanceMm: 0.4, componentHit: 'tip' as const },
      { pathIndex: 1, pointPosition: { x: 0, y: 0, z: 0 }, minDistanceMm: 0.1, componentHit: 'tip' as const },
    ];
    expect(summarize(hits, 2).worstClearanceMm).toBeCloseTo(0.1, 5);
  });
});
