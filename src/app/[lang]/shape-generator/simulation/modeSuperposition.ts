/**
 * modeSuperposition.ts — Compute the time-domain transient response
 * of a structure from its modal eigenvectors using mode superposition.
 *
 * Modal analysis gives N modes (eigenvectors φᵢ + natural frequencies
 * ωᵢ + damping ratios ζᵢ). For a forcing function f(t) projected
 * onto each mode as fᵢ(t), the modal response is:
 *
 *     q̈ᵢ + 2ζᵢωᵢ q̇ᵢ + ωᵢ² qᵢ = fᵢ(t)
 *
 * Each mode is a 1-DOF damped SDOF system. Integrate them
 * separately (Newmark-β here), then superimpose:
 *
 *     x(t) = Σᵢ φᵢ · qᵢ(t)
 *
 * Module produces a per-time-step displacement field. Used for
 * shock / vibration test simulation and harmonic response.
 */

export interface Mode {
  /** Mode index (1-based). */
  index: number;
  /** Natural frequency, rad/s. */
  omega: number;
  /** Damping ratio (0..1). 0.02 typical for steel. */
  zeta: number;
  /** Mass-normalized eigenvector (per-DOF entries). */
  eigenvector: number[];
}

export interface ForceTimeHistory {
  /** Time stamps, seconds. */
  time: number[];
  /** Generalized force per mode, [modeIndex][timeStep]. */
  modalForces: number[][];
}

export interface ResponseSnapshot {
  timeSec: number;
  /** Physical displacement per DOF. */
  displacement: number[];
  /** Modal contributions [modeIndex] = q (modal amplitude). */
  modalQ: number[];
  maxAbsDisplacement: number;
}

export interface SuperpositionResult {
  snapshots: ResponseSnapshot[];
  /** Mode that contributed the largest peak modal amplitude. */
  dominantModeIndex: number;
  /** Peak displacement across all snapshots. */
  peakDisplacementMm: number;
}

export interface SuperpositionOptions {
  /** Newmark-β parameters. β=0.25 γ=0.5 → average-acceleration (uncond. stable). */
  beta: number;
  gamma: number;
}

export const DEFAULT_OPTIONS: SuperpositionOptions = {
  beta: 0.25,
  gamma: 0.5,
};

// ── Top-level entry ────────────────────────────────────────────

export function modeSuperposition(
  modes: Mode[],
  forcing: ForceTimeHistory,
  options: Partial<SuperpositionOptions> = {},
): SuperpositionResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const numSteps = forcing.time.length;
  const numModes = modes.length;
  if (numSteps === 0 || numModes === 0) {
    return { snapshots: [], dominantModeIndex: -1, peakDisplacementMm: 0 };
  }

  const dofCount = modes[0]!.eigenvector.length;
  // Initialize modal coords.
  const q: number[] = new Array(numModes).fill(0);
  const qDot: number[] = new Array(numModes).fill(0);
  const qDotDot: number[] = new Array(numModes).fill(0);
  // Peak per mode.
  const peakModalQ: number[] = new Array(numModes).fill(0);

  const snapshots: ResponseSnapshot[] = [];

  // Initial acceleration at t=0: q̈ = f - 2ζω·q̇ - ω²·q (all zero initially).
  for (let i = 0; i < numModes; i++) {
    qDotDot[i] = (forcing.modalForces[i]?.[0] ?? 0);
  }
  snapshots.push(buildSnapshot(forcing.time[0]!, q, qDot, modes, dofCount));

  for (let step = 1; step < numSteps; step++) {
    const dt = forcing.time[step]! - forcing.time[step - 1]!;
    for (let m = 0; m < numModes; m++) {
      const mode = modes[m]!;
      const force = forcing.modalForces[m]?.[step] ?? 0;
      const { newQ, newQDot, newQDotDot } = newmarkStep(
        q[m]!, qDot[m]!, qDotDot[m]!, force, mode.omega, mode.zeta, dt, opts,
      );
      q[m] = newQ;
      qDot[m] = newQDot;
      qDotDot[m] = newQDotDot;
      if (Math.abs(newQ) > peakModalQ[m]!) peakModalQ[m] = Math.abs(newQ);
    }
    snapshots.push(buildSnapshot(forcing.time[step]!, q, qDot, modes, dofCount));
  }

  // Dominant mode = largest peak |q|.
  let dominantIdx = 0;
  let bestPeak = peakModalQ[0]!;
  for (let i = 1; i < peakModalQ.length; i++) {
    if (peakModalQ[i]! > bestPeak) {
      bestPeak = peakModalQ[i]!;
      dominantIdx = i;
    }
  }

  const peakDisp = snapshots.reduce((m, s) => Math.max(m, s.maxAbsDisplacement), 0);

  return {
    snapshots,
    dominantModeIndex: modes[dominantIdx]?.index ?? -1,
    peakDisplacementMm: peakDisp,
  };
}

// ── Newmark-β step ────────────────────────────────────────────

function newmarkStep(
  q: number, qDot: number, qDotDot: number,
  force: number, omega: number, zeta: number, dt: number,
  opts: SuperpositionOptions,
): { newQ: number; newQDot: number; newQDotDot: number } {
  const beta = opts.beta;
  const gamma = opts.gamma;
  const m = 1; // mass-normalized
  const c = 2 * zeta * omega;
  const k = omega * omega;
  const kHat = k + (gamma / (beta * dt)) * c + (1 / (beta * dt * dt)) * m;
  const massTerm = m * (q / (beta * dt * dt) + qDot / (beta * dt) + (1 / (2 * beta) - 1) * qDotDot);
  const dampingTerm = c * (q * gamma / (beta * dt) + qDot * (gamma / beta - 1) + dt * qDotDot * (gamma / (2 * beta) - 1));
  const fHat = force + massTerm + dampingTerm;
  const newQ = fHat / kHat;
  const newQDot = (gamma / (beta * dt)) * (newQ - q) + (1 - gamma / beta) * qDot + dt * (1 - gamma / (2 * beta)) * qDotDot;
  const newQDotDot = (1 / (beta * dt * dt)) * (newQ - q) - (1 / (beta * dt)) * qDot - (1 / (2 * beta) - 1) * qDotDot;
  return { newQ, newQDot, newQDotDot };
}

// ── Snapshot builder ──────────────────────────────────────────

function buildSnapshot(t: number, q: number[], _qDot: number[], modes: Mode[], dofCount: number): ResponseSnapshot {
  const displacement = new Array(dofCount).fill(0);
  for (let m = 0; m < modes.length; m++) {
    const mode = modes[m]!;
    const qm = q[m]!;
    for (let d = 0; d < dofCount; d++) {
      displacement[d] += qm * (mode.eigenvector[d] ?? 0);
    }
  }
  const maxAbs = displacement.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  return { timeSec: t, displacement, modalQ: [...q], maxAbsDisplacement: maxAbs };
}

// ── Summary ────────────────────────────────────────────────────

export interface ResponseSummary {
  snapshotCount: number;
  durationSec: number;
  peakDisplacementMm: number;
  dominantModeIndex: number;
}

export function summarize(result: SuperpositionResult): ResponseSummary {
  const t0 = result.snapshots[0]?.timeSec ?? 0;
  const tEnd = result.snapshots[result.snapshots.length - 1]?.timeSec ?? 0;
  return {
    snapshotCount: result.snapshots.length,
    durationSec: tEnd - t0,
    peakDisplacementMm: result.peakDisplacementMm,
    dominantModeIndex: result.dominantModeIndex,
  };
}
