/**
 * revolve feature — sync mesh path + OCCT-aware applyAsync wiring.
 *
 * The OCCT B-rep path (occtRevolveProfile) needs replicad WASM, which is gated
 * behind RUN_OCCT_FEASIBILITY in occtEngine's own suite. Here we verify the
 * feature WIRING that was missing: a sync mesh `apply`, an `applyAsync` that
 * falls back to the mesh when OCCT isn't ready, and that both yield geometry.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { revolveFeature } from './revolve';

/** A profile-ish input: box offset on +X so radius (√(x²+z²)) is non-zero. */
function inputGeom(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(6, 20, 6);
  g.translate(15, 0, 0); // centre at x=15 → clear radius column
  return g.toNonIndexed();
}

const params = { angle: 360, segments: 32, axis: 1 };

describe('revolveFeature', () => {
  it('exposes both a sync apply and an async applyAsync', () => {
    expect(typeof revolveFeature.apply).toBe('function');
    expect(typeof revolveFeature.applyAsync).toBe('function');
  });

  it('apply() meshes a solid of revolution (LatheGeometry) with positions', () => {
    const out = revolveFeature.apply(inputGeom(), params);
    expect(out.attributes.position.count).toBeGreaterThan(0);
  });

  it('applyAsync() falls back to the mesh path when OCCT is not ready', async () => {
    // No ensureOcctReady() called → isOcctReady() is false → mesh path.
    const out = await revolveFeature.applyAsync!(inputGeom(), params);
    expect(out.attributes.position.count).toBeGreaterThan(0);
  });

  it('respects the chosen axis (X-axis revolve still produces geometry)', () => {
    const out = revolveFeature.apply(inputGeom(), { ...params, axis: 0 });
    expect(out.attributes.position.count).toBeGreaterThan(0);
  });

  it('partial-angle revolve uses the mesh path (OCCT builder is full-turn only)', async () => {
    // angle < 359.5 → applyRevolveOcct returns null even if OCCT were ready.
    const out = await revolveFeature.applyAsync!(inputGeom(), { ...params, angle: 90 });
    expect(out.attributes.position.count).toBeGreaterThan(0);
  });
});
