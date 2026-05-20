/**
 * curveFeatures.ts — Project edge, composite curve, 3D spline through
 * points, helix on surface.
 *
 * Sketches handle 2D + simple 3D curves. Beyond that, real CAD needs
 * *curve features* that derive new geometry from existing edges +
 * faces:
 *
 *   - **Project edge** — drop a 3D edge onto a face along the face's
 *     normal, producing a new 2D sketch curve on that face.
 *   - **Composite curve** — chain N edges/curves into a single
 *     parameterized curve. Used as a sweep path or motion trajectory.
 *   - **3D spline through points** — fit a smooth Catmull-Rom or
 *     cubic spline through N control points; preserve tangents at
 *     the endpoints.
 *   - **Helix on surface** — wind a helix around a surface (e.g.
 *     thread on a tapered cone, screw pattern on a torus).
 *   - **Curve on surface (geodesic)** — shortest-path-on-surface
 *     between two points (approximate).
 */

export type Vec3 = [number, number, number];

function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function scale(v: Vec3, s: number): Vec3 { return [v[0] * s, v[1] * s, v[2] * s]; }
function add(a: Vec3, b: Vec3): Vec3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function length(v: Vec3): number { return Math.hypot(v[0], v[1], v[2]); }

// ── Project edge ────────────────────────────────────────────────

export interface FacePlane {
  /** Point on the face. */
  origin: Vec3;
  /** Outward unit normal. */
  normal: Vec3;
}

/** Project a single 3D point onto a planar face along its normal. */
export function projectPointToFace(point: Vec3, face: FacePlane): Vec3 {
  const d = dot(sub(point, face.origin), face.normal);
  return [
    point[0] - d * face.normal[0],
    point[1] - d * face.normal[1],
    point[2] - d * face.normal[2],
  ];
}

/** Project a polyline edge onto a face. */
export function projectEdgeToFace(edge: Vec3[], face: FacePlane): Vec3[] {
  return edge.map(p => projectPointToFace(p, face));
}

// ── Composite curve ─────────────────────────────────────────────

export interface CurveSegment {
  points: Vec3[];
  /** Identifier (for later reference). */
  id: string;
}

export interface CompositeCurve {
  /** Continuous concatenation of all input segments. */
  points: Vec3[];
  /** Per-segment cumulative parameter ranges [tStart, tEnd] in [0,1]. */
  segmentParams: Array<{ segmentId: string; tStart: number; tEnd: number }>;
  /** Total arc length (mm). */
  totalLengthMm: number;
}

/** Build a composite curve by chaining segments. End-of-segment + start-
 *  of-next must coincide within tolerance, otherwise return null. */
export function buildCompositeCurve(segments: CurveSegment[], tolMm: number = 0.01): CompositeCurve | null {
  if (segments.length === 0) {
    return { points: [], segmentParams: [], totalLengthMm: 0 };
  }
  // Validate continuity.
  for (let i = 1; i < segments.length; i++) {
    const prevEnd = segments[i - 1]!.points[segments[i - 1]!.points.length - 1]!;
    const curStart = segments[i]!.points[0]!;
    const gap = length(sub(prevEnd, curStart));
    if (gap > tolMm) return null;
  }
  const allPoints: Vec3[] = [];
  const lengths: number[] = [];
  for (const seg of segments) {
    let segLen = 0;
    for (let i = 1; i < seg.points.length; i++) {
      segLen += length(sub(seg.points[i]!, seg.points[i - 1]!));
    }
    lengths.push(segLen);
    if (allPoints.length === 0) allPoints.push(...seg.points);
    else allPoints.push(...seg.points.slice(1)); // skip duplicate endpoint
  }
  const totalLen = lengths.reduce((s, l) => s + l, 0);
  const segmentParams: CompositeCurve['segmentParams'] = [];
  let cumLen = 0;
  for (let i = 0; i < segments.length; i++) {
    segmentParams.push({
      segmentId: segments[i]!.id,
      tStart: totalLen > 0 ? cumLen / totalLen : 0,
      tEnd: totalLen > 0 ? (cumLen + lengths[i]!) / totalLen : 1,
    });
    cumLen += lengths[i]!;
  }
  return { points: allPoints, segmentParams, totalLengthMm: totalLen };
}

