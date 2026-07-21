/**
 * monteCarloPosition.ts — 3D position Monte Carlo with correlation.
 *
 * The 1D Monte Carlo in `toleranceStackup.ts` evaluates a single
 * dimension chain. Real assembly behavior depends on the joint 3D
 * variation of multiple features — say, four mounting-hole positions
 * driven by the same machining setup. Their errors are correlated
 * (a fixture shift moves all holes together), not independent.
 *
 * This module:
 *   - Samples N realizations of each feature's actual position from
 *     its nominal + tolerance distribution.
 *   - Supports correlation via shared "common-cause" random variables
 *     (datum shift, fixture rotation, thermal expansion).
 *   - Computes downstream measurements (distances, angles, parallel
 *     mating clearance) across all samples.
 *   - Reports yield, Cpk, worst-case observed, distribution shape.
 */

export type Vec3 = [number, number, number];

export type DistributionKind = 'normal' | 'uniform' | 'triangular';

export interface NominalFeature {
  id: string;
  /** Nominal position (mm). */
  nominalMm: Vec3;
  /** Half-width tolerance (mm) per axis, treated as ±. */
  toleranceMm: Vec3;
  /** Distribution shape. Default 'normal'. */
  distribution?: DistributionKind;
  /** Optional common-cause coupling: same id = correlated via shared RV. */
  commonCauseGroup?: string;
}

export interface FeatureSample {
  id: string;
  positionMm: Vec3;
}

export interface MeasurementSpec {
  id: string;
  /** Compute a scalar measurement from feature samples. */
  evaluate: (samples: Map<string, FeatureSample>) => number;
  /** Lower spec limit. */
  lsl?: number;
  /** Upper spec limit. */
  usl?: number;
}

export interface MeasurementResult {
  measurementId: string;
  /** All sample values for this measurement. */
  values: number[];
  /** Sample mean. */
  mean: number;
  /** Sample standard deviation. */
  stdDev: number;
  /** Min observed. */
  min: number;
  /** Max observed. */
  max: number;
  /** Fraction of samples within [lsl, usl]. */
  yieldFraction: number;
  /** Defects per million opportunities. */
  dpmo: number;
  /** Cpk (process capability index, one-sided to nearer spec). */
  cpk: number;
}

export interface MonteCarloResult {
  /** Per-measurement statistics. */
  measurements: MeasurementResult[];
  /** Total samples evaluated. */
  sampleCount: number;
  /** Aggregate yield (% of samples passing ALL measurements). */
  overallYield: number;
}

// ── Top-level entry ─────────────────────────────────────────────

export function runMonteCarlo(
  features: NominalFeature[],
  measurements: MeasurementSpec[],
  sampleCount: number = 5000,
  seed?: number,
): MonteCarloResult {
  const rng = makeRng(seed);
  // Snapshot value arrays per measurement.
  const valueArrays: Map<string, number[]> = new Map(measurements.map(m => [m.id, []]));
  // Track per-sample all-pass.
  let allPassCount = 0;

  for (let s = 0; s < sampleCount; s++) {
    const realized = realizeFeatures(features, rng);
    let allPass = true;
    for (const m of measurements) {
      const v = m.evaluate(realized);
      valueArrays.get(m.id)!.push(v);
      if (m.lsl !== undefined && v < m.lsl) allPass = false;
      if (m.usl !== undefined && v > m.usl) allPass = false;
    }
    if (allPass) allPassCount++;
  }

  const measurementResults: MeasurementResult[] = measurements.map(m => {
    const values = valueArrays.get(m.id)!;
    return summarizeMeasurement(values, m.id, m.lsl, m.usl);
  });

  return {
    measurements: measurementResults,
    sampleCount,
    overallYield: sampleCount > 0 ? allPassCount / sampleCount : 0,
  };
}

// ── Feature realization ─────────────────────────────────────────

