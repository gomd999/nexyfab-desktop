import { describe, it, expect } from 'vitest';
import {
  castRay,
  castRayBvh,
  buildBvh,
  screenToRay,
  type MeshArrays,
  type Camera,
} from './rayCastPicker';

function squareAtZ(z: number, faceId = 'f1'): MeshArrays {
  return {
    positions: [
      -1, -1, z,
      1, -1, z,
      1, 1, z,
      -1, 1, z,
    ],
    indices: [0, 1, 2, 0, 2, 3],
    triangleFaceIds: [faceId, faceId],
  };
}

describe('castRay', () => {
  it('hits a square head-on', () => {
    const mesh = squareAtZ(5);
    const r = castRay(mesh, { origin: [0, 0, 0], direction: [0, 0, 1] });
    expect(r).not.toBeNull();
    expect(r!.hitPointMm[2]).toBeCloseTo(5, 5);
    expect(r!.distanceMm).toBeCloseTo(5, 5);
  });

  it('misses when pointing away', () => {
    const mesh = squareAtZ(5);
    const r = castRay(mesh, { origin: [0, 0, 0], direction: [0, 0, -1] });
    expect(r).toBeNull();
  });

  it('attaches faceId from triangleFaceIds', () => {
    const mesh = squareAtZ(5, 'top-face');
    const r = castRay(mesh, { origin: [0, 0, 0], direction: [0, 0, 1] });
    expect(r?.faceId).toBe('top-face');
  });

  it('picks nearer triangle when two stacked', () => {
    const near = squareAtZ(2, 'near');
    const far = squareAtZ(10, 'far');
    const merged: MeshArrays = {
      positions: [...near.positions, ...far.positions],
      indices: [
        ...near.indices,
        ...far.indices.map(i => i + 4),
      ],
      triangleFaceIds: ['near', 'near', 'far', 'far'],
    };
    const r = castRay(merged, { origin: [0, 0, 0], direction: [0, 0, 1] });
    expect(r?.faceId).toBe('near');
  });

  it('barycentric coordinates sum to 1', () => {
    const mesh = squareAtZ(5);
    const r = castRay(mesh, { origin: [0, 0, 0], direction: [0, 0, 1] });
    const b = r!.barycentric;
    expect(b[0] + b[1] + b[2]).toBeCloseTo(1, 5);
  });

  it('miss when ray off to the side', () => {
    const mesh = squareAtZ(5);
    const r = castRay(mesh, { origin: [10, 10, 0], direction: [0, 0, 1] });
    expect(r).toBeNull();
  });
});

describe('castRayBvh', () => {
  it('produces same hit as naive castRay', () => {
    const mesh = squareAtZ(5);
    const bvh = buildBvh(mesh);
    const naive = castRay(mesh, { origin: [0, 0, 0], direction: [0, 0, 1] });
    const fast = castRayBvh(mesh, bvh, { origin: [0, 0, 0], direction: [0, 0, 1] });
    expect(fast?.triangleIndex).toBe(naive?.triangleIndex);
    expect(fast?.distanceMm).toBeCloseTo(naive?.distanceMm ?? -1, 5);
  });

  it('returns null when ray misses', () => {
    const mesh = squareAtZ(5);
    const bvh = buildBvh(mesh);
    const r = castRayBvh(mesh, bvh, { origin: [10, 10, 0], direction: [0, 0, 1] });
    expect(r).toBeNull();
  });

  it('large grid: BVH skips far-away nodes', () => {
    const positions: number[] = [];
    const indices: number[] = [];
    // 20 separate triangles in a grid.
    for (let i = 0; i < 20; i++) {
      const base = positions.length / 3;
      positions.push(i * 5, 0, 0, i * 5 + 1, 0, 0, i * 5 + 0.5, 1, 0);
      indices.push(base, base + 1, base + 2);
    }
    const mesh = { positions, indices };
    const bvh = buildBvh(mesh, 4);
    const r = castRayBvh(mesh, bvh, { origin: [0.5, 0.3, -10], direction: [0, 0, 1] });
    expect(r).not.toBeNull();
  });
});

describe('buildBvh', () => {
  it('returns root with bounds enclosing all triangles', () => {
    const mesh = squareAtZ(5);
    const bvh = buildBvh(mesh);
    expect(bvh.bounds.min[2]).toBeLessThanOrEqual(5);
    expect(bvh.bounds.max[2]).toBeGreaterThanOrEqual(5);
  });

  it('respects leaf size', () => {
    const mesh = squareAtZ(5);
    const bvh = buildBvh(mesh, 1);
    // With leafSize=1 and 2 triangles, we should have a split.
    expect(bvh.left).toBeDefined();
    expect(bvh.right).toBeDefined();
  });
});

describe('screenToRay', () => {
  const camera: Camera = {
    positionMm: [0, 0, -10],
    forward: [0, 0, 1],
    up: [0, 1, 0],
    fovYRad: Math.PI / 3,
    aspect: 1,
  };

  it('center pixel → ray along forward', () => {
    const ray = screenToRay(camera, 0, 0);
    expect(ray.direction[2]).toBeCloseTo(1, 5);
  });

  it('off-center pixel → ray deflected', () => {
    const ray = screenToRay(camera, 0.5, 0);
    expect(Math.abs(ray.direction[0])).toBeGreaterThan(0);
  });

  it('ray direction is unit length', () => {
    const ray = screenToRay(camera, 0.3, -0.7);
    const len = Math.hypot(ray.direction[0], ray.direction[1], ray.direction[2]);
    expect(len).toBeCloseTo(1, 5);
  });

  it('origin = camera position', () => {
    const ray = screenToRay(camera, 0, 0);
    expect(ray.origin).toEqual(camera.positionMm);
  });
});
