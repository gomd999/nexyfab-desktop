/**
 * coolingChannelLayout.ts — Place cooling water channels around an
 * injection mold cavity to balance cooling.
 *
 * Cooling channels run inside the mold plates, typically 6-12 mm
 * diameter drilled holes connected by manifold plugs. Placement
 * rules (from Menges & Mohren, "How to make injection molds"):
 *
 *   - **Channel-to-cavity distance** = 2.5 × channel diameter
 *     (closer → faster cooling but risk of cracking).
 *   - **Channel-to-channel pitch** = 3 × channel diameter
 *     (closer → uniform cooling but mechanical weakening).
 *   - Channels should follow the cavity contour (conformal cooling
 *     in 3D-printed molds → not addressed here; this module is for
 *     straight drilled channels).
 *
 * Algorithm: project the cavity bbox onto a chosen plate plane,
 * lay out an N × M grid of parallel channels at the right offset
 * + pitch, then estimate cooling-uniformity from the average
 * distance from cavity surface samples to the nearest channel
 * axis.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface CavityBBox {
  min: Vec3;
  max: Vec3;
}

export interface CoolingChannel {
  id: string;
  /** Start of the drilled channel. */
  start: Vec3;
  /** End of the drilled channel. */
  end: Vec3;
  /** Channel diameter in mm. */
  diameterMm: number;
}

export interface LayoutResult {
  channels: CoolingChannel[];
  /** Per-cavity-sample distance to nearest channel axis. */
  cavityDistances: number[];
  /** Standard deviation of those distances (uniformity proxy). */
  cavityDistanceStdev: number;
  /** Average distance. */
  cavityDistanceAvg: number;
  /** Maximum distance (worst hotspot). */
  cavityDistanceMax: number;
}

export interface LayoutOptions {
  /** Channel diameter, mm. */
  diameterMm: number;
  /** Plate plane normal (default +Z meaning channels in XY). */
  plateNormal: 'X' | 'Y' | 'Z';
  /** Override channel-to-cavity distance (default 2.5 × diameter). */
  cavityOffsetMm?: number;
  /** Override channel pitch (default 3 × diameter). */
  pitchMm?: number;
  /** Run channels along this in-plane axis. */
  channelAxis: 'X' | 'Y';
  /** Cavity-surface sample count for uniformity scoring. */
  surfaceSamples: number;
}

export const DEFAULT_OPTIONS: LayoutOptions = {
  diameterMm: 8.0,
  plateNormal: 'Z',
  channelAxis: 'X',
  surfaceSamples: 50,
};

// ── Top-level entry ────────────────────────────────────────────

export function planCoolingChannels(cavity: CavityBBox, options: Partial<LayoutOptions> = {}): LayoutResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const cavityOffset = opts.cavityOffsetMm ?? opts.diameterMm * 2.5;
  const pitch = opts.pitchMm ?? opts.diameterMm * 3;

  // Build the grid: channels run along `channelAxis`, repeated along
  // the perpendicular in-plane axis, placed at `cavityOffset` on
  // both sides of the cavity along the `plateNormal` axis.
  const channels: CoolingChannel[] = [];
  let id = 0;
  const { axisAlong, axisAcross, axisStack } = pickAxes(opts.plateNormal, opts.channelAxis);

  const cavityAlongMin = getAxis(cavity.min, axisAlong);
  const cavityAlongMax = getAxis(cavity.max, axisAlong);
  const cavityAcrossMin = getAxis(cavity.min, axisAcross);
  const cavityAcrossMax = getAxis(cavity.max, axisAcross);
  const cavityStackMin = getAxis(cavity.min, axisStack);
  const cavityStackMax = getAxis(cavity.max, axisStack);

  const acrossSpan = cavityAcrossMax - cavityAcrossMin;
  const nAcross = Math.max(2, Math.ceil(acrossSpan / pitch) + 1);
  const stackUp = cavityStackMax + cavityOffset;
  const stackDown = cavityStackMin - cavityOffset;

  for (let i = 0; i < nAcross; i++) {
    const t = nAcross === 1 ? 0 : i / (nAcross - 1);
    const acrossPos = cavityAcrossMin + acrossSpan * t;
    const startCoord = buildVec(axisAlong, cavityAlongMin - opts.diameterMm, axisAcross, acrossPos, axisStack, stackUp);
    const endCoord = buildVec(axisAlong, cavityAlongMax + opts.diameterMm, axisAcross, acrossPos, axisStack, stackUp);
    channels.push({ id: `upper-${id++}`, start: startCoord, end: endCoord, diameterMm: opts.diameterMm });

    const startCoordD = buildVec(axisAlong, cavityAlongMin - opts.diameterMm, axisAcross, acrossPos, axisStack, stackDown);
    const endCoordD = buildVec(axisAlong, cavityAlongMax + opts.diameterMm, axisAcross, acrossPos, axisStack, stackDown);
    channels.push({ id: `lower-${id++}`, start: startCoordD, end: endCoordD, diameterMm: opts.diameterMm });
  }

  // Sample cavity surface and compute distance to nearest channel axis.
  const samples = sampleCavitySurface(cavity, opts.surfaceSamples);
  const distances: number[] = [];
  for (const p of samples) {
    let minD = Infinity;
    for (const ch of channels) {
      const d = pointToSegmentDistance(p, ch.start, ch.end);
      if (d < minD) minD = d;
    }
    distances.push(minD);
  }

  const avg = distances.reduce((s, d) => s + d, 0) / Math.max(1, distances.length);
  const variance = distances.reduce((s, d) => s + (d - avg) ** 2, 0) / Math.max(1, distances.length);
  const stdev = Math.sqrt(variance);
  const max = distances.reduce((m, d) => Math.max(m, d), 0);

  return {
    channels,
    cavityDistances: distances,
    cavityDistanceStdev: stdev,
    cavityDistanceAvg: avg,
    cavityDistanceMax: max,
  };
}

