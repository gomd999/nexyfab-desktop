/**
 * modeCrossingDetector.ts — Detect mode-crossing (mode veering) in
 * FEA modal analyses across a parameter sweep.
 *
 * When you sweep a design parameter (e.g., bracket thickness) and
 * solve modal analysis at each step, the natural frequencies of the
 * modes change. Two phenomena can confuse the user:
 *
 *   - Mode crossing: two modes swap order (e.g., mode 2 becomes
 *     mode 3 because their frequencies cross).
 *   - Mode veering: two modes approach each other without crossing,
 *     but their mode shapes exchange.
 *
 * To track a "physical" mode (a mode shape) across the sweep, the
 * solver needs to MAC (modal assurance criterion) the shapes at each
 * step against the previous step and follow the highest MAC, not
 * the index.
 *
 * MAC formula:
 *   MAC(φ_a, φ_b) = |φ_a · φ_b|² / (||φ_a||² · ||φ_b||²)
 *
 * Module:
 *   - For a sweep of N parameter values × M modes, tracks each
 *     physical mode through the sweep via MAC ≥ threshold.
 *   - Flags crossings (where index swap occurs).
 *   - Flags veerings (close frequencies but mode shape exchange).
 */

export interface ModeAtStep {
  /** Mode index in the solver's output order. */
  index: number;
  /** Frequency (Hz). */
  frequencyHz: number;
  /** Mode-shape vector (flattened) — typically nodal displacement DOF values. */
  shape: number[];
}

export interface SweepStep {
  parameterValue: number;
  modes: ModeAtStep[];
}

export interface CrossingOptions {
  /** Minimum MAC to consider two shapes the same physical mode. */
  macThreshold: number;
  /** Frequency proximity (Hz) below which veering is flagged. */
  veeringFrequencyTolHz: number;
}

export const DEFAULT_OPTIONS: CrossingOptions = {
  macThreshold: 0.85,
  veeringFrequencyTolHz: 5,
};

export interface TrackedMode {
  /** Persistent ID assigned by the tracker. */
  physicalModeId: number;
  /** For each step: the solver index that this physical mode appears at. */
  perStepIndex: number[];
  /** Corresponding frequency at each step. */
  perStepFrequency: number[];
}

export interface CrossingEvent {
  stepIndex: number;
  parameterValue: number;
  /** Pair of physical-mode IDs that swapped index. */
  modeAId: number;
  modeBId: number;
}

export interface VeeringEvent {
  stepIndex: number;
  parameterValue: number;
  modeAId: number;
  modeBId: number;
  separationHz: number;
}

export interface DetectionResult {
  tracked: TrackedMode[];
  crossings: CrossingEvent[];
  veerings: VeeringEvent[];
}

// ── Top-level entry ────────────────────────────────────────────

export function detectModeCrossing(sweep: SweepStep[], options: Partial<CrossingOptions> = {}): DetectionResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (sweep.length === 0) {
    return { tracked: [], crossings: [], veerings: [] };
  }

  // Initialize with first step.
  const tracked: TrackedMode[] = sweep[0]!.modes.map((m, i) => ({
    physicalModeId: i,
    perStepIndex: [m.index],
    perStepFrequency: [m.frequencyHz],
  }));
  const lastShapes: number[][] = sweep[0]!.modes.map(m => m.shape);
  const crossings: CrossingEvent[] = [];
  const veerings: VeeringEvent[] = [];

  for (let s = 1; s < sweep.length; s++) {
    const step = sweep[s]!;
    const assigned = new Array<boolean>(step.modes.length).fill(false);
    for (let pmi = 0; pmi < tracked.length; pmi++) {
      const prevShape = lastShapes[pmi]!;
      let bestMode = -1;
      let bestMac = -1;
      for (let mi = 0; mi < step.modes.length; mi++) {
        if (assigned[mi]) continue;
        const mac = modalAssuranceCriterion(prevShape, step.modes[mi]!.shape);
        if (mac > bestMac) {
          bestMac = mac;
          bestMode = mi;
        }
      }
      if (bestMode === -1 || bestMac < opts.macThreshold) {
        // Lost track — leave per-step gaps.
        tracked[pmi]!.perStepIndex.push(-1);
        tracked[pmi]!.perStepFrequency.push(NaN);
        continue;
      }
      assigned[bestMode] = true;
      const matched = step.modes[bestMode]!;
      tracked[pmi]!.perStepIndex.push(matched.index);
      tracked[pmi]!.perStepFrequency.push(matched.frequencyHz);
      // Check for crossing: solver index differs from previous step's index.
      const prevSolverIdx = tracked[pmi]!.perStepIndex[s - 1]!;
      if (prevSolverIdx !== matched.index && prevSolverIdx !== -1) {
        // Find the other tracked mode that took this slot previously.
        const swappedWith = tracked.find(t => t !== tracked[pmi] && t.perStepIndex[s - 1] === matched.index);
        if (swappedWith) {
          crossings.push({
            stepIndex: s,
            parameterValue: step.parameterValue,
            modeAId: tracked[pmi]!.physicalModeId,
            modeBId: swappedWith.physicalModeId,
          });
        }
      }
      lastShapes[pmi] = matched.shape;
    }
    // Veering check on adjacent freq.
    for (let i = 0; i < tracked.length; i++) {
      for (let j = i + 1; j < tracked.length; j++) {
        const fA = tracked[i]!.perStepFrequency[s];
        const fB = tracked[j]!.perStepFrequency[s];
        if (fA === undefined || fB === undefined || isNaN(fA) || isNaN(fB)) continue;
        const sep = Math.abs(fA - fB);
        if (sep < opts.veeringFrequencyTolHz) {
          veerings.push({
            stepIndex: s,
            parameterValue: step.parameterValue,
            modeAId: tracked[i]!.physicalModeId,
            modeBId: tracked[j]!.physicalModeId,
            separationHz: sep,
          });
        }
      }
    }
  }

  return { tracked, crossings, veerings };
}

// ── MAC ──────────────────────────────────────────────────────

export function modalAssuranceCriterion(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return 0;
  return (dot * dot) / (normA * normB);
}

// ── Summary ────────────────────────────────────────────────────

export interface DetectionSummary {
  trackedModeCount: number;
  crossingCount: number;
  veeringCount: number;
  lostTrackCount: number;
}

export function summarize(result: DetectionResult): DetectionSummary {
  let lost = 0;
  for (const t of result.tracked) {
    if (t.perStepIndex.includes(-1)) lost++;
  }
  return {
    trackedModeCount: result.tracked.length,
    crossingCount: result.crossings.length,
    veeringCount: result.veerings.length,
    lostTrackCount: lost,
  };
}
