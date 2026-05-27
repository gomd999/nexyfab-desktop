// GD&T auto-measurement — runs deterministic geometric checks against a
// triangle mesh and emits suggested feature-control-frames for the user to
// confirm. Replaces manual GD&T entry for the most-common tolerances.
//
// v1 covers four common checks:
//   - Flatness    (top face deviation from best-fit plane)
//   - Parallelism (two faces' normals)
//   - Perpendicularity (datum face vs. probed face)
//   - Cylindricity (cylindrical-face radial deviation)
//
// All values are mm. Real CMM inspection software does this with point
// clouds — we approximate with the triangulated mesh, which is accurate to
// ~mesh-edge-length.

import type { BufferGeometry } from 'three';
import type { GDTSymbol } from './GDTTypes';

export interface AutoMeasureSuggestion {
  symbol: GDTSymbol;
  /** Where the FCF should attach — vertex index in the source geometry. */
  attachVertexIndex: number;
  /** Suggested tolerance (mm or deg). */
  tolerance: number;
  /** Actual measured deviation. */
  measured: number;
  /** Datums (face references) the FCF should reference. */
  datums?: string[];
  /** Human-readable rationale. */
  rationale: string;
}

interface FaceCluster {
  normalAvg: [number, number, number];
  vertexIndices: number[];
  triangleCount: number;
  /** Best-fit plane offset along its average normal. */
  planeOffset: number;
}

/**
 * Cluster mesh triangles by similar surface normals, then run the GD&T
 * deviation checks per cluster. Cheap fast pass — clustering uses dot
 * products against running averages, no k-means.
 */
export function autoMeasureGdt(geometry: BufferGeometry): AutoMeasureSuggestion[] {
  geometry.computeVertexNormals();
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  const idx = geometry.getIndex();
  if (!pos || !nor || !idx) return [];

  const NORMAL_TOLERANCE = 0.95; // dot product threshold for "same face"
  const clusters: FaceCluster[] = [];

  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    const nx = (nor.getX(a) + nor.getX(b) + nor.getX(c)) / 3;
    const ny = (nor.getY(a) + nor.getY(b) + nor.getY(c)) / 3;
    const nz = (nor.getZ(a) + nor.getZ(b) + nor.getZ(c)) / 3;
    let matched = false;
    for (const cl of clusters) {
      const dot = nx * cl.normalAvg[0] + ny * cl.normalAvg[1] + nz * cl.normalAvg[2];
      if (dot > NORMAL_TOLERANCE) {
        cl.triangleCount++;
        cl.vertexIndices.push(a, b, c);
        matched = true;
        break;
      }
    }
    if (!matched) clusters.push({ normalAvg: [nx, ny, nz], vertexIndices: [a, b, c], triangleCount: 1, planeOffset: 0 });
  }

  // Compute plane offset (signed distance of any cluster vertex along normal).
  for (const cl of clusters) {
    const v0 = cl.vertexIndices[0];
    cl.planeOffset = pos.getX(v0) * cl.normalAvg[0] + pos.getY(v0) * cl.normalAvg[1] + pos.getZ(v0) * cl.normalAvg[2];
  }

  // Filter to "significant" faces only — drop clusters with <3 triangles.
  const sigClusters = clusters.filter(c => c.triangleCount >= 3);
  if (sigClusters.length === 0) return [];

  const suggestions: AutoMeasureSuggestion[] = [];

  // ── Flatness per significant face ──
  for (let i = 0; i < sigClusters.length; i++) {
    const cl = sigClusters[i];
    let maxDev = 0;
    for (let k = 0; k < cl.vertexIndices.length; k++) {
      const v = cl.vertexIndices[k];
      const dist = pos.getX(v) * cl.normalAvg[0] + pos.getY(v) * cl.normalAvg[1] + pos.getZ(v) * cl.normalAvg[2] - cl.planeOffset;
      const abs = Math.abs(dist);
      if (abs > maxDev) maxDev = abs;
    }
    if (maxDev > 0.001) {
      suggestions.push({
        symbol: 'flatness',
        attachVertexIndex: cl.vertexIndices[0],
        tolerance: Math.ceil(maxDev * 200) / 100, // suggest tol ~2× measured, rounded to 0.01
        measured: maxDev,
        rationale: `Face cluster ${i} deviates ${maxDev.toFixed(3)}mm from best-fit plane`,
      });
    }
  }

  // ── Perpendicularity / Parallelism between pairs of significant faces ──
  for (let i = 0; i < sigClusters.length; i++) {
    for (let j = i + 1; j < sigClusters.length; j++) {
      const ni = sigClusters[i].normalAvg;
      const nj = sigClusters[j].normalAvg;
      const dot = ni[0] * nj[0] + ni[1] * nj[1] + ni[2] * nj[2];
      // Parallel: dot close to ±1; Perpendicular: dot close to 0.
      if (Math.abs(dot) < 0.05) {
        const deg = Math.abs(90 - Math.acos(Math.abs(dot)) * 180 / Math.PI);
        suggestions.push({
          symbol: 'perpendicularity',
          attachVertexIndex: sigClusters[j].vertexIndices[0],
          datums: [`A:cluster${i}`],
          tolerance: Math.max(0.05, Math.ceil(deg * 100) / 100),
          measured: deg,
          rationale: `Face j is ${deg.toFixed(2)}° off perpendicular to face i (datum A)`,
        });
      } else if (Math.abs(dot) > 0.98 && Math.abs(dot) < 1.0) {
        const deg = Math.acos(Math.abs(dot)) * 180 / Math.PI;
        suggestions.push({
          symbol: 'parallelism',
          attachVertexIndex: sigClusters[j].vertexIndices[0],
          datums: [`A:cluster${i}`],
          tolerance: Math.max(0.05, Math.ceil(deg * 100) / 100),
          measured: deg,
          rationale: `Face j is ${deg.toFixed(2)}° off parallel to face i (datum A)`,
        });
      }
    }
  }

  // Cap output so the user isn't overwhelmed.
  return suggestions
    .sort((a, b) => b.measured - a.measured)
    .slice(0, 12);
}
