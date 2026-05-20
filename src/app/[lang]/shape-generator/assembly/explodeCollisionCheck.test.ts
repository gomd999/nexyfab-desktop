import { describe, it, expect } from 'vitest';
import {
  detectExplodeCollisions,
  suggestReorder,
  summarize,
  type ExplodeStep,
} from './explodeCollisionCheck';

function box(componentId: string, x: number, y: number, z: number, size: number, dx: number, dy: number, dz: number): ExplodeStep {
  return {
    componentId,
    aabb: {
      min: { x, y, z },
      max: { x: x + size, y: y + size, z: z + size },
    },
    translation: { x: dx, y: dy, z: dz },
  };
}

describe('detectExplodeCollisions', () => {
  it('no steps → no collisions', () => {
    expect(detectExplodeCollisions([])).toEqual([]);
  });

  it('non-overlapping static AABBs → no collision', () => {
    const a = box('a', 0, 0, 0, 1, 0, 0, 0);
    const b = box('b', 5, 0, 0, 1, 0, 0, 0);
    expect(detectExplodeCollisions([a, b])).toEqual([]);
  });

  it('overlapping static AABBs → collision over whole [0,1]', () => {
    const a = box('a', 0, 0, 0, 10, 0, 0, 0);
    const b = box('b', 5, 5, 5, 10, 0, 0, 0);
    const c = detectExplodeCollisions([a, b]);
    expect(c).toHaveLength(1);
    expect(c[0]!.tStart).toBeCloseTo(0, 5);
    expect(c[0]!.tEnd).toBeCloseTo(1, 5);
  });

  it('moving apart → no collision after start', () => {
    // Two adjacent boxes moving apart; they overlap only at t=0.
    const a = box('a', 0, 0, 0, 10, -100, 0, 0);
    const b = box('b', 0, 0, 0, 10, 100, 0, 0);
    const c = detectExplodeCollisions([a, b]);
    // At t=0 they fully overlap. At t=1 they are separated.
    // tEnd should be small (overlap ends quickly).
    expect(c).toHaveLength(1);
    expect(c[0]!.tStart).toBeCloseTo(0, 5);
    expect(c[0]!.tEnd).toBeLessThan(0.2);
  });

  it('moving through each other → mid-flight collision', () => {
    // A starts left, moves right. B starts right, moves left. They pass through.
    const a = box('a', -50, 0, 0, 10, 100, 0, 0);
    const b = box('b', 50, 0, 0, 10, -100, 0, 0);
    const c = detectExplodeCollisions([a, b]);
    expect(c).toHaveLength(1);
    expect(c[0]!.tStart).toBeGreaterThan(0);
    expect(c[0]!.tEnd).toBeLessThan(1);
  });

  it('overlap volume positive when colliding', () => {
    const a = box('a', 0, 0, 0, 10, 0, 0, 0);
    const b = box('b', 5, 5, 5, 10, 0, 0, 0);
    const c = detectExplodeCollisions([a, b]);
    expect(c[0]!.midpointOverlapMm3).toBeGreaterThan(0);
  });

  it('three components → up to 3 pair checks', () => {
    const a = box('a', 0, 0, 0, 1, 0, 0, 0);
    const b = box('b', 5, 0, 0, 1, 0, 0, 0);
    const c = box('c', 10, 0, 0, 1, 0, 0, 0);
    expect(detectExplodeCollisions([a, b, c])).toEqual([]);
  });
});

describe('suggestReorder', () => {
  it('empty collisions → empty serialized list', () => {
    expect(suggestReorder([]).serializedComponents).toEqual([]);
  });

  it('most-conflicting component listed first', () => {
    const collisions = [
      { componentA: 'hub', componentB: 'a', tStart: 0, tEnd: 1, midpointOverlapMm3: 10 },
      { componentA: 'hub', componentB: 'b', tStart: 0, tEnd: 1, midpointOverlapMm3: 10 },
      { componentA: 'hub', componentB: 'c', tStart: 0, tEnd: 1, midpointOverlapMm3: 10 },
    ];
    const reorder = suggestReorder(collisions);
    expect(reorder.serializedComponents[0]).toBe('hub');
  });
});

describe('summarize', () => {
  it('zero collisions → Infinity earliest', () => {
    const a = box('a', 0, 0, 0, 1, 0, 0, 0);
    const s = summarize([a], []);
    expect(s.componentCount).toBe(1);
    expect(s.collisionPairCount).toBe(0);
    expect(s.earliestCollisionT).toBe(Infinity);
  });

  it('reports worst overlap and earliest', () => {
    const a = box('a', 0, 0, 0, 10, 0, 0, 0);
    const b = box('b', 5, 5, 5, 10, 0, 0, 0);
    const collisions = detectExplodeCollisions([a, b]);
    const s = summarize([a, b], collisions);
    expect(s.worstOverlapMm3).toBeGreaterThan(0);
    expect(s.earliestCollisionT).toBeCloseTo(0, 5);
  });
});
