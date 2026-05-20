/**
 * motionClearanceScrub.ts — Check assembly clearances throughout a
 * range of motion.
 *
 * For each driven joint (slider / pin / cam follower), the assembly
 * is swept through its motion range. At sampled positions, the
 * module checks the minimum clearance between specified body pairs.
 *
 *   - Below contact-tolerance → COLLISION (binding event).
 *   - Below required clearance → SCRAPE (rub).
 *   - Otherwise OK.
 *
 * Used for kinematic validation of mechanisms (linkages, robot
 * grippers, cam followers) before fabrication.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface MovingBody {
  id: string;
  /** Bounding sphere radius (mm). */
  radiusMm: number;
  /** Position-at-time function (param ∈ [0, 1] → centre). */
  trajectory: (t: number) => Vec3;
}

export interface ClearancePair {
  bodyA: string;
  bodyB: string;
  /** Required minimum clearance (mm). */
  requiredMm: number;
}

export interface ScrubOptions {
  /** Number of sample steps along [0, 1]. */
  samples: number;
  /** Distance below which contact is treated as collision. */
  collisionTolMm: number;
}

export const DEFAULT_OPTIONS: ScrubOptions = {
  samples: 50,
  collisionTolMm: 0.01,
};

export type ClearanceClass = 'ok' | 'scrape' | 'collision';

export interface ClearanceEvent {
  pair: ClearancePair;
  /** Parameter t ∈ [0, 1] at which the worst clearance occurs. */
  worstT: number;
  worstDistanceMm: number;
  classification: ClearanceClass;
}

export interface ScrubResult {
  events: ClearanceEvent[];
  sampleCount: number;
  worstOverall: ClearanceEvent | null;
}

// ── Top-level entry ────────────────────────────────────────────

export function scrubMotion(
  bodies: MovingBody[],
  pairs: ClearancePair[],
  options: Partial<ScrubOptions> = {},
): ScrubResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const events: ClearanceEvent[] = [];
  const bodyMap = new Map(bodies.map(b => [b.id, b]));

  for (const pair of pairs) {
    const a = bodyMap.get(pair.bodyA);
    const b = bodyMap.get(pair.bodyB);
    if (!a || !b) continue;
    let worstT = 0;
    let worstD = Infinity;
    for (let i = 0; i <= opts.samples; i++) {
      const t = i / opts.samples;
      const pa = a.trajectory(t);
      const pb = b.trajectory(t);
      const centreDist = Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
      const surfaceDist = centreDist - a.radiusMm - b.radiusMm;
      if (surfaceDist < worstD) {
        worstD = surfaceDist;
        worstT = t;
      }
    }
    let cls: ClearanceClass;
    if (worstD < opts.collisionTolMm) cls = 'collision';
    else if (worstD < pair.requiredMm) cls = 'scrape';
    else cls = 'ok';
    events.push({ pair, worstT, worstDistanceMm: worstD, classification: cls });
  }

  let worstOverall: ClearanceEvent | null = null;
  for (const e of events) {
    if (!worstOverall || e.worstDistanceMm < worstOverall.worstDistanceMm) worstOverall = e;
  }

  return { events, sampleCount: opts.samples + 1, worstOverall };
}

// ── Adaptive bisection refinement ────────────────────────────

/**
 * After scrubMotion finds a worst sample, refine the t by bisecting
 * around it.
 */
export function refineWorst(
  bodyA: MovingBody,
  bodyB: MovingBody,
  initialT: number,
  iterations: number = 10,
  windowFraction: number = 0.05,
): { t: number; distanceMm: number } {
  let lo = Math.max(0, initialT - windowFraction);
  let hi = Math.min(1, initialT + windowFraction);
  for (let i = 0; i < iterations; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const d1 = surfaceDistance(bodyA, bodyB, m1);
    const d2 = surfaceDistance(bodyA, bodyB, m2);
    if (d1 < d2) hi = m2;
    else lo = m1;
  }
  const t = (lo + hi) / 2;
  return { t, distanceMm: surfaceDistance(bodyA, bodyB, t) };
}

function surfaceDistance(a: MovingBody, b: MovingBody, t: number): number {
  const pa = a.trajectory(t);
  const pb = b.trajectory(t);
  return Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z) - a.radiusMm - b.radiusMm;
}

// ── Summary ────────────────────────────────────────────────────

export interface ScrubSummary {
  pairCount: number;
  collisionCount: number;
  scrapeCount: number;
  okCount: number;
  worstDistanceMm: number;
}

export function summarize(result: ScrubResult): ScrubSummary {
  let coll = 0, scrape = 0, ok = 0;
  for (const e of result.events) {
    if (e.classification === 'collision') coll++;
    else if (e.classification === 'scrape') scrape++;
    else ok++;
  }
  return {
    pairCount: result.events.length,
    collisionCount: coll,
    scrapeCount: scrape,
    okCount: ok,
    worstDistanceMm: result.worstOverall ? result.worstOverall.worstDistanceMm : Infinity,
  };
}
