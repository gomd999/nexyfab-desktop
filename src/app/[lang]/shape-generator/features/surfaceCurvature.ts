/**
 * surfaceCurvature.ts — Class-A surface inspection data.
 *
 * Class-A surfaces (automotive body panels, consumer-product housings)
 * require G2 continuity — adjacent patches must match in *curvature*
 * not just position+tangent. Designers use three traditional
 * visual tools to audit this:
 *
 *   - **Curvature comb** along a curve: for every sample point, draw
 *     a line normal to the curve whose length is proportional to the
 *     curvature 1/R. Smooth transition = smooth curve.
 *   - **Zebra stripes** on a surface: simulate a paint reflection of
 *     evenly-spaced black-and-white stripes. Discontinuities in the
 *     stripes reveal G0/G1/G2 issues.
 *   - **Porcupine quills** on a curve: short normals every Δt; quills
 *     "fan out" on convex regions and "twist" at inflection points.
 *
 * This module emits the *data* for those visualizations — actual
 * rendering is up to the React/Three.js layer.
 */

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface CurveSample {
  /** Parameter along curve (0..1). */
  t: number;
  /** Position in world coords (mm). */
  position: Point3D;
  /** Unit tangent. */
  tangent: Point3D;
  /** Unit normal (in the curve's osculating plane). */
  normal: Point3D;
  /** Signed curvature (1/mm). Positive = bending toward normal. */
  curvature: number;
}

// ── Curve sampling ──────────────────────────────────────────────

/** Sample a discrete polyline as if it were a smooth curve, computing
 *  curvature via the inscribed-circle (Menger curvature) of every
 *  triple of consecutive points. */
export function sampleCurveFromPolyline(points: Point3D[]): CurveSample[] {
  const n = points.length;
  if (n < 2) return [];
  // Cumulative arc length.
  const arc: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    arc[i] = arc[i - 1]! + distance(points[i - 1]!, points[i]!);
  }
  const totalLen = arc[n - 1]!;

  // First pass: unit tangents, plus the unsigned Menger curvature and the
  // binormal (unit a×b) at every interior point.
  const tangents: Point3D[] = new Array(n);
  const binormals: Array<Point3D | null> = new Array(n).fill(null);
  const kappaMag: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let tx = 0, ty = 0, tz = 0;
    if (i === 0) { tx = points[1]!.x - points[0]!.x; ty = points[1]!.y - points[0]!.y; tz = points[1]!.z - points[0]!.z; }
    else if (i === n - 1) { tx = points[n - 1]!.x - points[n - 2]!.x; ty = points[n - 1]!.y - points[n - 2]!.y; tz = points[n - 1]!.z - points[n - 2]!.z; }
    else { tx = points[i + 1]!.x - points[i - 1]!.x; ty = points[i + 1]!.y - points[i - 1]!.y; tz = points[i + 1]!.z - points[i - 1]!.z; }
    const tLen = Math.hypot(tx, ty, tz) || 1;
    tangents[i] = { x: tx / tLen, y: ty / tLen, z: tz / tLen };
    if (i > 0 && i < n - 1) {
      const m = mengerCurvature(points[i - 1]!, points[i]!, points[i + 1]!);
      kappaMag[i] = m.curvature;
      binormals[i] = m.normal; // unit binormal
    }
  }

  // Reference binormal = the binormal at the highest-curvature interior point.
  // Signing every sample's curvature by sign(B·refB) makes the curvature flip
  // across an inflection (binormal reversal) — the input findInflectionPoints
  // needs. For a planar curve this is the textbook signed curvature.
  let refB: Point3D = { x: 0, y: 0, z: 1 };
  let best = -1;
  for (let i = 0; i < n; i++) {
    const b = binormals[i];
    if (b && kappaMag[i] > best) { best = kappaMag[i]; refB = b; }
  }

  const samples: CurveSample[] = [];
  for (let i = 0; i < n; i++) {
    const t = totalLen > 0 ? arc[i]! / totalLen : 0;
    const tangent = tangents[i]!;
    let curvature = 0;
    let normal: Point3D = { x: 0, y: 1, z: 0 };
    const B = binormals[i];
    if (B) {
      const s = (B.x * refB.x + B.y * refB.y + B.z * refB.z) >= 0 ? 1 : -1;
      curvature = kappaMag[i]! * s;
      // Principal normal N = B × T — in the osculating plane, toward the centre
      // of curvature (NOT the binormal, which points out of the plane).
      const nx = B.y * tangent.z - B.z * tangent.y;
      const ny = B.z * tangent.x - B.x * tangent.z;
      const nz = B.x * tangent.y - B.y * tangent.x;
      const nl = Math.hypot(nx, ny, nz) || 1;
      normal = { x: nx / nl, y: ny / nl, z: nz / nl };
    }
    samples.push({ t, position: points[i]!, tangent, normal, curvature });
  }
  return samples;
}

