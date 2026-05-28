/**
 * bodyTransformMath.test.ts — Wave 2 Phase 3 Track E3.
 *
 * Pure math tests for the body-move + body-rotate helpers. No
 * THREE.js. Mirror the pushPullMath suite's structure — known
 * geometry inputs + expected outputs, no fuzzing.
 */

import { describe, it, expect } from 'vitest';
import {
  applyTranslationToPoint,
  applyRotationToPoint,
  applyMatrix4ToPoint,
  buildRotationMatrix3,
  composeTransforms,
  bboxAfterTranslation,
  bboxAfterRotation,
  snapTranslationToGrid,
  snapAngleToStep,
  MOVE_BODY_EPSILON_MM,
  ROTATE_BODY_EPSILON_RAD,
  BODY_TRANSLATION_SNAP_MM,
  BODY_ROTATION_SNAP_RAD,
} from '../bodyTransformMath';

describe('applyTranslationToPoint', () => {
  it('returns the input unchanged for a zero translation', () => {
    expect(applyTranslationToPoint([1, 2, 3], [0, 0, 0])).toEqual([1, 2, 3]);
  });

  it('translates along +X', () => {
    expect(applyTranslationToPoint([0, 0, 0], [5, 0, 0])).toEqual([5, 0, 0]);
  });

  it('translates along an arbitrary direction', () => {
    expect(applyTranslationToPoint([1, 2, 3], [-1, 4, 7])).toEqual([0, 6, 10]);
  });
});

