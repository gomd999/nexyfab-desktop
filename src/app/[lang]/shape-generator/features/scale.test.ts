/**
 * scale feature — sync mesh path + OCCT-aware applyAsync wiring.
 *
 * The OCCT B-rep path (occtScale → replicad uniform scale) needs replicad WASM,
 * verified behind RUN_OCCT_FEASIBILITY in __tests__/occtEngine.extrude.test.ts.
 * Here we pin the mesh behaviour and the wiring: a scale in the middle of an
 * OCCT chain must stay B-rep when uniform, and fall back to mesh otherwise
 * (non-uniform, no upstream handle, OCCT not ready) rather than crash.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { scaleFeature } from './scale';

function box(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(20, 20, 20).toNonIndexed();
}

describe('scaleFeature', () => {
  it('exposes a sync apply and an async applyAsync', () => {
    expect(typeof scaleFeature.apply).toBe('function');
    expect(typeof scaleFeature.applyAsync).toBe('function');
  });

  it('apply() scales the mesh (doubling X doubles the X span)', () => {
    const out = scaleFeature.apply(box(), { scaleX: 2, scaleY: 1, scaleZ: 1 });
    out.computeBoundingBox();
    const b = out.boundingBox!;
    expect(b.max.x - b.min.x).toBeGreaterThan(39); // 20 → 40
    expect(b.max.y - b.min.y).toBeLessThan(21);     // unchanged
  });

  it('applyAsync() falls back to the mesh path when OCCT is not ready', async () => {
    const out = await scaleFeature.applyAsync!(box(), { scaleX: 2, scaleY: 2, scaleZ: 2 });
    out.computeBoundingBox();
    const b = out.boundingBox!;
    expect(b.max.x - b.min.x).toBeGreaterThan(39); // uniform 2× → 40
  });

  it('applyAsync() falls back to mesh when there is no upstream OCCT handle', async () => {
    const g = box();
    expect(g.userData.occtHandle).toBeUndefined();
    const out = await scaleFeature.applyAsync!(g, { scaleX: 1.5, scaleY: 1.5, scaleZ: 1.5 });
    expect(out.attributes.position.count).toBeGreaterThan(0);
  });
});
