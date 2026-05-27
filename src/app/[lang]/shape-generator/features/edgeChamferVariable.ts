/**
 * edgeChamferVariable.ts — Variable-width chamfer along an edge.
 *
 * Uniform chamfer (existing `features/chamfer.ts`) trims a constant
 * amount from every point of an edge. Variable chamfer specifies a
 * width *profile* along the edge — anchor points at parameter values
 * 0..1 with widths, interpolated linearly (or with smoother spline).
 *
 * Why: real shop drawings often have a transition (e.g., bevel grows
 * from 1mm at the start to 5mm at the corner, then shrinks). It is
 * also the basis for non-uniform fillets — though here we focus on
 * chamfers (flat planar cut).
 *
 * Algorithm:
 *
 *   1. Sample the edge polyline at N parameter values.
 *   2. At each sample, evaluate the width profile.
 *   3. Compute the chamfer cut plane: offset the edge sample by
 *      `width × outward-normal` and `width × second-normal` to form
 *      a small chamfer quad.
 *   4. Output a strip of chamfer quads + the trimmed edge polyline.
 *
 * This is the *geometric* core; the caller is responsible for
 * boolean-cutting the chamfer prism against the body.
 */

export interface ChamferAnchor {
  /** Parameter along the edge (0..1). */
  t: number;
  /** Width to trim, mm. */
  widthMm: number;
}

export interface ChamferProfile {
  /** Anchor list sorted by `t`. Must include t=0 and t=1. */
  anchors: ChamferAnchor[];
  /** Linear or smooth interpolation. */
  interpolation: 'linear' | 'smooth';
}

export interface EdgePolyline {
  /** Ordered 3D points. */
  points: Array<[number, number, number]>;
  /** Outward normals at each point (unit vectors). For a half-edge
   *  this is the cross product of the two adjacent face normals. */
  outwardNormals: Array<[number, number, number]>;
  /** Second normals (orthogonal to edge tangent and outward). */
  secondNormals: Array<[number, number, number]>;
}

export interface ChamferStrip {
  /** Sample positions along the edge. */
  edgeSamples: Array<[number, number, number]>;
  /** First side of the chamfer (offset along outward). */
  sideA: Array<[number, number, number]>;
  /** Second side of the chamfer (offset along secondNormal). */
  sideB: Array<[number, number, number]>;
  /** Width at each sample. */
  widths: number[];
  /** Triangles for the chamfer strip (flat indices). */
  indices: number[];
}

// ── Top-level entry ────────────────────────────────────────────

export function buildVariableChamfer(
  edge: EdgePolyline,
  profile: ChamferProfile,
  sampleCount: number,
): ChamferStrip {
  if (edge.points.length < 2) {
    return { edgeSamples: [], sideA: [], sideB: [], widths: [], indices: [] };
  }
  const sortedAnchors = [...profile.anchors].sort((a, b) => a.t - b.t);
  validateProfile(sortedAnchors);

  const edgeSamples: Array<[number, number, number]> = [];
  const sideA: Array<[number, number, number]> = [];
  const sideB: Array<[number, number, number]> = [];
  const widths: number[] = [];

  for (let i = 0; i < sampleCount; i++) {
    const t = sampleCount === 1 ? 0 : i / (sampleCount - 1);
    const pos = samplePolyline(edge.points, t);
    const oNorm = samplePolyline(edge.outwardNormals, t);
    const sNorm = samplePolyline(edge.secondNormals, t);
    const w = evaluateProfile(sortedAnchors, profile.interpolation, t);
    edgeSamples.push(pos);
    widths.push(w);
    sideA.push([pos[0] + oNorm[0] * w, pos[1] + oNorm[1] * w, pos[2] + oNorm[2] * w]);
    sideB.push([pos[0] + sNorm[0] * w, pos[1] + sNorm[1] * w, pos[2] + sNorm[2] * w]);
  }

  // Build strip triangles: between sample i and i+1, connect (sideA[i], sideB[i], sideA[i+1], sideB[i+1]).
  const indices: number[] = [];
  for (let i = 0; i < sampleCount - 1; i++) {
    // We pack vertices as [sideA[0], sideB[0], sideA[1], sideB[1], ...].
    const aLow = i * 2;
    const bLow = i * 2 + 1;
    const aHigh = (i + 1) * 2;
    const bHigh = (i + 1) * 2 + 1;
    indices.push(aLow, bLow, aHigh);
    indices.push(bLow, bHigh, aHigh);
  }

  return { edgeSamples, sideA, sideB, widths, indices };
}

