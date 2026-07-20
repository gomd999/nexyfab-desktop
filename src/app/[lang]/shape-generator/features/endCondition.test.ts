/**
 * endCondition.test.ts — W5-D end conditions for cut/hole.
 *
 * Judgment baseline (260721, measured before the change):
 *   - cut had NO depth param at all — every cut was a through-slot
 *     (100×2×50 plate, 20×10 cut → removed 400.0 regardless).
 *   - hole "blind" (depth<999) was a CENTERED slab: 12 mm bore on a 20 mm box
 *     removed 936.43 mm³ (= centered theory) with ZERO opening on either face
 *     — an internal floating cavity, not a blind hole.
 *
 * These tests pin the new semantics with measured volume deltas (theory) and
 * vertex scans for the presence/absence of face openings, plus explicit
 * rejection reasons for invalid up_to_face targets. All mesh-path (three-bvh-
 * csg); OCCT is not initialised under vitest.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyCut, cutFeature, resolveUpToFacePlaneY } from './cut';
import { holeFeature } from './hole';
import { meshVolume } from './roundingGuard';
import { stampFaceFeatureIdAll } from './faceProvenance';
import type { FaceSelectionInfo } from '../editing/selectionInfo';

function box(w = 60, h = 20, d = 40): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  stampFaceFeatureIdAll(g, '__base__');
  return g;
}

/** Vertices on plane y≈target inside the axis-aligned rect around (cx,cz). */
function vertsOnPlaneInRect(g: THREE.BufferGeometry, y: number, cx: number, cz: number, hw: number, hl: number): number {
  const pos = g.attributes.position;
  let n = 0;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getY(i) - y) < 1e-4
      && Math.abs(pos.getX(i) - cx) <= hw + 1e-4
      && Math.abs(pos.getZ(i) - cz) <= hl + 1e-4) n++;
  }
  return n;
}

function faceSel(y: number, normal: [number, number, number] = [0, 1, 0], x = 0, z = 0): FaceSelectionInfo {
  return {
    type: 'face', normal, position: [x, y, z], area: 1, triangleCount: 2,
    normalLabel: 'test', triangleIndices: [],
  };
}

// 32-gon approximation of a bore cross-section (matches CylinderGeometry(…, 32)).
const POLY32 = 0.5 * 32 * Math.sin((2 * Math.PI) / 32);

