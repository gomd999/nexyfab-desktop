import { describe, it, expect } from 'vitest';
import {
  frustumOverlapsAabb,
  frustumFromMatrix,
  aabbBehindOccluder,
  type Frustum,
} from './culling';
import type { Aabb } from './octree';

/** Identity frustum: everything is "inside" all 6 planes (very generous).
 *  Useful as a smoke-test baseline. */
const wideFrustum: Frustum = [
  { nx: 1,  ny: 0,  nz: 0,  d: 1000 },
  { nx: -1, ny: 0,  nz: 0,  d: 1000 },
  { nx: 0,  ny: 1,  nz: 0,  d: 1000 },
  { nx: 0,  ny: -1, nz: 0,  d: 1000 },
  { nx: 0,  ny: 0,  nz: 1,  d: 1000 },
  { nx: 0,  ny: 0,  nz: -1, d: 1000 },
];

const box = (cx: number, cy: number, cz: number, size = 5): Aabb => ({
  min: [cx - size, cy - size, cz - size],
  max: [cx + size, cy + size, cz + size],
});

describe('frustumOverlapsAabb', () => {
  it('returns true for AABB inside a wide frustum', () => {
    expect(frustumOverlapsAabb(wideFrustum, box(0, 0, 0))).toBe(true);
  });

  it('returns false for AABB outside a single plane', () => {
    const tight: Frustum = [
      { nx: 1,  ny: 0, nz: 0, d: -10 }, // x ≥ 10
      ...wideFrustum.slice(1),
    ] as Frustum;
    expect(frustumOverlapsAabb(tight, box(0, 0, 0))).toBe(false);
    expect(frustumOverlapsAabb(tight, box(20, 0, 0))).toBe(true);
  });
});

describe('frustumFromMatrix', () => {
  it('produces 6 planes from a 16-float matrix', () => {
    // Identity matrix (column-major) → degenerate but well-formed planes.
    const identity = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    const f = frustumFromMatrix(identity);
    expect(f).toHaveLength(6);
    for (const p of f) {
      expect(Number.isFinite(p.d)).toBe(true);
      expect(Number.isFinite(p.nx)).toBe(true);
    }
  });

  it('each plane has approximately unit-length normal', () => {
    const m = [
      2, 0, 0, 0,
      0, 2, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    const f = frustumFromMatrix(m);
    for (const p of f) {
      const len = Math.hypot(p.nx, p.ny, p.nz);
      if (len > 0) {
        expect(len).toBeCloseTo(1, 5);
      }
    }
  });
});

describe('aabbBehindOccluder', () => {
  const eye: [number, number, number] = [0, 0, 0];
  const dir: [number, number, number] = [0, 0, 1];

  it('small box behind a big front-facing box → occluded', () => {
    const occluder = box(0, 0, 5, 10);    // covers (-10..10, -10..10, -5..15)
    const candidate = box(0, 0, 30, 1);   // small far box centred on axis
    expect(aabbBehindOccluder(eye, dir, occluder, candidate)).toBe(true);
  });

  it('candidate ahead of occluder → not occluded', () => {
    const occluder = box(0, 0, 50, 10);
    const candidate = box(0, 0, 5, 1);
    expect(aabbBehindOccluder(eye, dir, occluder, candidate)).toBe(false);
  });

  it('candidate sticking out of occluder silhouette → not occluded', () => {
    const occluder = box(0, 0, 5, 1);     // small occluder
    const candidate = box(0, 0, 30, 10);  // larger behind
    expect(aabbBehindOccluder(eye, dir, occluder, candidate)).toBe(false);
  });
});
