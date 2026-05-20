/**
 * weldBeadPathGenerator.ts — Generate weld bead robotic path along a
 * specified weld seam.
 *
 * Inputs:
 *   - Seam polyline (3D points along the joint).
 *   - Bead width + bead overlap (for multi-pass beads).
 *   - Travel angle (push vs pull): -15° push, +15° pull, 0 neutral.
 *   - Weave pattern (none / triangular / sinusoidal) for wide gaps.
 *
 * Output:
 *   - Path waypoints with TCP orientation.
 *   - Per-segment travel speed.
 *   - Estimated arc-on time.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface SeamPoint {
  position: Vec3;
  /** Seam normal (out of joint). */
  normal: Vec3;
}

export type WeavePattern = 'none' | 'triangular' | 'sinusoidal';

export interface BeadOptions {
  beadWidthMm: number;
  beadHeightMm: number;
  /** Travel angle (deg) along seam direction. */
  travelAngleDeg: number;
  /** Work angle (deg) perpendicular to seam. */
  workAngleDeg: number;
  /** Travel speed (mm/min). */
  travelSpeedMmMin: number;
  weave: WeavePattern;
  /** Weave amplitude (mm) for triangular/sinusoidal. */
  weaveAmplitudeMm: number;
  /** Weave frequency (Hz). */
  weaveFreqHz: number;
}

export const DEFAULT_OPTIONS: BeadOptions = {
  beadWidthMm: 5,
  beadHeightMm: 2,
  travelAngleDeg: 10,
  workAngleDeg: 45,
  travelSpeedMmMin: 300,
  weave: 'none',
  weaveAmplitudeMm: 0,
  weaveFreqHz: 0,
};

export interface WeldWaypoint {
  position: Vec3;
  /** TCP normal vector (welding torch direction). */
  tcpNormal: Vec3;
  /** Travel direction. */
  travelDirection: Vec3;
  /** Arc on / off flag. */
  arcOn: boolean;
}

export interface PathResult {
  waypoints: WeldWaypoint[];
  totalSeamLengthMm: number;
  estimatedTimeSec: number;
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function generatePath(seam: SeamPoint[], options: Partial<BeadOptions> = {}): PathResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const warnings: string[] = [];
  if (seam.length < 2) {
    warnings.push('Need ≥ 2 seam points.');
    return { waypoints: [], totalSeamLengthMm: 0, estimatedTimeSec: 0, warnings };
  }

  const waypoints: WeldWaypoint[] = [];
  let totalLength = 0;
  for (let i = 0; i < seam.length; i++) {
    const cur = seam[i]!;
    const nextIdx = Math.min(i + 1, seam.length - 1);
    const prevIdx = Math.max(i - 1, 0);
    const next = seam[nextIdx]!;
    const prev = seam[prevIdx]!;
    const travel = normalize(sub(next.position, prev.position));
    const baseNormal = normalize(cur.normal);
    // Tilt TCP by travel angle around the side direction.
    const side = normalize(cross(baseNormal, travel));
    const tcp = rotateAroundAxis(baseNormal, side, (opts.travelAngleDeg * Math.PI) / 180);

    let position = cur.position;
    if (opts.weave !== 'none') {
      // Apply weave perpendicular to travel.
      const phase = (i * 0.5 * opts.weaveFreqHz) % 1;
      const weaveOffset = opts.weave === 'triangular'
        ? (phase < 0.5 ? phase * 2 : 2 - phase * 2) * opts.weaveAmplitudeMm
        : Math.sin(phase * 2 * Math.PI) * opts.weaveAmplitudeMm;
      position = {
        x: cur.position.x + side.x * weaveOffset,
        y: cur.position.y + side.y * weaveOffset,
        z: cur.position.z + side.z * weaveOffset,
      };
    }

    waypoints.push({
      position,
      tcpNormal: tcp,
      travelDirection: travel,
      arcOn: true,
    });

    if (i > 0) totalLength += distance(seam[i - 1]!.position, cur.position);
  }
  const time = (totalLength / Math.max(0.001, opts.travelSpeedMmMin)) * 60;

  if (opts.beadHeightMm > opts.beadWidthMm) warnings.push('Bead height > width is unusual; check fillet shape.');

  return { waypoints, totalSeamLengthMm: totalLength, estimatedTimeSec: time, warnings };
}

// ── Vector helpers ───────────────────────────────────────────

function sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len === 0) return { x: 0, y: 0, z: 1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}
function rotateAroundAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = v.x * axis.x + v.y * axis.y + v.z * axis.z;
  return {
    x: v.x * cos + (axis.y * v.z - axis.z * v.y) * sin + axis.x * dot * (1 - cos),
    y: v.y * cos + (axis.z * v.x - axis.x * v.z) * sin + axis.y * dot * (1 - cos),
    z: v.z * cos + (axis.x * v.y - axis.y * v.x) * sin + axis.z * dot * (1 - cos),
  };
}
function distance(a: Vec3, b: Vec3): number { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

// ── Multi-pass for filler beads ──────────────────────────────

export interface MultiPassPlan {
  passes: number;
  perPassOffsetMm: number[];
}

export function multiPassPlan(grooveWidthMm: number, options: Partial<BeadOptions> = {}): MultiPassPlan {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const overlap = opts.beadWidthMm * 0.3;
  const effective = opts.beadWidthMm - overlap;
  const passes = Math.max(1, Math.ceil(grooveWidthMm / effective));
  const offsets = Array.from({ length: passes }, (_, i) => (i + 0.5) * effective - grooveWidthMm / 2);
  return { passes, perPassOffsetMm: offsets };
}

// ── Heat input ───────────────────────────────────────────────

export function heatInputKjPerMm(currentA: number, voltageV: number, travelSpeedMmMin: number, efficiency: number = 0.8): number {
  // Q = (V·I·η) / travel speed.
  const travelMmS = travelSpeedMmMin / 60;
  if (travelMmS === 0) return Infinity;
  return (voltageV * currentA * efficiency) / (1000 * travelMmS);
}

// ── Summary ────────────────────────────────────────────────────

export interface PathSummary {
  waypointCount: number;
  totalSeamLengthMm: number;
  estimatedTimeSec: number;
  warningCount: number;
}

export function summarize(result: PathResult): PathSummary {
  return {
    waypointCount: result.waypoints.length,
    totalSeamLengthMm: result.totalSeamLengthMm,
    estimatedTimeSec: result.estimatedTimeSec,
    warningCount: result.warnings.length,
  };
}
