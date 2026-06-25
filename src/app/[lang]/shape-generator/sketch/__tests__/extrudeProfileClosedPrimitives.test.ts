/**
 * extrudeProfile — closed-primitive tessellation (circle/rect/polygon/ellipse/
 * slot), fixing the "circle-only sketch yields 'Sketch produced empty
 * geometry'" class (REF-PART 2 pinned finding): profileToPoints used to sample
 * line/arc/nurbs and silently SKIP every closed primitive, so the most common
 * sketch op (draw circle → extrude/cut) failed on every plane.
 *
 * Hole semantics (documented contract): holes are modelled by the
 * MULTI-PROFILE path — profileToGeometryMulti(profiles), profiles[1..] become
 * THREE.Shape holes. A circle mixed into the same single profile as other
 * segments is appended inline (degenerate authoring), not treated as a hole.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  profileToPoints,
  profileToGeometry,
  profileToGeometryMulti,
  brepContourPoints,
  countContourEdgesPerSegment,
  CIRCLE_CONTOUR_EDGES,
  ELLIPSE_CONTOUR_EDGES,
  SLOT_CAP_EDGES,
  POLYGON_DEFAULT_SIDES,
} from '../extrudeProfile';
import type { SketchProfile, SketchConfig } from '../types';

const config = (depth = 10): SketchConfig => ({
  mode: 'extrude',
  depth,
  revolveAngle: 360,
  revolveAxis: 'y',
  segments: 32,
});

const single = (seg: SketchProfile['segments'][number]): SketchProfile =>
  ({ segments: [seg], closed: true });

const circle = (cx: number, cy: number, r: number): SketchProfile['segments'][number] =>
  ({ type: 'circle', id: 'c', points: [{ x: cx, y: cy }, { x: cx + r, y: cy }] });

function meshVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  let vol = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    const ax = pos.getX(i0), ay = pos.getY(i0), az = pos.getZ(i0);
    const bx = pos.getX(i1), by = pos.getY(i1), bz = pos.getZ(i1);
    const cx = pos.getX(i2), cy = pos.getY(i2), cz = pos.getZ(i2);
    vol += ax * (by * cz - bz * cy) + bx * (cy * az - cz * ay) + cx * (ay * bz - az * by);
  }
  return Math.abs(vol / 6);
}

/** Area of the regular n-gon inscribed in radius r (the tessellated circle). */
const ngonArea = (n: number, r: number) => (n / 2) * r * r * Math.sin((2 * Math.PI) / n);

describe('profileToPoints — closed primitives now sample (was: skipped)', () => {
  it('circle-only profile samples CIRCLE_CONTOUR_EDGES points on the radius', () => {
    const pts = profileToPoints(single(circle(5, -3, 7)));
    expect(pts).toHaveLength(CIRCLE_CONTOUR_EDGES);
    for (const p of pts) {
      expect(Math.hypot(p.x - 5, p.y + 3)).toBeCloseTo(7, 6);
    }
  });

  it('rect segment samples its 4 corners', () => {
    const pts = profileToPoints(single({ type: 'rect', id: 'r', points: [{ x: -2, y: -1 }, { x: 4, y: 3 }] }));
    expect(pts).toHaveLength(4);
    expect(pts).toContainEqual({ x: -2, y: -1 });
    expect(pts).toContainEqual({ x: 4, y: 3 });
  });

  it('polygon segment samples POLYGON_DEFAULT_SIDES vertices (side count is not in the data model)', () => {
    const pts = profileToPoints(single({ type: 'polygon', id: 'p', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }));
    expect(pts).toHaveLength(POLYGON_DEFAULT_SIDES);
    for (const p of pts) expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 6);
  });

  it('ellipse segment samples ELLIPSE_CONTOUR_EDGES points on the ellipse', () => {
    const pts = profileToPoints(single({
      type: 'ellipse', id: 'e',
      points: [{ x: 1, y: 2 }, { x: 1 + 8, y: 2 }, { x: 1, y: 2 + 5 }],
    }));
    expect(pts).toHaveLength(ELLIPSE_CONTOUR_EDGES);
    for (const p of pts) {
      const u = (p.x - 1) / 8, v = (p.y - 2) / 5;
      expect(Math.hypot(u, v)).toBeCloseTo(1, 6);
    }
  });

  it('slot segment samples a closed capsule (2·(SLOT_CAP_EDGES+1) points)', () => {
    const pts = profileToPoints(single({
      type: 'slot', id: 's',
      points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 4 }], // r = 4
    }));
    expect(pts).toHaveLength(2 * (SLOT_CAP_EDGES + 1));
    // Every point is on the capsule boundary: distance to segment [c1,c2] = r.
    for (const p of pts) {
      const t = Math.max(0, Math.min(1, p.x / 20));
      const d = Math.hypot(p.x - 20 * t, p.y);
      expect(d).toBeCloseTo(4, 6);
    }
  });

  it('degenerate primitives (zero radius / zero-size rect) contribute no points', () => {
    expect(profileToPoints(single(circle(0, 0, 0)))).toHaveLength(0);
    expect(profileToPoints(single({ type: 'rect', id: 'r', points: [{ x: 1, y: 1 }, { x: 1, y: 5 }] }))).toHaveLength(0);
  });
});

