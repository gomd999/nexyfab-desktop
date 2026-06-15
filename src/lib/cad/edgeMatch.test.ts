/**
 * edgeMatch — nearest-midpoint correspondence (K3).
 */
import { describe, it, expect } from 'vitest';
import { nearestByMidpoint } from './edgeMatch';
import type { Vec3 } from '@/lib/sketch/sketchPlane';

const mids: Vec3[] = [
  { x: 0, y: 0, z: 2.5 },
  { x: 10, y: 0, z: 2.5 },
  { x: 5, y: 0, z: 0 },
  { x: 5, y: 0, z: 5 },
];

describe('nearestByMidpoint', () => {
  it('picks the coincident candidate within tolerance', () => {
    const r = nearestByMidpoint(mids, { x: 10.0001, y: 0, z: 2.5 }, 1e-3);
    expect(r.index).toBe(1);
    expect(r.dist).toBeLessThan(1e-3);
  });

  it('rejects when the nearest is beyond tolerance', () => {
    const r = nearestByMidpoint(mids, { x: 3, y: 3, z: 3 }, 1e-3);
    expect(r.index).toBe(-1);
  });

  it('returns -1 for an empty candidate set', () => {
    expect(nearestByMidpoint([], { x: 0, y: 0, z: 0 }).index).toBe(-1);
  });

  it('breaks ties by first-seen and reports the true distance', () => {
    const dup: Vec3[] = [{ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }];
    const r = nearestByMidpoint(dup, { x: 1, y: 0, z: 0 }, 1e-6);
    expect(r.index).toBe(0);
    expect(r.dist).toBeCloseTo(0, 9);
  });
});
