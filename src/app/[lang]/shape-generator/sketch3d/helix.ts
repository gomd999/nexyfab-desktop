/**
 * helix.ts — Parametric 3D helix / spiral.
 *
 * Used to create:
 *   - Thread guides (sweep a circle along helix → bolt thread)
 *   - Springs (sweep a circle along helix → coil)
 *   - Spirals (variable-radius helix → planar spiral)
 *
 * Parameters:
 *   - pitch: vertical distance per turn (mm)
 *   - radius: cylinder radius (mm). Variable radius produces cone.
 *   - turns: number of full revolutions
 *   - direction: 'cw' or 'ccw' looking down the axis
 *   - axis: 'x' / 'y' / 'z' (default 'z')
 *
 * Output: 3D polyline samples ready to feed into sweep / sketch3D.
 */

export interface HelixParams {
  pitchMm: number;
  /** Radius at the start (mm). */
  radiusStartMm: number;
  /** Radius at the end (mm). Default = radiusStartMm (cylinder). */
  radiusEndMm?: number;
  turns: number;
  direction?: 'cw' | 'ccw';
  axis?: 'x' | 'y' | 'z';
  /** Samples per turn — affects smoothness. Default 32. */
  samplesPerTurn?: number;
}

export interface HelixSample {
  x: number;
  y: number;
  z: number;
  /** Parameter t along the helix (0 → 1). */
  t: number;
}

/** Sample a helix into an array of 3D points. */
export function sampleHelix(p: HelixParams): HelixSample[] {
  const dir = p.direction ?? 'ccw';
  const axis = p.axis ?? 'z';
  const samplesPerTurn = p.samplesPerTurn ?? 32;
  const totalSamples = Math.max(2, Math.ceil(p.turns * samplesPerTurn) + 1);
  const rStart = p.radiusStartMm;
  const rEnd = p.radiusEndMm ?? rStart;
  const totalHeight = p.pitchMm * p.turns;
  const dirSign = dir === 'ccw' ? 1 : -1;

  const out: HelixSample[] = [];
  for (let i = 0; i < totalSamples; i++) {
    const t = totalSamples === 1 ? 0 : i / (totalSamples - 1);
    const angle = dirSign * 2 * Math.PI * p.turns * t;
    const radius = rStart + (rEnd - rStart) * t;
    const h = totalHeight * t;
    const cu = radius * Math.cos(angle);
    const cv = radius * Math.sin(angle);
    let x = 0, y = 0, z = 0;
    switch (axis) {
      case 'x': x = h; y = cu; z = cv; break;
      case 'y': x = cu; y = h; z = cv; break;
      case 'z': x = cu; y = cv; z = h; break;
    }
    out.push({ x, y, z, t });
  }
  return out;
}

/** Total length of the sampled helix (mm). Useful for spring
 *  wire-length calculations + cost estimation. */
export function helixLength(samples: HelixSample[]): number {
  let len = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    len += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return len;
}

/** Build a planar spiral by setting pitch = 0 + variable radius. */
export function planarSpiral(opts: {
  radiusStartMm: number;
  radiusEndMm: number;
  turns: number;
  axis?: 'x' | 'y' | 'z';
  samplesPerTurn?: number;
}): HelixSample[] {
  return sampleHelix({
    pitchMm: 0,
    radiusStartMm: opts.radiusStartMm,
    radiusEndMm: opts.radiusEndMm,
    turns: opts.turns,
    axis: opts.axis,
    samplesPerTurn: opts.samplesPerTurn,
  });
}

/** Build a tapered helix (cone-thread). */
export function taperedHelix(opts: {
  pitchMm: number;
  topRadiusMm: number;
  bottomRadiusMm: number;
  turns: number;
  axis?: 'x' | 'y' | 'z';
}): HelixSample[] {
  return sampleHelix({
    pitchMm: opts.pitchMm,
    radiusStartMm: opts.bottomRadiusMm,
    radiusEndMm: opts.topRadiusMm,
    turns: opts.turns,
    axis: opts.axis,
  });
}