describe('profileToGeometry — circle-only sketches extrude (the REF-PART 2 fix)', () => {
  it('extrudes a circle-only profile into a 32-gon prism of the right volume', () => {
    const geo = profileToGeometry(single(circle(0, 0, 3)), config(8));
    expect(geo).not.toBeNull();
    const expected = ngonArea(CIRCLE_CONTOUR_EDGES, 3) * 8; // ≈ π·9·8 × 0.9968
    expect(meshVolume(geo!)).toBeCloseTo(expected, 1);
  });

  it('extrudes ellipse / slot / polygon-only profiles with closed-form volumes', () => {
    const ell = profileToGeometry(single({
      type: 'ellipse', id: 'e', points: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 0, y: 5 }],
    }), config(10));
    expect(ell).not.toBeNull();
    // n-gon-inscribed ellipse area = (n/2)·rx·ry·sin(2π/n)
    expect(meshVolume(ell!)).toBeCloseTo((ELLIPSE_CONTOUR_EDGES / 2) * 8 * 5 * Math.sin((2 * Math.PI) / ELLIPSE_CONTOUR_EDGES) * 10, 0);

    const slot = profileToGeometry(single({
      type: 'slot', id: 's', points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 4 }],
    }), config(5));
    expect(slot).not.toBeNull();
    // Capsule area = 2·r·L + (tessellated) π·r²; caps are 2·SLOT_CAP_EDGES-gon-ish.
    const capArea = ngonArea(2 * SLOT_CAP_EDGES, 4);
    expect(meshVolume(slot!)).toBeCloseTo((2 * 4 * 20 + capArea) * 5, 0);

    const hex = profileToGeometry(single({
      type: 'polygon', id: 'p', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
    }), config(4));
    expect(hex).not.toBeNull();
    expect(meshVolume(hex!)).toBeCloseTo(ngonArea(POLYGON_DEFAULT_SIDES, 10) * 4, 1);
  });

  it('extrudes a typed rect-only profile (was also skipped → null)', () => {
    const geo = profileToGeometry(single({ type: 'rect', id: 'r', points: [{ x: 0, y: 0 }, { x: 6, y: 4 }] }), config(2));
    expect(geo).not.toBeNull();
    expect(meshVolume(geo!)).toBeCloseTo(6 * 4 * 2, 4);
  });
});

describe('profileToGeometryMulti — a circle profile inside an outer loop is a HOLE', () => {
  it('outer rect + inner circle → volume = rect − tessellated circle', () => {
    const outer = single({ type: 'rect', id: 'o', points: [{ x: -10, y: -10 }, { x: 10, y: 10 }] });
    const hole = single(circle(0, 0, 4));
    const geo = profileToGeometryMulti([outer, hole], config(6));
    expect(geo).not.toBeNull();
    const expected = (20 * 20 - ngonArea(CIRCLE_CONTOUR_EDGES, 4)) * 6;
    expect(meshVolume(geo!)).toBeCloseTo(expected, 0);
  });
});

describe('mesh ↔ B-rep correspondence stays intact', () => {
  it('countContourEdgesPerSegment mirrors profileToPoints for every closed primitive', () => {
    const profiles: SketchProfile[] = [
      single(circle(0, 0, 5)),
      single({ type: 'rect', id: 'r', points: [{ x: 0, y: 0 }, { x: 4, y: 3 }] }),
      single({ type: 'polygon', id: 'p', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] }),
      single({ type: 'ellipse', id: 'e', points: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 0, y: 2 }] }),
      single({ type: 'slot', id: 's', points: [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 0, y: 2 }] }),
    ];
    for (const profile of profiles) {
      const counts = countContourEdgesPerSegment(profile);
      expect(counts).toHaveLength(1);
      expect(counts[0]).toBe(profileToPoints(profile).length);
    }
  });

  it('brepContourPoints still routes a single circle to the exact-cylinder path (null)', () => {
    expect(brepContourPoints(single(circle(0, 0, 5)))).toBeNull();
  });

  it('brepContourPoints keeps the exact 4-corner contour for a single rect', () => {
    const pts = brepContourPoints(single({ type: 'rect', id: 'r', points: [{ x: 0, y: 0 }, { x: 4, y: 3 }] }));
    expect(pts).toHaveLength(4);
  });
});
