/**
 * loadMassScaling.ts — Apply mass scaling to a transient FEA model to
 * accelerate explicit-dynamics analysis.
 *
 * Explicit dynamics is conditionally stable: timestep < critical
 * timestep:
 *
 *   Δt_crit = L_smallest / c   where c = sqrt(E/ρ).
 *
 * The smallest element drives Δt. Mass scaling artificially increases
 * the density of small elements so c drops and Δt grows. Trade-off:
 * artificial inertia adds — keep added mass < 5% of total.
 *
 * Module:
 *   - Detects elements with sub-critical Δt.
 *   - Computes required scale factor.
 *   - Reports total added mass.
 *   - Warns when added mass exceeds threshold.
 */

export interface ElementInfo {
  id: string;
  /** Characteristic length (mm). */
  charLengthMm: number;
  /** Mass (kg). */
  massKg: number;
  /** Material density (kg/m³). */
  densityKgM3: number;
  /** Young's modulus (Pa). */
  youngPa: number;
}

export interface ScalingOptions {
  /** Target Δt (s). */
  targetDtSec: number;
  /** Max added-mass fraction (e.g., 0.05). */
  maxAddedMassFraction: number;
}

export const DEFAULT_OPTIONS: ScalingOptions = {
  targetDtSec: 1e-6,
  maxAddedMassFraction: 0.05,
};

export interface ScaledElement {
  id: string;
  originalMassKg: number;
  scaleFactor: number;
  newMassKg: number;
  addedMassKg: number;
}

export interface ScalingResult {
  scaledElements: ScaledElement[];
  totalAddedMassKg: number;
  totalOriginalMassKg: number;
  addedMassFraction: number;
  withinLimit: boolean;
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function applyMassScaling(elements: ElementInfo[], options: Partial<ScalingOptions> = {}): ScalingResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const warnings: string[] = [];
  const scaled: ScaledElement[] = [];
  let totalAdded = 0;
  let totalOriginal = 0;

  for (const el of elements) {
    totalOriginal += el.massKg;
    const currentDt = criticalTimestep(el);
    if (currentDt >= opts.targetDtSec) {
      scaled.push({ id: el.id, originalMassKg: el.massKg, scaleFactor: 1, newMassKg: el.massKg, addedMassKg: 0 });
      continue;
    }
    const ratio = opts.targetDtSec / currentDt;
    const scaleFactor = ratio * ratio; // mass scale = (target Δt / current Δt)²
    const newMass = el.massKg * scaleFactor;
    const added = newMass - el.massKg;
    totalAdded += added;
    scaled.push({ id: el.id, originalMassKg: el.massKg, scaleFactor, newMassKg: newMass, addedMassKg: added });
  }

  const fraction = totalOriginal === 0 ? 0 : totalAdded / totalOriginal;
  const withinLimit = fraction <= opts.maxAddedMassFraction;
  if (!withinLimit) {
    warnings.push(`Added mass fraction ${(fraction * 100).toFixed(2)}% exceeds limit ${(opts.maxAddedMassFraction * 100).toFixed(0)}%; reduce mesh size variability.`);
  }

  return { scaledElements: scaled, totalAddedMassKg: totalAdded, totalOriginalMassKg: totalOriginal, addedMassFraction: fraction, withinLimit, warnings };
}

function criticalTimestep(el: ElementInfo): number {
  // c = sqrt(E / ρ). Δt = L / c.
  const wave = Math.sqrt(el.youngPa / Math.max(0.001, el.densityKgM3));
  const lengthM = el.charLengthMm / 1000;
  return lengthM / Math.max(0.001, wave);
}

// ── Worst element finder ─────────────────────────────────────

export function worstScaled(result: ScalingResult, top: number = 5): ScaledElement[] {
  return result.scaledElements.slice().sort((a, b) => b.scaleFactor - a.scaleFactor).slice(0, top);
}

// ── Suggest mesh refinement instead of scaling ───────────────

export interface MeshSuggestion {
  smallElementCount: number;
  recommendedMinCharLengthMm: number;
}

export function suggestMeshFix(elements: ElementInfo[], minDtSec: number): MeshSuggestion {
  const smallEls = elements.filter(e => criticalTimestep(e) < minDtSec);
  let avgLength = 0;
  for (const e of elements) avgLength += e.charLengthMm;
  avgLength /= Math.max(1, elements.length);
  return { smallElementCount: smallEls.length, recommendedMinCharLengthMm: avgLength * 0.5 };
}

// ── Summary ────────────────────────────────────────────────────

export interface ScalingSummary {
  elementCount: number;
  totalAddedMassKg: number;
  addedMassFraction: number;
  withinLimit: boolean;
}

export function summarize(result: ScalingResult): ScalingSummary {
  return {
    elementCount: result.scaledElements.length,
    totalAddedMassKg: result.totalAddedMassKg,
    addedMassFraction: result.addedMassFraction,
    withinLimit: result.withinLimit,
  };
}
