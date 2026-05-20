/**
 * fiveAxisCollisionSweep.ts — Sweep a 5-axis toolpath for collisions
 * between tool/holder/spindle and workpiece/fixture.
 *
 * In 5-axis machining, the tool tilts via two rotary axes (A/C or
 * B/C). Two new collision risks beyond 3-axis:
 *
 *   1. Holder strikes the workpiece sidewall when tool is tilted.
 *   2. Spindle body strikes fixture rails when rotated to extreme.
 *
 * Module:
 *   - Per waypoint, build tool axis + holder envelope rotated by
 *     A/B/C angles.
 *   - Test against AABB obstacles.
 *   - Identify which axis is the dominant cause when collision found.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface FiveAxisPoint {
  tip: Vec3;
  /** A rotation (deg) around X. */
  aAxisDeg: number;
  /** B rotation (deg) around Y. */
  bAxisDeg: number;
  /** C rotation (deg) around Z. */
  cAxisDeg: number;
}

export interface ToolGeometry {
  /** Tool tip diameter. */
  diameterMm: number;
  /** Holder cone: top dia, bot dia, height. */
  holderTopDiaMm: number;
  holderBotDiaMm: number;
  holderHeightMm: number;
  /** Tool flute length. */
  fluteLengthMm: number;
  /** Spindle nose AABB half-extents from origin (X, Y, Z). */
  spindleHalfExtents: Vec3;
}

export interface AABB { min: Vec3; max: Vec3 }

export interface CollisionEvent {
  pathIndex: number;
  component: 'tool-tip' | 'holder' | 'spindle';
  obstacleId: string;
  /** Rotation axis dominating the collision. */
  dominantAxis: 'A' | 'B' | 'C' | 'translation';
  penetrationMm: number;
}

