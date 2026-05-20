/**
 * contactPressureConverger.ts — Drive a contact-pressure iteration to
 * convergence.
 *
 * In nonlinear contact FEA, peak pressure at the contact patch
 * depends on contact stiffness, mesh refinement, friction. The
 * solver iterates; the convergence is tracked by:
 *
 *   - Max pressure change between iterations < ε_pressure
 *   - Max penetration < ε_penetration
 *   - Force-equilibrium residual < ε_force
 *
 * Module:
 *   - Accepts an iterator function that returns one iteration's
 *     state.
 *   - Runs until convergence or maxIterations.
 *   - Suggests stiffness / mesh adjustments based on trajectory:
 *     - Oscillating pressure → reduce stiffness
 *     - Monotone rising → mesh under-resolved at edge
 *     - Slow decay → augmented-Lagrange / penalty switch
 */

export interface IterationState {
  iteration: number;
  maxPressureMpa: number;
  maxPenetrationMm: number;
  forceResidualN: number;
  /** Optional snapshot of pressure samples for analysis. */
  pressureSamples?: number[];
}

export interface ConvergenceCriteria {
  pressureToleranceMpa: number;
  penetrationToleranceMm: number;
  forceResidualN: number;
  maxIterations: number;
}

export const DEFAULT_CRITERIA: ConvergenceCriteria = {
  pressureToleranceMpa: 0.1,
  penetrationToleranceMm: 0.001,
  forceResidualN: 1.0,
  maxIterations: 50,
};

export type IteratorFn = (prev: IterationState | null) => IterationState;

export interface ConvergenceResult {
  states: IterationState[];
  converged: boolean;
  finalState: IterationState | null;
  trajectory: 'monotone-rising' | 'monotone-falling' | 'oscillating' | 'flat' | 'unknown';
  recommendation: string;
}

// ── Top-level entry ────────────────────────────────────────────

export function runConvergence(
  iterator: IteratorFn,
  criteria: Partial<ConvergenceCriteria> = {},
): ConvergenceResult {
  const c = { ...DEFAULT_CRITERIA, ...criteria };
  const states: IterationState[] = [];
  let prev: IterationState | null = null;
  let converged = false;
  for (let i = 0; i < c.maxIterations; i++) {
    const next = iterator(prev);
    states.push(next);
    if (
      prev !== null
      && Math.abs(next.maxPressureMpa - prev.maxPressureMpa) <= c.pressureToleranceMpa
      && next.maxPenetrationMm <= c.penetrationToleranceMm
      && next.forceResidualN <= c.forceResidualN
    ) {
      converged = true;
      prev = next;
      break;
    }
    prev = next;
  }

  const trajectory = analyzeTrajectory(states);
  const recommendation = suggestAdjustment(states, trajectory, converged);

  return {
    states,
    converged,
    finalState: prev,
    trajectory,
    recommendation,
  };
}

// ── Trajectory analysis ───────────────────────────────────────

function analyzeTrajectory(states: IterationState[]): ConvergenceResult['trajectory'] {
  if (states.length < 3) return 'unknown';
  let rises = 0, falls = 0, flat = 0;
  for (let i = 1; i < states.length; i++) {
    const delta = states[i]!.maxPressureMpa - states[i - 1]!.maxPressureMpa;
    if (delta > 0.01) rises++;
    else if (delta < -0.01) falls++;
    else flat++;
  }
  if (flat >= states.length - 2) return 'flat';
  if (rises > 0 && falls > 0 && Math.min(rises, falls) >= 2) return 'oscillating';
  if (rises > falls && falls === 0) return 'monotone-rising';
  if (falls > rises && rises === 0) return 'monotone-falling';
  return 'unknown';
}

function suggestAdjustment(
  states: IterationState[],
  trajectory: ConvergenceResult['trajectory'],
  converged: boolean,
): string {
  if (converged) return 'Converged. No action needed.';
  if (trajectory === 'oscillating') return 'Pressure oscillating: reduce contact stiffness by ~30%.';
  if (trajectory === 'monotone-rising') return 'Pressure climbing: mesh likely under-resolved at contact edge. Refine.';
  if (trajectory === 'monotone-falling') return 'Pressure still falling at maxIterations: increase max iterations.';
  if (trajectory === 'flat') {
    const last = states[states.length - 1]!;
    if (last.forceResidualN > 1) return 'Pressure stable but force residual large: switch to augmented-Lagrange.';
    return 'Stalled near convergence: tighten contact stiffness slightly.';
  }
  return 'Did not converge. Inspect contact definition.';
}

// ── Damped relaxation iterator helper ────────────────────────

export function dampedRelaxation(
  fn: (state: IterationState | null) => Omit<IterationState, 'iteration'>,
  damping: number = 0.7,
): IteratorFn {
  let counter = 0;
  return (prev) => {
    counter++;
    const raw = fn(prev);
    if (prev === null) return { iteration: counter, ...raw };
    return {
      iteration: counter,
      maxPressureMpa: prev.maxPressureMpa + (raw.maxPressureMpa - prev.maxPressureMpa) * damping,
      maxPenetrationMm: prev.maxPenetrationMm + (raw.maxPenetrationMm - prev.maxPenetrationMm) * damping,
      forceResidualN: prev.forceResidualN + (raw.forceResidualN - prev.forceResidualN) * damping,
    };
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface ConvergenceSummary {
  iterations: number;
  converged: boolean;
  finalPressureMpa: number;
  finalPenetrationMm: number;
  trajectory: ConvergenceResult['trajectory'];
}

export function summarize(result: ConvergenceResult): ConvergenceSummary {
  return {
    iterations: result.states.length,
    converged: result.converged,
    finalPressureMpa: result.finalState ? result.finalState.maxPressureMpa : 0,
    finalPenetrationMm: result.finalState ? result.finalState.maxPenetrationMm : 0,
    trajectory: result.trajectory,
  };
}
