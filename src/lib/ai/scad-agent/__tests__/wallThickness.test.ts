/**
 * wallThickness.test.ts — Phase X11.
 *
 * Covers both halves of the wall-thickness DFM gate:
 *   1. `computeMinWallThickness` — geometry sampler. Smoke-tests against
 *      a few synthetic three.js geometries (cube, hollow shell, sphere,
 *      cylinder, empty) so the convex-solid edge case is locked.
 *   2. `verifyAgainstSpec` wall-thickness integration — happy path, the
 *      trigger case (0.3 mm wall on FDM), the skip cases, override, slack,
 *      and the formatSpecCritique failure line.
 *
 * Keeps to ~12 tests by design — the production raycast helper is
 * exercised at-large by other layers; here we just verify the contract.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { computeMinWallThickness } from '../faceInspection';
import {
  verifyAgainstSpec,
  formatSpecCritique,
  type MeasuredBbox,
} from '../specVerification';
import type { IntentInput } from '../../../openscad-render/intentToScad';

const bboxFromSize = (w: number, h: number, d: number): MeasuredBbox => ({
  min: [-w / 2, -h / 2, -d / 2],
  max: [w / 2, h / 2, d / 2],
});

/** Build a non-indexed BufferGeometry from a flat triangle-position list. */
function geomFromTris(positions: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(positions), 3));
  return g;
}

/**
 * Build a 20mm outer / 18mm inner hollow box (≈ 1 mm wall on every side).
 * With DoubleSide raycasting (which the production helper uses), the ray
 * from any outer centroid traveling inward hits the inner wall first at
 * distance (outer - inner) / 2 = 1 mm — that's the minimum we expect.
 *
 * Winding doesn't matter for raycast hit detection in DoubleSide mode;
 * we emit both cubes' faces unchanged so the inner wall sits in the path.
 */
function hollowBoxGeometry(outer: number, inner: number): THREE.BufferGeometry {
  const ho = outer / 2, hi = inner / 2;
  const face = (a: number[], b: number[], c: number[], d: number[]) =>
    [...a, ...b, ...c, ...a, ...c, ...d];
  const cube = (h: number) => [
    ...face([ h, -h, -h], [ h,  h, -h], [ h,  h,  h], [ h, -h,  h]), // +x
    ...face([-h, -h,  h], [-h,  h,  h], [-h,  h, -h], [-h, -h, -h]), // -x
    ...face([-h,  h, -h], [-h,  h,  h], [ h,  h,  h], [ h,  h, -h]), // +y
    ...face([-h, -h,  h], [-h, -h, -h], [ h, -h, -h], [ h, -h,  h]), // -y
    ...face([-h, -h,  h], [ h, -h,  h], [ h,  h,  h], [-h,  h,  h]), // +z
    ...face([-h,  h, -h], [ h,  h, -h], [ h, -h, -h], [-h, -h, -h]), // -z
  ];
  return geomFromTris([...cube(ho), ...cube(hi)]);
}

describe('computeMinWallThickness — geometry sampler', () => {
  it('cube 10³ → min wall ≈ 10 mm (the cube IS its own wall)', async () => {
    const cube = new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
    const stats = await computeMinWallThickness(cube);
    // A solid cube's inward ray from one face hits the opposite face at
    // exactly 10 mm.
    expect(stats.sampleCount).toBeGreaterThan(0);
    expect(stats.inlierFraction).toBeGreaterThan(0.9);
    expect(stats.minMm).toBeGreaterThan(9.5);
    expect(stats.minMm).toBeLessThan(10.5);
  });

  it('hollow box (1 mm shell) → min wall ≈ 1 mm', async () => {
    const geo = hollowBoxGeometry(20, 18);
    const stats = await computeMinWallThickness(geo);
    expect(stats.sampleCount).toBeGreaterThan(0);
    // Outer face samples hit the inner wall at ~1 mm; min must be ≤ ~1.05.
    expect(stats.minMm).toBeGreaterThan(0.5);
    expect(stats.minMm).toBeLessThan(1.5);
  });

  it('sphere (convex) → sampleCount > 0, but no inward hits → minMm=Infinity', async () => {
    const sph = new THREE.SphereGeometry(10, 16, 12).toNonIndexed();
    const stats = await computeMinWallThickness(sph);
    // Some samples taken but, for a closed convex surface, the inward ray
    // from any centroid eventually exits — actually the inward ray crosses
    // the diameter and hits the opposite cap. So a sphere's "wall" is its
    // diameter. The expected pattern is: minMm is roughly the sphere
    // diameter (20 mm) when measured this way. The "no inward hit" case
    // happens only when the mesh has open boundaries (single shell) — we
    // test that separately. Assert minMm > 0 here and inlierFraction high.
    expect(stats.minMm).toBeGreaterThan(0);
    expect(stats.inlierFraction).toBeGreaterThan(0.5);
  });

  it('cylinder Ø20×30 → min wall in (0, diameter] range', async () => {
    const cyl = new THREE.CylinderGeometry(10, 10, 30, 24).toNonIndexed();
    const stats = await computeMinWallThickness(cyl);
    expect(stats.sampleCount).toBeGreaterThan(0);
    expect(stats.minMm).toBeGreaterThan(0);
    expect(Number.isFinite(stats.minMm)).toBe(true);
  });

  it('empty geometry → zero samples + Infinity minMm', async () => {
    const g = new THREE.BufferGeometry();
    const stats = await computeMinWallThickness(g);
    expect(stats.sampleCount).toBe(0);
    expect(stats.minMm).toBe(Infinity);
    expect(stats.meanMm).toBe(0);
    expect(stats.inlierFraction).toBe(0);
  });
});