// ── Helpers ────────────────────────────────────────────────────

function pickAxes(plateNormal: 'X' | 'Y' | 'Z', channelAxis: 'X' | 'Y'): { axisAlong: 'x' | 'y' | 'z'; axisAcross: 'x' | 'y' | 'z'; axisStack: 'x' | 'y' | 'z' } {
  const stack = plateNormal.toLowerCase() as 'x' | 'y' | 'z';
  const along = channelAxis.toLowerCase() as 'x' | 'y';
  const allAxes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
  const across = allAxes.find(a => a !== stack && a !== along) ?? 'y';
  return { axisAlong: along, axisAcross: across, axisStack: stack };
}

function getAxis(v: Vec3, axis: 'x' | 'y' | 'z'): number {
  return v[axis];
}

function buildVec(
  a1: 'x' | 'y' | 'z', v1: number,
  a2: 'x' | 'y' | 'z', v2: number,
  a3: 'x' | 'y' | 'z', v3: number,
): Vec3 {
  const out: Vec3 = { x: 0, y: 0, z: 0 };
  out[a1] = v1;
  out[a2] = v2;
  out[a3] = v3;
  return out;
}

function sampleCavitySurface(cavity: CavityBBox, count: number): Vec3[] {
  const out: Vec3[] = [];
  // Sample on 6 faces of the bbox.
  for (let i = 0; i < count; i++) {
    const face = i % 6;
    const r1 = ((i * 17) % 100) / 100;
    const r2 = ((i * 23) % 100) / 100;
    const { min, max } = cavity;
    let p: Vec3;
    switch (face) {
      case 0: p = { x: min.x, y: lerp(min.y, max.y, r1), z: lerp(min.z, max.z, r2) }; break;
      case 1: p = { x: max.x, y: lerp(min.y, max.y, r1), z: lerp(min.z, max.z, r2) }; break;
      case 2: p = { x: lerp(min.x, max.x, r1), y: min.y, z: lerp(min.z, max.z, r2) }; break;
      case 3: p = { x: lerp(min.x, max.x, r1), y: max.y, z: lerp(min.z, max.z, r2) }; break;
      case 4: p = { x: lerp(min.x, max.x, r1), y: lerp(min.y, max.y, r2), z: min.z }; break;
      default: p = { x: lerp(min.x, max.x, r1), y: lerp(min.y, max.y, r2), z: max.z };
    }
    out.push(p);
  }
  return out;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function pointToSegmentDistance(p: Vec3, a: Vec3, b: Vec3): number {
  const ax = b.x - a.x, ay = b.y - a.y, az = b.z - a.z;
  const lenSq = ax * ax + ay * ay + az * az;
  if (lenSq < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ax + (p.y - a.y) * ay + (p.z - a.z) * az) / lenSq));
  const cx = a.x + ax * t;
  const cy = a.y + ay * t;
  const cz = a.z + az * t;
  return Math.hypot(p.x - cx, p.y - cy, p.z - cz);
}

// ── Summary ────────────────────────────────────────────────────

export interface LayoutSummary {
  channelCount: number;
  avgDistanceToCavity: number;
  worstDistanceToCavity: number;
  uniformityScore: number;
  /** True if stdev / avg < 0.3 (roughly uniform). */
  isUniform: boolean;
}

export function summarize(result: LayoutResult): LayoutSummary {
  const cv = result.cavityDistanceAvg > 0 ? result.cavityDistanceStdev / result.cavityDistanceAvg : 0;
  return {
    channelCount: result.channels.length,
    avgDistanceToCavity: result.cavityDistanceAvg,
    worstDistanceToCavity: result.cavityDistanceMax,
    uniformityScore: 1 - Math.min(1, cv),
    isUniform: cv < 0.3,
  };
}
