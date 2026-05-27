import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildLoft } from './loft';
import type { NurbsCurve3D } from './nurbsCurve';

/** Circle-ish quadratic NURBS at height z. Not a true circle, but
 *  closed-loop enough for loft tests. */
function ringCurve(radius: number, z: number): NurbsCurve3D {
  const N = 8;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < N; i++) {
    const t = (i / (N - 1)) * Math.PI * 2;
    pts.push(new THREE.Vector3(radius * Math.cos(t), radius * Math.sin(t), z));
  }
  return {
    controlPoints: pts,
    degree: 1,
    knots: [
      0,
      ...Array.from({ length: N - 1 }, (_, i) => i / (N - 2)),
      1,
    ],
  };
}

/** Straight line cross-section in XY at height z. */
function lineSection(length: number, z: number): NurbsCurve3D {
  return {
    controlPoints: [
      new THREE.Vector3(0, 0, z),
      new THREE.Vector3(length, 0, z),
    ],
    degree: 1,
    knots: [0, 0, 1, 1],
  };
}

describe('buildLoft · structural counts', () => {
  it('produces (N) verts × (sections) rows when segmentsBetweenSections=1', () => {
    const sections = [lineSection(10, 0), lineSection(10, 5)];
    const r = buildLoft(sections, { sectionSampleCount: 4, segmentsBetweenSections: 1 });
    // 2 rows × 4 cols = 8 verts.
    expect(r.report.totalVertices).toBe(8);
    // 2 triangles per quad × 3 quads × 1 row gap = 6 triangles.
    expect(r.report.totalTriangles).toBe(6);
  });

  it('subdivides between sections when segmentsBetweenSections > 1', () => {
    const sections = [lineSection(10, 0), lineSection(10, 5)];
    const r = buildLoft(sections, { sectionSampleCount: 3, segmentsBetweenSections: 4 });
    // 1 + 4 = 5 rows × 3 cols = 15 verts.
    expect(r.report.totalVertices).toBe(15);
  });

  it('chains multiple sections (3+) without losing rows', () => {
    const sections = [lineSection(10, 0), lineSection(10, 5), lineSection(10, 10)];
    const r = buildLoft(sections, { sectionSampleCount: 3, segmentsBetweenSections: 2 });
    // 1 initial + 2 segs/gap × 2 gaps = 5 rows.
    expect(r.report.totalVertices).toBe(5 * 3);
  });
});

describe('buildLoft · geometry correctness', () => {
  it('first row matches the first section samples (corners pinned)', () => {
    const sections = [lineSection(10, 0), lineSection(10, 5)];
    const r = buildLoft(sections, { sectionSampleCount: 3, segmentsBetweenSections: 1 });
    const pos = r.geometry.getAttribute('position');
    // First row should sit on z=0 plane.
    for (let i = 0; i < 3; i++) {
      expect(pos.getZ(i)).toBeCloseTo(0);
    }
    // Last row should sit on z=5 plane.
    for (let i = 3; i < 6; i++) {
      expect(pos.getZ(i)).toBeCloseTo(5);
    }
  });

  it('interpolated rows lie at the expected fractional Z', () => {
    const sections = [lineSection(10, 0), lineSection(10, 10)];
    const r = buildLoft(sections, { sectionSampleCount: 3, segmentsBetweenSections: 4 });
    const pos = r.geometry.getAttribute('position');
    // Row 2 (index 1 since 0 = first section) → t = 1/4 → z = 2.5
    expect(pos.getZ(3)).toBeCloseTo(2.5);
    // Row 3 → z = 5
    expect(pos.getZ(6)).toBeCloseTo(5);
  });

  it('handles two ring sections (varying radius)', () => {
    const r = buildLoft(
      [ringCurve(10, 0), ringCurve(5, 20)],
      { sectionSampleCount: 8 },
    );
    expect(r.report.totalVertices).toBeGreaterThan(0);
    r.geometry.computeBoundingBox();
    const bb = r.geometry.boundingBox!;
    expect(bb.max.z).toBeCloseTo(20, 1);
    expect(bb.min.z).toBeCloseTo(0, 1);
    // Radius drops along Z: max-X at z=0 is ~10, at z=20 is ~5.
    expect(bb.max.x).toBeLessThanOrEqual(10 + 0.5);
  });
});

describe('buildLoft · invariants', () => {
  it('returns an empty geometry when given fewer than 2 sections', () => {
    const r = buildLoft([lineSection(10, 0)], { sectionSampleCount: 4 });
    expect(r.report.totalVertices).toBe(0);
    expect(r.report.totalTriangles).toBe(0);
  });

  it('computes normals on the output', () => {
    const r = buildLoft(
      [lineSection(10, 0), lineSection(10, 5)],
      { sectionSampleCount: 3 },
    );
    expect(r.geometry.getAttribute('normal')).toBeDefined();
  });

  it('clamps sectionSampleCount to ≥ 2', () => {
    const r = buildLoft(
      [lineSection(10, 0), lineSection(10, 5)],
      { sectionSampleCount: 1 },
    );
    expect(r.report.sectionSampleCount).toBe(2);
  });
});
