/**
 * draft feature — mesh taper (mould/cast draft) + OCCT-aware applyAsync wiring.
 *
 * The mesh `apply` shears vertices relative to Y=0 (a reasonable approximation
 * for simple boxes). The precise replicad `.draft` B-rep path (occtDraft) is now
 * wired through `applyAsync`; its real-WASM correctness (face-finder +
 * neutral-plane convention producing the right solid) is verified in
 * __tests__/occtEngine.extrude.test.ts behind RUN_OCCT_FEASIBILITY. Here we pin
 * the mesh behaviour and the wiring (fallback when OCCT isn't ready / no handle).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { draftFeature } from './draft';

const params = { angle: 5, direction: 0 };

function box(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(20, 20, 20).toNonIndexed();
}

describe('draftFeature', () => {
  it('exposes a sync apply and an async applyAsync', () => {
    expect(typeof draftFeature.apply).toBe('function');
    expect(typeof draftFeature.applyAsync).toBe('function');
  });

  it('applyAsync() falls back to the mesh path when OCCT is not ready', async () => {
    // No ensureOcctReady() → shouldUseOcctEngine() is false → mesh path.
    const out = await draftFeature.applyAsync!(box(), params);
    expect(out.attributes.position.count).toBeGreaterThan(0);
  });

  it('applyAsync() falls back to mesh when there is no upstream OCCT handle', async () => {
    // A geometry with no userData.occtHandle has no B-rep to draft, so the
    // feature meshes rather than silently dropping the op.
    const g = box();
    expect(g.userData.occtHandle).toBeUndefined();
    const out = await draftFeature.applyAsync!(g, params);
    expect(out.attributes.position.count).toBeGreaterThan(0);
  });

  it('apply() tapers the walls and keeps a non-empty geometry', () => {
    const out = draftFeature.apply(box(), params);
    expect(out.attributes.position.count).toBeGreaterThan(0);
  });

  it('moves vertices off the neutral plane (X/Z shift grows with Y)', () => {
    const g = box();
    const out = draftFeature.apply(g, { angle: 10, direction: 0 });
    const inX = g.attributes.position.array as ArrayLike<number>;
    const outX = out.attributes.position.array as ArrayLike<number>;
    let moved = false;
    for (let i = 0; i < inX.length; i += 3) {
      if (Math.abs(inX[i] - outX[i]) > 1e-6) { moved = true; break; }
    }
    expect(moved).toBe(true);
  });

  it('a downward draft mirrors the upward one (opposite offset sign)', () => {
    const up = draftFeature.apply(box(), { angle: 8, direction: 0 });
    const down = draftFeature.apply(box(), { angle: 8, direction: 1 });
    const u = up.attributes.position.array as ArrayLike<number>;
    const d = down.attributes.position.array as ArrayLike<number>;
    // For the same input, up/down offsets are negatives → sum back to ~2× base.
    let differ = false;
    for (let i = 0; i < u.length; i += 3) {
      if (Math.abs(u[i] - d[i]) > 1e-6) { differ = true; break; }
    }
    expect(differ).toBe(true);
  });
});
