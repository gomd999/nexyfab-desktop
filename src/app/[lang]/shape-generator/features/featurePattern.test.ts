/**
 * featurePattern.test.ts — W5-D feature-unit pattern (patternTarget=1).
 *
 * Judgment baseline (260721, measured): linearPattern duplicated the WHOLE
 * body mesh — 3× vertex count, signed volume EXACTLY 3.0000× the single body
 * (overlap double-counted ⇒ merge, not union: merged 139317.8 vs true union
 * ≈ 91317.8), bbox stretched from 60 to 120 mm.
 *
 * Feature mode re-applies the SOURCE cut/hole per instance on the SAME body.
 * These tests fix the difference between the two modes — including the case
 * where instances land on a curved surface, where body-copy is wrong and
 * feature re-application is correct — plus the rejection reasons.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { holeFeature } from './hole';
import { cutFeature } from './cut';
import { linearPatternFeature } from './linearPattern';
import { circularPatternFeature } from './circularPattern';
import { applyFeaturePipelineDetailed } from './index';
import { readPatternSeeds } from './patternHelpers/featureSeed';
import { meshVolume } from './roundingGuard';
import { stampFaceFeatureIdAll } from './faceProvenance';
import type { FeatureInstance } from './types';

function box(w = 60, h = 20, d = 40): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  stampFaceFeatureIdAll(g, '__base__');
  return g;
}

function cylinder(r = 40, h = 20, seg = 64): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, h, seg).toNonIndexed();
  stampFaceFeatureIdAll(g, '__base__');
  return g;
}

/** Vertices on plane y≈target within radius r of (cx, cz) — bore-opening scan. */
function openingVerts(g: THREE.BufferGeometry, y: number, cx: number, cz: number, r: number): number {
  const pos = g.attributes.position;
  let n = 0;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getY(i) - y) < 1e-4
      && Math.hypot(pos.getX(i) - cx, pos.getZ(i) - cz) <= r + 1e-4) n++;
  }
  return n;
}

const POLY32 = 0.5 * 32 * Math.sin((2 * Math.PI) / 32); // 32-gon bore area factor

function drill(g: THREE.BufferGeometry, posX: number, posZ = 0, diameter = 10): THREE.BufferGeometry {
  return holeFeature.apply(
    g,
    { holeType: 0, diameter, posX, posZ, depth: 999, endCondition: 1, engine: 0 },
    { featureId: 'seed-hole' },
  );
}

