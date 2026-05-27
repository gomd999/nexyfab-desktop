/**
 * toleranceStackup.ts — Linear chain tolerance analysis.
 *
 * When dimensions chain (link1 + link2 + link3 = total), the
 * tolerance of the total depends on the contributions. Three
 * standard methods:
 *
 *   - **Worst Case (WC)**: total tol = Σ |tol_i|. Conservative
 *     guarantee, rarely-occurring.
 *   - **Root-Sum-Square (RSS)**: total tol = √(Σ tol_i²).
 *     Assumes independent normal distributions; matches well when
 *     N ≥ 4.
 *   - **Monte Carlo**: sample N times, compute distribution.
 *     Captures asymmetric / non-normal distributions.
 *
 * Each dimension has: nominal value, plus tolerance, minus
 * tolerance (typically asymmetric ± numbers possible),
 * distribution type for MC.
 */

export type DistributionType = 'normal' | 'uniform' | 'triangular';

export interface DimensionLink {
  /** Display label ("Link 1", "Spacer A"). */
  name: string;
  nominalMm: number;
  /** Plus tolerance (mm). */
  tolPlusMm: number;
  /** Minus tolerance (mm) — typically negative. */
  tolMinusMm: number;
  /** Direction in the chain — +1 for additive, -1 for subtractive. */
  direction: 1 | -1;
  /** Statistical distribution (MC only). */
  distribution?: DistributionType;
}

export interface StackupChain {
  links: DimensionLink[];
  /** Nominal of the resulting dimension. */
  resultNominalMm?: number;
}

export interface WorstCaseResult {
  nominalMm: number;
  maxMm: number;
  minMm: number;
  toleranceMm: number;
}

export interface RssResult {
  nominalMm: number;
  /** 1-sigma equivalent. */
  sigmaMm: number;
  /** ±3σ envelope. */
  threeSigmaMm: number;
}

export interface MonteCarloResult {
  nominalMm: number;
  meanMm: number;
  sigmaMm: number;
  minMm: number;
  maxMm: number;
  /** Percentage of samples within ±toleranceWindow. */
  cpkLike: number;
  samples: number;
}

/** Nominal sum of the chain (signed). */
function chainNominal(chain: StackupChain): number {
  return chain.links.reduce((s, l) => s + l.direction * l.nominalMm, 0);
}

/** Worst-case stack-up — sum of absolute tolerances. */
export function worstCase(chain: StackupChain): WorstCaseResult {
  const nominal = chainNominal(chain);
  let maxDelta = 0;
  let minDelta = 0;
  for (const l of chain.links) {
    if (l.direction === 1) {
      maxDelta += l.tolPlusMm;
      minDelta += l.tolMinusMm;
    } else {
      maxDelta -= l.tolMinusMm;
      minDelta -= l.tolPlusMm;
    }
  }
  return {
    nominalMm: nominal,
    maxMm: nominal + maxDelta,
    minMm: nominal + minDelta,
    toleranceMm: maxDelta - minDelta,
  };
}

/** Root-sum-square stack-up — assumes each link's tolerance is
 *  ±3σ symmetric. */
export function rss(chain: StackupChain): RssResult {
  const nominal = chainNominal(chain);
  let sumSq = 0;
  for (const l of chain.links) {
    // Average tol = (|tolPlus| + |tolMinus|) / 2 → 3σ
    const halfTol = (Math.abs(l.tolPlusMm) + Math.abs(l.tolMinusMm)) / 2;
    const sigma = halfTol / 3;
    sumSq += sigma * sigma;
  }
  const sigma = Math.sqrt(sumSq);
  return {
    nominalMm: nominal,
    sigmaMm: sigma,
    threeSigmaMm: 3 * sigma,
  };
}

/** Box-Muller transform for normal samples. */
function sampleNormal(mean: number, sigma: number): number {
  const u1 = Math.random() || 1e-9;
  const u2 = Math.random() || 1e-9;
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + sigma * z;
}

function sampleLink(link: DimensionLink): number {
  const halfTol = (Math.abs(link.tolPlusMm) + Math.abs(link.tolMinusMm)) / 2;
  const center = link.nominalMm + (link.tolPlusMm + link.tolMinusMm) / 2;
  const dist = link.distribution ?? 'normal';
  switch (dist) {
    case 'uniform':
      return center + (Math.random() * 2 - 1) * halfTol;
    case 'triangular': {
      const r1 = Math.random();
      const r2 = Math.random();
      return center + ((r1 + r2 - 1)) * halfTol;
    }
    case 'normal':
    default:
      return sampleNormal(center, halfTol / 3);
  }
}

/** Monte Carlo simulation. */
export function monteCarlo(
  chain: StackupChain,
  samples: number = 10000,
  toleranceWindowMm?: number,
): MonteCarloResult {
  const values: number[] = new Array(samples);
  for (let i = 0; i < samples; i++) {
    let sum = 0;
    for (const link of chain.links) {
      sum += link.direction * sampleLink(link);
    }
    values[i] = sum;
  }
  const mean = values.reduce((s, v) => s + v, 0) / samples;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / samples;
  const sigma = Math.sqrt(variance);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const nominal = chainNominal(chain);

  let cpkLike = 1;
  if (toleranceWindowMm !== undefined) {
    const lo = nominal - toleranceWindowMm;
    const hi = nominal + toleranceWindowMm;
    const within = values.filter(v => v >= lo && v <= hi).length;
    cpkLike = within / samples;
  }

  return {
    nominalMm: nominal,
    meanMm: mean,
    sigmaMm: sigma,
    minMm: min,
    maxMm: max,
    cpkLike,
    samples,
  };
}
