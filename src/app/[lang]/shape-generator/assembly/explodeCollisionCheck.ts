/**
 * explodeCollisionCheck.ts — Detect collisions during an exploded-view
 * animation.
 *
 * In an exploded view, each component moves along a vector from its
 * assembled location to its exploded location, parameterised by t ∈ [0, 1].
 * Naively summing the explode offsets can route a component through
 * another part during the animation, which looks wrong on a drawing.
 *
 * Module:
 *   - Tracks each component as an AABB sliding from start to end.
 *   - For each pair of swept AABBs, computes the time interval (if
 *     any) during which they overlap → collision.
 *   - Suggests a reorder so colliding components animate sequentially
 *     instead of simultaneously.
 *
 * Used to validate explode plans before rendering animation frames.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface AABB {
  min: Vec3;
  max: Vec3;
}

export interface ExplodeStep {
  componentId: string;
  /** Component bounding box at t = 0 (assembled). */
  aabb: AABB;
  /** Translation vector applied across t ∈ [0, 1]. */
  translation: Vec3;
}

export interface CollisionInterval {
  componentA: string;
  componentB: string;
  /** Time range of overlap. */
  tStart: number;
  tEnd: number;
  /** Volume of intersection at midpoint. */
  midpointOverlapMm3: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function detectExplodeCollisions(steps: ExplodeStep[]): CollisionInterval[] {
  const collisions: CollisionInterval[] = [];
  for (let i = 0; i < steps.length; i++) {
    for (let j = i + 1; j < steps.length; j++) {
      const interval = sweptOverlap(steps[i]!, steps[j]!);
      if (interval) collisions.push(interval);
    }
  }
  return collisions;
}

function sweptOverlap(a: ExplodeStep, b: ExplodeStep): CollisionInterval | null {
  // For each axis, find time interval where a and b overlap.
  const xRange = axisOverlap(
    a.aabb.min.x, a.aabb.max.x, a.translation.x,
    b.aabb.min.x, b.aabb.max.x, b.translation.x,
  );
  if (!xRange) return null;
  const yRange = axisOverlap(
    a.aabb.min.y, a.aabb.max.y, a.translation.y,
    b.aabb.min.y, b.aabb.max.y, b.translation.y,
  );
  if (!yRange) return null;
  const zRange = axisOverlap(
    a.aabb.min.z, a.aabb.max.z, a.translation.z,
    b.aabb.min.z, b.aabb.max.z, b.translation.z,
  );
  if (!zRange) return null;

  const tStart = Math.max(xRange[0], yRange[0], zRange[0]);
  const tEnd = Math.min(xRange[1], yRange[1], zRange[1]);
  if (tStart > tEnd) return null;
  const mid = (tStart + tEnd) / 2;
  const overlap = overlapVolume(a, b, mid);
  return { componentA: a.componentId, componentB: b.componentId, tStart, tEnd, midpointOverlapMm3: overlap };
}

// Returns the t-range [t0, t1] (clamped to [0,1]) during which the
// two intervals [aMin+aT·t, aMax+aT·t] and [bMin+bT·t, bMax+bT·t]
// overlap. Returns null if they never overlap.
function axisOverlap(
  aMin: number, aMax: number, aT: number,
  bMin: number, bMax: number, bT: number,
): [number, number] | null {
  // Overlap condition: aMin + aT·t <= bMax + bT·t AND bMin + bT·t <= aMax + aT·t
  // (aT - bT)·t <= bMax - aMin     and    (bT - aT)·t <= aMax - bMin
  let lo = 0;
  let hi = 1;
  const denom1 = aT - bT;
  const rhs1 = bMax - aMin;
  if (denom1 !== 0) {
    const tBound = rhs1 / denom1;
    if (denom1 > 0) hi = Math.min(hi, tBound);
    else lo = Math.max(lo, tBound);
  } else if (rhs1 < 0) {
    return null;
  }

  const denom2 = bT - aT;
  const rhs2 = aMax - bMin;
  if (denom2 !== 0) {
    const tBound = rhs2 / denom2;
    if (denom2 > 0) hi = Math.min(hi, tBound);
    else lo = Math.max(lo, tBound);
  } else if (rhs2 < 0) {
    return null;
  }

  if (lo > hi) return null;
  return [lo, hi];
}

function overlapVolume(a: ExplodeStep, b: ExplodeStep, t: number): number {
  const ax0 = a.aabb.min.x + a.translation.x * t;
  const ax1 = a.aabb.max.x + a.translation.x * t;
  const ay0 = a.aabb.min.y + a.translation.y * t;
  const ay1 = a.aabb.max.y + a.translation.y * t;
  const az0 = a.aabb.min.z + a.translation.z * t;
  const az1 = a.aabb.max.z + a.translation.z * t;
  const bx0 = b.aabb.min.x + b.translation.x * t;
  const bx1 = b.aabb.max.x + b.translation.x * t;
  const by0 = b.aabb.min.y + b.translation.y * t;
  const by1 = b.aabb.max.y + b.translation.y * t;
  const bz0 = b.aabb.min.z + b.translation.z * t;
  const bz1 = b.aabb.max.z + b.translation.z * t;
  const ox = Math.max(0, Math.min(ax1, bx1) - Math.max(ax0, bx0));
  const oy = Math.max(0, Math.min(ay1, by1) - Math.max(ay0, by0));
  const oz = Math.max(0, Math.min(az1, bz1) - Math.max(az0, bz0));
  return ox * oy * oz;
}

// ── Suggest reorder (avoid simultaneous collision) ─────────────

export interface ReorderSuggestion {
  /** Components that should animate one at a time, in this order. */
  serializedComponents: string[];
}

export function suggestReorder(collisions: CollisionInterval[]): ReorderSuggestion {
  // Build a conflict graph: edge if two components collide.
  const graph = new Map<string, Set<string>>();
  for (const c of collisions) {
    if (!graph.has(c.componentA)) graph.set(c.componentA, new Set());
    if (!graph.has(c.componentB)) graph.set(c.componentB, new Set());
    graph.get(c.componentA)!.add(c.componentB);
    graph.get(c.componentB)!.add(c.componentA);
  }
  // Sort by degree (most-conflicting first → animate first separately).
  const byDegree = Array.from(graph.entries())
    .sort((a, b) => b[1].size - a[1].size)
    .map(([id]) => id);
  return { serializedComponents: byDegree };
}

// ── Summary ────────────────────────────────────────────────────

export interface ExplodeSummary {
  componentCount: number;
  collisionPairCount: number;
  worstOverlapMm3: number;
  earliestCollisionT: number;
}

export function summarize(steps: ExplodeStep[], collisions: CollisionInterval[]): ExplodeSummary {
  let worst = 0;
  let earliest = Infinity;
  for (const c of collisions) {
    if (c.midpointOverlapMm3 > worst) worst = c.midpointOverlapMm3;
    if (c.tStart < earliest) earliest = c.tStart;
  }
  return {
    componentCount: steps.length,
    collisionPairCount: collisions.length,
    worstOverlapMm3: worst,
    earliestCollisionT: collisions.length === 0 ? Infinity : earliest,
  };
}
