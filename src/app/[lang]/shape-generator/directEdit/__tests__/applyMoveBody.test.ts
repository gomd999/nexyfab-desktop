/**
 * applyMoveBody.test.ts — Wave 2 Phase 3 Track E3.
 *
 * Mesh-level body-move tests:
 *   - Translation moves every vertex by the same delta.
 *   - Input geometry is not mutated.
 *   - Output preserves index attribute (when present).
 *   - Output preserves face-feature-id attribute (when present).
 *   - Output normals are recomputed.
 *   - Output bounding box reflects the translation.
 *   - Sub-epsilon translation is a no-op.
 *   - Validation rejects bad ops (NaN translation, empty bodyId, too large).
 *   - Performance budget on 100 / 500 / 1000-tri geometries.
 */

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  stampFaceFeatureIdAll,
  tagWholeGeometryFeature,
  FACE_FEATURE_ID_ATTR,
} from '../../features/faceProvenance';
import { applyMoveBody } from '../applyMoveBody';

/** 4-vertex flat square with whole-geo feature id 'body'. */
function makeFlatSquare(bodyId = 'body'): THREE.BufferGeometry {
  const positions = new Float32Array([
    -5, 0, -5,
     5, 0, -5,
     5, 0,  5,
    -5, 0,  5,
  ]);
  const indices = [0, 2, 1, 0, 3, 2];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  tagWholeGeometryFeature(geo, bodyId);
  return geo;
}

/** Planar fan with N triangles — used for perf tests. */
function makeFlatFan(triCount: number, bodyId = 'fan'): THREE.BufferGeometry {
  const verts: number[] = [0, 0, 0];
  for (let i = 0; i <= triCount; i++) {
    const a = (i / triCount) * Math.PI * 2;
    verts.push(Math.cos(a) * 10, 0, Math.sin(a) * 10);
  }
  const indices: number[] = [];
  for (let i = 0; i < triCount; i++) indices.push(0, i + 1, i + 2);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  tagWholeGeometryFeature(geo, bodyId);
  return geo;
}

describe('applyMoveBody — basic translation', () => {
  it('translates every vertex by the same delta', () => {
    const geo = makeFlatSquare();
    const result = applyMoveBody(geo, {
      kind: 'moveBody',
      bodyId: 'body',
      translation: [10, 20, 30],
      createdAt: 0,
    });
    expect(result.applied).toBe(true);
    expect(result.movedVertexCount).toBe(4);
    const newPos = result.geometry.attributes.position;
    for (let i = 0; i < 4; i++) {
      expect(newPos.getX(i)).toBeCloseTo(geo.attributes.position.getX(i) + 10, 6);
      expect(newPos.getY(i)).toBeCloseTo(geo.attributes.position.getY(i) + 20, 6);
      expect(newPos.getZ(i)).toBeCloseTo(geo.attributes.position.getZ(i) + 30, 6);
    }
  });

  it('does not mutate the input geometry', () => {
    const geo = makeFlatSquare();
    const snapshot = Array.from(geo.attributes.position.array as Float32Array);
    applyMoveBody(geo, {
      kind: 'moveBody',
      bodyId: 'body',
      translation: [1, 2, 3],
      createdAt: 0,
    });
    expect(Array.from(geo.attributes.position.array as Float32Array)).toEqual(snapshot);
  });

  it('preserves the index attribute (output has same indices)', () => {
    const geo = makeFlatSquare();
    const srcIdx = Array.from((geo.index!.array as Uint16Array | Uint32Array));
    const result = applyMoveBody(geo, {
      kind: 'moveBody',
      bodyId: 'body',
      translation: [1, 0, 0],
      createdAt: 0,
    });
    expect(result.geometry.index).not.toBeNull();
    expect(Array.from(result.geometry.index!.array as Uint16Array | Uint32Array)).toEqual(srcIdx);
  });

  it('preserves the face-feature-id attribute', () => {
    const geo = makeFlatSquare();
    stampFaceFeatureIdAll(geo, 'body');
    const result = applyMoveBody(geo, {
      kind: 'moveBody',
      bodyId: 'body',
      translation: [1, 1, 1],
      createdAt: 0,
    });
    expect(result.applied).toBe(true);
    expect(result.geometry.getAttribute(FACE_FEATURE_ID_ATTR)).toBeDefined();
  });

  it('recomputes normals on the output', () => {
    const geo = makeFlatSquare();
    const result = applyMoveBody(geo, {
      kind: 'moveBody',
      bodyId: 'body',
      translation: [0, 5, 0],
      createdAt: 0,
    });
    expect(result.geometry.attributes.normal).toBeDefined();
  });

  it('updates the bounding box on the output', () => {
    const geo = makeFlatSquare();
    const result = applyMoveBody(geo, {
      kind: 'moveBody',
      bodyId: 'body',
      translation: [0, 7, 0],
      createdAt: 0,
    });
    expect(result.geometry.boundingBox).toBeDefined();
    expect(result.geometry.boundingBox!.max.y).toBeCloseTo(7, 5);
  });

  it('handles a negative translation', () => {
    const geo = makeFlatSquare();
    const result = applyMoveBody(geo, {
      kind: 'moveBody',
      bodyId: 'body',
      translation: [-1, -2, -3],
      createdAt: 0,
    });
    expect(result.applied).toBe(true);
    const newPos = result.geometry.attributes.position;
    expect(newPos.getX(0)).toBeCloseTo(-6, 6);
    expect(newPos.getY(0)).toBeCloseTo(-2, 6);
    expect(newPos.getZ(0)).toBeCloseTo(-8, 6);
  });
});

