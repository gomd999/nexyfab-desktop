/**
 * moveCopy feature — sync mesh path + OCCT-aware applyAsync wiring.
 *
 * The OCCT B-rep path (occtMoveCopy → replicad translate / fuse) needs replicad
 * WASM, verified behind RUN_OCCT_FEASIBILITY in
 * __tests__/occtEngine.extrude.test.ts. Here we pin the mesh behaviour and the
 * wiring: a move/copy in the middle of an OCCT chain must stay B-rep, and fall
 * back to mesh (no upstream handle, OCCT not ready) rather than crash.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { moveCopyFeature } from './moveCopy';

function box(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(20, 20, 20).toNonIndexed();
}

const move = { offsetX: 0, offsetY: 0, offsetZ: 50, operation: 0 };
const copy = { offsetX: 0, offsetY: 0, offsetZ: 50, operation: 1 };

describe('moveCopyFeature', () => {
  it('exposes a sync apply and an async applyAsync', () => {
    expect(typeof moveCopyFeature.apply).toBe('function');
    expect(typeof moveCopyFeature.applyAsync).toBe('function');
  });

  it('apply() move translates the body (+50 in Z)', () => {
    const out = moveCopyFeature.apply(box(), move);
    out.computeBoundingBox();
    const b = out.boundingBox!;
    // box spans z∈[-10,10]; +50 → z∈[40,60].
    expect(b.min.z).toBeGreaterThan(39);
    expect(b.max.z).toBeLessThan(61);
  });

  it('apply() copy keeps the original + a translated copy (Z span covers both)', () => {
    const out = moveCopyFeature.apply(box(), copy);
    out.computeBoundingBox();
    const b = out.boundingBox!;
    // original z∈[-10,10] + copy z∈[40,60] → overall z∈[-10,60].
    expect(b.min.z).toBeLessThan(-9);
    expect(b.max.z).toBeGreaterThan(59);
  });

  it('applyAsync() falls back to the mesh path when OCCT is not ready', async () => {
    const out = await moveCopyFeature.applyAsync!(box(), move);
    expect(out.attributes.position.count).toBeGreaterThan(0);
  });

  it('applyAsync() falls back to mesh when there is no upstream OCCT handle', async () => {
    const g = box();
    expect(g.userData.occtHandle).toBeUndefined();
    const out = await moveCopyFeature.applyAsync!(g, copy);
    expect(out.attributes.position.count).toBeGreaterThan(0);
  });
});