/** Menger curvature: 4·area(p1,p2,p3) / (|p1-p2|·|p2-p3|·|p1-p3|). */
function mengerCurvature(p1: Point3D, p2: Point3D, p3: Point3D): { curvature: number; normal: Point3D } {
  const ax = p2.x - p1.x, ay = p2.y - p1.y, az = p2.z - p1.z;
  const bx = p3.x - p2.x, by = p3.y - p2.y, bz = p3.z - p2.z;
  const cx = p3.x - p1.x, cy = p3.y - p1.y, cz = p3.z - p1.z;
  // Cross product = 2·area·n, where n is the binormal.
  const crossX = ay * bz - az * by;
  const crossY = az * bx - ax * bz;
  const crossZ = ax * by - ay * bx;
  const crossLen = Math.hypot(crossX, crossY, crossZ);
  const aLen = Math.hypot(ax, ay, az);
  const bLen = Math.hypot(bx, by, bz);
  const cLen = Math.hypot(cx, cy, cz);
  if (aLen < 1e-12 || bLen < 1e-12 || cLen < 1e-12) {
    return { curvature: 0, normal: { x: 0, y: 1, z: 0 } };
  }
  const curvature = (2 * crossLen) / (aLen * bLen * cLen);
  // Normal is the cross product (binormal) crossed with tangent — we just
  // approximate as the unit cross.
  const nLen = crossLen || 1;
  return {
    curvature,
    normal: { x: crossX / nLen, y: crossY / nLen, z: crossZ / nLen },
  };
}

function distance(a: Point3D, b: Point3D): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// ── Curvature comb ──────────────────────────────────────────────

export interface CombSegment {
  /** Sample point on the curve. */
  base: Point3D;
  /** Tip of the comb (base + normal × scaledCurvature). */
  tip: Point3D;
  /** Underlying curvature (1/mm). */
  curvature: number;
}

export interface CombOptions {
  /** Multiplier applied to the curvature value to size the comb. */
  scaleFactor: number;
  /** Clamp the comb length to this maximum (mm). */
  maxLengthMm: number;
}

export const DEFAULT_COMB_OPTIONS: CombOptions = {
  scaleFactor: 10,
  maxLengthMm: 50,
};

export function generateCurvatureComb(samples: CurveSample[], options: Partial<CombOptions> = {}): CombSegment[] {
  const opts = { ...DEFAULT_COMB_OPTIONS, ...options };
  return samples.map(s => {
    let len = Math.abs(s.curvature) * opts.scaleFactor;
    if (len > opts.maxLengthMm) len = opts.maxLengthMm;
    return {
      base: s.position,
      tip: {
        x: s.position.x + s.normal.x * len,
        y: s.position.y + s.normal.y * len,
        z: s.position.z + s.normal.z * len,
      },
      curvature: s.curvature,
    };
  });
}

// ── Porcupine quills ────────────────────────────────────────────

export interface QuillSegment {
  base: Point3D;
  tip: Point3D;
  /** Color hint based on curvature magnitude. */
  intensity: number;
}

export function generatePorcupineQuills(samples: CurveSample[], lengthMm: number = 5): QuillSegment[] {
  return samples.map(s => {
    const intensity = Math.min(1, Math.abs(s.curvature) * 100);
    return {
      base: s.position,
      tip: {
        x: s.position.x + s.normal.x * lengthMm,
        y: s.position.y + s.normal.y * lengthMm,
        z: s.position.z + s.normal.z * lengthMm,
      },
      intensity,
    };
  });
}

// ── Inflection points ───────────────────────────────────────────

/** Inflection points are where signed curvature changes sign. Reports
 *  the parameter t and a short context window. */
export function findInflectionPoints(samples: CurveSample[]): Array<{ t: number; index: number }> {
  const out: Array<{ t: number; index: number }> = [];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]!.curvature;
    const cur = samples[i]!.curvature;
    if (prev !== 0 && cur !== 0 && Math.sign(prev) !== Math.sign(cur)) {
      out.push({ t: samples[i]!.t, index: i });
    }
  }
  return out;
}

// ── Zebra stripe field ──────────────────────────────────────────

