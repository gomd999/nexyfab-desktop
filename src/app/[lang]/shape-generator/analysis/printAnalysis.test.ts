/**
 * printAnalysis — geometry-coupled verification of the 3D-print analyzer's GEOMETRIC core
 * (the parts with an exact ground truth): the divergence-theorem mesh volume, the build
 * height + layer count along the build direction, the overhang detection (face normal vs
 * the down direction), and the per-axis support area in the orientation optimiser.
 *
 * The print-time and cost estimates are deposition-rate heuristics with no closed-form
 * ground truth, so they are NOT asserted here.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { analyzePrintability, findOptimalOrientation } from './printAnalysis';

describe('printAnalysis — geometry core (verified)', () => {
  it('computes the mesh volume, build height and layer count of a box', () => {
    const w = 20, h = 40, d = 20, layerHeight = 0.2;
    const r = analyzePrintability(new THREE.BoxGeometry(w, h, d), { buildDirection: [0, 1, 0], layerHeight });
    expect(r.costBreakdown!.meshVolume).toBeCloseTo((w * h * d) / 1000, 3); // 16 cm³
    expect(r.buildHeight).toBeCloseTo(h, 6);                                // 40 mm along +Y
    expect(r.layerCount).toBe(Math.ceil(h / layerHeight));                  // 200
  });

  it('flags the down-facing box face as an overhang and flips it with the build direction', () => {
    const up = analyzePrintability(new THREE.BoxGeometry(20, 20, 20), { buildDirection: [0, 1, 0] });
    const dn = analyzePrintability(new THREE.BoxGeometry(20, 20, 20), { buildDirection: [0, -1, 0] });
    expect(up.overhangFaces.length).toBe(2);                    // the −Y bottom face (2 triangles)
    expect(Math.max(...up.overhangAngles)).toBeCloseTo(90, 4);  // a flat ceiling is a 90° overhang
    expect(dn.overhangFaces.length).toBe(2);
    expect(up.overhangFaces).not.toEqual(dn.overhangFaces);     // different faces (top vs bottom)
  });

  it('flags the lower hemisphere of a sphere as overhangs', () => {
    const r = analyzePrintability(new THREE.SphereGeometry(15, 24, 16), { buildDirection: [0, 1, 0] });
    expect(r.overhangFaces.length).toBeGreaterThan(50); // the whole downward-facing hemisphere
  });

  it('measures the per-axis support area as the projected bottom-face area', () => {
    const w = 20, h = 40, d = 20; // building along Y rests on a 20×20 face; along X/Z a 40×20 face
    const o = findOptimalOrientation(new THREE.BoxGeometry(w, h, d));
    expect(o.candidates.length).toBe(6);
    const byLabel = Object.fromEntries(o.candidates.map(c => [c.label, c]));
    expect(byLabel['+Y'].supportArea).toBeCloseTo(w * d, 0);   // 400
    expect(byLabel['+X'].supportArea).toBeCloseTo(h * d, 0);   // 800
    expect(byLabel['+Z'].supportArea).toBeCloseTo(w * h, 0);   // 800
    expect(byLabel['+Y'].buildHeight).toBeCloseTo(h, 6);       // 40
    expect(byLabel['+X'].buildHeight).toBeCloseTo(w, 6);       // 20
    // the optimiser minimises support area ⇒ ±Y (400) beats ±X/±Z (800)
    expect(['+Y', '-Y']).toContain(o.candidates[o.bestIndex].label);
  });
});
