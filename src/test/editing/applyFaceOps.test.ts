/**
 * applyFaceOps unit tests — pin the contracts the FaceContextPanel relies on:
 *
 *  • offsetFace
 *    - non-mutating (input geometry unchanged)
 *    - moves the targeted face's vertices along the face normal
 *    - throws OFFSET_INVALID on non-finite delta
 *    - throws NO_GEOMETRY when the input has no position attribute
 *
 *  • shellWhole (pre-flight only — full OCCT path is exercised by
 *    pipeline.occt.test.ts. Here we only verify the typed error codes
 *    surface before the dynamic shellFeature import fires.)
 *    - throws THICKNESS_INVALID for thickness <= 0 or NaN
 *    - throws NO_GEOMETRY for non-indexed or tiny meshes
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { offsetFace, shellWhole } from '@/app/[lang]/shape-generator/editing/applyFaceOps';
import type { UniqueFace } from '@/app/[lang]/shape-generator/editing/useFaceEditing';

function cubeNonIndexed(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
}

function topFace(): UniqueFace {
  // BoxGeometry: each face is 2 triangles. Top (+Y) face is the third
  // pair in the position layout (px+,px-,py+,py-,pz+,pz-). Triangles 4,5
  // are the +Y face (each face has 2 tris, 4=2*2, 5=2*2+1).
  return {
    id: 0,
    triangleIndices: [4, 5],
    normal: [0, 1, 0],
    center: [0, 5, 0],
  };
}

describe('offsetFace', () => {
  it('does not mutate the input geometry', () => {
    const input = cubeNonIndexed();
    const inputPos = input.attributes.position as THREE.BufferAttribute;
    const snapshot = (inputPos.array as Float32Array).slice();
    offsetFace(input, topFace(), 3);
    expect(Array.from(inputPos.array as Float32Array)).toEqual(Array.from(snapshot));
  });

  it('returns a fresh geometry with the targeted face translated along its normal', () => {
    const input = cubeNonIndexed();
    const result = offsetFace(input, topFace(), 3);
    expect(result).not.toBe(input);
    // The +Y face vertices should have moved by +3 along Y; the rest should be
    // unchanged. We don't know the exact buffer indices the face owns without
    // re-running extractFaces, but the bounding box +Y bound must have shifted.
    input.computeBoundingBox();
    result.computeBoundingBox();
    expect(result.boundingBox!.max.y).toBeGreaterThan(input.boundingBox!.max.y);
  });

  it('throws OFFSET_INVALID on non-finite delta', () => {
    const input = cubeNonIndexed();
    expect(() => offsetFace(input, topFace(), NaN)).toThrow('OFFSET_INVALID');
    expect(() => offsetFace(input, topFace(), Infinity)).toThrow('OFFSET_INVALID');
  });

  it('throws NO_GEOMETRY when the geometry has no position attribute', () => {
    const empty = new THREE.BufferGeometry();
    expect(() => offsetFace(empty, topFace(), 1)).toThrow('NO_GEOMETRY');
  });
});

describe('shellWhole pre-flight', () => {
  it('throws THICKNESS_INVALID for thickness <= 0', async () => {
    const input = new THREE.BoxGeometry(10, 10, 10);
    await expect(shellWhole(input, 0)).rejects.toThrow('THICKNESS_INVALID');
    await expect(shellWhole(input, -1)).rejects.toThrow('THICKNESS_INVALID');
  });

  it('throws THICKNESS_INVALID for non-finite thickness', async () => {
    const input = new THREE.BoxGeometry(10, 10, 10);
    await expect(shellWhole(input, NaN)).rejects.toThrow('THICKNESS_INVALID');
  });

  it('welds non-indexed input instead of rejecting (imported STLs are non-indexed)', async () => {
    // Previously this threw NO_GEOMETRY, which made Shell silently fail on every
    // imported/edited mesh. Now we weld (mergeVertices) so the CSG path gets an
    // indexed mesh. We must NOT see the NO_GEOMETRY pre-flight rejection any more;
    // the shell op itself may still fail in the headless test env (no real CSG),
    // which is fine — we only assert the weld pre-flight passed.
    const input = new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
    let result: unknown;
    let error: Error | null = null;
    try { result = await shellWhole(input, 2); } catch (e) { error = e as Error; }
    if (error) expect(error.message).not.toContain('NO_GEOMETRY');
    else expect(result).toBeInstanceOf(THREE.BufferGeometry);
  });
});
