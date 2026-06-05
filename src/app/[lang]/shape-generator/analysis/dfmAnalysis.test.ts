/**
 * dfmAnalysis — geometry-coupled verification of the DFM (manufacturability) analyzer.
 * Two parts:
 *  1. measureWallThickness against slabs of KNOWN thickness — this pinned a real bug: the
 *     old vertex/averaged-normal sampling read a spurious ~0.2 mm minimum on ANY box
 *     (edge normals grazed an adjacent face), so the panel falsely flagged every part as
 *     thin-walled. Now it samples face centroids with the face normal and returns the
 *     exact thickness.
 *  2. The deterministic direction-based geometric checks against known geometry (CNC
 *     undercut, 3D-print overhang, deep-pocket aspect ratio).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { analyzeDFM, measureWallThickness } from './dfmAnalysis';

describe('dfmAnalysis — manufacturability (verified vs known geometry)', () => {
  it('measures the exact wall thickness of a slab (was a spurious ~0.2 mm)', () => {
    for (const t of [2, 4, 6]) {
      const g = new THREE.BoxGeometry(40, t, 40, 8, 1, 8);
      const m = measureWallThickness(g, t * 5, 0.3);
      expect(m.length).toBeGreaterThan(0);
      const min = m.reduce((a, b) => (a.thickness < b.thickness ? a : b)).thickness;
      expect(min).toBeCloseTo(t, 1);     // true thickness, not the old 0.2 artefact
    }
  });

  it('flags the bottom face of a box as a CNC undercut (tool reaches from +Y)', () => {
    const r = analyzeDFM(new THREE.BoxGeometry(20, 20, 20), ['cnc_milling'])[0];
    const uc = r.issues.find(i => i.type === 'undercut');
    expect(uc).toBeDefined();
    expect(uc!.faceIndices!.length).toBe(2); // the −Y face (2 triangles)
  });

  it('detects overhangs on a sphere but not on a box', () => {
    const box = analyzeDFM(new THREE.BoxGeometry(20, 20, 20), ['3d_printing'])[0];
    const sphere = analyzeDFM(new THREE.SphereGeometry(15, 24, 16), ['3d_printing'])[0];
    expect(box.issues.some(i => i.type === 'overhang')).toBe(false);   // box bottom is at the base
    expect(sphere.issues.some(i => i.type === 'overhang')).toBe(true); // lower hemisphere overhangs
  });

  it('flags a deep-pocket aspect ratio on a long bar but not a cube', () => {
    const long = analyzeDFM(new THREE.BoxGeometry(100, 10, 10), ['cnc_milling'])[0];
    const cube = analyzeDFM(new THREE.BoxGeometry(20, 20, 20), ['cnc_milling'])[0];
    expect(long.issues.some(i => i.type === 'deep_pocket')).toBe(true);  // 10:1 > 4:1
    expect(cube.issues.some(i => i.type === 'deep_pocket')).toBe(false);
  });

  it('produces a deterministic score in [0,100] with feasibility from the score', () => {
    const r = analyzeDFM(new THREE.BoxGeometry(20, 20, 20), ['cnc_milling'])[0];
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.feasible).toBe(r.score >= 25);
  });
});
