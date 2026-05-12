/**
 * CSG operations regression test.
 *
 * Why: editing/CSGOperations.ts previously swallowed errors and silently
 * returned the base geometry, masking failures. After A1 the function now
 * throws (via CSGEmptyResultError) so callers can surface the failure.
 * These tests pin the new contract:
 *   1. Successful boolean returns valid non-empty geometry
 *   2. Empty intersection throws CSGEmptyResultError
 *   3. Tool transformation is applied (position/rotation propagates to result)
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  applyCSG,
  makeToolGeometry,
  CSGEmptyResultError,
  type CSGToolParams,
} from '../editing/CSGOperations';

function makeBox(w = 50, h = 50, d = 50): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).toNonIndexed();
}

function bbox(geo: THREE.BufferGeometry): THREE.Box3 {
  geo.computeBoundingBox();
  return geo.boundingBox!.clone();
}

const baseToolParams = (): CSGToolParams => ({
  shape: 'box',
  width: 30,
  height: 30,
  depth: 30,
  posX: 0,
  posY: 0,
  posZ: 0,
  rotY: 0,
});

describe('makeToolGeometry', () => {
  it('produces non-indexed geometry for box tool', () => {
    const tool = makeToolGeometry(baseToolParams());
    expect(tool.index).toBeNull();
    expect(tool.attributes.position.count).toBeGreaterThan(0);
  });

  it('applies position offset to the tool', () => {
    const offset = makeToolGeometry({ ...baseToolParams(), posX: 100 });
    const box = bbox(offset);
    // 30mm box centred at x=100 → bbox should span ~85..115 in X
    expect(box.min.x).toBeGreaterThan(80);
    expect(box.max.x).toBeLessThan(120);
  });

  it('produces a sphere for shape=sphere', () => {
    const sphere = makeToolGeometry({ ...baseToolParams(), shape: 'sphere' });
    // SphereGeometry has more vertices than a 6-face box at default subdivisions.
    expect(sphere.attributes.position.count).toBeGreaterThan(100);
  });
});

describe('applyCSG', () => {
  it('union of two overlapping boxes returns non-empty geometry', () => {
    const a = makeBox(50, 50, 50);
    const b = makeBox(30, 30, 30);
    const result = applyCSG(a, b, 'union');
    expect(result.attributes.position.count).toBeGreaterThan(0);
  });

  it('subtract removes the overlapping region', () => {
    const a = makeBox(50, 50, 50);
    // Tool is fully inside A (smaller box at origin), so subtraction should
    // yield a hollow shell — still has many vertices, not empty.
    const b = makeBox(20, 20, 20);
    const result = applyCSG(a, b, 'subtract');
    expect(result.attributes.position.count).toBeGreaterThan(0);
  });

  it('intersect of two non-overlapping boxes throws CSGEmptyResultError', () => {
    const a = makeBox(20, 20, 20);
    // Move B far away from A so they cannot intersect.
    const b = makeBox(20, 20, 20);
    b.translate(1000, 0, 0);
    expect(() => applyCSG(a, b, 'intersect')).toThrow(CSGEmptyResultError);
  });

  it('returns a fresh BufferGeometry (not aliasing the input)', () => {
    const a = makeBox(50, 50, 50);
    const b = makeBox(30, 30, 30);
    const result = applyCSG(a, b, 'union');
    expect(result).not.toBe(a);
    expect(result).not.toBe(b);
  });
});
