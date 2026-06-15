/**
 * pipeFlow.ts — incompressible pipe-flow head loss and HARDY-CROSS network balancing.
 *
 *   Darcy-Weisbach:  h_f = f·(L/D)·v²/(2g) = K·Q²,   K = 8·f·L/(π²·g·D⁵)
 *   Hardy-Cross loop correction:  ΔQ = −Σ(K·Q|Q|) / Σ(2·K·|Q|)
 *
 * Each iteration drives the signed head loss around a loop to zero (Kirchhoff's
 * pressure law). Verified against the Darcy formula, the analytic parallel-pipe split
 * Q1/Q2 = √(K2/K1), and the converged loop head balance Σ h_f = 0.
 */

export const G = 9.80665; // m/s²

/** Darcy-Weisbach head loss h_f = f·(L/D)·v²/(2g). */
export function darcyHeadLoss(f: number, L: number, D: number, v: number): number {
  return (f * (L / D) * v * v) / (2 * G);
}

/** Pipe resistance K so that h_f = K·Q²:  K = 8·f·L/(π²·g·D⁵). */
export function pipeResistance(f: number, L: number, D: number): number {
  return (8 * f * L) / (Math.PI * Math.PI * G * D ** 5);
}

/** Reynolds number ρ·v·D/μ. */
export function reynolds(rho: number, v: number, D: number, mu: number): number {
  return (rho * v * D) / mu;
}

export interface LoopPipe { K: number; Q: number; } // Q signed in the loop traversal direction

/** Signed head loss around a loop: Σ K·Q·|Q| (should be ~0 when balanced). */
export function loopHeadImbalance(pipes: LoopPipe[]): number {
  return pipes.reduce((s, p) => s + p.K * p.Q * Math.abs(p.Q), 0);
}

/**
 * Hardy-Cross single-loop balancing. Applies ΔQ = −Σ(K Q|Q|)/Σ(2K|Q|) to every pipe
 * (preserving nodal continuity) until the loop head imbalance vanishes.
 */
export function hardyCrossLoop(pipes: LoopPipe[], iters = 100, tol = 1e-12): { pipes: LoopPipe[]; iterations: number } {
  const q = pipes.map((p) => ({ ...p }));
  for (let it = 0; it < iters; it++) {
    let num = 0, den = 0;
    for (const p of q) { num += p.K * p.Q * Math.abs(p.Q); den += 2 * p.K * Math.abs(p.Q); }
    const dQ = den > 0 ? -num / den : 0;
    for (const p of q) p.Q += dQ;
    if (Math.abs(dQ) < tol) return { pipes: q, iterations: it + 1 };
  }
  return { pipes: q, iterations: iters };
}
