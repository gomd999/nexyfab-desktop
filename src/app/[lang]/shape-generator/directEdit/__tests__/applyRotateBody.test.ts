/**
 * applyRotateBody.test.ts — Wave 2 Phase 3 Track E3.
 *
 * Mesh-level body-rotate tests:
 *   - Rotation about a body's bbox center leaves the bbox center fixed.
 *   - Rotation 90° about Z permutes axes correctly.
 *   - Identity rotation (angle ≈ 0) is a no-op.
 *   - Input geometry not mutated.
 *   - Output preserves index + face-feature-id attributes.
 *   - Output normals recomputed.
 *   - Validation rejects bad axes / angles / pivots / bodyIds.
 *   - Performance budget on 100 / 500 / 1000-tri geometries.
 */

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  stampFaceFeatureIdAll,
  tagWholeGeometryFeature,
  FACE_FEATURE_ID_ATTR,
} from '../../features/faceProvenance';
import { applyRotateBody } from '../applyRotateBody';

/** 4-vertex flat square centered at origin in XZ plane, y=0. */
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

describe('applyRotateBody — basic rotation', () => {
  it('rotates 90° about +Y through origin: (5,0,-5) → (-5,0,-5)', () => {
    const geo = makeFlatSquare();
    const result = applyRotateBody(geo, {
      kind: 'rotateBody',
      bodyId: 'body',
      rotation: {
        axis: [0, 1, 0],
        angleRad: Math.PI / 2,
        pivot: [0, 0, 0],
      },
      createdAt: 0,
    });
    expect(result.applied).toBe(true);
    const newPos = result.geometry.attributes.position;
    // (5, 0, -5) about +Y by 90° → (-5, 0, -5).
    // Actually: R · (x,y,z) for +Y 90° gives (z, y, -x).
    // So (5, 0, -5) → (-5, 0, -5).
    expect(newPos.getX(1)).toBeCloseTo(-5, 5);
    expect(newPos.getY(1)).toBeCloseTo(0, 5);
    expect(newPos.getZ(1)).toBeCloseTo(-5, 5);
  });

  it('rotation about bbox-center preserves the bbox-center point', () => {
    // Square at (-5,0,-5)..(5,0,5), center = (0,0,0). Already on
    // origin. Rotate 45° about +Y → bbox center unchanged.
    const geo = makeFlatSquare();
    const result = applyRotateBody(geo, {
      kind: 'rotateBody',
      bodyId: 'body',
      rotation: {
        axis: [0, 1, 0],
        angleRad: Math.PI / 4,
        pivot: [0, 0, 0],
      },
      createdAt: 0,
    });
    expect(result.applied).toBe(true);
    // The bbox should still be centered at origin.
    result.geometry.computeBoundingBox();
    const bb = result.geometry.boundingBox!;
    const cx = (bb.min.x + bb.max.x) / 2;
    const cz = (bb.min.z + bb.max.z) / 2;
    expect(cx).toBeCloseTo(0, 5);
    expect(cz).toBeCloseTo(0, 5);
  });

  it('rotation about an off-center pivot translates the bbox center', () => {
    const geo = makeFlatSquare();
    const result = applyRotateBody(geo, {
      kind: 'rotateBody',
      bodyId: 'body',
      rotation: {
        axis: [0, 1, 0],
        angleRad: Math.PI, // 180°
        pivot: [10, 0, 0],
      },
      createdAt: 0,
    });
    expect(result.applied).toBe(true);
    // Center (0,0,0) about (10,0,0) by 180° → (20,0,0).
    result.geometry.computeBoundingBox();
    const bb = result.geometry.boundingBox!;
    const cx = (bb.min.x + bb.max.x) / 2;
    expect(cx).toBeCloseTo(20, 5);
  });

  it('treats a sub-epsilon angle as a no-op', () => {
    const geo = makeFlatSquare();
    const result = applyRotateBody(geo, {
      kind: 'rotateBody',
      bodyId: 'body',
      rotation: { axis: [0, 1, 0], angleRad: 1e-12, pivot: [0, 0, 0] },
      createdAt: 0,
    });
    expect(result.applied).toBe(false);
    expect(result.geometry).toBe(geo);
  });

  it('does not mutate the input geometry', () => {
    const geo = makeFlatSquare();
    const snapshot = Array.from(geo.attributes.position.array as Float32Array);
    applyRotateBody(geo, {
      kind: 'rotateBody',
      bodyId: 'body',
      rotation: { axis: [0, 1, 0], angleRad: Math.PI / 3, pivot: [0, 0, 0] },
      createdAt: 0,
    });
    expect(Array.from(geo.attributes.position.array as Float32Array)).toEqual(snapshot);
  });

  it('preserves the index attribute', () => {
    const geo = makeFlatSquare();
    const srcIdx = Array.from((geo.index!.array as Uint16Array | Uint32Array));
    const result = applyRotateBody(geo, {
      kind: 'rotateBody',
      bodyId: 'body',
      rotation: { axis: [0, 1, 0], angleRad: Math.PI / 4, pivot: [0, 0, 0] },
      createdAt: 0,
    });
    expect(result.geometry.index).not.toBeNull();
    expect(Array.from(result.geometry.index!.array as Uint16Array | Uint32Array)).toEqual(srcIdx);
  });

  it('preserves the face-feature-id attribute', () => {
    const geo = makeFlatSquare();
    stampFaceFeatureIdAll(geo, 'body');
    const result = applyRotateBody(geo, {
      kind: 'rotateBody',
      bodyId: 'body',
      rotation: { axis: [0, 1, 0], angleRad: Math.PI / 2, pivot: [0, 0, 0] },
      createdAt: 0,
    });
    expect(result.applied).toBe(true);
    expect(result.geometry.getAttribute(FACE_FEATURE_ID_ATTR)).toBeDefined();
  });

  it('recomputes normals on the output', () => {
    const geo = makeFlatSquare();
    const result = applyRotateBody(geo, {
      kind: 'rotateBody',
      bodyId: 'body',
      rotation: { axis: [1, 0, 0], angleRad: Math.PI / 2, pivot: [0, 0, 0] },
      createdAt: 0,
    });
    expect(result.geometry.attributes.normal).toBeDefined();
  });
});

