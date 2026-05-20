/**
 * cgEnvelopeChecker.ts — Check assembly CG against an allowable
 * envelope.
 *
 * For aerospace / automotive / shipping cases, the assembly's CG
 * must fall inside a specified envelope (often a rectangle or
 * polygon at a given Z plane). Module:
 *
 *   - Computes CG from per-body mass + position (or accepts a
 *     pre-computed CG).
 *   - Tests CG against a convex polygon envelope.
 *   - Reports clearance to envelope edges.
 *   - Suggests rebalance: which body's mass should be moved to bring
 *     CG inside the envelope.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface MassBody {
  id: string;
  massKg: number;
  position: Vec3;
  /** Whether this body's position can be moved (true = movable balance ballast). */
  movable: boolean;
}

export interface EnvelopePolygon {
  /** Closed polygon, CCW, in the X-Y plane. */
  vertices: { x: number; y: number }[];
  /** Z plane at which envelope applies (CG projected to this plane). */
  zPlane: number;
  /** Maximum allowed |Δz| from envelope plane. */
  zToleranceMm: number;
}

export interface EnvelopeCheck {
  cg: Vec3;
  totalMassKg: number;
  insideEnvelope: boolean;
  zWithinTolerance: boolean;
  /** Distance from CG to envelope boundary (mm, negative if outside). */
  clearanceMm: number;
  /** Distance |Δz| from envelope plane. */
  zDeviationMm: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function checkEnvelope(bodies: MassBody[], envelope: EnvelopePolygon): EnvelopeCheck {
  if (bodies.length === 0) {
    return {
      cg: { x: 0, y: 0, z: 0 },
      totalMassKg: 0,
      insideEnvelope: false,
      zWithinTolerance: false,
      clearanceMm: 0,
      zDeviationMm: 0,
    };
  }
  let mass = 0;
  let cx = 0, cy = 0, cz = 0;
  for (const b of bodies) {
    mass += b.massKg;
    cx += b.massKg * b.position.x;
    cy += b.massKg * b.position.y;
    cz += b.massKg * b.position.z;
  }
  if (mass === 0) {
    return {
      cg: { x: 0, y: 0, z: 0 }, totalMassKg: 0,
      insideEnvelope: false, zWithinTolerance: false,
      clearanceMm: 0, zDeviationMm: 0,
    };
  }
  const cg: Vec3 = { x: cx / mass, y: cy / mass, z: cz / mass };
  const cgXy = { x: cg.x, y: cg.y };
  const inside = pointInPolygon(cgXy, envelope.vertices);
  const edgeDist = distanceToPolygonBoundary(cgXy, envelope.vertices);
  const signedDist = inside ? edgeDist : -edgeDist;
  const zDev = Math.abs(cg.z - envelope.zPlane);
  return {
    cg,
    totalMassKg: mass,
    insideEnvelope: inside,
    zWithinTolerance: zDev <= envelope.zToleranceMm,
    clearanceMm: signedDist,
    zDeviationMm: zDev,
  };
}

// ── Rebalance suggestion ─────────────────────────────────────

export interface RebalanceSuggestion {
  bodyId: string;
  proposedDelta: Vec3;
  reason: string;
}

/**
 * If the CG is outside the envelope, the heaviest movable body is
 * shifted to bring CG inside. Δx, Δy chosen along the shortest
 * vector from CG to the nearest polygon edge.
 */
export function suggestRebalance(bodies: MassBody[], envelope: EnvelopePolygon): RebalanceSuggestion | null {
  const check = checkEnvelope(bodies, envelope);
  if (check.insideEnvelope) return null;
  const movable = bodies.filter(b => b.movable);
  if (movable.length === 0) return null;
  // Pick heaviest movable.
  movable.sort((a, b) => b.massKg - a.massKg);
  const heaviest = movable[0]!;
  const target = closestEdgePoint({ x: check.cg.x, y: check.cg.y }, envelope.vertices);
  // Move CG toward (target.x, target.y, envelope.zPlane).
  // Required shift of heaviest body: (target - CG) × totalMass / heaviestMass.
  const ratio = check.totalMassKg / heaviest.massKg;
  return {
    bodyId: heaviest.id,
    proposedDelta: {
      x: (target.x - check.cg.x) * ratio,
      y: (target.y - check.cg.y) * ratio,
      z: (envelope.zPlane - check.cg.z) * ratio,
    },
    reason: `Move ${heaviest.id} (mass ${heaviest.massKg.toFixed(2)} kg) to bring CG inside envelope.`,
  };
}

// ── Geometry helpers ─────────────────────────────────────────

function pointInPolygon(p: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i]!;
    const pj = poly[j]!;
    if ((pi.y > p.y) !== (pj.y > p.y) && p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToPolygonBoundary(p: { x: number; y: number }, poly: { x: number; y: number }[]): number {
  let min = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const d = pointToSegment(p, a, b);
    if (d < min) min = d;
  }
  return min;
}

function closestEdgePoint(p: { x: number; y: number }, poly: { x: number; y: number }[]): { x: number; y: number } {
  let bestDist = Infinity;
  let best: { x: number; y: number } = poly[0]!;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const proj = projectToSegment(p, a, b);
    const d = Math.hypot(proj.x - p.x, proj.y - p.y);
    if (d < bestDist) {
      bestDist = d;
      best = proj;
    }
  }
  return best;
}

function pointToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const proj = projectToSegment(p, a, b);
  return Math.hypot(proj.x - p.x, proj.y - p.y);
}

function projectToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return a;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

// ── Summary ────────────────────────────────────────────────────

export interface EnvelopeSummary {
  totalMassKg: number;
  insideEnvelope: boolean;
  clearanceMm: number;
  zDeviationMm: number;
}

export function summarize(result: EnvelopeCheck): EnvelopeSummary {
  return {
    totalMassKg: result.totalMassKg,
    insideEnvelope: result.insideEnvelope,
    clearanceMm: result.clearanceMm,
    zDeviationMm: result.zDeviationMm,
  };
}
