// ─── Tolerance Stack-Up Analysis ─────────────────────────────────────────────
// Worst-case (arithmetic), RSS (root-sum-square), and Monte Carlo stack-up
// analysis for linear dimension chains.

/* ─── Types ───────────────────────────────────────────────────────────────── */

export interface ToleranceDimension {
  id: string;
  name: string;
  nominal: number;
  tolerancePlus: number;
  toleranceMinus: number;
  /** +1 = adds to stack, -1 = subtracts from stack */
  direction: 1 | -1;
  distribution: 'uniform' | 'normal';
}

export interface StackupResult {
  nominal: number;
  worstCaseMax: number;
  worstCaseMin: number;
  rssMax: number;
  rssMin: number;
  dimensions: ToleranceDimension[];
  /** id of the dimension contributing the most to variation */
  criticalDimension: string;
  cpk: number;
}

export interface MonteCarloResult {
  mean: number;
  stdDev: number;
  histogram: number[];
  percentiles: Record<string, number>;
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

/** Seeded pseudo-random (xorshift32) for reproducibility. */
function xorshift32(seed: number): () => number {
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 0xffffffff;
  };
}

/** Box-Muller transform — pair of standard-normal samples. */
function boxMuller(rng: () => number): [number, number] {
  const u1 = rng() || 1e-10;
  const u2 = rng();
  const r = Math.sqrt(-2 * Math.log(u1));
  const t = 2 * Math.PI * u2;
  return [r * Math.cos(t), r * Math.sin(t)];
}

/** Sample a single dimension value based on its distribution. */
function sampleDimension(dim: ToleranceDimension, rng: () => number): number {
  const midTol = (dim.tolerancePlus + dim.toleranceMinus) / 2;  // offset
  const halfRange = (dim.tolerancePlus - dim.toleranceMinus) / 2;

  if (dim.distribution === 'uniform') {
    const u = rng();
    return dim.nominal + midTol + halfRange * (2 * u - 1);
  }

  // Normal: 3-sigma = halfRange  (99.73 % coverage)
  const sigma = halfRange / 3 || 1e-12;
  const [z] = boxMuller(rng);
  return dim.nominal + midTol + sigma * z;
}

/** Percentile from sorted array (linear interpolation). */
function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/* ─── Worst-Case & RSS ────────────────────────────────────────────────────── */

export function computeStackup(dims: ToleranceDimension[]): StackupResult {
  if (dims.length === 0) {
    return {
      nominal: 0,
      worstCaseMax: 0,
      worstCaseMin: 0,
      rssMax: 0,
      rssMin: 0,
      dimensions: [],
      criticalDimension: '',
      cpk: 0,
    };
  }

  let nominal = 0;
  let wcPlus = 0;
  let wcMinus = 0;
  let rssSqPlus = 0;
  let rssSqMinus = 0;
  let maxContrib = 0;
  let criticalId = dims[0].id;

  for (const d of dims) {
    nominal += d.direction * d.nominal;

    const tp = d.direction === 1 ? d.tolerancePlus : -d.toleranceMinus;
    const tm = d.direction === 1 ? d.toleranceMinus : -d.tolerancePlus;

    wcPlus += Math.max(tp, 0) + Math.max(-tm, 0);
    wcMinus += Math.min(tm, 0) + Math.min(-tp, 0);

    // RSS uses half-range of each dimension
    const halfRange = (d.tolerancePlus - d.toleranceMinus) / 2;
    rssSqPlus += halfRange * halfRange;
    rssSqMinus += halfRange * halfRange;

    // Track largest contributor
    const contrib = halfRange;
    if (contrib > maxContrib) {
      maxContrib = contrib;
      criticalId = d.id;
    }
  }

  const rssHalf = Math.sqrt(rssSqPlus);
  const midShift = dims.reduce((s, d) => {
    const mid = (d.tolerancePlus + d.toleranceMinus) / 2;
    return s + d.direction * mid;
  }, 0);

  const worstCaseMax = nominal + wcPlus;
  const worstCaseMin = nominal + wcMinus;
  const rssMax = nominal + midShift + rssHalf;
  const rssMin = nominal + midShift - rssHalf;

  // Cpk based on RSS 3-sigma vs worst-case range
  const wcRange = worstCaseMax - worstCaseMin;
  const sigma3 = rssHalf; // rssHalf already represents ~3-sigma
  const cpk = wcRange > 0 && sigma3 > 0
    ? wcRange / (6 * (sigma3 / 3))
    : 0;

  return {
    nominal,
    worstCaseMax,
    worstCaseMin,
    rssMax,
    rssMin,
    dimensions: dims,
    criticalDimension: criticalId,
    cpk: Math.round(cpk * 100) / 100,
  };
}

/* ─── Monte Carlo ─────────────────────────────────────────────────────────── */

export function monteCarloStackup(
  dims: ToleranceDimension[],
  iterations = 10000,
): MonteCarloResult {
  if (dims.length === 0) {
    return { mean: 0, stdDev: 0, histogram: [], percentiles: {} };
  }

  const rng = xorshift32(42);
  const results = new Float64Array(iterations);

  for (let i = 0; i < iterations; i++) {
    let total = 0;
    for (const d of dims) {
      total += d.direction * sampleDimension(d, rng);
    }
    results[i] = total;
  }

  // Mean & std dev
  let sum = 0;
  for (let i = 0; i < iterations; i++) sum += results[i];
  const mean = sum / iterations;

  let varSum = 0;
  for (let i = 0; i < iterations; i++) {
    const diff = results[i] - mean;
    varSum += diff * diff;
  }
  const stdDev = Math.sqrt(varSum / (iterations - 1));

  // Sort for percentiles
  const sorted = Array.from(results).sort((a, b) => a - b);

  const pcts: Record<string, number> = {};
  for (const p of [0.1, 1, 2.5, 5, 25, 50, 75, 95, 97.5, 99, 99.9]) {
    pcts[String(p)] = Math.round(percentile(sorted, p) * 1e6) / 1e6;
  }

  // Histogram (30 bins)
  const bins = 30;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const binWidth = (max - min) / bins || 1;
  const histogram = new Array<number>(bins).fill(0);
  for (let i = 0; i < iterations; i++) {
    const idx = Math.min(Math.floor((results[i] - min) / binWidth), bins - 1);
    histogram[idx]++;
  }

  return {
    mean: Math.round(mean * 1e6) / 1e6,
    stdDev: Math.round(stdDev * 1e6) / 1e6,
    histogram,
    percentiles: pcts,
  };
}