/** Evaluate a composite curve at parameter t ∈ [0,1]. */
export function evalCompositeCurve(curve: CompositeCurve, t: number): Vec3 {
  if (curve.points.length === 0) return [0, 0, 0];
  if (t <= 0) return curve.points[0]!;
  if (t >= 1) return curve.points[curve.points.length - 1]!;
  // Walk segments by arc length proxy.
  const targetLen = t * curve.totalLengthMm;
  let accumLen = 0;
  for (let i = 1; i < curve.points.length; i++) {
    const segLen = length(sub(curve.points[i]!, curve.points[i - 1]!));
    if (accumLen + segLen >= targetLen) {
      const localT = segLen > 0 ? (targetLen - accumLen) / segLen : 0;
      return [
        curve.points[i - 1]![0] + (curve.points[i]![0] - curve.points[i - 1]![0]) * localT,
        curve.points[i - 1]![1] + (curve.points[i]![1] - curve.points[i - 1]![1]) * localT,
        curve.points[i - 1]![2] + (curve.points[i]![2] - curve.points[i - 1]![2]) * localT,
      ];
    }
    accumLen += segLen;
  }
  return curve.points[curve.points.length - 1]!;
}

// ── 3D spline through points (Catmull-Rom) ──────────────────────

export type SplineMode = 'catmull-rom' | 'cardinal' | 'natural-cubic';

export interface SplineOptions {
  mode: SplineMode;
  /** Tension parameter for cardinal splines (0=Catmull-Rom, 1=linear). */
  tension?: number;
  /** Samples per segment for output discretization. */
  samplesPerSegment?: number;
  /** Endpoint tangent vectors (optional). */
  startTangent?: Vec3;
  endTangent?: Vec3;
}

/** Catmull-Rom interpolation between p1 and p2 with neighbours p0 + p3. */
function catmullRomSegment(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number, tension: number = 0): Vec3 {
  const tau = (1 - tension) / 2;
  const t2 = t * t;
  const t3 = t2 * t;
  const apply = (a: number, b: number, c: number, d: number): number =>
    a * (-tau * t + 2 * tau * t2 - tau * t3)
    + b * (1 + (tau - 3) * t2 + (2 - tau) * t3)
    + c * (tau * t + (3 - 2 * tau) * t2 + (tau - 2) * t3)
    + d * (-tau * t2 + tau * t3);
  return [
    apply(p0[0], p1[0], p2[0], p3[0]),
    apply(p0[1], p1[1], p2[1], p3[1]),
    apply(p0[2], p1[2], p2[2], p3[2]),
  ];
}

export function fitSplineThroughPoints(controlPoints: Vec3[], options: SplineOptions): Vec3[] {
  if (controlPoints.length < 2) return controlPoints.slice();
  const samples = options.samplesPerSegment ?? 16;
  const tension = options.tension ?? 0;
  const out: Vec3[] = [];
  const n = controlPoints.length;
  for (let i = 0; i < n - 1; i++) {
    const p1 = controlPoints[i]!;
    const p2 = controlPoints[i + 1]!;
    const p0 = i === 0
      ? (options.startTangent ? sub(p1, options.startTangent) : p1)
      : controlPoints[i - 1]!;
    const p3 = i === n - 2
      ? (options.endTangent ? add(p2, options.endTangent) : p2)
      : controlPoints[i + 2]!;
    for (let s = 0; s < samples; s++) {
      const t = s / samples;
      out.push(catmullRomSegment(p0, p1, p2, p3, t, tension));
    }
  }
  out.push(controlPoints[n - 1]!);
  return out;
}

// ── Helix on surface ────────────────────────────────────────────

export interface HelixOnSurfaceOptions {
  /** Total turns. */
  turns: number;
  /** Pitch (mm per turn). */
  pitchMm: number;
  /** Sample count per turn. */
  samplesPerTurn: number;
  /** Axial direction (unit). */
  axisDirection: Vec3;
  /** Center of the surface at the start. */
  axisOrigin: Vec3;
  /** Initial radius (mm). */
  startRadiusMm: number;
  /** Final radius (mm) — supports tapered helix. */
  endRadiusMm: number;
}

