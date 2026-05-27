/**
 * symmetryEvaluator.ts — Evaluate ASME Y14.5 symmetry: the median points
 * between two corresponding (opposed) surface features must lie within a
 * tolerance zone of two parallel planes centred on the datum centre-plane.
 *
 * Symmetry is the planar analog of concentricity. For each opposed pair
 * (one point on each side feature), the median point's signed distance
 * from the datum centre-plane is computed. The zone width = max − min of
 * those signed distances (must be ≤ tolerance, the zone straddling 0).
 *
 * Datum centre-plane is given by a point on the plane + its unit normal
 * (default: YZ plane through origin, normal +X).
 */

export interface Point3D { x: number; y: number; z: number }

export interface OpposedPair {
  pointA: Point3D; // on one side feature
  pointB: Point3D; // on the corresponding side feature
}

export interface SymmetryInput {
  pairs: OpposedPair[];
  datumPlanePoint?: Point3D;  // default {0,0,0}
  datumPlaneNormal?: Point3D; // default {1,0,0}
  toleranceMm: number;
}

export interface SymmetryResult {
  symmetryMm: number;        // total zone width = max − min median offset
  maxMedianOffsetMm: number; // signed
  minMedianOffsetMm: number; // signed
  passed: boolean;
  worstPairIndex: number;
  warnings: string[];
}

export function evaluate(input: SymmetryInput): SymmetryResult {
  const warnings: string[] = [];
  if (input.pairs.length === 0) warnings.push('No opposed-point pairs provided.');
  if (input.toleranceMm <= 0) warnings.push('Tolerance must be positive.');

  const planePt = input.datumPlanePoint ?? { x: 0, y: 0, z: 0 };
  const n = normalize(input.datumPlaneNormal ?? { x: 1, y: 0, z: 0 });

  if (input.pairs.length === 0) {
    return { symmetryMm: 0, maxMedianOffsetMm: 0, minMedianOffsetMm: 0, passed: true, worstPairIndex: -1, warnings };
  }

  let max = -Infinity, min = Infinity, worstIdx = -1;
  input.pairs.forEach((pair, i) => {
    const median: Point3D = {
      x: (pair.pointA.x + pair.pointB.x) / 2,
      y: (pair.pointA.y + pair.pointB.y) / 2,
      z: (pair.pointA.z + pair.pointB.z) / 2,
    };
    const signed = (median.x - planePt.x) * n.x + (median.y - planePt.y) * n.y + (median.z - planePt.z) * n.z;
    if (signed > max) max = signed;
    if (signed < min) min = signed;
  });
  // worst pair = the one with the largest |offset|.
  let worstAbs = -1;
  input.pairs.forEach((pair, i) => {
    const median = {
      x: (pair.pointA.x + pair.pointB.x) / 2,
      y: (pair.pointA.y + pair.pointB.y) / 2,
      z: (pair.pointA.z + pair.pointB.z) / 2,
    };
    const signed = (median.x - planePt.x) * n.x + (median.y - planePt.y) * n.y + (median.z - planePt.z) * n.z;
    if (Math.abs(signed) > worstAbs) { worstAbs = Math.abs(signed); worstIdx = i; }
  });

  const zone = max - min;
  return {
    symmetryMm: zone,
    maxMedianOffsetMm: max,
    minMedianOffsetMm: min,
    passed: zone <= input.toleranceMm + 1e-9,
    worstPairIndex: worstIdx,
    warnings,
  };
}

function normalize(v: Point3D): Point3D {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** Build opposed pairs automatically by mirroring side-A points across the datum plane and matching nearest side-B. */
export function autoPair(
  sideA: Point3D[],
  sideB: Point3D[],
  datumPlanePoint: Point3D,
  datumPlaneNormal: Point3D,
): OpposedPair[] {
  const n = normalize(datumPlaneNormal);
  const pairs: OpposedPair[] = [];
  const usedB = new Set<number>();
  for (const a of sideA) {
    // mirror a across plane
    const dist = (a.x - datumPlanePoint.x) * n.x + (a.y - datumPlanePoint.y) * n.y + (a.z - datumPlanePoint.z) * n.z;
    const mirrored = { x: a.x - 2 * dist * n.x, y: a.y - 2 * dist * n.y, z: a.z - 2 * dist * n.z };
    let bestIdx = -1, bestDist = Infinity;
    sideB.forEach((b, j) => {
      if (usedB.has(j)) return;
      const d = Math.hypot(b.x - mirrored.x, b.y - mirrored.y, b.z - mirrored.z);
      if (d < bestDist) { bestDist = d; bestIdx = j; }
    });
    if (bestIdx >= 0) { usedB.add(bestIdx); pairs.push({ pointA: a, pointB: sideB[bestIdx]! }); }
  }
  return pairs;
}

export function summarize(r: SymmetryResult): { passed: boolean; symmetryMm: number } {
  return { passed: r.passed, symmetryMm: r.symmetryMm };
}