// ── Profile evaluation ─────────────────────────────────────────

function validateProfile(anchors: ChamferAnchor[]): void {
  if (anchors.length < 2) throw new Error('profile needs ≥ 2 anchors');
  if (anchors[0]!.t > 1e-6) throw new Error('first anchor must be at t=0');
  if (anchors[anchors.length - 1]!.t < 1 - 1e-6) throw new Error('last anchor must be at t=1');
  for (const a of anchors) if (a.widthMm < 0) throw new Error('width cannot be negative');
}

export function evaluateProfile(
  anchors: ChamferAnchor[],
  interpolation: 'linear' | 'smooth',
  t: number,
): number {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i]!;
    const b = anchors[i + 1]!;
    if (clamped >= a.t && clamped <= b.t) {
      if (Math.abs(b.t - a.t) < 1e-9) return a.widthMm;
      const local = (clamped - a.t) / (b.t - a.t);
      const blend = interpolation === 'smooth' ? smoothstep(local) : local;
      return a.widthMm + (b.widthMm - a.widthMm) * blend;
    }
  }
  return anchors[anchors.length - 1]!.widthMm;
}

function smoothstep(x: number): number {
  return x * x * (3 - 2 * x);
}

// ── Polyline sampling ──────────────────────────────────────────

function samplePolyline(points: Array<[number, number, number]>, t: number): [number, number, number] {
  if (points.length === 0) return [0, 0, 0];
  if (points.length === 1) return points[0]!;
  const u = Math.max(0, Math.min(0.9999, t)) * (points.length - 1);
  const i = Math.floor(u);
  const f = u - i;
  const a = points[i]!;
  const b = points[Math.min(points.length - 1, i + 1)]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

// ── Built-in profiles ──────────────────────────────────────────

export function constantProfile(widthMm: number): ChamferProfile {
  return {
    anchors: [{ t: 0, widthMm }, { t: 1, widthMm }],
    interpolation: 'linear',
  };
}

export function linearGrowthProfile(startMm: number, endMm: number): ChamferProfile {
  return {
    anchors: [{ t: 0, widthMm: startMm }, { t: 1, widthMm: endMm }],
    interpolation: 'linear',
  };
}

export function bumpProfile(peakMm: number, peakT: number = 0.5): ChamferProfile {
  return {
    anchors: [
      { t: 0, widthMm: 0 },
      { t: peakT, widthMm: peakMm },
      { t: 1, widthMm: 0 },
    ],
    interpolation: 'smooth',
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface ChamferStats {
  sampleCount: number;
  triangleCount: number;
  minWidthMm: number;
  maxWidthMm: number;
  averageWidthMm: number;
  /** Approximate trimmed length (mm). */
  edgeLengthMm: number;
}

export function computeStats(strip: ChamferStrip): ChamferStats {
  if (strip.widths.length === 0) {
    return { sampleCount: 0, triangleCount: 0, minWidthMm: 0, maxWidthMm: 0, averageWidthMm: 0, edgeLengthMm: 0 };
  }
  let length = 0;
  for (let i = 1; i < strip.edgeSamples.length; i++) {
    const a = strip.edgeSamples[i - 1]!;
    const b = strip.edgeSamples[i]!;
    length += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const w of strip.widths) {
    sum += w;
    if (w < min) min = w;
    if (w > max) max = w;
  }
  return {
    sampleCount: strip.widths.length,
    triangleCount: strip.indices.length / 3,
    minWidthMm: min,
    maxWidthMm: max,
    averageWidthMm: sum / strip.widths.length,
    edgeLengthMm: length,
  };
}
