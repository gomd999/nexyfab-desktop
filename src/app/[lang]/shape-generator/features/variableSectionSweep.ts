/**
 * variableSectionSweep.ts — Sweep with profile that morphs along path.
 *
 * `multiSectionSweep.ts` interpolates between *discrete* sections at
 * fixed spine parameters. Variable-section sweep is a generalization:
 * the profile is described by a parametric function of the spine
 * parameter, with the parameters themselves driven by rules (e.g.,
 * "diameter grows linearly from 10mm to 30mm, wall thickness from
 * 2mm to 5mm, hex count 6 → 12").
 *
 * Used by:
 *   - **Bottle / vessel design** — diameter and wall thickness vary
 *     smoothly along axis.
 *   - **Cooling fins / impellers** — twist + chord change along blade.
 *   - **Custom organic forms** — generative / parametric sculpture.
 *
 * The profile is a function `(s: number) => Point2D[]` where s ∈ [0,1].
 * The sweep walks the spine, evaluates the profile at each station,
 * applies the spine frame, and emits a quad mesh.
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface SpinePathSample {
  /** Parameter t in [0, 1]. */
  t: number;
  /** Position in world (mm). */
  position: Point3D;
  /** Unit tangent. */
  tangent: Point3D;
}

export type ProfileFunction = (s: number) => Point2D[];

export interface VariableSweepOptions {
  /** Number of stations along the spine. */
  stationCount: number;
  /** Number of points per cross-section. */
  profileResolution: number;
  /** Close the swept volume with end caps. */
  capEnds: boolean;
  /** Frame computation. */
  frame: 'frenet' | 'rmf';
}

export const DEFAULT_VAR_SWEEP_OPTIONS: VariableSweepOptions = {
  stationCount: 32,
  profileResolution: 32,
  capEnds: true,
  frame: 'rmf',
};

export interface SweepMesh {
  positions: Float32Array;
  indices: Uint32Array;
  stationCount: number;
  profileCount: number;
}

// ── Top-level entry ─────────────────────────────────────────────

export function sweepVariableSection(
  spine: SpinePathSample[],
  profileFn: ProfileFunction,
  options: Partial<VariableSweepOptions> = {},
): SweepMesh {
  const opts = { ...DEFAULT_VAR_SWEEP_OPTIONS, ...options };
  if (spine.length < 2) {
    return { positions: new Float32Array(0), indices: new Uint32Array(0), stationCount: 0, profileCount: 0 };
  }

  const positions: number[] = [];
  const indices: number[] = [];

  // Pre-compute reference frame for RMF (rotation-minimizing).
  const stations = sampleSpine(spine, opts.stationCount);
  const frames = opts.frame === 'rmf' ? rmfFrames(stations) : frenetFrames(stations);

  // For each station, evaluate the profile and lay it out.
  for (let i = 0; i < stations.length; i++) {
    const station = stations[i]!;
    const frame = frames[i]!;
    const profile2d = profileFn(station.t);
    const profile = resampleProfile(profile2d, opts.profileResolution);
    for (const p of profile) {
      const world = sectionPointToWorld(station.position, frame.normal, frame.binormal, p);
      positions.push(world.x, world.y, world.z);
    }
  }

  // Connect stations with quads (split into 2 triangles).
  const profCount = opts.profileResolution;
  for (let i = 0; i < stations.length - 1; i++) {
    for (let p = 0; p < profCount; p++) {
      const pNext = (p + 1) % profCount;
      const i00 = i * profCount + p;
      const i01 = i * profCount + pNext;
      const i10 = (i + 1) * profCount + p;
      const i11 = (i + 1) * profCount + pNext;
      indices.push(i00, i01, i11);
      indices.push(i00, i11, i10);
    }
  }

  if (opts.capEnds) {
    const firstBase = 0;
    const lastBase = (stations.length - 1) * profCount;
    for (let p = 1; p < profCount - 1; p++) {
      indices.push(firstBase, firstBase + p + 1, firstBase + p);
      indices.push(lastBase, lastBase + p, lastBase + p + 1);
    }
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    stationCount: stations.length,
    profileCount: profCount,
  };
}

// ── Spine sampling ──────────────────────────────────────────────

function sampleSpine(spine: SpinePathSample[], stationCount: number): SpinePathSample[] {
  if (spine.length === 0 || stationCount <= 0) return [];
  const out: SpinePathSample[] = [];
  for (let i = 0; i < stationCount; i++) {
    const t = i / (stationCount - 1);
    out.push(interpolateSpine(spine, t));
  }
  return out;
}