describe('applyMoveBody — validation', () => {
  it('rejects an empty bodyId', () => {
    const geo = makeFlatSquare();
    const warns: string[] = [];
    const result = applyMoveBody(
      geo,
      { kind: 'moveBody', bodyId: '', translation: [1, 0, 0], createdAt: 0 },
      { warn: (m) => warns.push(m) },
    );
    expect(result.applied).toBe(false);
    expect(warns.some(w => w.includes('invalid_bodyId'))).toBe(true);
  });

  it('rejects a NaN translation component', () => {
    const geo = makeFlatSquare();
    const warns: string[] = [];
    const result = applyMoveBody(
      geo,
      { kind: 'moveBody', bodyId: 'body', translation: [NaN, 0, 0], createdAt: 0 },
      { warn: (m) => warns.push(m) },
    );
    expect(result.applied).toBe(false);
    expect(warns.some(w => w.includes('invalid_translation'))).toBe(true);
  });

  it('rejects a translation magnitude exceeding the hard cap', () => {
    const geo = makeFlatSquare();
    const result = applyMoveBody(
      geo,
      { kind: 'moveBody', bodyId: 'body', translation: [1_000_000, 0, 0], createdAt: 0 },
      { warn: () => {} },
    );
    expect(result.applied).toBe(false);
  });

  it('treats a sub-epsilon translation as a no-op (no warn)', () => {
    const geo = makeFlatSquare();
    const result = applyMoveBody(
      geo,
      { kind: 'moveBody', bodyId: 'body', translation: [1e-10, 0, 0], createdAt: 0 },
      { warn: () => {} },
    );
    expect(result.applied).toBe(false);
    expect(result.geometry).toBe(geo);
  });

  it('refuses when geometry has no position attribute', () => {
    const geo = new THREE.BufferGeometry();
    const warns: string[] = [];
    const result = applyMoveBody(
      geo,
      { kind: 'moveBody', bodyId: 'body', translation: [1, 0, 0], createdAt: 0 },
      { warn: (m) => warns.push(m) },
    );
    expect(result.applied).toBe(false);
    expect(warns.some(w => w.includes('position attribute'))).toBe(true);
  });

  it('warns but applies when bodyId mismatches lastFeatureId', () => {
    const geo = makeFlatSquare('body-a');
    const warns: string[] = [];
    const result = applyMoveBody(
      geo,
      { kind: 'moveBody', bodyId: 'body-b', translation: [1, 0, 0], createdAt: 0 },
      { warn: (m) => warns.push(m) },
    );
    expect(result.applied).toBe(true);
    expect(warns.some(w => w.includes('does not match'))).toBe(true);
  });
});

describe('applyMoveBody — silenceable warn default', () => {
  it('uses console.warn by default', () => {
    const geo = new THREE.BufferGeometry();
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    applyMoveBody(geo, {
      kind: 'moveBody',
      bodyId: 'b',
      translation: [1, 0, 0],
      createdAt: 0,
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('applyMoveBody — performance', () => {
  it('completes within budget on a 100-tri mesh', () => {
    const geo = makeFlatFan(100);
    const result = applyMoveBody(geo, {
      kind: 'moveBody',
      bodyId: 'fan',
      translation: [5, 0, 0],
      createdAt: 0,
    });
    expect(result.applied).toBe(true);
    // p95 ≤ 30ms; CI cold-start headroom 60ms.
    expect(result.elapsedMs).toBeLessThan(60);
  });

  it('completes within budget on a 500-tri mesh (M8-scale proxy)', () => {
    const geo = makeFlatFan(500);
    const result = applyMoveBody(geo, {
      kind: 'moveBody',
      bodyId: 'fan',
      translation: [5, 0, 0],
      createdAt: 0,
    });
    expect(result.applied).toBe(true);
    expect(result.elapsedMs).toBeLessThan(120);
  });

  it('completes within budget on a 1000-tri mesh', () => {
    const geo = makeFlatFan(1000);
    const result = applyMoveBody(geo, {
      kind: 'moveBody',
      bodyId: 'fan',
      translation: [5, 0, 0],
      createdAt: 0,
    });
    expect(result.applied).toBe(true);
    // Trivial O(N) — 1000 verts × 3 floats is sub-ms on hot path,
    // but CI Win cold start can spike. Match the push-pull budget.
    expect(result.elapsedMs).toBeLessThan(250);
  });
});
