/**
 * partGeometryDiff.ts — Compare two part revisions geometrically.
 *
 * BOM revision tracker (existing) shows part-list deltas. This module
 * does the *geometric* delta: are these two STL/STEP exports actually
 * the same part? If different, where and by how much? Engineers use
 * it to verify that a "no-change" PR really doesn't change anything,
 * and that a "Rev B" actually moved the dimension it was supposed to.
 *
 * Diagnostics computed:
 *
 *   - Bounding-box delta (per axis).
 *   - Volume delta (computed from triangle mesh).
 *   - Centroid delta.
 *   - Per-triangle count change.
 *   - Optional Hausdorff sample (if both meshes provided): max
 *     deviation between sampled surface points of the two meshes.
 *   - Material / mass-property delta (if user supplied densities).
 *
 * Output: structured diff suitable for a side-by-side table in the
 * PDM "compare revisions" UI.
 */

export interface MeshArrays {
  positions: number[];
  indices: number[];
}

export interface PartRevisionInput {
  /** Revision label (e.g. "A", "B", "1.0"). */
  revision: string;
  /** Mesh arrays. */
  mesh: MeshArrays;
  /** Material density (g/cm³), optional. */
  densityGcm3?: number;
}

export interface BBox {
  min: [number, number, number];
  max: [number, number, number];
}

export interface MassProperties {
  volumeCm3: number;
  massGrams?: number;
  centroid: [number, number, number];
  bbox: BBox;
}

export interface RevisionDiff {
  revA: string;
  revB: string;
  bboxDelta: {
    minDelta: [number, number, number];
    maxDelta: [number, number, number];
    /** Max single-axis change in mm. */
    largestDelta: number;
  };
  volumeDeltaCm3: number;
  volumeDeltaFraction: number;
  centroidShiftMm: number;
  triangleCountDelta: number;
  vertexCountDelta: number;
  massDeltaGrams?: number;
  /** Sample-based surface deviation, mm — only set when `computeSurface` is true. */
  surfaceDeviationMm?: number;
  /** Diff verdict. */
  verdict: 'identical' | 'minor' | 'significant' | 'major';
}

export interface DiffOptions {
  /** Volume change percent above which to mark as significant. */
  significantVolumePct: number;
  /** Bbox delta (mm) above which to mark as significant. */
  significantBboxDelta: number;
  /** Use surface-distance sampling. */
  computeSurface: boolean;
  /** Number of surface samples (when enabled). */
  surfaceSamples: number;
}

export const DEFAULT_OPTIONS: DiffOptions = {
  significantVolumePct: 1.0,
  significantBboxDelta: 0.1,
  computeSurface: false,
  surfaceSamples: 100,
};

// ── Top-level entry ────────────────────────────────────────────

export function diffParts(a: PartRevisionInput, b: PartRevisionInput, options: Partial<DiffOptions> = {}): RevisionDiff {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const mpA = computeMassProperties(a.mesh, a.densityGcm3);
  const mpB = computeMassProperties(b.mesh, b.densityGcm3);

  const minDelta: [number, number, number] = [
    mpB.bbox.min[0] - mpA.bbox.min[0],
    mpB.bbox.min[1] - mpA.bbox.min[1],
    mpB.bbox.min[2] - mpA.bbox.min[2],
  ];
  const maxDelta: [number, number, number] = [
    mpB.bbox.max[0] - mpA.bbox.max[0],
    mpB.bbox.max[1] - mpA.bbox.max[1],
    mpB.bbox.max[2] - mpA.bbox.max[2],
  ];
  const largestBbox = Math.max(
    ...minDelta.map(Math.abs),
    ...maxDelta.map(Math.abs),
  );

  const volA = mpA.volumeCm3;
  const volB = mpB.volumeCm3;
  const volDelta = volB - volA;
  const volFrac = volA > 0 ? volDelta / volA : 0;

  const centroidShift = Math.hypot(
    mpB.centroid[0] - mpA.centroid[0],
    mpB.centroid[1] - mpA.centroid[1],
    mpB.centroid[2] - mpA.centroid[2],
  );

  const triDelta = (b.mesh.indices.length - a.mesh.indices.length) / 3;
  const vertDelta = (b.mesh.positions.length - a.mesh.positions.length) / 3;

  let massDelta: number | undefined;
  if (mpA.massGrams !== undefined && mpB.massGrams !== undefined) {
    massDelta = mpB.massGrams - mpA.massGrams;
  }

  let surfaceDev: number | undefined;
  if (opts.computeSurface) {
    surfaceDev = sampleSurfaceDeviation(a.mesh, b.mesh, opts.surfaceSamples);
  }

  // Verdict.
  const volPct = Math.abs(volFrac) * 100;
  let verdict: RevisionDiff['verdict'];
  if (volPct < 0.01 && largestBbox < 0.001 && triDelta === 0) verdict = 'identical';
  else if (volPct < opts.significantVolumePct && largestBbox < opts.significantBboxDelta) verdict = 'minor';
  else if (volPct < 10 && largestBbox < 10) verdict = 'significant';
  else verdict = 'major';

  const diff: RevisionDiff = {
    revA: a.revision,
    revB: b.revision,
    bboxDelta: { minDelta, maxDelta, largestDelta: largestBbox },
    volumeDeltaCm3: volDelta,
    volumeDeltaFraction: volFrac,
    centroidShiftMm: centroidShift,
    triangleCountDelta: triDelta,
    vertexCountDelta: vertDelta,
    verdict,
  };
  if (massDelta !== undefined) diff.massDeltaGrams = massDelta;
  if (surfaceDev !== undefined) diff.surfaceDeviationMm = surfaceDev;
  return diff;
}

