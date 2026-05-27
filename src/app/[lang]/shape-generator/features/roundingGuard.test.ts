import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { filletFeature } from './fillet';
import { chamferFeature } from './chamfer';
import { isOcctReady } from './occtEngine';
import { meshVolume, isRoundingNoOp } from './roundingGuard';

// These tests run WITHOUT RUN_OCCT_FEASIBILITY, so OCCT is not initialised and
// engine=1 fillet/chamfer takes the mesh path. Box-like solids now round for
// real (meshRounding), so the guard only fires for shapes the mesh path can't
// round (e.g. a cylinder) on the silent-downgrade path.

function makeBox(w = 60, h = 40, d = 30): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.computeVertexNormals();
  return geo;
}

function makeCylinder(r = 15, h = 50): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(r, r, h, 48);
  geo.computeVertexNormals();
  return geo;
}

// A sphere is neither box-like nor cylinder-like (bbox fill ≈ π/6), so the mesh
// rounding can't handle it — the right shape to exercise the loud-fail guard.
function makeSphere(r = 20): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(r, 24, 24);
  geo.computeVertexNormals();
  return geo;
}

function defaultParams(def: { params: Array<{ key: string; default: number }> }): Record<string, number> {
  const p: Record<string, number> = {};
  for (const sp of def.params) p[sp.key] = sp.default;
  return p;
}

describe('meshVolume', () => {
  it('matches the analytic box volume', () => {
    expect(meshVolume(makeBox())).toBeCloseTo(60 * 40 * 30, 1);
  });
});

describe('isRoundingNoOp', () => {
  it('flags identical geometry as a no-op', () => {
    expect(isRoundingNoOp(makeBox(), makeBox())).toBe(true);
  });

  it('does not flag a clearly smaller solid', () => {
    expect(isRoundingNoOp(makeBox(), makeBox(60, 40, 20))).toBe(false);
  });
});

describe('fillet silent-downgrade guard', () => {
  it('precondition: OCCT is not initialised in this run', () => {
    expect(isOcctReady()).toBe(false);
  });

  it('box rounds for real even without OCCT (no throw, material removed)', () => {
    const params = defaultParams(filletFeature);
    params.radius = 3;
    params.engine = 1; // wants OCCT, unavailable → mesh rounding handles the box
    const out = filletFeature.apply(makeBox(), params);
    expect(meshVolume(out)).toBeLessThan(60 * 40 * 30);
    expect(meshVolume(out)).toBeGreaterThan(60 * 40 * 30 * 0.9);
  });

  it('cylinder also rounds for real without OCCT (no throw, material removed)', () => {
    const params = defaultParams(filletFeature);
    params.radius = 3;
    params.engine = 1;
    const out = filletFeature.apply(makeCylinder(), params);
    const full = Math.PI * 15 * 15 * 50;
    expect(meshVolume(out)).toBeLessThan(full);
    expect(meshVolume(out)).toBeGreaterThan(full * 0.9);
  });

  it('unsupported shape (sphere) silent downgrade throws instead of a no-op', () => {
    const params = defaultParams(filletFeature);
    params.radius = 3;
    params.engine = 1;
    expect(() => filletFeature.apply(makeSphere(), params)).toThrow(/OCCT|B-rep|unrounded/i);
  });

  it('explicit engine=0 on an unsupported shape does NOT throw (placeholder)', () => {
    const params = defaultParams(filletFeature);
    params.radius = 3;
    params.engine = 0;
    expect(() => filletFeature.apply(makeSphere(), params)).not.toThrow();
  });
});

describe('chamfer silent-downgrade guard', () => {
  it('box bevels for real even without OCCT (no throw)', () => {
    const params = defaultParams(chamferFeature);
    params.distance = 2;
    params.engine = 1;
    const out = chamferFeature.apply(makeBox(), params);
    expect(meshVolume(out)).toBeLessThan(60 * 40 * 30);
  });

  it('unsupported shape (sphere) silent downgrade throws', () => {
    const params = defaultParams(chamferFeature);
    params.distance = 2;
    params.engine = 1;
    expect(() => chamferFeature.apply(makeSphere(), params)).toThrow(/OCCT|B-rep|unrounded/i);
  });
});