describe('buildRotationMatrix3', () => {
  it('returns identity for a zero angle', () => {
    const R = buildRotationMatrix3([0, 1, 0], 0);
    expect(R).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('returns identity for a sub-epsilon angle', () => {
    const R = buildRotationMatrix3([0, 1, 0], ROTATE_BODY_EPSILON_RAD / 10);
    expect(R).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('returns identity for a degenerate (zero-magnitude) axis', () => {
    const R = buildRotationMatrix3([0, 0, 0], Math.PI / 2);
    expect(R).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('rotates 90° about +Z: (1,0,0) → (0,1,0)', () => {
    const R = buildRotationMatrix3([0, 0, 1], Math.PI / 2);
    const out = applyRotationToPoint([1, 0, 0], R);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeCloseTo(1, 6);
    expect(out[2]).toBeCloseTo(0, 6);
  });

  it('rotates 90° about +Y: (1,0,0) → (0,0,-1)', () => {
    const R = buildRotationMatrix3([0, 1, 0], Math.PI / 2);
    const out = applyRotationToPoint([1, 0, 0], R);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeCloseTo(0, 6);
    expect(out[2]).toBeCloseTo(-1, 6);
  });

  it('rotates 180° about +X: (0,1,0) → (0,-1,0)', () => {
    const R = buildRotationMatrix3([1, 0, 0], Math.PI);
    const out = applyRotationToPoint([0, 1, 0], R);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeCloseTo(-1, 6);
    expect(out[2]).toBeCloseTo(0, 6);
  });

  it('normalises the axis (non-unit input produces same result)', () => {
    const R1 = buildRotationMatrix3([0, 0, 1], Math.PI / 2);
    const R2 = buildRotationMatrix3([0, 0, 5], Math.PI / 2);
    for (let i = 0; i < 9; i++) expect(R1[i]).toBeCloseTo(R2[i]!, 6);
  });

  it('is its own inverse for ±θ (R(θ) · R(-θ) = I) on a sample vector', () => {
    const R = buildRotationMatrix3([0, 1, 0], Math.PI / 4);
    const Rinv = buildRotationMatrix3([0, 1, 0], -Math.PI / 4);
    const v: [number, number, number] = [3, 2, 1];
    const out = applyRotationToPoint(applyRotationToPoint(v, R), Rinv);
    expect(out[0]).toBeCloseTo(3, 6);
    expect(out[1]).toBeCloseTo(2, 6);
    expect(out[2]).toBeCloseTo(1, 6);
  });
});

describe('applyRotationToPoint with pivot', () => {
  it('rotates 90° about Z through pivot (5,5,0): (10,5,0) → (5,10,0)', () => {
    const R = buildRotationMatrix3([0, 0, 1], Math.PI / 2);
    const out = applyRotationToPoint([10, 5, 0], R, [5, 5, 0]);
    expect(out[0]).toBeCloseTo(5, 6);
    expect(out[1]).toBeCloseTo(10, 6);
    expect(out[2]).toBeCloseTo(0, 6);
  });

  it('leaves the pivot point itself unchanged', () => {
    const R = buildRotationMatrix3([0, 0, 1], Math.PI / 2);
    const pivot: [number, number, number] = [7, 11, 13];
    const out = applyRotationToPoint(pivot, R, pivot);
    expect(out[0]).toBeCloseTo(7, 6);
    expect(out[1]).toBeCloseTo(11, 6);
    expect(out[2]).toBeCloseTo(13, 6);
  });

  it('cube-corner rotation about cube-center (8 corner cube test)', () => {
    // Unit cube centered at (0.5, 0.5, 0.5). 90° about Z permutes
    // corners (0,0,*) → (1,0,*) → (1,1,*) → (0,1,*).
    const R = buildRotationMatrix3([0, 0, 1], Math.PI / 2);
    const pivot: [number, number, number] = [0.5, 0.5, 0];
    const c0 = applyRotationToPoint([0, 0, 0], R, pivot);
    expect(c0[0]).toBeCloseTo(1, 6);
    expect(c0[1]).toBeCloseTo(0, 6);
    const c1 = applyRotationToPoint([1, 0, 0], R, pivot);
    expect(c1[0]).toBeCloseTo(1, 6);
    expect(c1[1]).toBeCloseTo(1, 6);
  });
});

describe('composeTransforms', () => {
  it('returns identity when both args are null', () => {
    const M = composeTransforms(null, null);
    const out = applyMatrix4ToPoint([2, 3, 4], M);
    expect(out).toEqual([2, 3, 4]);
  });

  it('translates when only translation is given', () => {
    const M = composeTransforms([1, 2, 3], null);
    const out = applyMatrix4ToPoint([0, 0, 0], M);
    expect(out).toEqual([1, 2, 3]);
  });

  it('rotates about a pivot when only rotation is given', () => {
    const M = composeTransforms(null, {
      axis: [0, 0, 1],
      angleRad: Math.PI / 2,
      pivot: [0, 0, 0],
    });
    const out = applyMatrix4ToPoint([1, 0, 0], M);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeCloseTo(1, 6);
  });

  it('rotates then translates (order: pre-rot, post-translate)', () => {
    const M = composeTransforms([10, 0, 0], {
      axis: [0, 0, 1],
      angleRad: Math.PI / 2,
      pivot: [0, 0, 0],
    });
    // (1,0,0) → rotate → (0,1,0) → translate → (10,1,0)
    const out = applyMatrix4ToPoint([1, 0, 0], M);
    expect(out[0]).toBeCloseTo(10, 6);
    expect(out[1]).toBeCloseTo(1, 6);
  });

  it('respects a non-origin pivot', () => {
    const M = composeTransforms(null, {
      axis: [0, 0, 1],
      angleRad: Math.PI,
      pivot: [5, 0, 0],
    });
    const out = applyMatrix4ToPoint([10, 0, 0], M);
    // (10,0,0) about (5,0,0) by π → (0,0,0)
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeCloseTo(0, 6);
  });
});

describe('snapTranslationToGrid', () => {
  it('passes through when gridSize ≤ 0', () => {
    expect(snapTranslationToGrid([1.7, 2.3, 3.9], 0)).toEqual([1.7, 2.3, 3.9]);
    expect(snapTranslationToGrid([1.7, 2.3, 3.9], -1)).toEqual([1.7, 2.3, 3.9]);
  });

  it('snaps each axis independently to 1mm', () => {
    const snapped = snapTranslationToGrid([1.7, 2.3, 3.6], 1);
    expect(snapped[0]).toBe(2);
    expect(snapped[1]).toBe(2);
    expect(snapped[2]).toBe(4);
  });

  it('snaps negative values symmetrically', () => {
    const snapped = snapTranslationToGrid([-1.7, -2.3, -3.6], 1);
    expect(snapped[0]).toBe(-2);
    expect(snapped[1]).toBe(-2);
    expect(snapped[2]).toBe(-4);
  });

  it('uses the BODY_TRANSLATION_SNAP_MM default convention', () => {
    expect(BODY_TRANSLATION_SNAP_MM).toBe(1);
  });
});

describe('snapAngleToStep', () => {
  it('passes through when stepRad ≤ 0', () => {
    expect(snapAngleToStep(1.234, 0)).toBe(1.234);
    expect(snapAngleToStep(1.234, -0.1)).toBe(1.234);
  });

  it('snaps to 15° increments (default body-rotation snap)', () => {
    const step = BODY_ROTATION_SNAP_RAD;
    // 20° → 15° (snap-down)
    const snapped = snapAngleToStep((20 * Math.PI) / 180, step);
    expect(snapped).toBeCloseTo(step, 6);
    // 23° → 30° (snap-up)
    const snapped2 = snapAngleToStep((23 * Math.PI) / 180, step);
    expect(snapped2).toBeCloseTo(step * 2, 6);
  });

  it('passes Infinity through unchanged', () => {
    expect(snapAngleToStep(Infinity, BODY_ROTATION_SNAP_RAD)).toBe(Infinity);
  });
});

describe('bboxAfterTranslation', () => {
  it('returns null on empty input', () => {
    expect(bboxAfterTranslation(new Float32Array([]), [1, 2, 3])).toBeNull();
  });

  it('shifts the bounding box of a unit cube by the translation', () => {
    const positions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0, 1, 0,
      0, 0, 1,
      1, 0, 1,
      1, 1, 1,
      0, 1, 1,
    ]);
    const bb = bboxAfterTranslation(positions, [10, 20, 30]);
    expect(bb).not.toBeNull();
    expect(bb!.min).toEqual([10, 20, 30]);
    expect(bb!.max).toEqual([11, 21, 31]);
  });
});

describe('bboxAfterRotation', () => {
  it('returns null on empty input', () => {
    expect(
      bboxAfterRotation(new Float32Array([]), {
        axis: [0, 0, 1],
        angleRad: Math.PI / 2,
        pivot: [0, 0, 0],
      }),
    ).toBeNull();
  });

  it('rotates a unit cube 90° about Z through origin', () => {
    // Cube corners (0,0,0) .. (1,1,1). 90° about Z maps (x,y,z) → (-y, x, z).
    const positions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0, 1, 0,
    ]);
    const bb = bboxAfterRotation(positions, {
      axis: [0, 0, 1],
      angleRad: Math.PI / 2,
      pivot: [0, 0, 0],
    });
    expect(bb).not.toBeNull();
    expect(bb!.min[0]).toBeCloseTo(-1, 5);
    expect(bb!.min[1]).toBeCloseTo(0, 5);
    expect(bb!.max[0]).toBeCloseTo(0, 5);
    expect(bb!.max[1]).toBeCloseTo(1, 5);
  });
});

describe('constants', () => {
  it('exposes a finite move epsilon', () => {
    expect(MOVE_BODY_EPSILON_MM).toBeGreaterThan(0);
    expect(MOVE_BODY_EPSILON_MM).toBeLessThan(0.001);
  });

  it('exposes a finite rotate epsilon', () => {
    expect(ROTATE_BODY_EPSILON_RAD).toBeGreaterThan(0);
    expect(ROTATE_BODY_EPSILON_RAD).toBeLessThan(0.001);
  });

  it('exposes a sensible default rotation snap (15°)', () => {
    expect(BODY_ROTATION_SNAP_RAD).toBeCloseTo((15 * Math.PI) / 180, 9);
  });
});