// ── Mass properties ────────────────────────────────────────────

export function computeMassProperties(mesh: MeshArrays, densityGcm3?: number): MassProperties {
  if (mesh.indices.length === 0) {
    return { volumeCm3: 0, centroid: [0, 0, 0], bbox: { min: [0, 0, 0], max: [0, 0, 0] } };
  }
  let xMin = Infinity, yMin = Infinity, zMin = Infinity;
  let xMax = -Infinity, yMax = -Infinity, zMax = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i]!;
    const y = mesh.positions[i + 1]!;
    const z = mesh.positions[i + 2]!;
    if (x < xMin) xMin = x; if (x > xMax) xMax = x;
    if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    if (z < zMin) zMin = z; if (z > zMax) zMax = z;
  }
  // Signed tetra volume (mm³).
  let vol = 0;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const i0 = mesh.indices[i]!;
    const i1 = mesh.indices[i + 1]!;
    const i2 = mesh.indices[i + 2]!;
    const p0: [number, number, number] = [mesh.positions[i0 * 3]!, mesh.positions[i0 * 3 + 1]!, mesh.positions[i0 * 3 + 2]!];
    const p1: [number, number, number] = [mesh.positions[i1 * 3]!, mesh.positions[i1 * 3 + 1]!, mesh.positions[i1 * 3 + 2]!];
    const p2: [number, number, number] = [mesh.positions[i2 * 3]!, mesh.positions[i2 * 3 + 1]!, mesh.positions[i2 * 3 + 2]!];
    const v = (
      p0[0] * (p1[1] * p2[2] - p1[2] * p2[1]) +
      p1[0] * (p2[1] * p0[2] - p2[2] * p0[1]) +
      p2[0] * (p0[1] * p1[2] - p0[2] * p1[1])
    ) / 6;
    vol += v;
    cx += v * (p0[0] + p1[0] + p2[0]) / 4;
    cy += v * (p0[1] + p1[1] + p2[1]) / 4;
    cz += v * (p0[2] + p1[2] + p2[2]) / 4;
  }
  const absVol = Math.abs(vol);
  const centroid: [number, number, number] = absVol > 1e-9
    ? [cx / vol, cy / vol, cz / vol]
    : [(xMin + xMax) / 2, (yMin + yMax) / 2, (zMin + zMax) / 2];
  const volCm3 = absVol / 1000;
  const result: MassProperties = {
    volumeCm3: volCm3,
    centroid,
    bbox: { min: [xMin, yMin, zMin], max: [xMax, yMax, zMax] },
  };
  if (densityGcm3 !== undefined) result.massGrams = volCm3 * densityGcm3;
  return result;
}

// ── Surface deviation (light sampling) ─────────────────────────

function sampleSurfaceDeviation(a: MeshArrays, b: MeshArrays, samples: number): number {
  if (a.indices.length === 0 || b.indices.length === 0) return 0;
  let maxDev = 0;
  for (let i = 0; i < samples; i++) {
    const idx = Math.floor((i / samples) * a.positions.length / 3);
    const px = a.positions[idx * 3] ?? 0;
    const py = a.positions[idx * 3 + 1] ?? 0;
    const pz = a.positions[idx * 3 + 2] ?? 0;
    let best = Infinity;
    for (let j = 0; j < b.positions.length; j += 3) {
      const d = Math.hypot(b.positions[j]! - px, b.positions[j + 1]! - py, b.positions[j + 2]! - pz);
      if (d < best) best = d;
    }
    if (best > maxDev) maxDev = best;
  }
  return maxDev;
}

// ── Summary ────────────────────────────────────────────────────

export interface DiffSummary {
  verdict: RevisionDiff['verdict'];
  largestBboxDeltaMm: number;
  volumeChangePct: number;
  topologyChanged: boolean;
}

export function summarize(diff: RevisionDiff): DiffSummary {
  return {
    verdict: diff.verdict,
    largestBboxDeltaMm: diff.bboxDelta.largestDelta,
    volumeChangePct: diff.volumeDeltaFraction * 100,
    topologyChanged: diff.triangleCountDelta !== 0 || diff.vertexCountDelta !== 0,
  };
}
