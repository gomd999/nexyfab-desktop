/**
 * contactStiffnessTuner.ts — Tune contact stiffness for FEA
 * convergence.
 *
 * In nonlinear contact analysis, the contact stiffness (normal +
 * tangential) governs how the gap closes between mating bodies.
 *
 *   - Too low → unrealistic penetration, results inaccurate.
 *   - Too high → ill-conditioned system, solver fails to converge.
 *
 * Practitioner rule: start with k_n ≈ 10 · E / element_size
 * (Pa/m), then iterate until penetration < 1% of element size.
 *
 * Module:
 *
 *   - Suggests initial stiffness from material + mesh size.
 *   - Adjusts based on observed penetration / iteration count.
 *   - Detects "ringing" (oscillating reactions) → recommends
 *     reducing stiffness.
 */

export interface ContactPair {
  id: string;
  /** Effective Young's modulus, MPa (typically harmonic mean of A and B). */
  effectiveYoungMpa: number;
  /** Characteristic element size, mm. */
  elementSizeMm: number;
  /** Frictional contact? */
  frictional: boolean;
}

export interface IterationData {
  /** Iteration index. */
  iteration: number;
  /** Max observed penetration, mm. */
  maxPenetrationMm: number;
  /** Newton residual norm. */
  residual: number;
  /** Was the iteration converged? */
  converged: boolean;
}

export interface StiffnessRecommendation {
  contactId: string;
  /** Suggested normal stiffness, N/mm³ (per unit area). */
  normalStiffness: number;
  /** Suggested tangential stiffness. */
  tangentialStiffness: number;
  /** Reasoning. */
  reasoning: string;
  /** Recommendation kind. */
  action: 'use-initial' | 'increase' | 'decrease' | 'switch-method';
}

export interface TunerOptions {
  /** Initial stiffness multiplier (Pa·m/Pa). Default 10. */
  initialMultiplier: number;
  /** Stiffness reduction factor when oscillating. */
  reductionFactor: number;
  /** Stiffness boost factor when penetration too high. */
  boostFactor: number;
  /** Acceptable penetration fraction. */
  targetPenetrationFraction: number;
}

export const DEFAULT_OPTIONS: TunerOptions = {
  initialMultiplier: 10,
  reductionFactor: 0.5,
  boostFactor: 2,
  targetPenetrationFraction: 0.01,
};

// ── Initial estimate ──────────────────────────────────────────

export function suggestInitial(pair: ContactPair, options: Partial<TunerOptions> = {}): StiffnessRecommendation {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const youngPa = pair.effectiveYoungMpa * 1e6;
  const sizeM = pair.elementSizeMm / 1000;
  const normal = opts.initialMultiplier * youngPa / sizeM;
  return {
    contactId: pair.id,
    normalStiffness: normal,
    tangentialStiffness: pair.frictional ? normal * 0.1 : 0,
    reasoning: `Initial k_n = ${opts.initialMultiplier} × E / element_size`,
    action: 'use-initial',
  };
}

// ── Adjustment from iteration data ────────────────────────────

export function adjustFromIterations(pair: ContactPair, currentStiffness: number, iterations: IterationData[], options: Partial<TunerOptions> = {}): StiffnessRecommendation {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (iterations.length === 0) {
    return suggestInitial(pair, opts);
  }
  const last = iterations[iterations.length - 1]!;
  // Penetration too high → increase.
  if (last.maxPenetrationMm > pair.elementSizeMm * opts.targetPenetrationFraction) {
    return {
      contactId: pair.id,
      normalStiffness: currentStiffness * opts.boostFactor,
      tangentialStiffness: pair.frictional ? currentStiffness * opts.boostFactor * 0.1 : 0,
      reasoning: `Penetration ${last.maxPenetrationMm.toFixed(4)} > target (${(pair.elementSizeMm * opts.targetPenetrationFraction).toFixed(4)}) — increase stiffness.`,
      action: 'increase',
    };
  }
  // Detect oscillation: residual goes up then down across last 3 iterations.
  if (iterations.length >= 3 && isOscillating(iterations.slice(-3))) {
    return {
      contactId: pair.id,
      normalStiffness: currentStiffness * opts.reductionFactor,
      tangentialStiffness: pair.frictional ? currentStiffness * opts.reductionFactor * 0.1 : 0,
      reasoning: 'Residual oscillation detected — reduce stiffness for stability.',
      action: 'decrease',
    };
  }
  // Many non-converging iterations → switch to augmented Lagrangian.
  if (iterations.length > 20 && !last.converged) {
    return {
      contactId: pair.id,
      normalStiffness: currentStiffness,
      tangentialStiffness: pair.frictional ? currentStiffness * 0.1 : 0,
      reasoning: 'Too many iterations without convergence — consider Augmented Lagrangian method.',
      action: 'switch-method',
    };
  }
  return {
    contactId: pair.id,
    normalStiffness: currentStiffness,
    tangentialStiffness: pair.frictional ? currentStiffness * 0.1 : 0,
    reasoning: 'Converged — keep current stiffness.',
    action: 'use-initial',
  };
}

function isOscillating(window: IterationData[]): boolean {
  if (window.length < 3) return false;
  const r1 = window[0]!.residual;
  const r2 = window[1]!.residual;
  const r3 = window[2]!.residual;
  return (r2 > r1 * 1.5 && r3 < r2 * 0.7) || (r2 < r1 * 0.7 && r3 > r2 * 1.5);
}

// ── Method selection ─────────────────────────────────────────

export type ContactMethod = 'penalty' | 'lagrange-multiplier' | 'augmented-lagrange';

export interface MethodChoice {
  method: ContactMethod;
  reasoning: string;
}

export function pickMethod(pair: ContactPair, iterations: IterationData[]): MethodChoice {
  // Frictional contact + many iters → augmented Lagrange.
  if (pair.frictional && iterations.length > 15) {
    return {
      method: 'augmented-lagrange',
      reasoning: 'Frictional contact + slow convergence → augmented Lagrange balances accuracy & robustness.',
    };
  }
  if (iterations.some(it => it.maxPenetrationMm > pair.elementSizeMm * 0.05)) {
    return {
      method: 'lagrange-multiplier',
      reasoning: 'Large penetration with penalty → Lagrange multiplier enforces zero penetration exactly.',
    };
  }
  return {
    method: 'penalty',
    reasoning: 'Standard penalty method sufficient.',
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface TuningSummary {
  contactId: string;
  initialStiffness: number;
  finalStiffness: number;
  iterationCount: number;
  finalAction: StiffnessRecommendation['action'];
  recommendedMethod: ContactMethod;
}

export function summarize(pair: ContactPair, currentStiffness: number, iterations: IterationData[]): TuningSummary {
  const initial = suggestInitial(pair);
  const final = adjustFromIterations(pair, currentStiffness, iterations);
  const method = pickMethod(pair, iterations);
  return {
    contactId: pair.id,
    initialStiffness: initial.normalStiffness,
    finalStiffness: final.normalStiffness,
    iterationCount: iterations.length,
    finalAction: final.action,
    recommendedMethod: method.method,
  };
}