/** Build a helix that winds around an axis, optionally tapered. */
export function helixOnSurface(options: HelixOnSurfaceOptions): Vec3[] {
  const out: Vec3[] = [];
  const totalSamples = options.samplesPerTurn * options.turns;
  // Build basis perpendicular to axisDirection.
  const a = options.axisDirection;
  const helper: Vec3 = Math.abs(a[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u: Vec3 = [
    helper[1] * a[2] - helper[2] * a[1],
    helper[2] * a[0] - helper[0] * a[2],
    helper[0] * a[1] - helper[1] * a[0],
  ];
  const uLen = length(u);
  const uN: Vec3 = [u[0] / uLen, u[1] / uLen, u[2] / uLen];
  const v: Vec3 = [
    a[1] * uN[2] - a[2] * uN[1],
    a[2] * uN[0] - a[0] * uN[2],
    a[0] * uN[1] - a[1] * uN[0],
  ];
  for (let s = 0; s <= totalSamples; s++) {
    const t = s / Math.max(1, totalSamples);
    const angle = t * options.turns * Math.PI * 2;
    const radius = options.startRadiusMm + (options.endRadiusMm - options.startRadiusMm) * t;
    const axialDistance = t * options.turns * options.pitchMm;
    const pos: Vec3 = [
      options.axisOrigin[0] + uN[0] * radius * Math.cos(angle) + v[0] * radius * Math.sin(angle) + a[0] * axialDistance,
      options.axisOrigin[1] + uN[1] * radius * Math.cos(angle) + v[1] * radius * Math.sin(angle) + a[1] * axialDistance,
      options.axisOrigin[2] + uN[2] * radius * Math.cos(angle) + v[2] * radius * Math.sin(angle) + a[2] * axialDistance,
    ];
    out.push(pos);
  }
  return out;
}

// ── Geodesic-ish curve on surface (approximate) ─────────────────

/** Approximate geodesic between two surface points by sampling the
 *  straight 3D segment + projecting each sample back to the closest
 *  triangle. For preview tier; production uses heat-method / fast-
 *  marching on the mesh. */
export function approximateGeodesic(
  start: Vec3,
  end: Vec3,
  meshPositions: number[],
  meshIndices: number[],
  samples: number = 32,
): Vec3[] {
  const out: Vec3[] = [];
  const triCount = meshIndices.length / 3;

  function projectToClosestTri(p: Vec3): Vec3 {
    let best: Vec3 = p;
    let bestDist = Infinity;
    for (let t = 0; t < triCount; t++) {
      const i0 = meshIndices[t * 3]!;
      const i1 = meshIndices[t * 3 + 1]!;
      const i2 = meshIndices[t * 3 + 2]!;
      const a: Vec3 = [meshPositions[i0 * 3]!, meshPositions[i0 * 3 + 1]!, meshPositions[i0 * 3 + 2]!];
      const b: Vec3 = [meshPositions[i1 * 3]!, meshPositions[i1 * 3 + 1]!, meshPositions[i1 * 3 + 2]!];
      const c: Vec3 = [meshPositions[i2 * 3]!, meshPositions[i2 * 3 + 1]!, meshPositions[i2 * 3 + 2]!];
      const e1 = sub(b, a);
      const e2 = sub(c, a);
      const nx = e1[1] * e2[2] - e1[2] * e2[1];
      const ny = e1[2] * e2[0] - e1[0] * e2[2];
      const nz = e1[0] * e2[1] - e1[1] * e2[0];
      const nLen = Math.hypot(nx, ny, nz);
      if (nLen === 0) continue;
      const n: Vec3 = [nx / nLen, ny / nLen, nz / nLen];
      const d = dot(sub(p, a), n);
      const proj: Vec3 = [p[0] - d * n[0], p[1] - d * n[1], p[2] - d * n[2]];
      const dist = Math.abs(d);
      if (dist < bestDist) {
        bestDist = dist;
        best = proj;
      }
    }
    return best;
  }

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const straight: Vec3 = [
      start[0] + (end[0] - start[0]) * t,
      start[1] + (end[1] - start[1]) * t,
      start[2] + (end[2] - start[2]) * t,
    ];
    out.push(projectToClosestTri(straight));
  }
  void scale; // silence unused
  return out;
}
