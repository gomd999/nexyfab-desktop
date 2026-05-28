/**
 * pushPullMath.test.ts — Wave 2 Phase 3 Track E1 pure-math suite.
 *
 * Pure math: no THREE.js, no React. Locks the projection sign
 * convention + validation refusal cases + snap-to-grid behaviour.
 */

import { describe, it, expect } from 'vitest';
import {
  computePushPullOffset,
  validatePushPullOffset,
  dragSnapToGrid,
  computeFaceBboxExtent,
  PUSH_PULL_EPSILON_MM,
  PUSH_PULL_MAX_OFFSET_MM,
} from '../pushPullMath';

describe('computePushPullOffset', () => {
  it('returns the drag magnitude when drag is parallel to +normal', () => {
    expect(computePushPullOffset([0, 1, 0], [0, 5, 0])).toBe(5);
  });

  it('returns negative when drag is opposite to normal (inward pull)', () => {
    expect(computePushPullOffset([0, 1, 0], [0, -3, 0])).toBe(-3);
  });

  it('returns zero when drag is perpendicular to normal', () => {
    expect(computePushPullOffset([0, 1, 0], [5, 0, 0])).toBe(0);
  });

  it('projects an oblique drag correctly (45° to normal)', () => {
    const offset = computePushPullOffset([0, 1, 0], [10, 10, 0]);
    expect(offset).toBeCloseTo(10, 6);
  });

  it('normalises non-unit face normals', () => {
    // Face normal [0, 2, 0] should behave like [0, 1, 0].
    const offset = computePushPullOffset([0, 2, 0], [0, 5, 0]);
    expect(offset).toBe(5);
  });

  it('handles 3D oblique normals (1, 1, 1)/√3', () => {
    const len = Math.sqrt(3);
    const offset = computePushPullOffset(
      [1 / len, 1 / len, 1 / len],
      [len, len, len],
    );
    expect(offset).toBeCloseTo(3, 6);
  });

  it('returns 0 for sub-epsilon drag (denoise)', () => {
    expect(computePushPullOffset([0, 1, 0], [0, PUSH_PULL_EPSILON_MM / 10, 0])).toBe(0);
  });

  it('returns 0 for degenerate (zero) face normal', () => {
    expect(computePushPullOffset([0, 0, 0], [5, 5, 5])).toBe(0);
  });

  it('handles arbitrary axis (X normal)', () => {
    expect(computePushPullOffset([1, 0, 0], [4, 0, 0])).toBe(4);
  });

  it('handles arbitrary axis (Z normal)', () => {
    expect(computePushPullOffset([0, 0, -1], [0, 0, 7])).toBeCloseTo(-7, 6);
  });
});

describe('validatePushPullOffset', () => {
  const cubeCtx = {
    geometryBboxExtent: [100, 100, 100] as const,
    faceBboxExtent: [100, 100, 0] as const,
  };

  it('accepts a reasonable outward push', () => {
    expect(validatePushPullOffset(10, cubeCtx)).toEqual({ ok: true });
  });

  it('accepts a reasonable inward pull within face dim', () => {
    expect(validatePushPullOffset(-10, cubeCtx)).toEqual({ ok: true });
  });

  it('refuses NaN', () => {
    expect(validatePushPullOffset(NaN, cubeCtx)).toEqual({
      ok: false,
      reason: 'invalid_offset',
    });
  });

  it('refuses Infinity', () => {
    expect(validatePushPullOffset(Infinity, cubeCtx)).toEqual({
      ok: false,
      reason: 'invalid_offset',
    });
  });

  it('refuses near-zero offset (no-op)', () => {
    expect(validatePushPullOffset(PUSH_PULL_EPSILON_MM / 10, cubeCtx)).toEqual({
      ok: false,
      reason: 'invalid_offset',
    });
  });

  it('refuses offset exceeding hard cap', () => {
    expect(validatePushPullOffset(PUSH_PULL_MAX_OFFSET_MM + 1, cubeCtx)).toEqual({
      ok: false,
      reason: 'too_large',
    });
  });

  it('refuses offset exceeding 2× geometry extent', () => {
    expect(validatePushPullOffset(250, cubeCtx)).toEqual({
      ok: false,
      reason: 'too_large',
    });
  });

  it('refuses inward pull greater than smallest face dim', () => {
    const narrowCtx = {
      geometryBboxExtent: [100, 100, 100] as const,
      faceBboxExtent: [10, 100, 0] as const, // narrow face
    };
    expect(validatePushPullOffset(-20, narrowCtx)).toEqual({
      ok: false,
      reason: 'self_intersect',
    });
  });

  it('accepts large outward push regardless of face size', () => {
    const narrowCtx = {
      geometryBboxExtent: [100, 100, 100] as const,
      faceBboxExtent: [10, 100, 0] as const,
    };
    expect(validatePushPullOffset(20, narrowCtx)).toEqual({ ok: true });
  });
});

describe('dragSnapToGrid', () => {
  it('returns the offset unchanged when gridSize is 0', () => {
    expect(dragSnapToGrid(3.7, 0)).toBe(3.7);
  });

  it('returns the offset unchanged when gridSize is negative', () => {
    expect(dragSnapToGrid(3.7, -1)).toBe(3.7);
  });

  it('snaps positive offset to nearest 0.1 grid', () => {
    expect(dragSnapToGrid(3.74, 0.1)).toBeCloseTo(3.7, 9);
    expect(dragSnapToGrid(3.76, 0.1)).toBeCloseTo(3.8, 9);
  });

  it('snaps negative offset symmetrically', () => {
    expect(dragSnapToGrid(-3.74, 0.1)).toBeCloseTo(-3.7, 9);
  });

  it('snaps to 1mm grid', () => {
    expect(dragSnapToGrid(2.6, 1)).toBe(3);
  });

  it('passes through Infinity unchanged', () => {
    expect(dragSnapToGrid(Infinity, 0.1)).toBe(Infinity);
  });
});

describe('computeFaceBboxExtent', () => {
  it('returns [w, h, 0] for a planar Y-up face on a unit cube top', () => {
    // Top face of a unit cube at y=1, vertices at the four corners.
    const positions = new Float32Array([
      0, 1, 0,  // 0
      1, 1, 0,  // 1
      1, 1, 1,  // 2
      0, 1, 1,  // 3
    ]);
    const extent = computeFaceBboxExtent(positions, [0, 1, 2, 3], [0, 1, 0]);
    expect(extent[0]).toBeCloseTo(1, 6);
    expect(extent[1]).toBeCloseTo(1, 6);
    expect(extent[2]).toBeCloseTo(0, 6);
  });

  it('returns zeroes for an empty vertex list', () => {
    const extent = computeFaceBboxExtent(new Float32Array([]), [], [0, 1, 0]);
    expect(extent).toEqual([0, 0, 0]);
  });

  it('handles an X-aligned face on a 10×20 rectangle', () => {
    const positions = new Float32Array([
      5, 0, 0,
      5, 10, 0,
      5, 10, 20,
      5, 0, 20,
    ]);
    const extent = computeFaceBboxExtent(positions, [0, 1, 2, 3], [1, 0, 0]);
    // Both in-plane dims should be present (10 and 20).
    const sorted = [extent[0], extent[1]].sort((a, b) => a - b);
    expect(sorted[0]).toBeCloseTo(10, 6);
    expect(sorted[1]).toBeCloseTo(20, 6);
  });
});