export interface ZebraSampleData {
  /** Sample position. */
  position: Point3D;
  /** Surface normal. */
  normal: Point3D;
  /** Computed zebra stripe value (0 or 1). */
  stripeValue: 0 | 1;
}

/** Zebra stripe equation: stripe = floor((normal · viewDir) × frequency) mod 2.
 *  Smooth normal field → continuous stripe transition; sharp normal field
 *  (G0 boundary) → stripe jump. */
export function evaluateZebraStripes(
  positions: Point3D[],
  normals: Point3D[],
  viewDir: Point3D = { x: 0, y: 0, z: 1 },
  frequency: number = 20,
): ZebraSampleData[] {
  if (positions.length !== normals.length) {
    throw new Error('Positions and normals length mismatch');
  }
  const out: ZebraSampleData[] = [];
  for (let i = 0; i < positions.length; i++) {
    const n = normals[i]!;
    const dot = n.x * viewDir.x + n.y * viewDir.y + n.z * viewDir.z;
    const v = Math.floor(dot * frequency);
    out.push({
      position: positions[i]!,
      normal: n,
      stripeValue: ((v % 2) + 2) % 2 === 0 ? 0 : 1,
    });
  }
  return out;
}

// ── G-level audit between two curves ────────────────────────────

export type GLevel = 'G0' | 'G1' | 'G2' | 'G3';

export interface ContinuityAudit {
  achievedLevel: GLevel;
  /** Position gap at the junction (mm). */
  positionGapMm: number;
  /** Tangent angle deviation (deg). */
  tangentDeviationDeg: number;
  /** Curvature ratio (1 = perfect match). */
  curvatureRatio: number;
}

/** Audit two curve sample arrays where they join. Curve A ends, curve B
 *  begins; compares last A sample to first B sample. */
export function auditCurveJunction(curveA: CurveSample[], curveB: CurveSample[]): ContinuityAudit {
  if (curveA.length === 0 || curveB.length === 0) {
    return { achievedLevel: 'G0', positionGapMm: Infinity, tangentDeviationDeg: 180, curvatureRatio: 0 };
  }
  const a = curveA[curveA.length - 1]!;
  const b = curveB[0]!;
  const posGap = distance(a.position, b.position);
  const dot = a.tangent.x * b.tangent.x + a.tangent.y * b.tangent.y + a.tangent.z * b.tangent.z;
  const tangentDeg = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
  const curvRatio = b.curvature !== 0 ? a.curvature / b.curvature : (a.curvature === 0 ? 1 : 0);

  // This audit compares position, tangent and curvature at the junction, so it
  // can certify up to G2 (curvature continuity). It deliberately does NOT claim
  // G3: G3 is curvature-DERIVATIVE (dκ/ds) continuity, which cannot be told from
  // the junction curvatures alone — and the two curves are signed against
  // independent reference binormals, so a cross-curve dκ/ds comparison would be
  // unreliable anyway. Reporting G3 from a tighter ratio (as before) overclaimed.
  let level: GLevel = 'G0';
  if (posGap < 0.01) {
    level = 'G0';
    if (tangentDeg < 1) {
      level = 'G1';
      if (Math.abs(curvRatio - 1) < 0.05) {
        level = 'G2';
      }
    }
  }

  return {
    achievedLevel: level,
    positionGapMm: posGap,
    tangentDeviationDeg: tangentDeg,
    curvatureRatio: curvRatio,
  };
}

// ── Curvature statistics ────────────────────────────────────────

export interface CurvatureStats {
  /** Max absolute curvature observed. */
  maxAbsCurvature: number;
  /** Mean absolute curvature. */
  meanAbsCurvature: number;
  /** Min radius of curvature (1 / max curvature) in mm. */
  minRadiusMm: number;
  /** Number of inflection points. */
  inflectionCount: number;
}

export function computeCurvatureStats(samples: CurveSample[]): CurvatureStats {
  if (samples.length === 0) {
    return { maxAbsCurvature: 0, meanAbsCurvature: 0, minRadiusMm: Infinity, inflectionCount: 0 };
  }
  let max = 0, sum = 0;
  for (const s of samples) {
    const a = Math.abs(s.curvature);
    if (a > max) max = a;
    sum += a;
  }
  const inflections = findInflectionPoints(samples);
  return {
    maxAbsCurvature: max,
    meanAbsCurvature: sum / samples.length,
    minRadiusMm: max > 0 ? 1 / max : Infinity,
    inflectionCount: inflections.length,
  };
}
