/**
 * concentricityEvaluator.ts — Evaluate ASME Y14.5 concentricity: the
 * DERIVED MEDIAN POINTS of a feature of size must lie within a
 * cylindrical tolerance zone (diameter t) centred on the datum axis.
 *
 * Concentricity is about the median points (the midpoints of opposed
 * surface points), NOT the surface itself — which is why it differs from
 * runout. We accept per-section opposed-point pairs, compute each
 * section's median point, then the radial distance of each median point
 * from the datum axis. The zone = 2 × max radial distance.
 *
 * Datum axis is given as a point + direction (default through origin
 * along +Z). For a simple part the datum axis is the part's nominal axis.
 */

export interface Point3D { x: number; y: number; z: number }

export interface OpposedPair {
  axialPositionMm: number;
  pointA: Point3D;
  pointB: Point3D; // diametrically opposite measured point
}

export interface ConcentricityInput {
  pairs: OpposedPair[];
  datumAxisPoint?: Point3D;     // default {0,0,0}
  datumAxisDirection?: Point3D; // default {0,0,1}
  toleranceMm: number;
}

export interface MedianPointResult {
  axialPositionMm: number;
  medianPoint: Point3D;
  radialOffsetMm: number;
}

export interface ConcentricityResult {
  medianPoints: MedianPointResult[];
  concentricityMm: number; // diametral zone = 2 × max radial offset
  maxRadialOffsetMm: number;
  worstAxialMm: number;
  passed: boolean;
  warnings: string[];
}

export function evaluate(input: ConcentricityInput): ConcentricityResult {
  const warnings: string[] = [];
  if (input.pairs.length === 0) warnings.push('No opposed-point pairs provided.');
  if (input.toleranceMm <= 0) warnings.push('Tolerance must be positive.');

  const axisPt = input.datumAxisPoint ?? { x: 0, y: 0, z: 0 };
  const axisDir = normalize(input.datumAxisDirection ?? { x: 0, y: 0, z: 1 });

  const medianPoints: MedianPointResult[] = input.pairs.map(pair => {
    const median: Point3D = {
      x: (pair.pointA.x + pair.pointB.x) / 2,
      y: (pair.pointA.y + pair.pointB.y) / 2,
      z: (pair.pointA.z + pair.pointB.z) / 2,
    };
    const radial = radialDistanceToAxis(median, axisPt, axisDir);
    return { axialPositionMm: pair.axialPositionMm, medianPoint: median, radialOffsetMm: radial };
  });

  let maxRadial = 0, worstAxial = 0;
  for (const m of medianPoints) {
    if (m.radialOffsetMm > maxRadial) { maxRadial = m.radialOffsetMm; worstAxial = m.axialPositionMm; }
  }
  const zone = 2 * maxRadial;

  return {
    medianPoints,
    concentricityMm: zone,
    maxRadialOffsetMm: maxRadial,
    worstAxialMm: worstAxial,
    passed: zone <= input.toleranceMm + 1e-9,
    warnings,
  };
}

function radialDistanceToAxis(p: Point3D, axisPt: Point3D, axisDir: Point3D): number {
  const v = { x: p.x - axisPt.x, y: p.y - axisPt.y, z: p.z - axisPt.z };
  const along = v.x * axisDir.x + v.y * axisDir.y + v.z * axisDir.z;
  const perp = {
    x: v.x - along * axisDir.x,
    y: v.y - along * axisDir.y,
    z: v.z - along * axisDir.z,
  };
  return Math.hypot(perp.x, perp.y, perp.z);
}

function normalize(v: Point3D): Point3D {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** Compare concentricity to the runout-style surface check (median vs surface). */
export function medianVsSurfaceSpread(input: ConcentricityInput): { medianZoneMm: number; surfaceSpreadMm: number } {
  const r = evaluate(input);
  const axisPt = input.datumAxisPoint ?? { x: 0, y: 0, z: 0 };
  const axisDir = normalize(input.datumAxisDirection ?? { x: 0, y: 0, z: 1 });
  let min = Infinity, max = -Infinity;
  for (const pair of input.pairs) {
    for (const pt of [pair.pointA, pair.pointB]) {
      const rad = radialDistanceToAxis(pt, axisPt, axisDir);
      min = Math.min(min, rad);
      max = Math.max(max, rad);
    }
  }
  return { medianZoneMm: r.concentricityMm, surfaceSpreadMm: input.pairs.length ? max - min : 0 };
}

export function summarize(r: ConcentricityResult): { passed: boolean; concentricityMm: number; pairCount: number } {
  return { passed: r.passed, concentricityMm: r.concentricityMm, pairCount: r.medianPoints.length };
}