function interpolateSpine(spine: SpinePathSample[], t: number): SpinePathSample {
  if (spine.length === 0) {
    return { t, position: { x: 0, y: 0, z: 0 }, tangent: { x: 0, y: 0, z: 1 } };
  }
  if (t <= spine[0]!.t) return spine[0]!;
  if (t >= spine[spine.length - 1]!.t) return spine[spine.length - 1]!;
  for (let i = 0; i < spine.length - 1; i++) {
    if (spine[i + 1]!.t >= t) {
      const a = spine[i]!;
      const b = spine[i + 1]!;
      const u = (t - a.t) / (b.t - a.t);
      return {
        t,
        position: { x: lerp(a.position.x, b.position.x, u), y: lerp(a.position.y, b.position.y, u), z: lerp(a.position.z, b.position.z, u) },
        tangent: normalize({ x: lerp(a.tangent.x, b.tangent.x, u), y: lerp(a.tangent.y, b.tangent.y, u), z: lerp(a.tangent.z, b.tangent.z, u) }),
      };
    }
  }
  return spine[spine.length - 1]!;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ── Frame computation ──────────────────────────────────────────

interface Frame {
  origin: Point3D;
  tangent: Point3D;
  normal: Point3D;
  binormal: Point3D;
}

/** Frenet frame from spine — defined when curvature ≠ 0; otherwise
 *  falls back to the previous frame. */
function frenetFrames(stations: SpinePathSample[]): Frame[] {
  const frames: Frame[] = [];
  let lastNormal: Point3D = { x: 1, y: 0, z: 0 };
  for (let i = 0; i < stations.length; i++) {
    const t = stations[i]!.tangent;
    const seed: Point3D = Math.abs(t.z) < 0.95 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
    const dot = seed.x * t.x + seed.y * t.y + seed.z * t.z;
    const n = normalize({ x: seed.x - dot * t.x, y: seed.y - dot * t.y, z: seed.z - dot * t.z });
    if (i === 0) lastNormal = n;
    const b = cross(t, n);
    frames.push({ origin: stations[i]!.position, tangent: t, normal: n, binormal: b });
    lastNormal = n;
  }
  return frames;
}

/** Rotation-minimizing frame (RMF) — Bishop frame propagation. */
function rmfFrames(stations: SpinePathSample[]): Frame[] {
  const frames: Frame[] = [];
  if (stations.length === 0) return frames;
  // Pick an initial normal perpendicular to the first tangent.
  const t0 = stations[0]!.tangent;
  const seed: Point3D = Math.abs(t0.z) < 0.95 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const dot0 = seed.x * t0.x + seed.y * t0.y + seed.z * t0.z;
  let normal = normalize({ x: seed.x - dot0 * t0.x, y: seed.y - dot0 * t0.y, z: seed.z - dot0 * t0.z });
  for (let i = 0; i < stations.length; i++) {
    const t = stations[i]!.tangent;
    // Project current normal onto plane perpendicular to t.
    const proj = normalize(subtract(normal, scale(t, dot(normal, t))));
    normal = proj;
    const binormal = cross(t, normal);
    frames.push({ origin: stations[i]!.position, tangent: t, normal, binormal });
  }
  return frames;
}

// ── Profile resampling ─────────────────────────────────────────

function resampleProfile(profile: Point2D[], targetCount: number): Point2D[] {
  if (profile.length === 0) return [];
  if (profile.length === targetCount) return profile;
  const perimLengths: number[] = [];
  let total = 0;
  for (let i = 0; i < profile.length; i++) {
    const j = (i + 1) % profile.length;
    const d = Math.hypot(profile[j]!.x - profile[i]!.x, profile[j]!.y - profile[i]!.y);
    perimLengths.push(d);
    total += d;
  }
  if (total === 0) return Array(targetCount).fill(profile[0]!);
  const out: Point2D[] = [];
  for (let i = 0; i < targetCount; i++) {
    const target = (i / targetCount) * total;
    let acc = 0;
    let k = 0;
    while (k < perimLengths.length && acc + perimLengths[k]! < target) {
      acc += perimLengths[k]!;
      k++;
    }
    if (k >= perimLengths.length) k = perimLengths.length - 1;
    const segLen = perimLengths[k]!;
    const u = segLen > 0 ? (target - acc) / segLen : 0;
    const a = profile[k]!;
    const b = profile[(k + 1) % profile.length]!;
    out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
  }
  return out;
}

function sectionPointToWorld(origin: Point3D, normal: Point3D, binormal: Point3D, p: Point2D): Point3D {
  return {
    x: origin.x + normal.x * p.x + binormal.x * p.y,
    y: origin.y + normal.y * p.x + binormal.y * p.y,
    z: origin.z + normal.z * p.x + binormal.z * p.y,
  };
}

// ── Common profile builders ────────────────────────────────────

/** Circle profile with optional radius driver f(s). */
export function circleProfile(radius: number | ((s: number) => number), points: number = 32): ProfileFunction {
  return (s) => {
    const r = typeof radius === 'function' ? radius(s) : radius;
    const out: Point2D[] = [];
    for (let i = 0; i < points; i++) {
      const a = (i / points) * 2 * Math.PI;
      out.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
    }
    return out;
  };
}

/** Regular N-gon profile with side count + radius drivers. */
export function polygonProfile(
  sides: number | ((s: number) => number),
  radius: number | ((s: number) => number),
): ProfileFunction {
  return (s) => {
    const n = Math.max(3, Math.round(typeof sides === 'function' ? sides(s) : sides));
    const r = typeof radius === 'function' ? radius(s) : radius;
    const out: Point2D[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI;
      out.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
    }
    return out;
  };
}

/** Ellipse profile (rx, ry can each vary along s). */
export function ellipseProfile(
  rx: number | ((s: number) => number),
  ry: number | ((s: number) => number),
  points: number = 32,
): ProfileFunction {
  return (s) => {
    const a = typeof rx === 'function' ? rx(s) : rx;
    const b = typeof ry === 'function' ? ry(s) : ry;
    const out: Point2D[] = [];
    for (let i = 0; i < points; i++) {
      const ang = (i / points) * 2 * Math.PI;
      out.push({ x: a * Math.cos(ang), y: b * Math.sin(ang) });
    }
    return out;
  };
}

// ── Vector helpers ──────────────────────────────────────────────

function dot(a: Point3D, b: Point3D): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Point3D, b: Point3D): Point3D {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function normalize(v: Point3D): Point3D {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function subtract(a: Point3D, b: Point3D): Point3D {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(v: Point3D, s: number): Point3D {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}