describe('cut end conditions (W5-D)', () => {
  it('through_all (default) removes full-thickness material and opens the bottom face', () => {
    const g = box(100, 10, 50); // y ∈ [-5, 5]
    const v0 = meshVolume(g);
    const out = applyCut(g, { width: 20, length: 10, posX: 0, posZ: 0 }); // no endCondition → legacy through
    const removed = v0 - meshVolume(out);
    expect(removed).toBeCloseTo(20 * 10 * 10, 0); // 2000 mm³
    // Opening on the FAR face: cut-wall vertices reach the bottom plane.
    expect(vertsOnPlaneInRect(out, -5, 0, 0, 10.01, 5.01)).toBeGreaterThan(0);
  });

  it('blind stops at the given depth: volume theory + NO opening on the far face', () => {
    const g = box(100, 10, 50);
    const v0 = meshVolume(g);
    const out = applyCut(g, { width: 20, length: 10, posX: 0, posZ: 0, endCondition: 'blind', depth: 4 });
    const removed = v0 - meshVolume(out);
    expect(removed).toBeCloseTo(20 * 10 * 4, 0); // 800 mm³
    // Pocket floor sits at y = 5 − 4 = 1 (floor verts lie ON the rect bounds → inclusive scan) …
    expect(vertsOnPlaneInRect(out, 1, 0, 0, 10.01, 5.01)).toBeGreaterThan(0);
    // … and the bottom face is intact: no cut vertices STRICTLY inside the
    // rect footprint on the bottom plane (rect corners of the original face
    // grid don't exist there on a plain box).
    expect(vertsOnPlaneInRect(out, -5, 0, 0, 9.99, 4.99)).toBe(0);
  });

  it('blind rejects a non-positive depth with the reason', () => {
    const g = box(100, 10, 50);
    expect(() => applyCut(g, { width: 20, length: 10, posX: 0, posZ: 0, endCondition: 'blind', depth: 0 }))
      .toThrow(/Blind cut rejected: depth must be a positive number/);
  });

  it('up_to_face derives the depth from the selected plane (measured)', () => {
    // Stepped block: blind-cut the right half down 10 → step face at y=0 over x∈[0,30].
    const g = box(60, 20, 40); // y ∈ [-10, 10]
    const stepped = applyCut(g, { width: 30, length: 40, posX: 15, posZ: 0, endCondition: 'blind', depth: 10 });
    const vStep = meshVolume(stepped);
    expect(vStep).toBeCloseTo(48000 - 30 * 40 * 10, 0);

    // Now cut on the LEFT half, up to the step plane y=0 → auto depth 10.
    const sel = [faceSel(0, [0, 1, 0], 15, 0)];
    const planeY = resolveUpToFacePlaneY(stepped, sel);
    expect(planeY).toBe(0);
    const out = applyCut(stepped, { width: 10, length: 10, posX: -15, posZ: 0, endCondition: 'up_to_face', upToPlaneY: planeY });
    const removed = vStep - meshVolume(out);
    expect(removed).toBeCloseTo(10 * 10 * 10, 0); // depth auto-derived = 10 mm
    // Floor of the new pocket is exactly the target plane (inclusive scan — floor verts lie ON the bounds).
    expect(vertsOnPlaneInRect(out, 0, -15, 0, 5.01, 5.01)).toBeGreaterThan(0);
    // Far (bottom) face intact under the pocket.
    expect(vertsOnPlaneInRect(out, -10, -15, 0, 4.99, 4.99)).toBe(0);
  });

  it('up_to_face rejects: no selection / tilted face / plane above top / lost face — each with a reason', () => {
    const g = box(60, 20, 40);
    expect(() => resolveUpToFacePlaneY(g, undefined)).toThrow(/no target face selected/);
    expect(() => resolveUpToFacePlaneY(g, [faceSel(0, [1, 0, 0])])).toThrow(/not a horizontal plane/);
    expect(() => resolveUpToFacePlaneY(g, [faceSel(10)])).toThrow(/at\/above the top face/);
    expect(() => resolveUpToFacePlaneY(g, [faceSel(-15)])).toThrow(/below the body/);
    // Plane inside the bbox but with no actual face there → "face lost".
    expect(() => resolveUpToFacePlaneY(g, [faceSel(3.7)])).toThrow(/no face found at y=3.7 .*no longer exists/);
  });

  it('cutFeature.apply enum path: endCondition=0 (blind) uses the depth param', () => {
    const out = cutFeature.apply(
      box(100, 10, 50),
      { width: 20, length: 10, posX: 0, posZ: 0, endCondition: 0, depth: 4 },
      undefined,
    );
    expect(meshVolume(out)).toBeCloseTo(100 * 10 * 50 - 800, 0);
  });
});

