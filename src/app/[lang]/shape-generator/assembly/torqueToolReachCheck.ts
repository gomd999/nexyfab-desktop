/**
 * torqueToolReachCheck.ts — Check whether a torque wrench can reach
 * each fastener in an assembly without collision.
 *
 * For every bolt the tool needs:
 *   - Approach corridor along the bolt axis sized for the socket /
 *     head clearance.
 *   - Free rotation arc for the lever.
 *   - Optional pre-load tool (impact driver) clearance.
 *
 * Module:
 *   - Bolt at position (X,Y,Z) with axis vector.
 *   - Tool defined by socket length + lever arm radius.
 *   - Obstacles defined as AABBs (other parts, fixtures).
 *   - Reports per-bolt reachability + worst clearance.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface AABB {
  min: Vec3;
  max: Vec3;
}

export interface Bolt {
  id: string;
  position: Vec3;
  /** Bolt axis (unit vector pointing toward bolt head). */
  axis: Vec3;
  /** Socket size (across-flats, mm). */
  socketSizeMm: number;
}

export interface TorqueTool {
  /** Length of the socket + extension (along bolt axis). */
  socketLengthMm: number;
  /** Lever / handle radius (perpendicular to axis). */
  leverRadiusMm: number;
  /** Free swing angle required (deg). */
  swingAngleDeg: number;
  /** Total clearance margin (mm). */
  clearanceMm: number;
}

export interface ReachOptions {
  /** Angular sweep samples for swing arc. */
  swingSamples: number;
}

export const DEFAULT_OPTIONS: ReachOptions = { swingSamples: 12 };

export interface ReachResult {
  boltId: string;
  approachClearMm: number;
  swingClearMm: number;
  reachable: boolean;
  obstacleHit?: string;
}

// ── Top-level entry ────────────────────────────────────────────

export function checkReach(bolts: Bolt[], tool: TorqueTool, obstacles: { id: string; aabb: AABB }[], options: Partial<ReachOptions> = {}): ReachResult[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return bolts.map(b => evaluateBolt(b, tool, obstacles, opts));
}

function evaluateBolt(bolt: Bolt, tool: TorqueTool, obstacles: { id: string; aabb: AABB }[], opts: ReachOptions): ReachResult {
  const axis = normalize(bolt.axis);
  // Approach: line from bolt head along axis for socketLength.
  const headApex: Vec3 = {
    x: bolt.position.x + axis.x * tool.socketLengthMm,
    y: bolt.position.y + axis.y * tool.socketLengthMm,
    z: bolt.position.z + axis.z * tool.socketLengthMm,
  };
  const approachClear = distancePointToAABBs(headApex, obstacles);

  // Swing arc: ring perpendicular to axis at the socket tip with radius = leverRadiusMm.
  const perp = perpendicular(axis);
  let worstSwing = Infinity;
  let hit: string | undefined;
  for (let i = 0; i < opts.swingSamples; i++) {
    const t = (i / opts.swingSamples) * (tool.swingAngleDeg * Math.PI) / 180;
    const r = tool.leverRadiusMm;
    const rotated = rotateAroundAxis(perp, axis, t);
    const sample: Vec3 = {
      x: headApex.x + rotated.x * r,
      y: headApex.y + rotated.y * r,
      z: headApex.z + rotated.z * r,
    };
    for (const obs of obstacles) {
      const d = distancePointToAABB(sample, obs.aabb);
      if (d < worstSwing) {
        worstSwing = d;
        if (d < tool.clearanceMm) hit = obs.id;
      }
    }
  }

  const reachable = approachClear >= tool.clearanceMm && worstSwing >= tool.clearanceMm;
  const result: ReachResult = {
    boltId: bolt.id,
    approachClearMm: approachClear,
    swingClearMm: worstSwing === Infinity ? approachClear : worstSwing,
    reachable,
  };
  if (hit !== undefined) result.obstacleHit = hit;
  return result;
}

// ── Geometry helpers ────────────────────────────────────────

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len === 0) return { x: 0, y: 0, z: 1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function perpendicular(v: Vec3): Vec3 {
  const helper = Math.abs(v.x) > 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const cross = {
    x: v.y * helper.z - v.z * helper.y,
    y: v.z * helper.x - v.x * helper.z,
    z: v.x * helper.y - v.y * helper.x,
  };
  return normalize(cross);
}

function rotateAroundAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  // Rodrigues' rotation formula.
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = v.x * axis.x + v.y * axis.y + v.z * axis.z;
  return {
    x: v.x * cos + (axis.y * v.z - axis.z * v.y) * sin + axis.x * dot * (1 - cos),
    y: v.y * cos + (axis.z * v.x - axis.x * v.z) * sin + axis.y * dot * (1 - cos),
    z: v.z * cos + (axis.x * v.y - axis.y * v.x) * sin + axis.z * dot * (1 - cos),
  };
}

function distancePointToAABB(p: Vec3, aabb: AABB): number {
  const dx = Math.max(aabb.min.x - p.x, 0, p.x - aabb.max.x);
  const dy = Math.max(aabb.min.y - p.y, 0, p.y - aabb.max.y);
  const dz = Math.max(aabb.min.z - p.z, 0, p.z - aabb.max.z);
  return Math.hypot(dx, dy, dz);
}

function distancePointToAABBs(p: Vec3, obstacles: { id: string; aabb: AABB }[]): number {
  let min = Infinity;
  for (const o of obstacles) {
    const d = distancePointToAABB(p, o.aabb);
    if (d < min) min = d;
  }
  return min === Infinity ? 1e9 : min;
}

// ── Suggest alternate tool ────────────────────────────────────

export interface ToolSuggestion {
  oldLeverRadius: number;
  newLeverRadius: number;
  rationale: string;
}

export function suggestSmallerTool(result: ReachResult, tool: TorqueTool): ToolSuggestion | null {
  if (result.reachable) return null;
  // Estimate required radius reduction: shrink so swingClear becomes OK.
  const ratio = result.swingClearMm / Math.max(0.001, tool.clearanceMm);
  const newRadius = Math.max(5, tool.leverRadiusMm * ratio);
  return {
    oldLeverRadius: tool.leverRadiusMm,
    newLeverRadius: newRadius,
    rationale: `Reduce lever from ${tool.leverRadiusMm} → ${newRadius.toFixed(1)} mm (e.g. crow-foot / stubby socket).`,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface ReachSummary {
  boltCount: number;
  reachableCount: number;
  unreachableCount: number;
  worstApproachClear: number;
}

export function summarize(results: ReachResult[]): ReachSummary {
  let reach = 0;
  let worst = Infinity;
  for (const r of results) {
    if (r.reachable) reach++;
    if (r.approachClearMm < worst) worst = r.approachClearMm;
  }
  return {
    boltCount: results.length,
    reachableCount: reach,
    unreachableCount: results.length - reach,
    worstApproachClear: results.length === 0 ? Infinity : worst,
  };
}
