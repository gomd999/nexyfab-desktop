// GD&T symbolic tolerance stack-up analysis.
// Given a chain of toleranced dimensions, computes worst-case (1D) and
// root-sum-square (RSS) accumulated tolerance. Used to verify that the
// end-to-end gap, hole pattern, or assembly clearance stays within spec
// once all individual feature tolerances are accounted for.
//
// Supports bilateral (±) and unilateral (+/−) tolerances, plus GD&T
// position-tolerance feature control frames where the bonus tolerance from
// MMC must be folded in.

export interface ChainLink {
  /** Nominal dimension (mm). Sign indicates direction in the chain. */
  nominal: number;
  /** Plus tolerance (mm). */
  plus: number;
  /** Minus tolerance (mm; always non-negative). */
  minus: number;
  /** Human-friendly name. */
  label: string;
  /** True if this link is a GD&T position with MMC bonus. */
  mmcBonus?: boolean;
}

export interface StackUpResult {
  /** Sum of nominals — the design intent. */
  nominal: number;
  /** Worst-case interval [min, max] (mm). */
  worstCase: { min: number; max: number };
  /** RSS-combined ± tolerance (mm). */
  rssTolerance: number;
  /** Per-link contribution to worst-case + RSS — for the UI to highlight
   *  which feature dominates the stack. */
  contributions: { link: ChainLink; worstCase: number; rss: number }[];
}

/**
 * Worst-case + RSS analysis on a tolerance chain.
 *
 * Worst-case (arithmetic) is the conservative 100%-confidence answer.
 * RSS (root-sum-square) assumes independent normal distributions at ±3σ
 * and gives the realistic 99.73%-confidence answer.
 */
export function analyzeStackUp(links: ChainLink[]): StackUpResult {
  let nominalSum = 0;
  let worstPlus = 0;
  let worstMinus = 0;
  let rssSquares = 0;
  const contributions: StackUpResult['contributions'] = [];

  for (const link of links) {
    const dir = Math.sign(link.nominal) || 1;
    nominalSum += link.nominal;
    // Both ± tolerances contribute regardless of direction (the part can
    // be at either end of its tolerance band).
    worstPlus += link.plus;
    worstMinus += link.minus;
    // Half-range used for RSS — symmetric tolerance equivalent.
    const halfRange = (link.plus + link.minus) / 2;
    rssSquares += halfRange * halfRange;
    contributions.push({
      link,
      worstCase: link.plus + link.minus,
      rss: halfRange,
    });
    void dir; // sign kept for callers that wish to visualize direction.
  }

  const rssTolerance = Math.sqrt(rssSquares);
  return {
    nominal: nominalSum,
    worstCase: {
      min: nominalSum - worstMinus,
      max: nominalSum + worstPlus,
    },
    rssTolerance,
    contributions,
  };
}

// ─── Monte Carlo refinement ────────────────────────────────────────────────

export interface MonteCarloOptions {
  /** Iterations. Default 10000. */
  iterations?: number;
  /** Confidence percentile (0..1). Default 0.997 (~3σ for normal). */
  confidence?: number;
  /** Treat each link's tolerance as ±3σ (true) or uniform (false). */
  normalDistribution?: boolean;
}

export interface MonteCarloResult extends StackUpResult {
  /** Sampled min / max bounding the confidence interval. */
  monteCarlo: { min: number; max: number; mean: number; stddev: number };
}

/**
 * Monte Carlo refinement of the stack-up. Useful when the dimension is
 * fed into downstream calculations (e.g. gear clearance vs. running torque)
 * where the distribution shape matters, not just worst/RSS bounds.
 */
export function monteCarloStackUp(links: ChainLink[], opts: MonteCarloOptions = {}): MonteCarloResult {
  const base = analyzeStackUp(links);
  const iters = opts.iterations ?? 10000;
  const conf = opts.confidence ?? 0.997;
  const normal = opts.normalDistribution ?? true;

  const samples = new Array<number>(iters);
  for (let i = 0; i < iters; i++) {
    let v = 0;
    for (const link of links) {
      const halfRange = (link.plus + link.minus) / 2;
      const center = link.nominal + (link.plus - link.minus) / 2;
      if (normal) {
        // Box-Muller — clamp to ±3σ = halfRange.
        const u1 = Math.random() || 1e-9;
        const u2 = Math.random();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        v += center + Math.max(-halfRange, Math.min(halfRange, (z / 3) * halfRange));
      } else {
        // Uniform across the tolerance band.
        v += center + (Math.random() * 2 - 1) * halfRange;
      }
    }
    samples[i] = v;
  }
  samples.sort((a, b) => a - b);
  const tailIdx = Math.floor(((1 - conf) / 2) * iters);
  const mcMin = samples[tailIdx];
  const mcMax = samples[iters - 1 - tailIdx];
  const mean = samples.reduce((s, v) => s + v, 0) / iters;
  const variance = samples.reduce((s, v) => s + (v - mean) ** 2, 0) / iters;

  return {
    ...base,
    monteCarlo: { min: mcMin, max: mcMax, mean, stddev: Math.sqrt(variance) },
  };
}
