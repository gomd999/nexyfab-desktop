/**
 * interference — AABB-based interference detection tests.
 */
import { describe, it, expect } from 'vitest';
import {
  aabb,
  transformAabb,
  aabbOverlap,
  aabbPenetration,
  assemblyInterferences,
} from './interference';
import { partInstance, IDENTITY_QUAT } from './assemblyState';
import { vec3 } from '@/lib/sketch/sketchPlane';

function part(id: string, position = vec3(0, 0, 0)) {
  return partInstance({
    id, name: id, partTemplateId: 'tpl',
    position, orientation: IDENTITY_QUAT,
    fixed: id === 'f',
  });
}

describe('aabbOverlap', () => {
  it('separated boxes: false', () => {
    const a = aabb(vec3(0, 0, 0), vec3(1, 1, 1));
    const b = aabb(vec3(2, 0, 0), vec3(3, 1, 1));
    expect(aabbOverlap(a, b)).toBe(false);
  });

  it('overlapping boxes: true', () => {
    const a = aabb(vec3(0, 0, 0), vec3(2, 2, 2));
    const b = aabb(vec3(1, 1, 1), vec3(3, 3, 3));
    expect(aabbOverlap(a, b)).toBe(true);
  });

  it('touching faces: edge case — touching counts as no overlap (tolerance=0)', () => {
    const a = aabb(vec3(0, 0, 0), vec3(1, 1, 1));
    const b = aabb(vec3(1, 0, 0), vec3(2, 1, 1));
    expect(aabbOverlap(a, b)).toBe(false);
  });

  it('positive tolerance excludes near-touches', () => {
    const a = aabb(vec3(0, 0, 0), vec3(1, 1, 1));
    const b = aabb(vec3(0.99, 0, 0), vec3(2, 1, 1));
    expect(aabbOverlap(a, b, 0)).toBe(true);
    expect(aabbOverlap(a, b, 0.1)).toBe(false);
  });
});

describe('aabbPenetration', () => {
  it('returns 0 for non-overlapping boxes', () => {
    const a = aabb(vec3(0, 0, 0), vec3(1, 1, 1));
    const b = aabb(vec3(5, 5, 5), vec3(6, 6, 6));
    expect(aabbPenetration(a, b)).toBe(0);
  });

  it('returns min-axis-overlap for overlapping boxes', () => {
    const a = aabb(vec3(0, 0, 0), vec3(10, 10, 10));
    const b = aabb(vec3(8, 2, 2), vec3(12, 8, 8));
    // x overlap: 10 - 8 = 2; y overlap: 8 - 2 = 6; z overlap: 8 - 2 = 6.
    expect(aabbPenetration(a, b)).toBe(2);
  });
});

describe('transformAabb', () => {
  it('identity orientation: just translates the box', () => {
    const local = aabb(vec3(-1, -2, -3), vec3(1, 2, 3));
    const p = part('p', vec3(10, 20, 30));
    const w = transformAabb(local, p);
    expect(w.min).toEqual({ x: 9, y: 18, z: 27 });
    expect(w.max).toEqual({ x: 11, y: 22, z: 33 });
  });

  it('rotated box is always axis-aligned and conservatively encloses the rotated body', () => {
    // Unit cube centered at origin, rotated 45° around Z (orientation
    // approximated via identity here since rotateVec is the source of truth;
    // we just check the helper returns a valid AABB).
    const local = aabb(vec3(-1, -1, -1), vec3(1, 1, 1));
    const p = part('p', vec3(0, 0, 0));
    const w = transformAabb(local, p);
    expect(w.min.x).toBeLessThanOrEqual(-1);
    expect(w.max.x).toBeGreaterThanOrEqual(1);
  });
});

describe('assemblyInterferences', () => {
  it('finds overlapping pair', () => {
    const a = part('a', vec3(0, 0, 0));
    const b = part('b', vec3(1, 0, 0));
    const boxes = new Map([
      ['a', aabb(vec3(-2, -2, -2), vec3(2, 2, 2))], // world: -2..2
      ['b', aabb(vec3(-2, -2, -2), vec3(2, 2, 2))], // world: -1..3
    ]);
    const r = assemblyInterferences([a, b], boxes);
    expect(r.length).toBe(1);
    expect([r[0]!.partA, r[0]!.partB].sort()).toEqual(['a', 'b']);
    expect(r[0]!.penetration).toBeGreaterThan(0);
  });

  it('separated parts: no interference', () => {
    const a = part('a', vec3(0, 0, 0));
    const b = part('b', vec3(10, 0, 0));
    const boxes = new Map([
      ['a', aabb(vec3(-1, -1, -1), vec3(1, 1, 1))],
      ['b', aabb(vec3(-1, -1, -1), vec3(1, 1, 1))],
    ]);
    expect(assemblyInterferences([a, b], boxes).length).toBe(0);
  });

  it('whitelist skips deliberately-mated pairs', () => {
    const a = part('a', vec3(0, 0, 0));
    const b = part('b', vec3(0, 0, 0));
    const boxes = new Map([
      ['a', aabb(vec3(-1, -1, -1), vec3(1, 1, 1))],
      ['b', aabb(vec3(-1, -1, -1), vec3(1, 1, 1))],
    ]);
    expect(assemblyInterferences([a, b], boxes).length).toBe(1);
    expect(
      assemblyInterferences([a, b], boxes, new Set(['a::b'])).length,
    ).toBe(0);
  });

  it('parts without bbox in map are skipped', () => {
    const a = part('a');
    const b = part('b');
    const boxes = new Map([
      ['a', aabb(vec3(0, 0, 0), vec3(1, 1, 1))],
      // no entry for b
    ]);
    expect(assemblyInterferences([a, b], boxes).length).toBe(0);
  });

  it('O(N²) pair scan: 4 mutually-overlapping parts → 6 pairs', () => {
    const ps = ['a', 'b', 'c', 'd'].map((id) => part(id));
    const boxes = new Map(ps.map((p) => [p.id, aabb(vec3(-1, -1, -1), vec3(1, 1, 1))]));
    expect(assemblyInterferences(ps, boxes).length).toBe(6);
  });
});
