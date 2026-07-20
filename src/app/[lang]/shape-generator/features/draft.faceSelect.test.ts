/**
 * W5-C — face-selection draft (mesh path) measurement tests.
 *
 * Contract under test (draft.ts applyFaceDraftMesh):
 *  - ONLY vertices on the selected face's plane move; every other vertex is
 *    bit-identical (the old behaviour sheared the whole body — probe measured
 *    36/36 box vertices moving, bottom row by tan(5°)·10 = 0.874887).
 *  - Displacement about the bottom neutral plane: dx = (y − yMin)·tan(angle)
 *    along the horizontal face normal (verified to 1e-6 on float64 positions;
 *    float32 storage adds ≤ ~4e-6 rounding, asserted separately).
 *  - Bottom (neutral-plane) vertices of the selected face do not move.
 *  - Explicit refusals: horizontal face (DRAFT_FACE_HORIZONTAL) and an inward
 *    draft big enough to cross the body (DRAFT_SELF_INTERSECT).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { draftFeature } from './draft';
import type { FeatureApplyContext } from './types';

const TAN5 = Math.tan((5 * Math.PI) / 180);

function selCtx(
  normal: [number, number, number],
  position: [number, number, number],
): FeatureApplyContext {
  return {
    featureId: 'w5c-draft',
    faceSelections: [{
      type: 'face', normal, position, area: 2500, triangleCount: 2,
      normalLabel: '+X', triangleIndices: [],
    }],
  };
}

/** 50³ box centered at origin (y ∈ [−25, 25]), non-indexed like the modeler's mesh base. */
function box50(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(50, 50, 50).toNonIndexed();
}

/** Same box with float64 positions — isolates the algorithm from float32 storage rounding. */
function box50f64(): THREE.BufferGeometry {
  const g = box50();
  const p = g.getAttribute('position');
  g.setAttribute('position', new THREE.BufferAttribute(Float64Array.from(p.array as Float32Array), 3));
  return g;
}