describe('feature-unit linear pattern (patternTarget=1)', () => {
  it('re-drills the seed hole per instance: N real bores on ONE body (volume + openings + bbox)', () => {
    const g = box(); // 60×20×40 → 48000 mm³
    const v0 = meshVolume(g);
    const holed = drill(g, -20);
    const bore = v0 - meshVolume(holed);
    expect(bore).toBeCloseTo(POLY32 * 25 * 20, 0); // one through bore ≈ 1560.72

    const out = linearPatternFeature.apply(holed, { axis: 0, count: 3, spacing: 20, patternTarget: 1 }, { featureId: 'pat' });
    const v3 = meshVolume(out);
    // ONE body minus THREE real bores.
    expect(v0 - v3).toBeCloseTo(3 * bore, 0);
    // Bores open the top face at x = −20, 0, +20.
    for (const x of [-20, 0, 20]) {
      expect(openingVerts(out, 10, x, 0, 5.01), `top opening at x=${x}`).toBeGreaterThan(0);
      expect(openingVerts(out, -10, x, 0, 5.01), `bottom opening at x=${x}`).toBeGreaterThan(0);
    }
    // Body NOT duplicated: bbox unchanged.
    out.computeBoundingBox();
    expect(out.boundingBox!.max.x - out.boundingBox!.min.x).toBeCloseTo(60, 6);
  });

  it('DIFFERENCE FIXED (curved surface): feature mode is correct where body copy is not', () => {
    // Cylinder base r=40 h=20 — instances land on a curved-boundary body.
    const cyl = cylinder();
    const vCyl = meshVolume(cyl);
    const holed = drill(cyl, -20, 0, 8);
    const bore = vCyl - meshVolume(holed);
    expect(bore).toBeCloseTo(POLY32 * 16 * 20, 0); // full-height bore, wholly inside the section

    // Feature mode: one cylinder, three real bores at x = −20, 0, +20.
    const feat = linearPatternFeature.apply(holed.clone(), { axis: 0, count: 3, spacing: 20, patternTarget: 1 }, { featureId: 'pat' });
    const vFeat = meshVolume(feat);
    expect(vCyl - vFeat).toBeCloseTo(3 * bore, 0);
    feat.computeBoundingBox();
    expect(feat.boundingBox!.max.x - feat.boundingBox!.min.x).toBeCloseTo(80, 4); // still one Ø80 cylinder

    // Body mode on the same input: three overlapping WHOLE cylinders.
    const body = linearPatternFeature.apply(holed.clone(), { axis: 0, count: 3, spacing: 20, patternTarget: 0 });
    const vBody = meshVolume(body);
    const vSingle = meshVolume(holed);
    expect(vBody / vSingle).toBeCloseTo(3.0, 3);      // overlap double-counted — not a union
    body.computeBoundingBox();
    expect(body.boundingBox!.max.x - body.boundingBox!.min.x).toBeCloseTo(120, 4); // stretched body
    expect(body.attributes.position.count).toBe(holed.attributes.position.count * 3); // mesh copies
    // And the two modes are materially different bodies:
    expect(Math.abs(vBody - vFeat)).toBeGreaterThan(vSingle); // ≫ any tessellation noise
  });

  it('body mode (default) is byte-compatible with the legacy pattern behavior', () => {
    const holed = drill(box(), -20);
    const legacyShaped = linearPatternFeature.apply(holed.clone(), { axis: 0, count: 3, spacing: 30 });
    const explicitBody = linearPatternFeature.apply(holed.clone(), { axis: 0, count: 3, spacing: 30, patternTarget: 0 });
    expect(explicitBody.attributes.position.count).toBe(legacyShaped.attributes.position.count);
    expect(meshVolume(explicitBody)).toBeCloseTo(meshVolume(legacyShaped), 6);
    expect(legacyShaped.attributes.position.count).toBe(holed.attributes.position.count * 3);
  });

  it('patterns a CUT seed too, and seedBack selects an earlier seed', () => {
    const g = box(100, 10, 50); // y ∈ [-5, 5]
    const v0 = meshVolume(g);
    // Seed 1: blind cut 10×10 depth 4 at x=−40  → then Seed 2: hole at x=30.
    const cutOut = cutFeature.apply(g, { width: 10, length: 10, posX: -40, posZ: 0, endCondition: 0, depth: 4 }, { featureId: 'c1' });
    const vCut = meshVolume(cutOut);
    expect(v0 - vCut).toBeCloseTo(400, 0);
    const holed = holeFeature.apply(cutOut, { holeType: 0, diameter: 6, posX: 30, posZ: 0, depth: 999, endCondition: 1, engine: 0 }, { featureId: 'h1' });
    const vHoled = meshVolume(holed);
    expect(readPatternSeeds(holed).map(s => s.type)).toEqual(['cut', 'hole']);

    // seedBack=1 → skip the hole, pattern the CUT along X: instances at −40, −20, 0.
    const out = linearPatternFeature.apply(holed, { axis: 0, count: 3, spacing: 20, patternTarget: 1, seedBack: 1 }, { featureId: 'pat' });
    const removed = vHoled - meshVolume(out);
    expect(removed).toBeCloseTo(2 * 400, 0); // 2 extra blind cuts (10×10×4)
    // The blind-cut floors exist at y = 5 − 4 = 1 at each instance.
    for (const x of [-40, -20, 0]) {
      expect(openingVerts(out, 1, x, 0, 7.1), `floor at x=${x}`).toBeGreaterThan(0);
    }
  });

  it('runs through the REAL pipeline: hole → linearPattern(feature) survives pipelineManager stamping', () => {
    const feats: FeatureInstance[] = [
      { id: 'h1', type: 'hole', params: { holeType: 0, diameter: 10, posX: -20, posZ: 0, depth: 999, endCondition: 1, engine: 0, counterboreDia: 18, counterboreDepth: 5, countersinkAngle: 90 }, enabled: true },
      { id: 'p1', type: 'linearPattern', params: { axis: 0, count: 3, spacing: 20, patternTarget: 1, seedBack: 0 }, enabled: true },
    ];
    const res = applyFeaturePipelineDetailed(box(), feats);
    expect(res.errors).toEqual({});
    const v = meshVolume(res.geometry);
    expect(48000 - v).toBeCloseTo(3 * POLY32 * 25 * 20, 0); // three real bores
    res.geometry.computeBoundingBox();
    expect(res.geometry.boundingBox!.max.x - res.geometry.boundingBox!.min.x).toBeCloseTo(60, 6);
  });

  it('rejections carry reasons: no seed / Y axis', () => {
    expect(() => linearPatternFeature.apply(box(), { axis: 0, count: 3, spacing: 20, patternTarget: 1 }))
      .toThrow(/no patternable source feature/);
    const holed = drill(box(), -20);
    expect(() => linearPatternFeature.apply(holed, { axis: 1, count: 3, spacing: 20, patternTarget: 1 }))
      .toThrow(/Y-axis pattern cannot re-place/);
  });
});