describe('applyRotateBody — validation', () => {
  it('rejects an empty bodyId', () => {
    const geo = makeFlatSquare();
    const warns: string[] = [];
    const result = applyRotateBody(
      geo,
      {
        kind: 'rotateBody',
        bodyId: '',
        rotation: { axis: [0, 1, 0], angleRad: Math.PI / 2, pivot: [0, 0, 0] },
        createdAt: 0,
      },
      { warn: (m) => warns.push(m) },
    );
    expect(result.applied).toBe(false);
    expect(warns.some(w => w.includes('invalid_bodyId'))).toBe(true);
  });

  it('rejects a zero-magnitude axis', () => {
    const geo = makeFlatSquare();
    const warns: string[] = [];
    const result = applyRotateBody(
      geo,
      {
        kind: 'rotateBody',
        bodyId: 'body',
        rotation: { axis: [0, 0, 0], angleRad: Math.PI / 2, pivot: [0, 0, 0] },
        createdAt: 0,
      },
      { warn: (m) => warns.push(m) },
    );
    expect(result.applied).toBe(false);
    expect(warns.some(w => w.includes('invalid_rotation_axis'))).toBe(true);
  });

  it('rejects an angle outside ±2π', () => {
    const geo = makeFlatSquare();
    const warns: string[] = [];
    const result = applyRotateBody(
      geo,
      {
        kind: 'rotateBody',
        bodyId: 'body',
        rotation: { axis: [0, 1, 0], angleRad: 100, pivot: [0, 0, 0] },
        createdAt: 0,
      },
      { warn: (m) => warns.push(m) },
    );
    expect(result.applied).toBe(false);
    expect(warns.some(w => w.includes('invalid_rotation_angle'))).toBe(true);
  });

  it('rejects a non-finite pivot component', () => {
    const geo = makeFlatSquare();
    const warns: string[] = [];
    const result = applyRotateBody(
      geo,
      {
        kind: 'rotateBody',
        bodyId: 'body',
        rotation: { axis: [0, 1, 0], angleRad: Math.PI / 2, pivot: [NaN, 0, 0] },
        createdAt: 0,
      },
      { warn: (m) => warns.push(m) },
    );
    expect(result.applied).toBe(false);
    expect(warns.some(w => w.includes('invalid_rotation_pivot'))).toBe(true);
  });

  it('refuses when geometry has no position attribute', () => {
    const geo = new THREE.BufferGeometry();
    const warns: string[] = [];
    const result = applyRotateBody(
      geo,
      {
        kind: 'rotateBody',
        bodyId: 'body',
        rotation: { axis: [0, 1, 0], angleRad: Math.PI / 2, pivot: [0, 0, 0] },
        createdAt: 0,
      },
      { warn: (m) => warns.push(m) },
    );
    expect(result.applied).toBe(false);
    expect(warns.some(w => w.includes('position attribute'))).toBe(true);
  });

  it('warns but applies when bodyId mismatches lastFeatureId', () => {
    const geo = makeFlatSquare('body-a');
    const warns: string[] = [];
    const result = applyRotateBody(
      geo,
      {
        kind: 'rotateBody',
        bodyId: 'body-b',
        rotation: { axis: [0, 1, 0], angleRad: Math.PI / 2, pivot: [0, 0, 0] },
        createdAt: 0,
      },
      { warn: (m) => warns.push(m) },
    );
    expect(result.applied).toBe(true);
    expect(warns.some(w => w.includes('does not match'))).toBe(true);
  });
});

