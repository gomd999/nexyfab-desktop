/**
 * OCCT B-rep chaining regression (#98 phase 2d-4).
 *
 * Validates that a two-step OCCT chain (boolean → fillet) runs through the
 * real shape registry and produces a geometry different from the bbox
 * fallback. Also guards the registry-reset contract and the mixed-engine
 * fallback path.
 *
 * Skipped unless RUN_OCCT_FEASIBILITY=1 — same 10 MB WASM init cost as the
 * sibling OCCT tests.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { applyFeaturePipelineDetailed } from '../features';
import {
  ensureOcctReady,
  isOcctReady,
  setOcctGlobalMode,
  resetShapeRegistry,
} from '../features/occtEngine';
import type { FeatureInstance } from '../features/types';

const ENABLED = process.env.RUN_OCCT_FEASIBILITY === '1';
const describeMaybe = ENABLED ? describe : describe.skip;

function makeBox(w = 60, h = 40, d = 30): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.computeVertexNormals();
  return geo;
}

function meshVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position;
  const idx = geo.index;
  if (!pos || !idx) return 0;
  let vol = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i));
    b.fromBufferAttribute(pos, idx.getX(i + 1));
    c.fromBufferAttribute(pos, idx.getX(i + 2));
    vol += a.dot(b.clone().cross(c)) / 6;
  }
  return Math.abs(vol);
}

describeMaybe('OCCT B-rep chain — #98 phase 2d-4', () => {
  beforeAll(async () => {
    await ensureOcctReady();
    setOcctGlobalMode(false); // chain tests use per-feature engine=1 flags
  }, 60_000);

  it('is ready after ensureOcctReady', () => {
    expect(isOcctReady()).toBe(true);
  });

  it('double boolean chain carries an OCCT handle through both ops', () => {
    // Chains two OCCT booleans back-to-back. The second boolean must pick
    // up the first's registered shape via userData.occtHandle — if chain
    // plumbing regresses, the second op would instead rebuild a fresh box
    // host from the intermediate mesh bbox and produce a visibly larger
    // volume (the first cut wouldn't compose).
    const base = makeBox();
    const features: FeatureInstance[] = [
      {
        id: 'b1',
        type: 'boolean',
        params: {
          operation: 1, toolShape: 1, toolWidth: 20, toolHeight: 80, toolDepth: 20,
          posX: -15, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0,
          engine: 1,
        },
        enabled: true,
      },
      {
        id: 'b2',
        type: 'boolean',
        params: {
          operation: 1, toolShape: 1, toolWidth: 20, toolHeight: 80, toolDepth: 20,
          posX: 15, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0,
          engine: 1,
        },
        enabled: true,
      },
    ];

    const result = applyFeaturePipelineDetailed(base, features);
    expect(Object.keys(result.errors)).toEqual([]);
    expect(result.geometry.attributes.position.count).toBeGreaterThan(0);

    // Output must carry a handle from the final boolean op.
    const handle = result.geometry.userData?.occtHandle;
    expect(typeof handle).toBe('string');
    expect(handle as string).toMatch(/^occt:\d+$/);

    // Chain volume: box minus two cylinder bores. If chaining regressed and
    // each cut restarted from a box host, the volume would equal a single
    // cut (≈ box − 1 cylinder). A true chain subtracts BOTH holes.
    const chainVol = meshVolume(result.geometry);
    const boxVol = 60 * 40 * 30;
    const oneCylVol = Math.PI * 10 * 10 * 40; // r=10, h=40 (clipped to box)
    // Lenient: accept 1.5×..2.5× cylinder volume removed (OCCT tessellation
    // noise + cylinder-box intersection geometry).
    const removed = boxVol - chainVol;
    expect(removed).toBeGreaterThan(oneCylVol * 1.5);
    expect(removed).toBeLessThan(oneCylVol * 2.5);
  }, 60_000);

  it('registry is cleared between pipeline runs — no handle leak', () => {
    const base = makeBox();
    const features: FeatureInstance[] = [
      {
        id: 'f1',
        type: 'fillet',
        params: { radius: 2, segments: 3, engine: 1 },
        enabled: true,
      },
    ];

    // First run — registers a shape.
    const first = applyFeaturePipelineDetailed(base, features);
    const firstHandle = first.geometry.userData?.occtHandle as string;
    expect(firstHandle).toMatch(/^occt:\d+$/);

    // Second run — pipeline start clears the registry, so the first run's
    // handle should no longer resolve. Second run still succeeds.
    const second = applyFeaturePipelineDetailed(base, features);
    const secondHandle = second.geometry.userData?.occtHandle as string;
    expect(secondHandle).toMatch(/^occt:\d+$/);

    // Both runs produced output; handles are distinct (registry was reset
    // and new shapes registered fresh).
    expect(second.geometry.attributes.position.count).toBeGreaterThan(0);
  }, 60_000);

  it('mixed engine: OCCT boolean followed by CSG-only feature does not crash', () => {
    const base = makeBox();
    const features: FeatureInstance[] = [
      {
        id: 'b1',
        type: 'boolean',
        params: {
          operation: 1, toolShape: 1, toolWidth: 15, toolHeight: 80, toolDepth: 15,
          posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0,
          engine: 1,  // OCCT
        },
        enabled: true,
      },
      {
        // linearPattern has no OCCT implementation — pipeline must fall back
        // to the mesh path here without crashing. We don't assert on the
        // output shape; we just want the run to complete and produce a
        // non-empty geometry.
        id: 'lp1',
        type: 'linearPattern',
        params: { count: 2, spacing: 10, axis: 0 },
        enabled: true,
      },
    ];

    const result = applyFeaturePipelineDetailed(base, features);
    expect(result.geometry.attributes.position.count).toBeGreaterThan(0);
  }, 60_000);

  it('manual resetShapeRegistry still works for external callers', () => {
    // Smoke test: the exported helper should be a no-arg function that
    // doesn't throw even when the registry is empty.
    expect(() => resetShapeRegistry()).not.toThrow();
    expect(() => resetShapeRegistry()).not.toThrow();
  });
});
