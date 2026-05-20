/**
 * printOrientationOptimizer.ts — Pick best build orientation for AM.
 *
 * Build orientation drives print success more than any other choice:
 *
 *   - **Build height** — taller orientations cost more (more layers).
 *   - **Support volume** — overhangs > critical angle need support.
 *     Critical angle is process-dependent (FDM ≈ 45°, SLA ≈ 30°,
 *     SLS ≈ 0° (powder is self-supporting)).
 *   - **Bottom-face area** — wide flat bottom = stable, no raft.
 *   - **Trapped fluids / powder** — internal cavities pointing
 *     downward trap unfused powder; orient them up.
 *   - **Anisotropy** — FDM bonds weaker across layer lines; align
 *     load direction perpendicular to layer lines.
 *   - **Visual quality** — front-facing surfaces should be the
 *     smoothest (top-facing in FDM).
 *
 * This module evaluates candidate orientations (rotation matrices),
 * scoring each on multi-objective criteria. Returns top-N ranked.
 *
 * Candidate generation: 6 axis-aligned principal orientations +
 * Fibonacci-lattice sampling of additional rotations.
 */

export type Vec3 = [number, number, number];

export interface TriangleSample {
  /** Outward normal (unit). */
  normal: Vec3;
  /** Triangle area (mm²). */
  areaMm2: number;
  /** Triangle centroid (mm). */
  centroidMm: Vec3;
}

export interface OrientationCandidate {
  /** Rotation matrix (3×3 row-major) applied to the part. */
  rotation: number[];
  /** Build axis after rotation (always [0,0,1] in world). */
  description?: string;
  /** Score components. */
  buildHeightMm: number;
  supportArea: number;
  bottomArea: number;
  /** Composite score (higher = better). */
  score: number;
}

export type PrintProcess = 'FDM' | 'SLA' | 'SLS' | 'DMLS';

export interface OrientationOptions {
  process: PrintProcess;
  /** Overhang threshold in degrees (faces tilted below build plate by more than this need support). */
  overhangAngleDeg: number;
  /** Weights for the score components. */
  weights: {
    /** Penalty per mm of build height. */
    heightWeight: number;
    /** Penalty per mm² of supported area. */
    supportWeight: number;
    /** Reward per mm² of bottom area. */
    bottomWeight: number;
  };
  /** Fibonacci samples beyond the 6 axis candidates. */
  sampleCount: number;
}

export const DEFAULT_ORIENTATION_OPTIONS: OrientationOptions = {
  process: 'FDM',
  overhangAngleDeg: 45,
  weights: { heightWeight: 0.1, supportWeight: 1, bottomWeight: 0.5 },
  sampleCount: 24,
};

// ── Top-level entry ─────────────────────────────────────────────

