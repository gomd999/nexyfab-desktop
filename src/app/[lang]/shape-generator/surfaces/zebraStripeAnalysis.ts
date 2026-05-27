/**
 * zebraStripeAnalysis.ts — Surface quality inspection via virtual
 * zebra stripe reflections.
 *
 * Reflective surfaces (car bodies, aircraft skins, premium consumer
 * products) need *Class A* quality — the reflection of a parallel
 * line pattern should be a smooth curve. Any G1/G2 discontinuity
 * shows up as a kink or break in the reflected stripes.
 *
 * Virtual zebra (analytical, no actual rendering):
 *
 *   1. Define a viewing direction V and a stripe orientation S.
 *   2. For each surface sample (normal n), the reflected ray is
 *      R = V - 2·(V·n)·n.
 *   3. Compute the angle of R projected onto S. Periodic value
 *      becomes the stripe (0 / 1 alternating).
 *   4. Continuity check: for adjacent samples, |Δreflection| above
 *      threshold flags a discontinuity (a "broken zebra" line).
 *
 * Output: per-sample stripe bin + flagged discontinuity locations.
 */

export interface SurfaceSample {
  /** Sample id (vertex index in mesh). */
  id: number;
  /** Surface normal (unit). */
  normal: [number, number, number];
  /** Optional neighbor sample ids (for continuity sweep). */
  neighbors?: number[];
}

export interface StripeResult {
  /** Per-sample stripe bin (0 or 1). */
  stripeBin: number[];
  /** Per-sample reflection angle (radians). */
  reflectionAngles: number[];
  /** Sample-pairs whose reflection angle changed sharply. */
  discontinuities: Array<{ sampleA: number; sampleB: number; deltaRad: number }>;
  /** Number of stripe bins per full revolution. */
  stripeCount: number;
}

export interface AnalysisOptions {
  /** Camera direction (looking at the surface). */
  viewDirection: [number, number, number];
  /** Stripe count per full reflection sweep. */
  stripeCount: number;
  /** Discontinuity threshold (radians). */
  discontinuityRad: number;
}

export const DEFAULT_OPTIONS: AnalysisOptions = {
  viewDirection: [0, 0, -1],
  stripeCount: 20,
  discontinuityRad: 0.3,
};

// ── Top-level entry ────────────────────────────────────────────

export function analyzeZebra(samples: SurfaceSample[], options: Partial<AnalysisOptions> = {}): StripeResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const view = normalize(opts.viewDirection);
  const reflectionAngles: number[] = [];
  const stripeBin: number[] = [];

  // Pick two orthogonal stripe axes in the view plane.
  const stripeAxisU = pickOrthogonal(view);
  const stripeAxisV = normalize(cross(view, stripeAxisU));

  for (const s of samples) {
    const n = normalize(s.normal);
    const dotVn = dot(view, n);
    const R: [number, number, number] = [
      view[0] - 2 * dotVn * n[0],
      view[1] - 2 * dotVn * n[1],
      view[2] - 2 * dotVn * n[2],
    ];
    // Project R onto the plane perpendicular to view.
    const Rperp: [number, number, number] = [
      R[0] - dot(R, view) * view[0],
      R[1] - dot(R, view) * view[1],
      R[2] - dot(R, view) * view[2],
    ];
    const u = dot(Rperp, stripeAxisU);
    const v = dot(Rperp, stripeAxisV);
    // atan2 gives full angle in [-π, π]; remap to [0, 2π).
    let angle = Math.atan2(v, u);
    if (angle < 0) angle += 2 * Math.PI;
    reflectionAngles.push(angle);
    const binned = Math.floor((angle / (2 * Math.PI)) * opts.stripeCount) % 2;
    stripeBin.push(binned);
  }

  // Find discontinuities using neighbor relations.
  const discontinuities: Array<{ sampleA: number; sampleB: number; deltaRad: number }> = [];
  const idxOf = new Map<number, number>();
  samples.forEach((s, i) => idxOf.set(s.id, i));
  const seenPairs = new Set<string>();
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    if (!s.neighbors) continue;
    for (const nbrId of s.neighbors) {
      const j = idxOf.get(nbrId);
      if (j === undefined || j === i) continue;
      const lo = Math.min(s.id, nbrId);
      const hi = Math.max(s.id, nbrId);
      const key = `${lo}-${hi}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      const dA = reflectionAngles[i]!;
      const dB = reflectionAngles[j]!;
      // Angular delta wrapped to [0, π].
      let delta = Math.abs(dA - dB);
      if (delta > Math.PI) delta = 2 * Math.PI - delta;
      if (delta > opts.discontinuityRad) {
        discontinuities.push({ sampleA: s.id, sampleB: nbrId, deltaRad: delta });
      }
    }
  }

  return {
    stripeBin,
    reflectionAngles,
    discontinuities,
    stripeCount: opts.stripeCount,
  };
}

// ── Class A verdict ────────────────────────────────────────────

export type ClassAVerdict = 'class-a' | 'class-b' | 'reject';

export interface QualityVerdict {
  verdict: ClassAVerdict;
  discontinuityFraction: number;
  /** Worst delta in radians. */
  worstDeltaRad: number;
}

export function classifyQuality(result: StripeResult, sampleCount: number): QualityVerdict {
  const frac = sampleCount > 0 ? result.discontinuities.length / sampleCount : 0;
  const worst = result.discontinuities.reduce((m, d) => Math.max(m, d.deltaRad), 0);
  let verdict: ClassAVerdict;
  if (frac < 0.005 && worst < 0.2) verdict = 'class-a';
  else if (frac < 0.05) verdict = 'class-b';
  else verdict = 'reject';
  return { verdict, discontinuityFraction: frac, worstDeltaRad: worst };
}

// ── Helpers ────────────────────────────────────────────────────

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-9) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function pickOrthogonal(v: [number, number, number]): [number, number, number] {
  // Choose any axis-aligned vector not parallel to v.
  const candidate: [number, number, number] = Math.abs(v[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  // Gram-Schmidt: subtract projection onto v.
  const proj = dot(candidate, v);
  const r: [number, number, number] = [
    candidate[0] - proj * v[0],
    candidate[1] - proj * v[1],
    candidate[2] - proj * v[2],
  ];
  return normalize(r);
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

// ── Summary ────────────────────────────────────────────────────

export interface ZebraSummary {
  sampleCount: number;
  discontinuityCount: number;
  stripe0Count: number;
  stripe1Count: number;
  verdict: ClassAVerdict;
}

export function summarize(result: StripeResult, sampleCount: number): ZebraSummary {
  const verdict = classifyQuality(result, sampleCount).verdict;
  const s0 = result.stripeBin.filter(b => b === 0).length;
  const s1 = result.stripeBin.filter(b => b === 1).length;
  return {
    sampleCount,
    discontinuityCount: result.discontinuities.length,
    stripe0Count: s0,
    stripe1Count: s1,
    verdict,
  };
}
