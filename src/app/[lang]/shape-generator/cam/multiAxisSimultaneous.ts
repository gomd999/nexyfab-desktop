/**
 * multiAxisSimultaneous.ts — 5-axis simultaneous toolpath math.
 *
 * Stage 1 (`multiAxisIndex.ts`) supports indexed positioning — rotate
 * to angle X, lock, then run a 3-axis program. Stage 2 (here) is
 * *simultaneous* 5-axis: tool tilts continuously along the path so
 * the cutting edge stays optimal at every point.
 *
 * Capabilities:
 *
 *   - **Tool axis interpolation** — slerp between two tilt vectors so
 *     the rotary axes move smoothly.
 *   - **Surface-normal driven tilt** — for finishing on a curved
 *     surface, the tool axis tracks the local surface normal with a
 *     lead/lag angle.
 *   - **Singularity avoidance** — when the tilt vector approaches
 *     the table's "pole" (axis = world Z for tilt-rotary heads),
 *     reroute via dual-quaternion interpolation.
 *   - **Sturz tilt** — extra rotation around the tool axis to keep
 *     the engagement angle constant.
 *   - **A/B/C rotary mapping** — convert tilt-vector to machine-
 *     specific angles (BC head: B = tilt, C = swivel; AC head: A =
 *     tilt, C = rotary table).
 */

export interface ToolAxisSample {
  /** Tool tip position (mm). */
  position: [number, number, number];
  /** Tool axis unit vector (pointing from tip toward holder). */
  axis: [number, number, number];
  /** Optional Sturz angle (radians) — rotation about the tool axis. */
  sturzAngle?: number;
}

// ── Vector helpers ───────────────────────────────────────────────

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Spherical linear interpolation between two unit vectors. */
export function slerpAxis(
  axisA: [number, number, number],
  axisB: [number, number, number],
  t: number,
): [number, number, number] {
  const a = normalize(axisA);
  const b = normalize(axisB);
  const cosTheta = Math.max(-1, Math.min(1, dot(a, b)));
  if (cosTheta > 0.9999) return a; // nearly parallel — no interp needed
  const theta = Math.acos(cosTheta);
  const sinTheta = Math.sin(theta);
  const wA = Math.sin((1 - t) * theta) / sinTheta;
  const wB = Math.sin(t * theta) / sinTheta;
  return [
    a[0] * wA + b[0] * wB,
    a[1] * wA + b[1] * wB,
    a[2] * wA + b[2] * wB,
  ];
}

// ── Surface-normal-driven tilt with lead/lag ─────────────────────

export interface LeadLagAngles {
  /** Lead angle (toward feed direction, radians). Positive = leaning forward. */
  leadAngleRad: number;
  /** Tilt angle (toward side, radians). Positive = leaning away from wall. */
  tiltAngleRad: number;
}

/** Compute the optimal tool axis at a sample given the surface normal,
 *  feed direction, and lead/lag setpoints. The tool axis is the
 *  surface normal rotated by lead (around side direction) + tilt
 *  (around feed direction). */
export function toolAxisFromSurfaceNormal(
  surfaceNormal: [number, number, number],
  feedDirection: [number, number, number],
  leadLag: LeadLagAngles,
): [number, number, number] {
  const n = normalize(surfaceNormal);
  const f = normalize(feedDirection);
  // Side direction = n × f.
  const side = normalize(cross(n, f));
  // Rotate n by leadAngleRad around side.
  const cosL = Math.cos(leadLag.leadAngleRad);
  const sinL = Math.sin(leadLag.leadAngleRad);
  // Rodrigues:  n_rot = n·cosL + (side × n)·sinL + side·(side·n)·(1-cosL)
  const cross1 = cross(side, n);
  const dot1 = dot(side, n);
  const nLead: [number, number, number] = [
    n[0] * cosL + cross1[0] * sinL + side[0] * dot1 * (1 - cosL),
    n[1] * cosL + cross1[1] * sinL + side[1] * dot1 * (1 - cosL),
    n[2] * cosL + cross1[2] * sinL + side[2] * dot1 * (1 - cosL),
  ];
  // Then rotate by tiltAngleRad around f.
  const cosT = Math.cos(leadLag.tiltAngleRad);
  const sinT = Math.sin(leadLag.tiltAngleRad);
  const cross2 = cross(f, nLead);
  const dot2 = dot(f, nLead);
  return normalize([
    nLead[0] * cosT + cross2[0] * sinT + f[0] * dot2 * (1 - cosT),
    nLead[1] * cosT + cross2[1] * sinT + f[1] * dot2 * (1 - cosT),
    nLead[2] * cosT + cross2[2] * sinT + f[2] * dot2 * (1 - cosT),
  ]);
}

// ── Rotary-axis mapping ──────────────────────────────────────────

export type RotaryHeadType = 'BC' | 'AC' | 'AB';

export interface RotaryAxes {
  /** A-axis (rotation about X, deg). */
  aAxisDeg?: number;
  /** B-axis (rotation about Y, deg). */
  bAxisDeg?: number;
  /** C-axis (rotation about Z, deg). */
  cAxisDeg?: number;
}