export function optimizePrintOrientation(
  triangles: TriangleSample[],
  options: Partial<OrientationOptions> = {},
): OrientationCandidate[] {
  const opts = mergeOptions(options);
  const rotations = generateRotationCandidates(opts.sampleCount);
  const candidates = rotations.map(({ rotation, label }) => evaluateOrientation(triangles, rotation, label, opts));
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function mergeOptions(o: Partial<OrientationOptions>): OrientationOptions {
  return {
    process: o.process ?? DEFAULT_ORIENTATION_OPTIONS.process,
    overhangAngleDeg: o.overhangAngleDeg ?? processOverhangAngle(o.process ?? DEFAULT_ORIENTATION_OPTIONS.process),
    weights: { ...DEFAULT_ORIENTATION_OPTIONS.weights, ...o.weights },
    sampleCount: o.sampleCount ?? DEFAULT_ORIENTATION_OPTIONS.sampleCount,
  };
}

function processOverhangAngle(p: PrintProcess): number {
  switch (p) {
    case 'FDM': return 45;
    case 'SLA': return 30;
    case 'SLS': return 0;
    case 'DMLS': return 35;
  }
}

// ── Evaluation ──────────────────────────────────────────────────

export function evaluateOrientation(
  triangles: TriangleSample[],
  rotation: number[],
  label: string | undefined,
  opts: OrientationOptions,
): OrientationCandidate {
  // After rotation, build axis = +Z. The face's "facing-down" angle is
  // arccos(rotated_normal · -Z) = arccos(-rotated_normal[2]).
  const cosCrit = Math.cos((90 - opts.overhangAngleDeg) * Math.PI / 180);
  let supportArea = 0;
  let bottomArea = 0;
  let minZ = Infinity, maxZ = -Infinity;

  for (const tri of triangles) {
    const rn = rotateVec(rotation, tri.normal);
    // Downward component: -rn[2]. Larger = more facing down.
    const downComponent = -rn[2];
    if (downComponent > 0.95) {
      // Near-flat bottom face — counted as "bottom", not support
      // (it rests on the build plate, no support needed).
      bottomArea += tri.areaMm2;
    } else if (downComponent > cosCrit) {
      // Steep overhang — needs support.
      supportArea += tri.areaMm2 * downComponent;
    }
    // Build height bound.
    for (const offset of [-1, 1]) {
      void offset;
    }
    const rc = rotateVec(rotation, tri.centroidMm);
    if (rc[2] < minZ) minZ = rc[2];
    if (rc[2] > maxZ) maxZ = rc[2];
  }
  const buildHeight = Math.max(0, maxZ - minZ);
  const score = opts.weights.bottomWeight * bottomArea
              - opts.weights.heightWeight * buildHeight
              - opts.weights.supportWeight * supportArea;

  const result: OrientationCandidate = {
    rotation,
    buildHeightMm: buildHeight,
    supportArea,
    bottomArea,
    score,
  };
  if (label !== undefined) result.description = label;
  return result;
}

// ── Candidate generation ────────────────────────────────────────

function rotationFromUpVector(up: Vec3): number[] {
  // Build a rotation that maps up → +Z.
  const target: Vec3 = [0, 0, 1];
  const u = normalize(up);
  const dot = u[0] * target[0] + u[1] * target[1] + u[2] * target[2];
  if (dot > 0.9999) {
    return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }
  if (dot < -0.9999) {
    return [1, 0, 0, 0, -1, 0, 0, 0, -1];
  }
  const axis = cross(u, target);
  const axisN = normalize(axis);
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  return rotationAxisAngle(axisN, angle);
}

function rotationAxisAngle(axis: Vec3, angle: number): number[] {
  const c = Math.cos(angle), s = Math.sin(angle), C = 1 - c;
  const [x, y, z] = axis;
  return [
    c + x * x * C,     x * y * C - z * s, x * z * C + y * s,
    y * x * C + z * s, c + y * y * C,     y * z * C - x * s,
    z * x * C - y * s, z * y * C + x * s, c + z * z * C,
  ];
}

export function generateRotationCandidates(sampleCount: number): Array<{ rotation: number[]; label?: string }> {
  const candidates: Array<{ rotation: number[]; label?: string }> = [
    { rotation: rotationFromUpVector([0, 0, 1]), label: 'Z+ up' },
    { rotation: rotationFromUpVector([0, 0, -1]), label: 'Z- up' },
    { rotation: rotationFromUpVector([1, 0, 0]), label: 'X+ up' },
    { rotation: rotationFromUpVector([-1, 0, 0]), label: 'X- up' },
    { rotation: rotationFromUpVector([0, 1, 0]), label: 'Y+ up' },
    { rotation: rotationFromUpVector([0, -1, 0]), label: 'Y- up' },
  ];
  // Fibonacci-lattice samples for additional orientations.
  const golden = (1 + Math.sqrt(5)) / 2;
  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleCount;
    const phi = Math.acos(1 - 2 * t);
    const theta = 2 * Math.PI * i / golden;
    const up: Vec3 = [
      Math.sin(phi) * Math.cos(theta),
      Math.sin(phi) * Math.sin(theta),
      Math.cos(phi),
    ];
    candidates.push({ rotation: rotationFromUpVector(up) });
  }
  return candidates;
}

// ── Anisotropy + finish ─────────────────────────────────────────

export interface LoadCase {
  /** Direction the load is applied (world coords). */
  direction: Vec3;
  /** Magnitude relative — used to weight multiple loads. */
  weight: number;
}

/** Reward orientations where layer lines are perpendicular to the load
 *  direction (strong direction). For FDM. */
export function anisotropyScore(rotation: number[], loadCases: LoadCase[]): number {
  if (loadCases.length === 0) return 0;
  const layerLineDir: Vec3 = [0, 0, 1]; // along build axis
  let total = 0;
  let weightSum = 0;
  for (const lc of loadCases) {
    const rotatedDir = rotateVec(rotation, lc.direction);
    const dot = Math.abs(
      rotatedDir[0] * layerLineDir[0] +
      rotatedDir[1] * layerLineDir[1] +
      rotatedDir[2] * layerLineDir[2],
    );
    total += (1 - dot) * lc.weight; // higher when load perpendicular to layer lines
    weightSum += lc.weight;
  }
  return weightSum > 0 ? total / weightSum : 0;
}

// ── Vector helpers ──────────────────────────────────────────────

function rotateVec(rot: number[], v: Vec3): Vec3 {
  return [
    rot[0]! * v[0] + rot[1]! * v[1] + rot[2]! * v[2],
    rot[3]! * v[0] + rot[4]! * v[1] + rot[5]! * v[2],
    rot[6]! * v[0] + rot[7]! * v[1] + rot[8]! * v[2],
  ];
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
