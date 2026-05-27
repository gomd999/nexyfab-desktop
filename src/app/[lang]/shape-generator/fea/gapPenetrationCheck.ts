/**
 * gapPenetrationCheck.ts — Detect gaps and penetrations between
 * adjacent bodies in an FEA assembly.
 *
 * Real-world parts mate with small physical gaps + occasional small
 * overlaps. FEA solvers either:
 *
 *   - Hard contact: gaps must close before forces transfer; small
 *     gaps cause convergence issues.
 *   - Bonded: any gap >= tolerance is treated as separated → wrong
 *     load path.
 *   - Penalty contact: an initial penetration generates spurious
 *     stress at t=0.
 *
 * Module compares two surface meshes (faces a + b) and reports:
 *
 *   - Per-vertex shortest distance to the opposing surface.
 *   - Categorisation: gap / contact / penetration.
 *   - Statistics: max gap, max penetration, mean.
 *   - Recommended pre-processing: close-gap, allow-pen, mesh-refine.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface Triangle {
  v0: Vec3;
  v1: Vec3;
  v2: Vec3;
}

export interface SurfaceVertex {
  id: string;
  position: Vec3;
  /** Outward normal at this vertex. */
  normal: Vec3;
}

export interface GapPenetrationOptions {
  /** Tolerance below which a gap is treated as contact. */
  contactToleranceMm: number;
  /** Threshold above which a gap is reported as too large. */
  maxAcceptableGapMm: number;
  /** Maximum acceptable penetration. */
  maxAcceptablePenetrationMm: number;
}

export const DEFAULT_OPTIONS: GapPenetrationOptions = {
  contactToleranceMm: 0.01,
  maxAcceptableGapMm: 0.2,
  maxAcceptablePenetrationMm: 0.01,
};

export interface VertexResult {
  vertexId: string;
  position: Vec3;
  /** Signed distance: + = gap (outside), – = penetration. */
  signedDistanceMm: number;
  category: 'gap' | 'contact' | 'penetration';
  closestPoint: Vec3;
}

export interface CheckResult {
  perVertex: VertexResult[];
  maxGapMm: number;
  maxPenetrationMm: number;
  meanAbsDistanceMm: number;
  contactCount: number;
  gapCount: number;
  penetrationCount: number;
  recommendations: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function checkGapPenetration(
  surfaceA: SurfaceVertex[],
  surfaceBTriangles: Triangle[],
  options: Partial<GapPenetrationOptions> = {},
): CheckResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const results: VertexResult[] = surfaceA.map(v => probeVertex(v, surfaceBTriangles, opts));

  let maxGap = 0;
  let maxPen = 0;
  let sum = 0;
  let gaps = 0;
  let contacts = 0;
  let penetrations = 0;
  for (const r of results) {
    if (r.category === 'gap') {
      gaps++;
      if (r.signedDistanceMm > maxGap) maxGap = r.signedDistanceMm;
    } else if (r.category === 'penetration') {
      penetrations++;
      const pen = -r.signedDistanceMm;
      if (pen > maxPen) maxPen = pen;
    } else {
      contacts++;
    }
    sum += Math.abs(r.signedDistanceMm);
  }

  const mean = results.length === 0 ? 0 : sum / results.length;

  const recommendations: string[] = [];
  if (maxGap > opts.maxAcceptableGapMm) {
    recommendations.push(`Max gap ${maxGap.toFixed(3)} mm exceeds ${opts.maxAcceptableGapMm} mm — extend bonded contact tolerance or refine mesh.`);
  }
  if (maxPen > opts.maxAcceptablePenetrationMm) {
    recommendations.push(`Max penetration ${maxPen.toFixed(3)} mm exceeds ${opts.maxAcceptablePenetrationMm} mm — increase contact stiffness or adjust initial conditions.`);
  }
  if (gaps > 0 && penetrations > 0) {
    recommendations.push('Mixed gaps + penetrations: surfaces are mismatched. Re-examine assembly mate or geometry.');
  }

  return {
    perVertex: results,
    maxGapMm: maxGap,
    maxPenetrationMm: maxPen,
    meanAbsDistanceMm: mean,
    contactCount: contacts,
    gapCount: gaps,
    penetrationCount: penetrations,
    recommendations,
  };
}

// ── Per-vertex probe ──────────────────────────────────────────

function probeVertex(v: SurfaceVertex, tris: Triangle[], opts: GapPenetrationOptions): VertexResult {
  let bestDist = Infinity;
  let bestPoint: Vec3 = { x: 0, y: 0, z: 0 };
  let bestSign = 1;
  for (const tri of tris) {
    const cp = closestPointOnTriangle(v.position, tri);
    const d = distance(v.position, cp);
    if (d < bestDist) {
      bestDist = d;
      bestPoint = cp;
      // Sign: dot product of (cp - v) with the outward normal.
      const dx = cp.x - v.position.x;
      const dy = cp.y - v.position.y;
      const dz = cp.z - v.position.z;
      const dotN = dx * v.normal.x + dy * v.normal.y + dz * v.normal.z;
      bestSign = dotN >= 0 ? -1 : 1; // cp on outside of normal → gap; inside → penetration
    }
  }
  const signed = bestDist * bestSign;
  let category: VertexResult['category'];
  if (Math.abs(signed) <= opts.contactToleranceMm) category = 'contact';
  else if (signed > 0) category = 'gap';
  else category = 'penetration';
  return {
    vertexId: v.id,
    position: v.position,
    signedDistanceMm: signed,
    category,
    closestPoint: bestPoint,
  };
}

// ── Geometry helpers ──────────────────────────────────────────

function closestPointOnTriangle(p: Vec3, tri: Triangle): Vec3 {
  const ab = sub(tri.v1, tri.v0);
  const ac = sub(tri.v2, tri.v0);
  const ap = sub(p, tri.v0);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return tri.v0;
  const bp = sub(p, tri.v1);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return tri.v1;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return { x: tri.v0.x + ab.x * v, y: tri.v0.y + ab.y * v, z: tri.v0.z + ab.z * v };
  }
  const cp = sub(p, tri.v2);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return tri.v2;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return { x: tri.v0.x + ac.x * w, y: tri.v0.y + ac.y * w, z: tri.v0.z + ac.z * w };
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return { x: tri.v1.x + (tri.v2.x - tri.v1.x) * w, y: tri.v1.y + (tri.v2.y - tri.v1.y) * w, z: tri.v1.z + (tri.v2.z - tri.v1.z) * w };
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return {
    x: tri.v0.x + ab.x * v + ac.x * w,
    y: tri.v0.y + ab.y * v + ac.y * w,
    z: tri.v0.z + ab.z * v + ac.z * w,
  };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// ── Summary ────────────────────────────────────────────────────

export interface CheckSummary {
  vertexCount: number;
  contactFraction: number;
  maxGap: number;
  maxPenetration: number;
  recommendationCount: number;
}

export function summarize(result: CheckResult): CheckSummary {
  return {
    vertexCount: result.perVertex.length,
    contactFraction: result.perVertex.length === 0 ? 0 : result.contactCount / result.perVertex.length,
    maxGap: result.maxGapMm,
    maxPenetration: result.maxPenetrationMm,
    recommendationCount: result.recommendations.length,
  };
}
