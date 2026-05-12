/**
 * Q — Kinematics v0 — pure-geometry checks for common mechanism failures.
 *
 * No physics simulator: just closed-form geometric checks that catch the
 * 80% of "this won't actually work" bugs the agent commits during
 * assembly design. Specifically:
 *
 *   1. Gear mesh — for two spur gears, the center distance must equal
 *      m × (z₁ + z₂) / 2. We accept ±5% slop to allow for shrinkage
 *      tolerances (otherwise gears bind or skip).
 *   2. AABB interference — given two B-rep handles' bounding boxes
 *      and positions, report overlap volume so the agent knows when
 *      two parts collide.
 *
 * v0 limitations (call out in the tool's text response):
 *   - Gear mesh ignores backlash, helix angle, addendum/dedendum specifics.
 *   - Interference is AABB only, not exact mesh. False positives on
 *     diagonal parts; false negatives never (AABB ⊇ true bbox).
 *   - No motion simulation (kinematic chain solving is v1 + Solvespace 3D).
 */

export interface SpurGearSpec {
  /** Module (mm). */
  module: number;
  /** Number of teeth. */
  teeth: number;
}

export interface GearMeshCheckArgs {
  gearA: SpurGearSpec;
  gearB: SpurGearSpec;
  /** Actual center-to-center distance between axes (mm). */
  centerDistanceMm: number;
  /** Allowed mismatch as fraction of pitch diameter sum. Default 0.05 (5%). */
  toleranceFrac?: number;
}

export interface GearMeshCheckResult {
  ok: boolean;
  idealCenterDistanceMm: number;
  actualCenterDistanceMm: number;
  errorMm: number;
  gearRatio: number;
  message: string;
}

export function checkGearMesh(args: GearMeshCheckArgs): GearMeshCheckResult {
  const ideal = args.gearA.module * (args.gearA.teeth + args.gearB.teeth) / 2;
  const error = args.centerDistanceMm - ideal;
  const tolFrac = args.toleranceFrac ?? 0.05;
  const tolMm = ideal * tolFrac;
  const ok = Math.abs(error) <= tolMm && args.gearA.module === args.gearB.module;
  const ratio = args.gearB.teeth / args.gearA.teeth;
  let message: string;
  if (args.gearA.module !== args.gearB.module) {
    message = `Modules differ (${args.gearA.module} vs ${args.gearB.module}) — spur gears must share a module to mesh.`;
  } else if (Math.abs(error) > tolMm) {
    message = `Center distance ${args.centerDistanceMm}mm vs ideal ${ideal.toFixed(2)}mm — error ${error >= 0 ? '+' : ''}${error.toFixed(2)}mm exceeds ±${tolMm.toFixed(2)}mm.`;
  } else {
    message = `Mesh OK. Ratio ${ratio.toFixed(2)} : 1, center ${args.centerDistanceMm}mm (ideal ${ideal.toFixed(2)}mm, error ${error.toFixed(3)}mm).`;
  }
  return { ok, idealCenterDistanceMm: ideal, actualCenterDistanceMm: args.centerDistanceMm, errorMm: error, gearRatio: ratio, message };
}

// ─── AABB interference ─────────────────────────────────────────────────

export interface AABB {
  min: [number, number, number];
  max: [number, number, number];
}

export interface InterferenceCheckArgs {
  bboxA: AABB;
  bboxB: AABB;
  /** Optional translation applied to A's bbox. Default zero. */
  positionA?: [number, number, number];
  positionB?: [number, number, number];
}

export interface InterferenceResult {
  collides: boolean;
  /** Overlap dimensions in mm — all >0 only when collides. */
  overlap: { x: number; y: number; z: number; volume: number };
  message: string;
}

function shifted(b: AABB, t: [number, number, number]): AABB {
  return {
    min: [b.min[0] + t[0], b.min[1] + t[1], b.min[2] + t[2]],
    max: [b.max[0] + t[0], b.max[1] + t[1], b.max[2] + t[2]],
  };
}

export function checkInterference(args: InterferenceCheckArgs): InterferenceResult {
  const a = shifted(args.bboxA, args.positionA ?? [0, 0, 0]);
  const b = shifted(args.bboxB, args.positionB ?? [0, 0, 0]);
  const ox = Math.max(0, Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]));
  const oy = Math.max(0, Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]));
  const oz = Math.max(0, Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]));
  const volume = ox * oy * oz;
  const collides = ox > 0 && oy > 0 && oz > 0;
  const message = collides
    ? `Interference: AABB overlap ${ox.toFixed(2)} × ${oy.toFixed(2)} × ${oz.toFixed(2)}mm (volume ${volume.toFixed(2)}mm³). Move parts ≥${Math.max(ox, oy, oz).toFixed(2)}mm apart along the dominant axis.`
    : `No AABB collision. Note: AABB is conservative — actual mesh may still clear or interfere if shapes are diagonal.`;
  return { collides, overlap: { x: ox, y: oy, z: oz, volume }, message };
}
