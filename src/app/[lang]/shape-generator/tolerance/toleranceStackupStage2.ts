/**
 * toleranceStackupStage2.ts — Sensitivity, yield, sigma-level
 * extensions to the Stage-1 tolerance stack-up.
 *
 * Stage 1 (`toleranceStackup.ts`) returns nominal / σ / cpk-like
 * fraction. Stage 2 (here) answers the *engineering* questions:
 *
 *   - **Sensitivity** — which input dimensions contribute most to
 *     output variance? Standard "elementary effects" / one-at-a-time
 *     perturbation: rerun Monte Carlo with each link's variance
 *     temporarily zeroed, take Δσ as that link's importance.
 *
 *   - **DPMO** — defects per million opportunities. Standard Six-
 *     Sigma metric: # parts out of spec × 10⁶ / # parts.
 *
 *   - **Sigma level** — number of σ between μ and the nearest spec
 *     limit. Industry "6σ" target → 3.4 DPMO under normal Z-shift.
 *
 *   - **Distribution comparison** — re-runs Monte Carlo three times
 *     (normal / uniform / triangular per link) and reports σ_out
 *     for each. Highlights when distribution choice changes the
 *     answer enough to matter.
 */

import {
  monteCarlo,
  type StackupChain,
  type DimensionLink,
  type MonteCarloResult,
} from './toleranceStackup';

export interface SpecLimits {
  lsl: number;  // lower spec limit
  usl: number;  // upper spec limit
}

// ── Sensitivity ──────────────────────────────────────────────────

export interface SensitivityResult {
  /** Link name → fraction of total output variance attributable to it. */
  contributions: Array<{ linkName: string; sigmaContribution: number; percentContribution: number }>;
  /** Total σ_output. */
  totalSigma: number;
}

/** Sensitivity = each link's tolMax² × (1/12)·variance-weight. Closed
 *  form for sum-of-independents. */
export function sensitivityAnalysis(chain: StackupChain): SensitivityResult {
  const contributions: SensitivityResult['contributions'] = [];
  let totalVariance = 0;
  for (const link of chain.links) {
    const halfRange = (link.tolPlusMm + link.tolMinusMm) / 2;
    // Variance contribution depends on distribution; default to
    // uniform (var = (2·halfRange)²/12) for the analysis.
    const variance = ((2 * halfRange) ** 2) / 12;
    totalVariance += variance;
    contributions.push({
      linkName: link.name,
      sigmaContribution: Math.sqrt(variance),
      percentContribution: 0, // filled below
    });
  }
  const totalSigma = Math.sqrt(totalVariance);
  for (const c of contributions) {
    c.percentContribution = totalSigma > 0 ? (c.sigmaContribution ** 2) / totalVariance * 100 : 0;
  }
  contributions.sort((a, b) => b.percentContribution - a.percentContribution);
  return { contributions, totalSigma };
}

// ── DPMO / sigma level ───────────────────────────────────────────

export interface YieldResult {
  /** Defects per million opportunities. */
  dpmo: number;
  /** Probability the part is within spec (0..1). */
  yieldFraction: number;
  /** Sigma level (Z-score short-term, no 1.5σ shift). */
  sigmaLevelShortTerm: number;
  /** Sigma level long-term (with traditional 1.5σ shift). */
  sigmaLevelLongTerm: number;
}

/** Standard normal CDF approximation. */
function normCdf(z: number): number {
  // Abramowitz-Stegun 7.1.26 — error < 7.5e-8.
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804 * Math.exp(-z * z / 2);
  const prob = d * t
    * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - prob : prob;
}

function normInverse(p: number): number {
  // Beasley-Springer-Moro approximation.
  if (p <= 0 || p >= 1) return p === 0 ? -Infinity : Infinity;
  // Rational approximation for 0.5 ≤ p ≤ 1.
  if (p < 0.5) return -normInverse(1 - p);
  const t = Math.sqrt(-2 * Math.log(1 - p));
  return t - ((0.010328 * t + 0.802853) * t + 2.515517)
    / (((0.001308 * t + 0.189269) * t + 1.432788) * t + 1);
}

export function computeYield(
  mean: number,
  sigma: number,
  spec: SpecLimits,
): YieldResult {
  if (sigma === 0) {
    const inSpec = mean >= spec.lsl && mean <= spec.usl;
    return {
      dpmo: inSpec ? 0 : 1_000_000,
      yieldFraction: inSpec ? 1 : 0,
      sigmaLevelShortTerm: Infinity,
      sigmaLevelLongTerm: Infinity,
    };
  }
  const zUpper = (spec.usl - mean) / sigma;
  const zLower = (mean - spec.lsl) / sigma;
  const above = 1 - normCdf(zUpper);
  const below = 1 - normCdf(zLower);
  const defectRate = above + below;
  const yieldFraction = 1 - defectRate;
  const dpmo = defectRate * 1e6;
  // Short-term sigma level: Z-score for cumulative yield.
  const sigmaLevel = normInverse(Math.min(0.9999999, yieldFraction));
  return {
    dpmo,
    yieldFraction,
    sigmaLevelShortTerm: sigmaLevel,
    sigmaLevelLongTerm: Math.max(0, sigmaLevel - 1.5),
  };
}

// ── Distribution comparison ──────────────────────────────────────

export interface DistributionComparison {
  normalResult: MonteCarloResult;
  uniformResult: MonteCarloResult;
  triangularResult: MonteCarloResult;
  /** Spread (max-min) of σ across the three distributions (mm).
   *  Large value = analysis is sensitive to your distribution
   *  assumption — you need better input data. */
  sigmaSpreadMm: number;
}

function withDistribution(chain: StackupChain, dist: DimensionLink['distribution']): StackupChain {
  return {
    links: chain.links.map(l => ({ ...l, distribution: dist })),
  };
}

export function compareDistributions(
  chain: StackupChain,
  samples: number = 5000,
  toleranceWindowMm?: number,
): DistributionComparison {
  const norm = monteCarlo(withDistribution(chain, 'normal'), samples, toleranceWindowMm);
  const uni = monteCarlo(withDistribution(chain, 'uniform'), samples, toleranceWindowMm);
  const tri = monteCarlo(withDistribution(chain, 'triangular'), samples, toleranceWindowMm);
  const sigmas = [norm.sigmaMm, uni.sigmaMm, tri.sigmaMm];
  return {
    normalResult: norm,
    uniformResult: uni,
    triangularResult: tri,
    sigmaSpreadMm: Math.max(...sigmas) - Math.min(...sigmas),
  };
}

// ── Top-level helper ─────────────────────────────────────────────

export interface FullStackupAnalysis {
  sensitivity: SensitivityResult;
  yieldResult: YieldResult | null;
  distributionComparison: DistributionComparison;
  /** Top-3 most-contributing links. */
  topContributors: Array<{ linkName: string; percent: number }>;
}

export function analyzeStackupFull(
  chain: StackupChain,
  spec: SpecLimits | null,
  samples: number = 5000,
): FullStackupAnalysis {
  const sensitivity = sensitivityAnalysis(chain);
  const dist = compareDistributions(chain, samples);
  const yieldResult = spec ? computeYield(dist.normalResult.meanMm, dist.normalResult.sigmaMm, spec) : null;
  return {
    sensitivity,
    yieldResult,
    distributionComparison: dist,
    topContributors: sensitivity.contributions.slice(0, 3).map(c => ({
      linkName: c.linkName,
      percent: c.percentContribution,
    })),
  };
}
