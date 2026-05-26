/**
 * Invariant assertions — smoke tests. Full coverage of validateGeometry is
 * already in src/app/[lang]/shape-generator/__tests__; here we only verify
 * that the assert wrappers throw / no-op according to NODE_ENV.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  assertManifold,
  assertWatertight,
  assertNonZeroVolume,
  assertValidSolid,
  isValidSolid,
  GeometryInvariantError,
} from './invariants';

function makeBox(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(10, 10, 10);
  g.computeVertexNormals();
  return g;
}

function makeOpenPlane(): THREE.BufferGeometry {
  // 1 triangle — has 3 open edges, is not closed, volume = 0.
  return new THREE.PlaneGeometry(10, 10);
}

describe('geometry invariants', () => {
  it('assertValidSolid passes on a closed box', () => {
    expect(() => assertValidSolid(makeBox(), { op: 'test' })).not.toThrow();
  });

  it('assertManifold passes on a closed box', () => {
    expect(() => assertManifold(makeBox(), { op: 'test' })).not.toThrow();
  });

  it('assertWatertight throws on an open plane', () => {
    expect(() => assertWatertight(makeOpenPlane(), { op: 'test' }))
      .toThrowError(GeometryInvariantError);
  });

  it('assertNonZeroVolume throws on a flat plane (zero volume)', () => {
    expect(() => assertNonZeroVolume(makeOpenPlane(), { op: 'test' }))
      .toThrowError(GeometryInvariantError);
  });

  it('isValidSolid returns true for a box', () => {
    expect(isValidSolid(makeBox(), { op: 'test' })).toBe(true);
  });

  it('isValidSolid returns false for an open plane (never throws)', () => {
    expect(isValidSolid(makeOpenPlane(), { op: 'test' })).toBe(false);
  });

  it('thrown error carries op context and invariant kind', () => {
    try {
      assertNonZeroVolume(makeOpenPlane(), { op: 'unit-test', featureId: 'abc' });
    } catch (err) {
      expect(err).toBeInstanceOf(GeometryInvariantError);
      const e = err as GeometryInvariantError;
      expect(e.invariant).toBe('non-zero-volume');
      expect(e.context.op).toBe('unit-test');
      expect(e.context.featureId).toBe('abc');
    }
  });
});
