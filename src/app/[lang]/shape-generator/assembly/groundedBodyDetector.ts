/**
 * groundedBodyDetector.ts — Detect the "grounded" body in an
 * assembly (the body fixed to the world frame).
 *
 * Every well-defined assembly has at least one body anchored to
 * the world — the chassis, base plate, or whatever the other parts
 * mate to. Detecting this automatically helps:
 *
 *   - Initial fixturing in motion studies.
 *   - Frame transform calculations.
 *   - DOF analysis (parts mated to ground are auto-constrained).
 *
 * Heuristics:
 *
 *   1. Explicit "isGrounded" flag — strongest signal.
 *   2. Body with the most outgoing mates (likely a hub / base).
 *   3. Largest body by mass / volume.
 *   4. Body whose centroid is closest to the assembly origin.
 *
 * Module returns ranked candidates with score breakdown.
 */

export interface AssemblyBody {
  id: string;
  /** Optional explicit ground flag. */
  isGrounded?: boolean;
  /** Mass in kg. */
  massKg?: number;
  /** Centroid in world coordinates. */
  centroid?: { x: number; y: number; z: number };
}

export interface BodyMate {
  /** Body ids the mate connects. */
  bodyA: string;
  bodyB: string;
}

export interface CandidateScore {
  bodyId: string;
  totalScore: number;
  /** Per-rule contribution. */
  explicit: number;
  mateCount: number;
  mateScore: number;
  mass: number;
  massScore: number;
  centroidDist: number;
  centroidScore: number;
}

export interface DetectionResult {
  /** Top-ranked grounded body. */
  groundedBodyId: string | null;
  /** All candidates with scores. */
  candidates: CandidateScore[];
  /** Confidence (0..1) — how much the top candidate dominates. */
  confidence: number;
}

export interface DetectorOptions {
  /** Score weights. */
  explicitWeight: number;
  mateCountWeight: number;
  massWeight: number;
  centroidWeight: number;
  /** Assembly origin for centroid distance. */
  assemblyOrigin: { x: number; y: number; z: number };
}

export const DEFAULT_OPTIONS: DetectorOptions = {
  explicitWeight: 100,
  mateCountWeight: 5,
  massWeight: 0.1,
  centroidWeight: 1,
  assemblyOrigin: { x: 0, y: 0, z: 0 },
};

// ── Top-level entry ────────────────────────────────────────────

export function detectGroundedBody(
  bodies: AssemblyBody[],
  mates: BodyMate[],
  options: Partial<DetectorOptions> = {},
): DetectionResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (bodies.length === 0) {
    return { groundedBodyId: null, candidates: [], confidence: 0 };
  }

  // Count mates per body.
  const mateCount = new Map<string, number>();
  for (const body of bodies) mateCount.set(body.id, 0);
  for (const mate of mates) {
    mateCount.set(mate.bodyA, (mateCount.get(mate.bodyA) ?? 0) + 1);
    mateCount.set(mate.bodyB, (mateCount.get(mate.bodyB) ?? 0) + 1);
  }
  const maxMates = Math.max(1, ...mateCount.values());

  // Max mass for normalization.
  const masses = bodies.map(b => b.massKg ?? 0);
  const maxMass = Math.max(1, ...masses);

  // Compute max centroid distance to normalize centroid score (closer = better).
  const dists = bodies.map(b => b.centroid ? distance(b.centroid, opts.assemblyOrigin) : Infinity);
  const finiteDists = dists.filter(d => Number.isFinite(d));
  const maxDist = finiteDists.length > 0 ? Math.max(1, ...finiteDists) : 1;

  // Score each body.
  const candidates: CandidateScore[] = bodies.map(body => {
    const explicit = body.isGrounded ? opts.explicitWeight : 0;
    const mc = mateCount.get(body.id) ?? 0;
    const mateScoreVal = (mc / maxMates) * opts.mateCountWeight;
    const mass = body.massKg ?? 0;
    const massScoreVal = (mass / maxMass) * opts.massWeight;
    const dist = body.centroid ? distance(body.centroid, opts.assemblyOrigin) : maxDist;
    const centroidScoreVal = (1 - Math.min(1, dist / maxDist)) * opts.centroidWeight;
    return {
      bodyId: body.id,
      totalScore: explicit + mateScoreVal + massScoreVal + centroidScoreVal,
      explicit,
      mateCount: mc,
      mateScore: mateScoreVal,
      mass,
      massScore: massScoreVal,
      centroidDist: dist,
      centroidScore: centroidScoreVal,
    };
  });

  candidates.sort((a, b) => b.totalScore - a.totalScore);
  const top = candidates[0]!;
  const second = candidates[1];
  const gap = second ? top.totalScore - second.totalScore : top.totalScore;
  const confidence = top.totalScore > 0 ? Math.min(1, gap / top.totalScore) : 0;

  return {
    groundedBodyId: top.totalScore > 0 ? top.bodyId : null,
    candidates,
    confidence,
  };
}

// ── Helpers ────────────────────────────────────────────────────

function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// ── Mate connectivity helpers ─────────────────────────────────

export function getConnectivity(bodies: AssemblyBody[], mates: BodyMate[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const b of bodies) adj.set(b.id, new Set());
  for (const m of mates) {
    adj.get(m.bodyA)?.add(m.bodyB);
    adj.get(m.bodyB)?.add(m.bodyA);
  }
  return adj;
}

/** True if every body is reachable from the grounded body. */
export function isFullyConnected(result: DetectionResult, bodies: AssemblyBody[], mates: BodyMate[]): boolean {
  if (!result.groundedBodyId) return false;
  const adj = getConnectivity(bodies, mates);
  const visited = new Set<string>();
  const stack = [result.groundedBodyId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const n of adj.get(cur) ?? []) if (!visited.has(n)) stack.push(n);
  }
  return visited.size === bodies.length;
}

// ── Summary ────────────────────────────────────────────────────

export interface DetectionSummary {
  bodyCount: number;
  groundedBodyId: string | null;
  confidence: number;
  topScore: number;
  ratioToSecond: number;
}

export function summarize(result: DetectionResult): DetectionSummary {
  const top = result.candidates[0];
  const second = result.candidates[1];
  return {
    bodyCount: result.candidates.length,
    groundedBodyId: result.groundedBodyId,
    confidence: result.confidence,
    topScore: top?.totalScore ?? 0,
    ratioToSecond: top && second && second.totalScore > 0 ? top.totalScore / second.totalScore : 0,
  };
}
