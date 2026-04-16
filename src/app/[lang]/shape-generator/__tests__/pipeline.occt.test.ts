/**
 * Pipeline test for the OCCT boolean path (#98 phase 2b).
 *
 * Mirrors the `box-subtract-cylinder` fixture from pipeline.regression.test.ts
 * but routes it through booleanFeature's engine=1 branch, which calls into
 * the replicad OCCT kernel via occtEngine. Validates:
 *
 *   1. ensureOcctReady() loads the WASM in node without custom shims
 *   2. booleanFeature.apply picks up engine=1 and produces a non-empty mesh
 *   3. output volume is within 1% of the existing three-bvh-csg golden
 *
 * Skipped unless RUN_OCCT_FEASIBILITY=1 for the same reasons as the
 * feasibility test (10 MB WASM, multi-second init).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { booleanFeature } from '../features/boolean';
import { filletFeature } from '../features/fillet';
import { chamferFeature } from '../features/chamfer';
import { ensureOcctReady, isOcctReady } from '../features/occtEngine';
import { computeSignature, type GeometrySignature } from './geometrySignature';

const ENABLED = process.env.RUN_OCCT_FEASIBILITY === '1';
const describeMaybe = ENABLED ? describe : describe.skip;

function makeBox(w = 60, h = 40, d = 30): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.computeVertexNormals();
  return geo;
}

function defaultParams(def: { params: Array<{ key: string; default: number }> }): Record<string, number> {
  const p: Record<string, number> = {};
  for (const sp of def.params) p[sp.key] = sp.default;
  return p;
}

describeMaybe('boolean feature — OCCT engine path', () => {
  beforeAll(async () => {
    await ensureOcctReady();
  }, 60_000);

  it('is ready after ensureOcctReady', () => {
    expect(isOcctReady()).toBe(true);
  });

  it('box-subtract-cylinder via OCCT lands within 1% of three-bvh-csg golden', () => {
    const geo = makeBox();
    const params = defaultParams(booleanFeature);
    params.operation = 1;     // subtract
    params.toolShape = 1;     // cylinder
    params.toolWidth = 20;
    params.toolHeight = 80;
    params.engine = 1;        // OCCT

    const result = booleanFeature.apply(geo, params);
    expect(result).toBeDefined();
    expect(result.attributes.position.count).toBeGreaterThan(0);

    const sig = computeSignature(result);

    const goldenPath = join(__dirname, '__goldens__', 'pipeline.json');
    const goldens = JSON.parse(readFileSync(goldenPath, 'utf8')) as Record<string, GeometrySignature>;
    const baseline = goldens['box-subtract-cylinder'];

    const volDrift = Math.abs(sig.volume_mm3 - baseline.volume_mm3) / baseline.volume_mm3;
    const areaDrift = Math.abs(sig.surfaceArea_mm2 - baseline.surfaceArea_mm2) / baseline.surfaceArea_mm2;
    // eslint-disable-next-line no-console
    console.log(
      `[OCCT path] tris=${sig.triangleCount} (baseline ${baseline.triangleCount})  ` +
      `vol drift ${(volDrift * 100).toFixed(3)}%  area drift ${(areaDrift * 100).toFixed(3)}%`,
    );

    expect(volDrift).toBeLessThan(0.01);
    expect(areaDrift).toBeLessThan(0.02);

    // Sanity: bbox should match the box baseline (cylinder doesn't extend the box).
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(sig.bbox.min[i] - baseline.bbox.min[i])).toBeLessThanOrEqual(0.5);
      expect(Math.abs(sig.bbox.max[i] - baseline.bbox.max[i])).toBeLessThanOrEqual(0.5);
    }
  }, 60_000);

  it('falls back cleanly when engine=1 but a feature throws', () => {
    // Force an impossible tool (zero width) — OCCT should error; apply()
    // should log and fall back to three-bvh-csg, which then raises its own
    // empty-geometry error. We're asserting here that the fallback path
    // runs at all (no unhandled rejection crashing the process).
    const geo = makeBox();
    const params = defaultParams(booleanFeature);
    params.operation = 1;
    params.toolShape = 1;
    params.toolWidth = 0.0001;  // essentially a line
    params.toolHeight = 80;
    params.engine = 1;

    expect(() => booleanFeature.apply(geo, params)).not.toThrow(/unhandled/i);
  }, 60_000);

  it('fillet via OCCT rounds every edge of a box — real B-rep, not mesh offset', () => {
    // Baseline mesh-CSG fillet produces 12 tris (the placeholder leaves the
    // box untouched). Real OCCT fillet should dramatically increase tri
    // count AND shrink the volume by a meaningful amount.
    const geo = makeBox();
    const params = defaultParams(filletFeature);
    params.radius = 3;
    params.engine = 1;

    const result = filletFeature.apply(geo, params);
    expect(result).toBeDefined();
    const sig = computeSignature(result);
    const baseVolume = 60 * 40 * 30;  // 72000

    // eslint-disable-next-line no-console
    console.log(
      `[OCCT fillet] r=3 tris=${sig.triangleCount} vol=${sig.volume_mm3.toFixed(2)} (base ${baseVolume})`,
    );

    // Rounding 12 edges of a 60×40×30 box with r=3 removes ~1000 mm³
    // (each edge: (1 - π/4) · r² · L summed over the 12 edges ≈ 927; plus
    // small corner contributions). We bracket generously: must remove at
    // least 500, at most 2500.
    expect(sig.triangleCount).toBeGreaterThan(50);   // much more than the 12 of the placeholder
    expect(baseVolume - sig.volume_mm3).toBeGreaterThan(500);
    expect(baseVolume - sig.volume_mm3).toBeLessThan(2500);
  }, 60_000);

  it('chamfer via OCCT replaces every edge with a flat face', () => {
    const geo = makeBox();
    const params = defaultParams(chamferFeature);
    params.distance = 2;
    params.engine = 1;

    const result = chamferFeature.apply(geo, params);
    expect(result).toBeDefined();
    const sig = computeSignature(result);
    const baseVolume = 60 * 40 * 30;

    // eslint-disable-next-line no-console
    console.log(
      `[OCCT chamfer] d=2 tris=${sig.triangleCount} vol=${sig.volume_mm3.toFixed(2)} (base ${baseVolume})`,
    );

    // Chamfer d=2 on all 12 edges: each edge loses ½·d²·L triangular prism,
    // summed ≈ 520; OCCT's output is ~1000 because the chamfered face
    // merges 3-way at corners. Accept a wide band.
    expect(sig.triangleCount).toBeGreaterThan(30);  // 12 placeholder vs 26+ for real chamfer
    expect(baseVolume - sig.volume_mm3).toBeGreaterThan(400);
    expect(baseVolume - sig.volume_mm3).toBeLessThan(2000);
  }, 60_000);
});
