/**
 * loft.ts — Multi-section loft surface.
 *
 * Lofting interpolates a series of cross-section curves into a single
 * smooth surface. The curves are sampled at matching parameter
 * positions (uniform sampling across the curve's knot range), and the
 * resulting point sequences are joined to form quad strips that
 * tessellate into the output BufferGeometry.
 *
 * Scope of this implementation:
 *   - Equal sampling per cross-section (each curve provides the same
 *     point count). Caller is responsible for matching curve degrees
 *     and knot vectors if they want strict NURBS continuity; we just
 *     sample geometry.
 *   - Linear interpolation between consecutive sections (degree-1 in
 *     the V direction). Higher-order V interpolation (Hermite, NURBS)
 *     lands in a follow-up once the use cases settle.
 *   - Open loft only (sections are not wrapped back to the first).
 *
 * Out of scope (follow-up):
 *   - Guide curves (rail-driven lofts).
 *   - Tangency constraints at section boundaries.
 *   - Closed lofts (section[0] === section[N]).
 */

import * as THREE from 'three';
import { sampleNurbsCurve3D, type NurbsCurve3D } from './nurbsCurve';

export interface LoftOptions {
  /** Number of points sampled per cross-section. Same for every section. */
  sectionSampleCount: number;
  /** Number of segments BETWEEN consecutive sections (1 = no
   *  interpolation, just connect with quads; larger = smoother). */
  segmentsBetweenSections?: number;
}

export interface LoftReport {
  sectionCount: number;
  sectionSampleCount: number;
  totalVertices: number;
  totalTriangles: number;
}

export interface LoftResult {
  geometry: THREE.BufferGeometry;
  report: LoftReport;
}

/** Build a lofted surface from `sections` (≥ 2 cross-section curves).
 *  Each cross-section is sampled into N points; consecutive sections
 *  are connected by quad strips, optionally subdivided along V for
 *  smoother shading. */
export function buildLoft(sections: NurbsCurve3D[], opts: LoftOptions): LoftResult {
  if (sections.length < 2) {
    return {
      geometry: new THREE.BufferGeometry(),
      report: {
        sectionCount: sections.length,
        sectionSampleCount: opts.sectionSampleCount,
        totalVertices: 0, totalTriangles: 0,
      },
    };
  }
  const N = Math.max(2, Math.floor(opts.sectionSampleCount));
  const segBetween = Math.max(1, Math.floor(opts.segmentsBetweenSections ?? 1));

  // Sample every cross-section at the same parameter values.
  const sectionPoints: THREE.Vector3[][] = sections.map(s => sampleNurbsCurve3D(s, N));

  // For each interval between sections, generate `segBetween` rows of
  // interpolated points (skipping the duplicated endpoint of each
  // subsequent interval so the row grid stays consecutive).
  const rows: THREE.Vector3[][] = [];
  rows.push(sectionPoints[0]);
  for (let s = 0; s < sectionPoints.length - 1; s++) {
    const from = sectionPoints[s];
    const to = sectionPoints[s + 1];
    for (let step = 1; step <= segBetween; step++) {
      const t = step / segBetween;
      const row: THREE.Vector3[] = [];
      for (let i = 0; i < N; i++) {
        row.push(new THREE.Vector3(
          from[i].x + (to[i].x - from[i].x) * t,
          from[i].y + (to[i].y - from[i].y) * t,
          from[i].z + (to[i].z - from[i].z) * t,
        ));
      }
      rows.push(row);
    }
  }

  const totalRows = rows.length;
  const positions: number[] = [];
  for (const row of rows) {
    for (const p of row) positions.push(p.x, p.y, p.z);
  }

  const indices: number[] = [];
  for (let r = 0; r < totalRows - 1; r++) {
    for (let i = 0; i < N - 1; i++) {
      const a = r * N + i;
      const b = a + 1;
      const c = a + N;
      const d = c + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return {
    geometry: geo,
    report: {
      sectionCount: sections.length,
      sectionSampleCount: N,
      totalVertices: positions.length / 3,
      totalTriangles: indices.length / 3,
    },
  };
}
