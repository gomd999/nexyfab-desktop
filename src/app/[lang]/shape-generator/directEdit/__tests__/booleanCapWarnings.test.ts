/**
 * booleanCapWarnings.test.ts — Wave 2 Phase 3 Track E4 (W6).
 *
 * Coverage for the 4 spec-locked warning codes:
 *   - SUBTRACT_SAME_BODY     — fires + does not fire
 *   - SUBTRACT_NULL_RESULT   — synthesised post-apply
 *   - SUBTRACT_DISJOINT      — fires + does not fire
 *   - SUBTRACT_NON_MANIFOLD  — fires for several malformed inputs
 *
 * Plus the supporting helpers `isLikelyManifold` and `bboxesOverlap`.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  checkSubtractBodyCaps,
  makeNullResultWarning,
  isLikelyManifold,
  bboxesOverlap,
  BOOLEAN_CAP_WARNING_CATALOGUE,
} from '../booleanCapWarnings';
import type { DirectEditOp } from '../directEditTypes';

function makeBox(
  size = 10,
  center: [number, number, number] = [0, 0, 0],
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(size, size, size);
  geo.translate(center[0], center[1], center[2]);
  return geo;
}

function subtractOp(
  targetBodyId = 't',
  toolBodyId = 'u',
): Extract<DirectEditOp, { kind: 'subtractBody' }> {
  return {
    kind: 'subtractBody',
    targetBodyId,
    toolBodyId,
    keepTool: false,
    createdAt: 0,
  };
}

describe('booleanCapWarnings — SUBTRACT_SAME_BODY', () => {
  it('fires when target and tool ids match', () => {
    const target = makeBox();
    const tool = makeBox();
    const w = checkSubtractBodyCaps(subtractOp('A', 'A'), { target, tool });
    expect(w.some(x => x.code === 'SUBTRACT_SAME_BODY')).toBe(true);
  });

  it('SAME_BODY is blocking', () => {
    const target = makeBox();
    const tool = makeBox();
    const w = checkSubtractBodyCaps(subtractOp('A', 'A'), { target, tool });
    const match = w.find(x => x.code === 'SUBTRACT_SAME_BODY');
    expect(match?.blocking).toBe(true);
  });

  it('short-circuits — no other warnings emitted when SAME_BODY fires', () => {
    const target = new THREE.BufferGeometry();
    const tool = new THREE.BufferGeometry();
    const w = checkSubtractBodyCaps(subtractOp('A', 'A'), { target, tool });
    expect(w.length).toBe(1);
    expect(w[0]!.code).toBe('SUBTRACT_SAME_BODY');
  });

  it('does NOT fire when ids differ', () => {
    const target = makeBox();
    const tool = makeBox(8, [5, 0, 0]);
    const w = checkSubtractBodyCaps(subtractOp('A', 'B'), { target, tool });
    expect(w.some(x => x.code === 'SUBTRACT_SAME_BODY')).toBe(false);
  });
});

describe('booleanCapWarnings — SUBTRACT_NON_MANIFOLD', () => {
  it('fires when target is an empty BufferGeometry', () => {
    const target = new THREE.BufferGeometry();
    const tool = makeBox();
    const w = checkSubtractBodyCaps(subtractOp(), { target, tool });
    expect(w.some(x => x.code === 'SUBTRACT_NON_MANIFOLD')).toBe(true);
  });

  it('fires when tool has NaN in positions', () => {
    const target = makeBox();
    const tool = makeBox();
    const arr = tool.attributes.position.array as Float32Array;
    arr[0] = Number.NaN;
    const w = checkSubtractBodyCaps(subtractOp(), { target, tool });
    expect(w.some(x => x.code === 'SUBTRACT_NON_MANIFOLD')).toBe(true);
  });

  it('NON_MANIFOLD is blocking', () => {
    const target = new THREE.BufferGeometry();
    const tool = makeBox();
    const w = checkSubtractBodyCaps(subtractOp(), { target, tool });
    const match = w.find(x => x.code === 'SUBTRACT_NON_MANIFOLD');
    expect(match?.blocking).toBe(true);
  });

  it('does NOT fire for two valid manifold meshes', () => {
    const target = makeBox(20);
    const tool = makeBox(10, [5, 0, 0]);
    const w = checkSubtractBodyCaps(subtractOp(), { target, tool });
    expect(w.some(x => x.code === 'SUBTRACT_NON_MANIFOLD')).toBe(false);
  });
});

describe('booleanCapWarnings — SUBTRACT_DISJOINT', () => {
  it('fires when bboxes do not overlap', () => {
    const target = makeBox(10, [0, 0, 0]);
    const tool = makeBox(10, [100, 100, 100]);
    const w = checkSubtractBodyCaps(subtractOp(), { target, tool });
    expect(w.some(x => x.code === 'SUBTRACT_DISJOINT')).toBe(true);
  });

  it('DISJOINT is NOT blocking', () => {
    const target = makeBox(10, [0, 0, 0]);
    const tool = makeBox(10, [100, 100, 100]);
    const w = checkSubtractBodyCaps(subtractOp(), { target, tool });
    const match = w.find(x => x.code === 'SUBTRACT_DISJOINT');
    expect(match?.blocking).toBe(false);
  });

  it('does NOT fire for overlapping bboxes', () => {
    const target = makeBox(20, [0, 0, 0]);
    const tool = makeBox(10, [5, 0, 0]);
    const w = checkSubtractBodyCaps(subtractOp(), { target, tool });
    expect(w.some(x => x.code === 'SUBTRACT_DISJOINT')).toBe(false);
  });
});

describe('booleanCapWarnings — SUBTRACT_NULL_RESULT', () => {
  it('synthesised via makeNullResultWarning()', () => {
    const w = makeNullResultWarning();
    expect(w.code).toBe('SUBTRACT_NULL_RESULT');
    expect(w.blocking).toBe(true);
    expect(w.message).toContain('empty');
  });

  it('is NOT emitted by the pre-apply check (requires post-apply data)', () => {
    const target = makeBox(2);
    const tool = makeBox(20);
    const w = checkSubtractBodyCaps(subtractOp(), { target, tool });
    expect(w.some(x => x.code === 'SUBTRACT_NULL_RESULT')).toBe(false);
  });
});

describe('booleanCapWarnings — isLikelyManifold', () => {
  it('rejects null', () => {
    expect(isLikelyManifold(null)).toBe(false);
  });

  it('rejects an empty geometry', () => {
    expect(isLikelyManifold(new THREE.BufferGeometry())).toBe(false);
  });

  it('accepts a box', () => {
    expect(isLikelyManifold(makeBox())).toBe(true);
  });

  it('rejects a geometry with too few triangles', () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    expect(isLikelyManifold(geo)).toBe(false);
  });
});

describe('booleanCapWarnings — bboxesOverlap', () => {
  it('true for overlapping boxes', () => {
    expect(bboxesOverlap(makeBox(20), makeBox(10, [5, 0, 0]))).toBe(true);
  });

  it('false for disjoint boxes', () => {
    expect(bboxesOverlap(makeBox(10, [0, 0, 0]), makeBox(10, [100, 0, 0]))).toBe(false);
  });

  it('true for touching boxes (edge contact)', () => {
    // Two boxes sharing a face — bboxes touch but technically overlap
    // on the boundary. We expect true.
    expect(bboxesOverlap(makeBox(10, [0, 0, 0]), makeBox(10, [10, 0, 0]))).toBe(true);
  });
});

describe('booleanCapWarnings — catalogue', () => {
  it('exports all 4 codes', () => {
    expect(BOOLEAN_CAP_WARNING_CATALOGUE).toHaveLength(4);
    expect(BOOLEAN_CAP_WARNING_CATALOGUE).toContain('SUBTRACT_SAME_BODY');
    expect(BOOLEAN_CAP_WARNING_CATALOGUE).toContain('SUBTRACT_NULL_RESULT');
    expect(BOOLEAN_CAP_WARNING_CATALOGUE).toContain('SUBTRACT_DISJOINT');
    expect(BOOLEAN_CAP_WARNING_CATALOGUE).toContain('SUBTRACT_NON_MANIFOLD');
  });
});
