/**
 * contactPreloadSetter.ts — Set initial preload for FEA contact
 * surfaces (bolt joint, interference fit, gasket).
 *
 * Preload is the force applied to the contact pair before the
 * external loads are applied. Required for:
 *
 *   - Bolted joints (proof preload typically 70% of bolt's proof
 *     strength).
 *   - Interference fits (radial pressure from press-fit).
 *   - Gasket compression (% squeeze).
 *
 * Module:
 *   - Computes the preload value for each contact case.
 *   - Returns the FEA pre-tension command (Abaqus *PRE-TENSION SECTION).
 */

export type PreloadKind = 'bolt' | 'interference' | 'gasket' | 'thermal-shrink';

export interface BoltPreloadInput {
  kind: 'bolt';
  /** Bolt thread diameter (mm). */
  threadDiameterMm: number;
  /** Property class (e.g., "8.8"). */
  propertyClass: string;
  /** Fraction of proof strength (default 0.70). */
  proofFraction?: number;
}

export interface InterferencePreloadInput {
  kind: 'interference';
  /** Diametral interference (mm). */
  interferenceMm: number;
  /** Shaft outer radius (mm). */
  shaftRadiusMm: number;
  /** Effective Young's modulus (MPa). */
  effectiveYoungMpa: number;
}

export interface GasketPreloadInput {
  kind: 'gasket';
  /** Gasket compression % (e.g., 0.25 = 25%). */
  compressionFraction: number;
  /** Gasket spring constant (N/mm). */
  springConstantNMm: number;
}

export interface ThermalShrinkInput {
  kind: 'thermal-shrink';
  /** Initial interference at room temp (mm). */
  interferenceMm: number;
  /** Temperature delta to fit (°C). */
  deltaTC: number;
  /** Coefficient of thermal expansion (1/°C). */
  cteOnC: number;
}

export type PreloadInput = BoltPreloadInput | InterferencePreloadInput | GasketPreloadInput | ThermalShrinkInput;

export interface PreloadResult {
  kind: PreloadKind;
  /** Preload force (N), positive = compressive contact. */
  preloadN: number;
  /** Pre-tension section identifier suitable for Abaqus / Ansys. */
  preTensionId?: string;
  /** Optional pressure (MPa) for distributed loads. */
  pressureMpa?: number;
  warnings: string[];
}

// ── Proof stress table (illustrative ISO 898-1). ─────────────

export const PROOF_STRESS_MPA: Record<string, number> = {
  '4.6': 225,
  '4.8': 310,
  '5.6': 280,
  '5.8': 380,
  '8.8': 580,
  '10.9': 830,
  '12.9': 970,
};

// ── Top-level entry ────────────────────────────────────────────

export function computePreload(input: PreloadInput): PreloadResult {
  const warnings: string[] = [];
  switch (input.kind) {
    case 'bolt': {
      const proof = PROOF_STRESS_MPA[input.propertyClass] ?? 580;
      if (PROOF_STRESS_MPA[input.propertyClass] === undefined) {
        warnings.push(`Unknown property class ${input.propertyClass}; using 8.8 default.`);
      }
      const fraction = input.proofFraction ?? 0.7;
      const stressArea = 0.7854 * (input.threadDiameterMm * 0.85) ** 2;
      const preload = fraction * proof * stressArea;
      return {
        kind: 'bolt',
        preloadN: preload,
        preTensionId: `BOLT-PRE-${input.threadDiameterMm}`,
        warnings,
      };
    }
    case 'interference': {
      // Lamé / cylindrical interference fit pressure:
      //   p = E · δ / (2 · R) (simplified for solid shaft + thin hub).
      const pressure = (input.effectiveYoungMpa * input.interferenceMm) / (2 * input.shaftRadiusMm);
      const contactArea = 2 * Math.PI * input.shaftRadiusMm * input.shaftRadiusMm * 2;
      const force = pressure * contactArea;
      return {
        kind: 'interference',
        preloadN: force,
        pressureMpa: pressure,
        warnings,
      };
    }
    case 'gasket': {
      // F = k · δ where δ = compression as fraction × gasket thickness — use unit thickness.
      const force = input.springConstantNMm * input.compressionFraction;
      if (input.compressionFraction > 0.5) warnings.push('Compression > 50%; may crush gasket.');
      return {
        kind: 'gasket',
        preloadN: force,
        warnings,
      };
    }
    case 'thermal-shrink': {
      // ε = α · ΔT; preload force estimated from interference.
      const finalInterference = input.interferenceMm - input.interferenceMm * input.cteOnC * input.deltaTC;
      const ratio = finalInterference / Math.max(0.0001, input.interferenceMm);
      const force = ratio * 1000;
      return { kind: 'thermal-shrink', preloadN: force, warnings };
    }
  }
}

// ── Bulk computation ─────────────────────────────────────────

export function computeMultiple(inputs: PreloadInput[]): PreloadResult[] {
  return inputs.map(computePreload);
}

// ── Validate against bolt's allowable preload ────────────────

export interface PreloadCheck {
  preloadN: number;
  maxAllowableN: number;
  withinLimit: boolean;
}

export function validateBoltPreload(input: BoltPreloadInput): PreloadCheck {
  const result = computePreload(input);
  const proof = PROOF_STRESS_MPA[input.propertyClass] ?? 580;
  const stressArea = 0.7854 * (input.threadDiameterMm * 0.85) ** 2;
  const maxAllowable = proof * stressArea;
  return { preloadN: result.preloadN, maxAllowableN: maxAllowable, withinLimit: result.preloadN <= maxAllowable };
}

// ── Summary ────────────────────────────────────────────────────

export interface PreloadSummary {
  kind: PreloadKind;
  preloadN: number;
  warningCount: number;
}

export function summarize(result: PreloadResult): PreloadSummary {
  return {
    kind: result.kind,
    preloadN: result.preloadN,
    warningCount: result.warnings.length,
  };
}