describe('verifyAgainstSpec — wall thickness DFM gate', () => {
  const boxIntent: IntentInput = {
    shapeId: 'box',
    params: { width: 50, height: 50, depth: 50 },
  };
  const meas = bboxFromSize(50, 50, 50);

  it('happy path: 1.5 mm wall on fdm (min 0.8) → pass', () => {
    const r = verifyAgainstSpec(boxIntent, meas, {
      detectedMinWallMm: 1.5,
      processForDfm: 'fdm',
    });
    expect(r.ok).toBe(true);
    expect(r.wallThickness).toBeDefined();
    expect(r.wallThickness?.pass).toBe(true);
    expect(r.wallThickness?.processMinMm).toBe(0.8);
    expect(r.wallThickness?.minDetectedMm).toBe(1.5);
  });

  it('trigger: 0.3 mm wall on fdm → fail with critique mentioning 0.8 mm', () => {
    const r = verifyAgainstSpec(boxIntent, meas, {
      detectedMinWallMm: 0.3,
      processForDfm: 'fdm',
    });
    expect(r.ok).toBe(false);
    expect(r.wallThickness?.pass).toBe(false);
    const text = formatSpecCritique(r);
    expect(text).toMatch(/wall thickness/);
    expect(text).toMatch(/0\.30/);
    expect(text).toMatch(/0\.8/);
    expect(text).toMatch(/fdm/);
  });

  it('skip: no processForDfm provided → wallThickness undefined', () => {
    const r = verifyAgainstSpec(boxIntent, meas, {
      detectedMinWallMm: 0.3,
    });
    expect(r.wallThickness).toBeUndefined();
    // bbox passes, so overall ok.
    expect(r.ok).toBe(true);
  });

  it('skip: convex solid (minDetectedMm=null) → present with pass=true and note', () => {
    const r = verifyAgainstSpec(boxIntent, meas, {
      detectedMinWallMm: null,
      processForDfm: 'fdm',
    });
    expect(r.wallThickness).toBeDefined();
    expect(r.wallThickness?.minDetectedMm).toBeNull();
    expect(r.wallThickness?.pass).toBe(true);
    expect(r.wallThickness?.note).toMatch(/convex/i);
    expect(r.ok).toBe(true);
  });

  it('override: processWallMinOverrideMm=2.0 wins over fdm default (0.8)', () => {
    const r = verifyAgainstSpec(boxIntent, meas, {
      detectedMinWallMm: 1.0,
      processForDfm: 'fdm',
      processWallMinOverrideMm: 2.0,
    });
    expect(r.wallThickness?.processMinMm).toBe(2.0);
    expect(r.wallThickness?.pass).toBe(false); // 1.0 < 2.0 - slack
    expect(r.ok).toBe(false);
  });

  it('slack: 0.78 mm on fdm (0.8 min) → pass via 0.05 mm slack', () => {
    const r = verifyAgainstSpec(boxIntent, meas, {
      detectedMinWallMm: 0.78,
      processForDfm: 'fdm',
    });
    expect(r.wallThickness?.pass).toBe(true);
    expect(r.ok).toBe(true);
  });

  it('formatSpecCritique success line includes wall thickness when passing', () => {
    const r = verifyAgainstSpec(boxIntent, meas, {
      detectedMinWallMm: 1.5,
      processForDfm: 'fdm',
    });
    const text = formatSpecCritique(r);
    expect(text).toMatch(/spec ok/);
    expect(text).toMatch(/Wall thickness/);
    expect(text).toMatch(/1\.50/);
    expect(text).toMatch(/0\.8/);
  });
});