describe('feature-unit circular pattern (patternTarget=1)', () => {
  it('re-drills the seed hole at Y-rotated positions: bolt circle on ONE body', () => {
    const g = box(100, 20, 100); // 200000 mm³
    const v0 = meshVolume(g);
    const holed = drill(g, 30, 0, 8);
    const bore = v0 - meshVolume(holed);
    const out = circularPatternFeature.apply(holed, { axis: 1, count: 4, totalAngle: 360, patternTarget: 1 }, { featureId: 'pat' });
    expect(v0 - meshVolume(out)).toBeCloseTo(4 * bore, 0);
    // Bolt circle positions (THREE rotation-about-Y): (30,0) → (0,−30) → (−30,0) → (0,30).
    for (const [x, z] of [[30, 0], [0, -30], [-30, 0], [0, 30]] as const) {
      expect(openingVerts(out, 10, x, z, 4.01), `top opening at (${x},${z})`).toBeGreaterThan(0);
    }
    out.computeBoundingBox();
    expect(out.boundingBox!.max.x - out.boundingBox!.min.x).toBeCloseTo(100, 6); // body not rotated/duplicated
  });

  it('rejections carry reasons: non-Y axis / cut seed', () => {
    const holed = drill(box(100, 20, 100), 30, 0, 8);
    expect(() => circularPatternFeature.apply(holed, { axis: 0, count: 4, totalAngle: 360, patternTarget: 1 }))
      .toThrow(/rotation must be about the Y axis/);
    const cutOut = cutFeature.apply(box(100, 20, 100), { width: 10, length: 10, posX: 30, posZ: 0, endCondition: 1 }, { featureId: 'c' });
    expect(() => circularPatternFeature.apply(cutOut, { axis: 1, count: 4, totalAngle: 360, patternTarget: 1 }))
      .toThrow(/seed is a 'cut'/);
  });

  it('seed log is restored after the pattern (instance re-drills do not pollute seedBack)', () => {
    const holed = drill(box(), -20);
    const seedsBefore = readPatternSeeds(holed);
    expect(seedsBefore).toHaveLength(1);
    const out = linearPatternFeature.apply(holed, { axis: 0, count: 3, spacing: 20, patternTarget: 1 }, { featureId: 'pat' });
    expect(readPatternSeeds(out)).toEqual(seedsBefore);
  });
});