function realizeFeatures(features: NominalFeature[], rng: () => number): Map<string, FeatureSample> {
  // Pre-draw shared common-cause RVs.
  const sharedRvs = new Map<string, [number, number, number]>();
  for (const f of features) {
    if (!f.commonCauseGroup) continue;
    if (!sharedRvs.has(f.commonCauseGroup)) {
      sharedRvs.set(f.commonCauseGroup, [
        sampleStandard(rng, f.distribution ?? 'normal'),
        sampleStandard(rng, f.distribution ?? 'normal'),
        sampleStandard(rng, f.distribution ?? 'normal'),
      ]);
    }
  }

  const out = new Map<string, FeatureSample>();
  for (const f of features) {
    const dist = f.distribution ?? 'normal';
    let rx: number, ry: number, rz: number;
    if (f.commonCauseGroup && sharedRvs.has(f.commonCauseGroup)) {
      const shared = sharedRvs.get(f.commonCauseGroup)!;
      // Coupled: 70% shared + 30% individual.
      rx = 0.7 * shared[0] + 0.3 * sampleStandard(rng, dist);
      ry = 0.7 * shared[1] + 0.3 * sampleStandard(rng, dist);
      rz = 0.7 * shared[2] + 0.3 * sampleStandard(rng, dist);
    } else {
      rx = sampleStandard(rng, dist);
      ry = sampleStandard(rng, dist);
      rz = sampleStandard(rng, dist);
    }
    out.set(f.id, {
      id: f.id,
      positionMm: [
        f.nominalMm[0] + rx * f.toleranceMm[0],
        f.nominalMm[1] + ry * f.toleranceMm[1],
        f.nominalMm[2] + rz * f.toleranceMm[2],
      ],
    });
  }
  return out;
}

function sampleStandard(rng: () => number, dist: DistributionKind): number {
  switch (dist) {
    case 'normal':
      return sampleStandardNormal(rng);
    case 'uniform':
      return rng() * 2 - 1;
    case 'triangular': {
      const u = rng();
      if (u < 0.5) return Math.sqrt(2 * u) - 1;
      return 1 - Math.sqrt(2 * (1 - u));
    }
  }
}

function sampleStandardNormal(rng: () => number): number {
  // Box-Muller. Range maps to (~-3, ~+3) sigma for ±tolerance approx.
  const u1 = Math.max(1e-12, rng());
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return z / 3; // scale so ±1 represents ±3σ ≈ tolerance
}

// ── Summary ─────────────────────────────────────────────────────

function summarizeMeasurement(values: number[], id: string, lsl: number | undefined, usl: number | undefined): MeasurementResult {
  if (values.length === 0) {
    return {
      measurementId: id,
      values: [],
      mean: 0, stdDev: 0, min: 0, max: 0,
      yieldFraction: 0, dpmo: 1_000_000, cpk: 0,
    };
  }
  let sum = 0, sqSum = 0;
  let min = Infinity, max = -Infinity;
  for (const v of values) {
    sum += v;
    sqSum += v * v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / values.length;
  const variance = sqSum / values.length - mean * mean;
  const stdDev = Math.sqrt(Math.max(0, variance));

  let inSpec = 0;
  if (lsl !== undefined || usl !== undefined) {
    for (const v of values) {
      const passLow = lsl === undefined || v >= lsl;
      const passHigh = usl === undefined || v <= usl;
      if (passLow && passHigh) inSpec++;
    }
  } else {
    inSpec = values.length;
  }
  const yieldFraction = inSpec / values.length;
  const dpmo = Math.round((1 - yieldFraction) * 1_000_000);

  // Cpk = min((USL - μ) / (3σ), (μ - LSL) / (3σ)).
  let cpk = Infinity;
  if (stdDev > 0) {
    if (usl !== undefined) {
      cpk = Math.min(cpk, (usl - mean) / (3 * stdDev));
    }
    if (lsl !== undefined) {
      cpk = Math.min(cpk, (mean - lsl) / (3 * stdDev));
    }
    if (cpk === Infinity) cpk = 0;
  }

  return {
    measurementId: id,
    values,
    mean, stdDev, min, max,
    yieldFraction, dpmo, cpk,
  };
}

// ── Histogram ───────────────────────────────────────────────────

export interface Histogram {
  bins: Array<{ minValue: number; maxValue: number; count: number }>;
  totalCount: number;
}

export function histogram(values: number[], binCount: number = 20): Histogram {
  if (values.length === 0 || binCount <= 0) {
    return { bins: [], totalCount: 0 };
  }
  let min = Infinity, max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === max) {
    return { bins: [{ minValue: min, maxValue: max, count: values.length }], totalCount: values.length };
  }
  const binWidth = (max - min) / binCount;
  const bins = Array.from({ length: binCount }, (_, i) => ({
    minValue: min + i * binWidth,
    maxValue: min + (i + 1) * binWidth,
    count: 0,
  }));
  for (const v of values) {
    let idx = Math.floor((v - min) / binWidth);
    if (idx >= binCount) idx = binCount - 1;
    bins[idx]!.count++;
  }
  return { bins, totalCount: values.length };
}

// ── Deterministic RNG ───────────────────────────────────────────

function makeRng(seed?: number): () => number {
  let s = seed ?? Math.floor(Math.random() * 2 ** 31);
  return () => {
    // Math.imul keeps the multiply exact in 32-bit space. The float form
    // (s * 1103515245) overflows 2^53 and collapses the LCG into a ~10k
    // cycle with heavy bin bias (see meshCompare.ts sampleIndices).
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}
