/**
 * camLite — geometry-coupled verification of the CAM toolpath generator's GEOMETRIC core:
 * the waterline slicer (triangle ∩ horizontal plane → chained polylines) and the pass /
 * grid counts. A horizontal slice of a box is its rectangular XZ outline (perimeter
 * 2(w+d)); of a cylinder, a circle (perimeter 2πR). Pass count = ceil(dy/stepdown); the
 * drill grid follows the bbox spacing.
 *
 * Feed-rate time estimates are heuristics with no closed form and are not asserted.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { generateCAMToolpaths } from './camLite';

const pathLen = (p: THREE.Vector3[]): number => {
  let l = 0; for (let i = 1; i < p.length; i++) l += p[i].distanceTo(p[i - 1]); return l;
};

describe('camLite — waterline slicer (verified vs known cross-sections)', () => {
  it('slices a box into rectangular contours of perimeter 2(w+d)', () => {
    const w = 40, h = 30, d = 20, stepdown = 5;
    const r = generateCAMToolpaths(new THREE.BoxGeometry(w, h, d), {
      type: 'contour', toolDiameter: 6, stepover: 40, stepdown, feedRate: 1000, spindleSpeed: 1000,
    });
    expect(r.passes).toBe(Math.ceil(h / stepdown)); // 6
    // the interior slices are the true rectangular cross-section (perimeter 2(w+d)=120)
    const perim = 2 * (w + d);
    const rectCount = r.toolpaths.filter(p => Math.abs(pathLen(p) - perim) < 1).length;
    expect(rectCount).toBeGreaterThanOrEqual(4);
  });

  it('slices a cylinder into circular contours of perimeter ≈ 2πR', () => {
    const R = 15, h = 40;
    const r = generateCAMToolpaths(new THREE.CylinderGeometry(R, R, h, 48), {
      type: 'contour', toolDiameter: 6, stepover: 40, stepdown: 5, feedRate: 1000, spindleSpeed: 1000,
    });
    const circ = 2 * Math.PI * R; // 94.25
    const circleCount = r.toolpaths.filter(p => Math.abs(pathLen(p) - circ) < 0.5).length;
    expect(circleCount).toBeGreaterThanOrEqual(3); // faceted, within 0.1%
  });

  it('lays out a drill grid by bounding-box spacing', () => {
    const dx = 60, dz = 40, dia = 5;        // holeSpacing = 3·dia = 15
    const r = generateCAMToolpaths(new THREE.BoxGeometry(dx, 20, dz), {
      type: 'drill', toolDiameter: dia, stepover: 40, stepdown: 5, feedRate: 1000, spindleSpeed: 1000,
    });
    const cols = Math.floor(dx / 15), rows = Math.floor(dz / 15); // 4, 2
    expect(r.toolpaths.length).toBe((cols + 1) * (rows + 1));     // 5×3 = 15
    // each hole is a plunge-retract (3 points)
    expect(r.toolpaths[0].length).toBe(3);
  });

  it('counts face-mill depth passes as ceil(dy/stepdown) with positive path length', () => {
    const dyy = 20, stepdown = 2;
    const r = generateCAMToolpaths(new THREE.BoxGeometry(60, dyy, 40), {
      type: 'face_mill', toolDiameter: 10, stepover: 50, stepdown, feedRate: 1000, spindleSpeed: 1000,
    });
    expect(r.passes).toBe(Math.ceil(dyy / stepdown)); // 10
    expect(r.totalLength).toBeGreaterThan(0);
  });
});
