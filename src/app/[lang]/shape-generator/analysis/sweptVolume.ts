/**
 * sweptVolume.ts — Swept volume of a moving part along a motion path.
 *
 * In motion studies / interference analysis you need to know the
 * total space a moving part occupies as it travels through its
 * trajectory. The result is the **swept volume**: a union of the
 * part's bounding region at every sampled pose.
 *
 * This module gives a *bounding* swept volume (axis-aligned bounding
 * box union sampled at N poses). It is the cheap, fast approximation
 * that is used to:
 *
 *   - Detect rough envelope collisions early (before full mesh test).
 *   - Plan the housing / cabinet size for a moving mechanism.
 *   - Quote shipping crate volume for an assembled-but-deployable
 *     product.
 *
 * For accurate swept volume the caller would do a per-pose convex-hull
 * accumulation; that's a Stage 2 module.
 *
 * Inputs: a list of poses (translation + axis-angle rotation), and
 * a part bbox in its local frame.
 *
 * Output: AABB of the swept region + total enclosed bbox volume +
 * sampled corner cloud.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface Pose {
  /** World-space translation. */
  translation: Vec3;
  /** Axis (unit vector). */
  axis: Vec3;
  /** Rotation angle, degrees. */
  angleDeg: number;
}

export interface AABB {
  min: Vec3;
  max: Vec3;
}

export interface SweepResult {
  /** Bounding box of swept region. */
  bbox: AABB;
  /** Volume of bbox (mm³). */
  bboxVolumeMm3: number;
  /** Sampled corner positions (all 8 corners × all poses). */
  cornerSamples: Vec3[];
  /** Per-pose worst-axis extension (mm) — how far the corner travels in each axis. */
  axisRanges: { x: number; y: number; z: number };
  /** Pose count actually used. */
  poseCount: number;
}

export interface SweepOptions {
  /** If > 0, sub-sample interpolated poses between provided ones. */
  interpolationSamples: number;
}

export const DEFAULT_OPTIONS: SweepOptions = {
  interpolationSamples: 5,
};

// ── Top-level entry ────────────────────────────────────────────

export function computeSweptVolume(localBbox: AABB, poses: Pose[], options: Partial<SweepOptions> = {}): SweepResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (poses.length === 0) {
    return {
      bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
      bboxVolumeMm3: 0,
      cornerSamples: [],
      axisRanges: { x: 0, y: 0, z: 0 },
      poseCount: 0,
    };
  }

  const expanded = expandPoseSequence(poses, opts.interpolationSamples);
  const localCorners = bboxCorners(localBbox);
  const cornerSamples: Vec3[] = [];
  let xMin = Infinity, yMin = Infinity, zMin = Infinity;
  let xMax = -Infinity, yMax = -Infinity, zMax = -Infinity;

  for (const pose of expanded) {
    const R = quatToMatrix(axisAngleToQuat(pose.axis, pose.angleDeg));
    for (const c of localCorners) {
      const wx = R[0]! * c.x + R[1]! * c.y + R[2]! * c.z + pose.translation.x;
      const wy = R[3]! * c.x + R[4]! * c.y + R[5]! * c.z + pose.translation.y;
      const wz = R[6]! * c.x + R[7]! * c.y + R[8]! * c.z + pose.translation.z;
      cornerSamples.push({ x: wx, y: wy, z: wz });
      if (wx < xMin) xMin = wx;
      if (wy < yMin) yMin = wy;
      if (wz < zMin) zMin = wz;
      if (wx > xMax) xMax = wx;
      if (wy > yMax) yMax = wy;
      if (wz > zMax) zMax = wz;
    }
  }

  const bbox: AABB = { min: { x: xMin, y: yMin, z: zMin }, max: { x: xMax, y: yMax, z: zMax } };
  const vol = (xMax - xMin) * (yMax - yMin) * (zMax - zMin);
  return {
    bbox,
    bboxVolumeMm3: vol,
    cornerSamples,
    axisRanges: { x: xMax - xMin, y: yMax - yMin, z: zMax - zMin },
    poseCount: expanded.length,
  };
}

