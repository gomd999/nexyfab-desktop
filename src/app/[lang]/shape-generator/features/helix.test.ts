/**
 * helix feature — sync mesh path + OCCT-aware applyAsync wiring.
 *
 * The OCCT B-rep path (occtSweepHelix) needs replicad WASM, verified behind
 * RUN_OCCT_FEASIBILITY in __tests__/occtEngine.extrude.test.ts. Here we pin the
 * mesh behaviour and the wiring: a fresh helix yields geometry, and applyAsync
 * falls back to the mesh when OCCT isn't ready.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { helixFeature } from './helix';

const params = { radius: 20, pitch: 5, turns: 6, wireRadius: 1.2, axis: 1, handedness: 0 };

function empty(): THREE.BufferGeometry {
  return new THREE.BufferGeometry();
}

describe('helixFeature', () => {
  it('exposes a sync apply and an async applyAsync', () => {
    expect(typeof helixFeature.apply).toBe('function');
    expect(typeof helixFeature.applyAsync).toBe('function');
  });

  it('apply() builds a helical tube with positions', () => {
    const out = helixFeature.apply(empty(), params);
    expect(out.attributes.position.count).toBeGreaterThan(0);
  });

  it('applyAsync() falls back to the mesh path when OCCT is not ready', async () => {
    const out = await helixFeature.applyAsync!(empty(), params);
    expect(out.attributes.position.count).toBeGreaterThan(0);
  });

  it('left-handed / Z-axis variants still produce geometry via the mesh path', async () => {
    const out = await helixFeature.applyAsync!(empty(), { ...params, axis: 2, handedness: 1 });
    expect(out.attributes.position.count).toBeGreaterThan(0);
  });
});