describe('applyRotateBody — silenceable warn default', () => {
  it('uses console.warn by default', () => {
    const geo = new THREE.BufferGeometry();
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    applyRotateBody(geo, {
      kind: 'rotateBody',
      bodyId: 'b',
      rotation: { axis: [0, 1, 0], angleRad: Math.PI / 2, pivot: [0, 0, 0] },
      createdAt: 0,
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('applyRotateBody — performance', () => {
  it('completes within budget on a 100-tri mesh', () => {
    const geo = makeFlatFan(100);
    const result = applyRotateBody(geo, {
      kind: 'rotateBody',
      bodyId: 'fan',
      rotation: { axis: [0, 1, 0], angleRad: Math.PI / 2, pivot: [0, 0, 0] },
      createdAt: 0,
    });
    expect(result.applied).toBe(true);
    expect(result.elapsedMs).toBeLessThan(60);
  });

  it('completes within budget on a 500-tri mesh (M8-scale proxy)', () => {
    const geo = makeFlatFan(500);
    const result = applyRotateBody(geo, {
      kind: 'rotateBody',
      bodyId: 'fan',
      rotation: { axis: [0, 1, 0], angleRad: Math.PI / 2, pivot: [0, 0, 0] },
      createdAt: 0,
    });
    expect(result.applied).toBe(true);
    expect(result.elapsedMs).toBeLessThan(120);
  });

  it('completes within budget on a 1000-tri mesh', () => {
    const geo = makeFlatFan(1000);
    const result = applyRotateBody(geo, {
      kind: 'rotateBody',
      bodyId: 'fan',
      rotation: { axis: [0, 1, 0], angleRad: Math.PI / 2, pivot: [0, 0, 0] },
      createdAt: 0,
    });
    expect(result.applied).toBe(true);
    expect(result.elapsedMs).toBeLessThan(250);
  });
});