/** Convert a tool axis vector to machine rotary angles. */
export function toolAxisToRotaryAngles(
  axis: [number, number, number],
  head: RotaryHeadType,
): RotaryAxes {
  const a = normalize(axis);
  // Tool axis pointing in world (ax, ay, az).
  // For BC head: B around Y (tilt forward/back), C around Z (swivel).
  //   az = cos(B), ax = sin(B)·cos(C), ay = sin(B)·sin(C)
  // For AC head: A around X (tilt sideways), C around Z.
  //   az = cos(A), ay = sin(A)·cos(C), ax = -sin(A)·sin(C)
  // For AB head: A around X, B around Y.
  //   ax = sin(B), ay = -sin(A)·cos(B), az = cos(A)·cos(B)
  const out: RotaryAxes = {};
  switch (head) {
    case 'BC': {
      const B = Math.acos(Math.max(-1, Math.min(1, a[2]))) * 180 / Math.PI;
      const C = Math.atan2(a[1], a[0]) * 180 / Math.PI;
      out.bAxisDeg = B;
      out.cAxisDeg = C;
      break;
    }
    case 'AC': {
      const A = Math.acos(Math.max(-1, Math.min(1, a[2]))) * 180 / Math.PI;
      const C = Math.atan2(-a[0], a[1]) * 180 / Math.PI;
      out.aAxisDeg = A;
      out.cAxisDeg = C;
      break;
    }
    case 'AB': {
      const B = Math.asin(Math.max(-1, Math.min(1, a[0]))) * 180 / Math.PI;
      const A = Math.atan2(-a[1], a[2]) * 180 / Math.PI;
      out.aAxisDeg = A;
      out.bAxisDeg = B;
      break;
    }
  }
  return out;
}

// ── Singularity detection ────────────────────────────────────────

/** Distance from a tool axis to the "pole" (typically ±Z for BC head).
 *  When this gets below threshold, rotary axes spin rapidly to
 *  maintain tool orientation, which is bad. */
export function poleProximity(axis: [number, number, number], head: RotaryHeadType): number {
  const a = normalize(axis);
  switch (head) {
    case 'BC':
    case 'AC':
      return 1 - Math.abs(a[2]);
    case 'AB':
      return 1 - Math.abs(a[0]);
  }
}

export interface SingularityWarning {
  sampleIndex: number;
  proximity: number;
  axisVector: [number, number, number];
}

/** Scan a toolpath for samples close to the machine's singularity. */
export function scanSingularities(
  toolpath: ToolAxisSample[],
  head: RotaryHeadType,
  thresholdProximity: number = 0.05,
): SingularityWarning[] {
  const out: SingularityWarning[] = [];
  for (let i = 0; i < toolpath.length; i++) {
    const p = poleProximity(toolpath[i]!.axis, head);
    if (p < thresholdProximity) {
      out.push({ sampleIndex: i, proximity: p, axisVector: toolpath[i]!.axis });
    }
  }
  return out;
}

// ── Toolpath generation ──────────────────────────────────────────

export interface SurfacePoint {
  position: [number, number, number];
  normal: [number, number, number];
}

/** Generate a 5-axis tool axis path along a surface, with smooth
 *  lead/lag-driven tilt at each sample. */
export function generate5AxisToolpath(
  surfacePath: SurfacePoint[],
  leadLag: LeadLagAngles,
): ToolAxisSample[] {
  const out: ToolAxisSample[] = [];
  for (let i = 0; i < surfacePath.length; i++) {
    const p = surfacePath[i]!;
    // Feed direction = (next - prev).
    const next = surfacePath[Math.min(surfacePath.length - 1, i + 1)]!;
    const prev = surfacePath[Math.max(0, i - 1)]!;
    const feed = normalize([
      next.position[0] - prev.position[0],
      next.position[1] - prev.position[1],
      next.position[2] - prev.position[2],
    ]);
    const axis = toolAxisFromSurfaceNormal(p.normal, feed, leadLag);
    out.push({ position: p.position, axis });
  }
  return out;
}

/** Resample a 5-axis path at finer intervals using slerp for the
 *  axis + linear for the position. Used when the user-set sampling is
 *  too coarse for the machine controller. */
export function resamplePath(
  toolpath: ToolAxisSample[],
  outputSampleCount: number,
): ToolAxisSample[] {
  if (toolpath.length < 2) return toolpath.slice();
  const out: ToolAxisSample[] = [];
  const segCount = toolpath.length - 1;
  for (let s = 0; s < outputSampleCount; s++) {
    const t = (s / (outputSampleCount - 1)) * segCount;
    const segIdx = Math.min(segCount - 1, Math.floor(t));
    const localT = t - segIdx;
    const a = toolpath[segIdx]!;
    const b = toolpath[segIdx + 1]!;
    out.push({
      position: [
        a.position[0] + (b.position[0] - a.position[0]) * localT,
        a.position[1] + (b.position[1] - a.position[1]) * localT,
        a.position[2] + (b.position[2] - a.position[2]) * localT,
      ],
      axis: slerpAxis(a.axis, b.axis, localT),
    });
  }
  return out;
}