// ── Pose interpolation ────────────────────────────────────────

function expandPoseSequence(poses: Pose[], samplesBetween: number): Pose[] {
  if (samplesBetween <= 0 || poses.length < 2) return poses;
  const out: Pose[] = [];
  for (let i = 0; i < poses.length - 1; i++) {
    const a = poses[i]!;
    const b = poses[i + 1]!;
    for (let s = 0; s <= samplesBetween; s++) {
      const t = s / (samplesBetween + 1);
      out.push(lerpPose(a, b, t));
    }
  }
  out.push(poses[poses.length - 1]!);
  return out;
}

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return {
    translation: {
      x: a.translation.x + (b.translation.x - a.translation.x) * t,
      y: a.translation.y + (b.translation.y - a.translation.y) * t,
      z: a.translation.z + (b.translation.z - a.translation.z) * t,
    },
    axis: a.axis, // simple model: assume both poses share an axis
    angleDeg: a.angleDeg + (b.angleDeg - a.angleDeg) * t,
  };
}

// ── BBox + rotation helpers ───────────────────────────────────

export function bboxCorners(bbox: AABB): Vec3[] {
  const { min, max } = bbox;
  return [
    { x: min.x, y: min.y, z: min.z },
    { x: max.x, y: min.y, z: min.z },
    { x: min.x, y: max.y, z: min.z },
    { x: max.x, y: max.y, z: min.z },
    { x: min.x, y: min.y, z: max.z },
    { x: max.x, y: min.y, z: max.z },
    { x: min.x, y: max.y, z: max.z },
    { x: max.x, y: max.y, z: max.z },
  ];
}

function axisAngleToQuat(axis: Vec3, angleDeg: number): [number, number, number, number] {
  const len = Math.hypot(axis.x, axis.y, axis.z);
  if (len < 1e-9) return [1, 0, 0, 0];
  const ax = axis.x / len, ay = axis.y / len, az = axis.z / len;
  const half = (angleDeg * Math.PI) / 360;
  const s = Math.sin(half);
  return [Math.cos(half), ax * s, ay * s, az * s];
}

function quatToMatrix(q: [number, number, number, number]): number[] {
  const [w, x, y, z] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z),     2 * (x * z + w * y),
    2 * (x * y + w * z),     1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y),     2 * (y * z + w * x),     1 - 2 * (x * x + y * y),
  ];
}

// ── Interference test ──────────────────────────────────────────

/** Returns true if the swept bbox overlaps another bbox. */
export function bboxesOverlap(a: AABB, b: AABB): boolean {
  return (
    a.min.x <= b.max.x && a.max.x >= b.min.x &&
    a.min.y <= b.max.y && a.max.y >= b.min.y &&
    a.min.z <= b.max.z && a.max.z >= b.min.z
  );
}

// ── Summary ────────────────────────────────────────────────────

export interface SweepSummary {
  poseCount: number;
  bboxVolumeMm3: number;
  longestAxisMm: number;
  shortestAxisMm: number;
  aspectRatio: number;
  /** Returns "linear" (1 long, 2 short), "planar" (2 long, 1 short), or "compact". */
  shape: 'linear' | 'planar' | 'compact';
}

export function summarize(result: SweepResult): SweepSummary {
  const ranges = [result.axisRanges.x, result.axisRanges.y, result.axisRanges.z].sort((a, b) => a - b);
  const small = ranges[0]!;
  const mid = ranges[1]!;
  const big = ranges[2]!;
  let shape: 'linear' | 'planar' | 'compact';
  if (big > mid * 3) shape = 'linear';
  else if (mid > small * 3) shape = 'planar';
  else shape = 'compact';
  const aspect = small > 0 ? big / small : Infinity;
  return {
    poseCount: result.poseCount,
    bboxVolumeMm3: result.bboxVolumeMm3,
    longestAxisMm: big,
    shortestAxisMm: small,
    aspectRatio: aspect,
    shape,
  };
}