describe('draft — face-selection (W5-C)', () => {
  it('float64: selected +X face displaces by exactly (y−yMin)·tan(5°), within 1e-6', () => {
    const g = box50f64();
    const before = Float64Array.from(g.getAttribute('position').array as Float64Array);
    const out = draftFeature.apply(g, { angle: 5, direction: 0 }, selCtx([1, 0, 0], [25, 0, 0]));
    const after = out.getAttribute('position').array as Float64Array;
    let onPlane = 0;
    for (let i = 0; i < before.length; i += 3) {
      if (Math.abs(before[i] - 25) > 1e-9) continue; // not on the selected plane
      onPlane++;
      const expected = (before[i + 1] + 25) * TAN5; // (y − yMin)·tan5, outward (+x)
      expect(Math.abs((after[i] - before[i]) - expected)).toBeLessThanOrEqual(1e-6);
      // z must not change for an +X-normal face (tilt direction is +x only)
      expect(after[i + 2]).toBe(before[i + 2]);
    }
    expect(onPlane).toBeGreaterThan(0);
  });

  it('float64: every vertex NOT on the selected plane is bit-identical', () => {
    const g = box50f64();
    const before = Float64Array.from(g.getAttribute('position').array as Float64Array);
    const out = draftFeature.apply(g, { angle: 5, direction: 0 }, selCtx([1, 0, 0], [25, 0, 0]));
    const after = out.getAttribute('position').array as Float64Array;
    let offPlane = 0;
    for (let i = 0; i < before.length; i += 3) {
      if (Math.abs(before[i] - 25) <= 1e-9) continue;
      offPlane++;
      expect(after[i]).toBe(before[i]);
      expect(after[i + 1]).toBe(before[i + 1]);
      expect(after[i + 2]).toBe(before[i + 2]);
    }
    expect(offPlane).toBeGreaterThan(0);
  });

  it('float32 storage: same law within 5e-6 (float32 write-back rounding), off-plane exactly 0', () => {
    const g = box50();
    const before = (g.getAttribute('position').array as Float32Array).slice();
    const out = draftFeature.apply(g, { angle: 5, direction: 0 }, selCtx([1, 0, 0], [25, 0, 0]));
    const after = out.getAttribute('position').array as Float32Array;
    for (let i = 0; i < before.length; i += 3) {
      const dx = after[i] - before[i];
      if (Math.abs(before[i] - 25) < 1e-6) {
        expect(Math.abs(dx - (before[i + 1] + 25) * TAN5)).toBeLessThanOrEqual(5e-6);
      } else {
        expect(dx).toBe(0);
        expect(after[i + 2] - before[i + 2]).toBe(0);
      }
    }
  });

  it('neutral-plane (bottom) vertices of the selected face do not move', () => {
    const g = box50();
    const before = (g.getAttribute('position').array as Float32Array).slice();
    const out = draftFeature.apply(g, { angle: 5, direction: 0 }, selCtx([1, 0, 0], [25, 0, 0]));
    const after = out.getAttribute('position').array as Float32Array;
    let bottomOnFace = 0;
    for (let i = 0; i < before.length; i += 3) {
      if (Math.abs(before[i] - 25) < 1e-6 && Math.abs(before[i + 1] + 25) < 1e-6) {
        bottomOnFace++;
        expect(after[i]).toBe(before[i]);
        expect(after[i + 2]).toBe(before[i + 2]);
      }
    }
    expect(bottomOnFace).toBeGreaterThan(0);
  });

  it('direction 1 tilts inward (negative dx on a +X face)', () => {
    const g = box50();
    const before = (g.getAttribute('position').array as Float32Array).slice();
    const out = draftFeature.apply(g, { angle: 5, direction: 1 }, selCtx([1, 0, 0], [25, 0, 0]));
    const after = out.getAttribute('position').array as Float32Array;
    for (let i = 0; i < before.length; i += 3) {
      if (Math.abs(before[i] - 25) < 1e-6 && before[i + 1] > 0) {
        expect(after[i]).toBeLessThan(before[i]);
      }
    }
  });

  it('adjacency stays stitched: shared-position vertices on the selected plane move identically', () => {
    const g = box50();
    const out = draftFeature.apply(g, { angle: 5, direction: 0 }, selCtx([1, 0, 0], [25, 0, 0]));
    const after = out.getAttribute('position').array as Float32Array;
    // group post-draft positions by their PRE-draft position key; all copies must agree
    const before = (new THREE.BoxGeometry(50, 50, 50).toNonIndexed().getAttribute('position').array as Float32Array);
    const seen = new Map<string, [number, number, number]>();
    for (let i = 0; i < before.length; i += 3) {
      const key = `${before[i]},${before[i + 1]},${before[i + 2]}`;
      const cur: [number, number, number] = [after[i], after[i + 1], after[i + 2]];
      const prev = seen.get(key);
      if (prev) {
        expect(cur[0]).toBe(prev[0]);
        expect(cur[1]).toBe(prev[1]);
        expect(cur[2]).toBe(prev[2]);
      } else {
        seen.set(key, cur);
      }
    }
  });

  it('REFUSES a horizontal (top) face: cannot draft about the bottom', () => {
    const g = box50();
    expect(() =>
      draftFeature.apply(g, { angle: 5, direction: 0 }, selCtx([0, 1, 0], [0, 25, 0])),
    ).toThrow(/DRAFT_FACE_HORIZONTAL/);
  });

  it('REFUSES a self-intersecting inward draft (60° over a 50-cube crosses the body)', () => {
    const g = box50();
    expect(() =>
      draftFeature.apply(g, { angle: 60, direction: 1 }, selCtx([1, 0, 0], [25, 0, 0])),
    ).toThrow(/DRAFT_SELF_INTERSECT/);
  });

  it('applyAsync honours the face selection on the mesh fallback (no OCCT in tests)', async () => {
    const g = box50();
    const before = (g.getAttribute('position').array as Float32Array).slice();
    const out = await draftFeature.applyAsync!(g, { angle: 5, direction: 0 }, selCtx([1, 0, 0], [25, 0, 0]));
    const after = out.getAttribute('position').array as Float32Array;
    for (let i = 0; i < before.length; i += 3) {
      if (Math.abs(before[i] - 25) >= 1e-6) expect(after[i]).toBe(before[i]);
    }
    expect(out.userData?.occtHandle).toBeUndefined();
  });

  it('no-selection path keeps the legacy whole-body taper (pinned by draft.test.ts)', () => {
    const g = box50();
    const before = (g.getAttribute('position').array as Float32Array).slice();
    const out = draftFeature.apply(g, { angle: 5, direction: 0 });
    const after = out.getAttribute('position').array as Float32Array;
    let moved = 0;
    for (let i = 0; i < before.length; i += 3) {
      if (Math.abs(after[i] - before[i]) > 1e-9) moved++;
    }
    expect(moved).toBeGreaterThan(30); // global shear still moves (nearly) all vertices
  });
});