describe('hole end conditions (W5-D)', () => {
  it('blind (endCondition=0) now drills FROM THE TOP: opening on top, none on bottom, volume theory', () => {
    const g = box(); // 60×20×40, y ∈ [-10, 10]
    const v0 = meshVolume(g);
    const out = holeFeature.apply(g, { holeType: 0, diameter: 10, posX: 0, posZ: 0, depth: 12, endCondition: 0, engine: 0 }, { featureId: 'h' });
    const removed = v0 - meshVolume(out);
    expect(removed).toBeCloseTo(POLY32 * 25 * 12, 0); // 936.43 mm³ (32-gon bore ×12 mm)
    // Judgment baseline had 0 top-opening verts (floating cavity). Now: open top, closed bottom.
    expect(vertsOnPlaneInRect(out, 10, 0, 0, 5.01, 5.01)).toBeGreaterThan(0);
    expect(vertsOnPlaneInRect(out, -10, 0, 0, 4.99, 4.99)).toBe(0);
    // Bore floor at y = 10 − 12 = −2.
    expect(vertsOnPlaneInRect(out, -2, 0, 0, 5.01, 5.01)).toBeGreaterThan(0);
  });

  it('through_all (endCondition=1) ignores depth and opens BOTH faces', () => {
    const g = box();
    const v0 = meshVolume(g);
    const out = holeFeature.apply(g, { holeType: 0, diameter: 10, posX: 0, posZ: 0, depth: 5, endCondition: 1, engine: 0 }, { featureId: 'h' });
    const removed = v0 - meshVolume(out);
    expect(removed).toBeCloseTo(POLY32 * 25 * 20, 0); // full 20 mm despite depth=5
    expect(vertsOnPlaneInRect(out, 10, 0, 0, 5.01, 5.01)).toBeGreaterThan(0);
    expect(vertsOnPlaneInRect(out, -10, 0, 0, 5.01, 5.01)).toBeGreaterThan(0);
  });

  it('up_to_face (endCondition=2) auto-derives depth to the selected plane', () => {
    // Step at y=0 over the right half, then an up-to-face hole on the left.
    const stepped = applyCut(box(), { width: 30, length: 40, posX: 15, posZ: 0, endCondition: 'blind', depth: 10 });
    const vStep = meshVolume(stepped);
    const out = holeFeature.apply(
      stepped,
      { holeType: 0, diameter: 10, posX: -15, posZ: 0, depth: 999, endCondition: 2, engine: 0 },
      { featureId: 'h', faceSelections: [faceSel(0, [0, 1, 0], 15, 0)] },
    );
    const removed = vStep - meshVolume(out);
    expect(removed).toBeCloseTo(POLY32 * 25 * 10, 0); // auto depth = topY − 0 = 10 mm
    expect(vertsOnPlaneInRect(out, 0, -15, 0, 5.01, 5.01)).toBeGreaterThan(0);  // floor at the plane
    expect(vertsOnPlaneInRect(out, -10, -15, 0, 4.99, 4.99)).toBe(0);           // bottom intact
  });

  it('up_to_face without a face selection is rejected with the reason', () => {
    expect(() => holeFeature.apply(
      box(),
      { holeType: 0, diameter: 10, posX: 0, posZ: 0, depth: 999, endCondition: 2, engine: 0 },
      { featureId: 'h' },
    )).toThrow(/no target face selected/);
  });

  it('blind rejects depth ≥ 999 sentinel or ≤ 0 with the reason', () => {
    expect(() => holeFeature.apply(box(), { holeType: 0, diameter: 10, posX: 0, posZ: 0, depth: 999, endCondition: 0, engine: 0 }, { featureId: 'h' }))
      .toThrow(/Blind hole rejected/);
  });

  it('LEGACY SEAL: without endCondition the old centered-slab behavior is preserved bit-for-bit', () => {
    // Old saved projects have no endCondition key — their geometry must not shift.
    const g = box();
    const v0 = meshVolume(g);
    const out = holeFeature.apply(g, { holeType: 0, diameter: 10, posX: 0, posZ: 0, depth: 12, engine: 0 }, { featureId: 'h' });
    const removed = v0 - meshVolume(out);
    expect(removed).toBeCloseTo(POLY32 * 25 * 12, 0);
    // Centered cavity: NO opening on either face (the judged legacy artifact).
    expect(vertsOnPlaneInRect(out, 10, 0, 0, 5.01, 5.01)).toBe(0);
    expect(vertsOnPlaneInRect(out, -10, 0, 0, 5.01, 5.01)).toBe(0);
  });
});