export interface SweepResult {
  events: CollisionEvent[];
  totalSamples: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function sweepFiveAxis(
  path: FiveAxisPoint[],
  tool: ToolGeometry,
  obstacles: { id: string; aabb: AABB }[],
  options: { clearanceMm?: number } = {},
): SweepResult {
  const clearance = options.clearanceMm ?? 1.0;
  const events: CollisionEvent[] = [];
  for (let i = 0; i < path.length; i++) {
    const pt = path[i]!;
    const dominant = dominantRotation(pt, i > 0 ? path[i - 1]! : pt);
    // Tool tip sphere.
    const tipAabb = sphereAabb(pt.tip, tool.diameterMm / 2 + clearance);
    // Holder swept cylinder.
    const holderCenter = applyTilt(pt.tip, tool.fluteLengthMm + tool.holderHeightMm / 2, pt);
    const holderRadius = Math.max(tool.holderTopDiaMm, tool.holderBotDiaMm) / 2 + clearance;
    const holderAabb: AABB = {
      min: { x: holderCenter.x - holderRadius, y: holderCenter.y - holderRadius, z: holderCenter.z - tool.holderHeightMm / 2 },
      max: { x: holderCenter.x + holderRadius, y: holderCenter.y + holderRadius, z: holderCenter.z + tool.holderHeightMm / 2 },
    };
    // Spindle nose.
    const spindleCenter = applyTilt(pt.tip, tool.fluteLengthMm + tool.holderHeightMm + tool.spindleHalfExtents.z, pt);
    const spindleAabb: AABB = {
      min: { x: spindleCenter.x - tool.spindleHalfExtents.x, y: spindleCenter.y - tool.spindleHalfExtents.y, z: spindleCenter.z - tool.spindleHalfExtents.z },
      max: { x: spindleCenter.x + tool.spindleHalfExtents.x, y: spindleCenter.y + tool.spindleHalfExtents.y, z: spindleCenter.z + tool.spindleHalfExtents.z },
    };
    for (const obs of obstacles) {
      const tipPen = aabbPenetration(tipAabb, obs.aabb);
      if (tipPen > 0) {
        events.push({ pathIndex: i, component: 'tool-tip', obstacleId: obs.id, dominantAxis: dominant, penetrationMm: tipPen });
      }
      const holderPen = aabbPenetration(holderAabb, obs.aabb);
      if (holderPen > 0) {
        events.push({ pathIndex: i, component: 'holder', obstacleId: obs.id, dominantAxis: dominant, penetrationMm: holderPen });
      }
      const spindlePen = aabbPenetration(spindleAabb, obs.aabb);
      if (spindlePen > 0) {
        events.push({ pathIndex: i, component: 'spindle', obstacleId: obs.id, dominantAxis: dominant, penetrationMm: spindlePen });
      }
    }
  }
  return { events, totalSamples: path.length };
}

// ── Helpers ──────────────────────────────────────────────────

function applyTilt(tip: Vec3, distance: number, pt: FiveAxisPoint): Vec3 {
  const aRad = (pt.aAxisDeg * Math.PI) / 180;
  const bRad = (pt.bAxisDeg * Math.PI) / 180;
  // Tool axis after tilt: start from Z, rotate by B around Y, then A around X.
  const sb = Math.sin(bRad), cb = Math.cos(bRad);
  const sa = Math.sin(aRad), ca = Math.cos(aRad);
  // After B: (sin B, 0, cos B). After A: (sin B, sin A·cos B, cos A·cos B).
  const axis: Vec3 = { x: sb, y: sa * cb, z: ca * cb };
  return {
    x: tip.x + axis.x * distance,
    y: tip.y + axis.y * distance,
    z: tip.z + axis.z * distance,
  };
}

function sphereAabb(centre: Vec3, radius: number): AABB {
  return {
    min: { x: centre.x - radius, y: centre.y - radius, z: centre.z - radius },
    max: { x: centre.x + radius, y: centre.y + radius, z: centre.z + radius },
  };
}

function aabbPenetration(a: AABB, b: AABB): number {
  const ox = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
  const oy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
  const oz = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
  if (ox <= 0 || oy <= 0 || oz <= 0) return 0;
  return Math.min(ox, oy, oz);
}

function dominantRotation(cur: FiveAxisPoint, prev: FiveAxisPoint): 'A' | 'B' | 'C' | 'translation' {
  const da = Math.abs(cur.aAxisDeg - prev.aAxisDeg);
  const db = Math.abs(cur.bAxisDeg - prev.bAxisDeg);
  const dc = Math.abs(cur.cAxisDeg - prev.cAxisDeg);
  const dt = Math.hypot(cur.tip.x - prev.tip.x, cur.tip.y - prev.tip.y, cur.tip.z - prev.tip.z);
  // Normalise translation to deg-equivalent by /10.
  const trans = dt / 10;
  const max = Math.max(da, db, dc, trans);
  if (max === da) return 'A';
  if (max === db) return 'B';
  if (max === dc) return 'C';
  return 'translation';
}

// ── Aggregate ────────────────────────────────────────────────

export interface SweepStats {
  collisionCount: number;
  byComponent: Record<CollisionEvent['component'], number>;
  byAxis: Record<CollisionEvent['dominantAxis'], number>;
  worstPenetrationMm: number;
}

export function aggregate(result: SweepResult): SweepStats {
  const byComponent: Record<CollisionEvent['component'], number> = { 'tool-tip': 0, holder: 0, spindle: 0 };
  const byAxis: Record<CollisionEvent['dominantAxis'], number> = { A: 0, B: 0, C: 0, translation: 0 };
  let worst = 0;
  for (const e of result.events) {
    byComponent[e.component]++;
    byAxis[e.dominantAxis]++;
    if (e.penetrationMm > worst) worst = e.penetrationMm;
  }
  return { collisionCount: result.events.length, byComponent, byAxis, worstPenetrationMm: worst };
}

// ── Suggest tilt limit ───────────────────────────────────────

export function suggestTiltLimit(result: SweepResult, path: FiveAxisPoint[]): { aMax: number; bMax: number } {
  let aMax = 90, bMax = 90;
  for (const e of result.events) {
    if (e.component === 'holder') {
      const pt = path[Math.floor(e.pathIndex)];
      if (pt) {
        if (Math.abs(pt.aAxisDeg) < aMax) aMax = Math.abs(pt.aAxisDeg) * 0.9;
        if (Math.abs(pt.bAxisDeg) < bMax) bMax = Math.abs(pt.bAxisDeg) * 0.9;
      }
    }
  }
  return { aMax, bMax };
}

// ── Summary ────────────────────────────────────────────────────

export interface SweepSummary {
  totalSamples: number;
  collisionCount: number;
  worstPenetrationMm: number;
}

export function summarize(result: SweepResult): SweepSummary {
  const stats = aggregate(result);
  return {
    totalSamples: result.totalSamples,
    collisionCount: result.events.length,
    worstPenetrationMm: stats.worstPenetrationMm,
  };
}
