/**
 * coiningCheck.ts — Check sheet-metal coining feasibility and required
 * press tonnage.
 *
 * Coining is a forming process where the entire bend is compressed
 * past yield, producing tighter tolerance + smaller inside radius
 * than air-bending. It requires:
 *
 *   - Very high tonnage: ~5× normal air-bend force.
 *   - Robust die / punch with hard chrome plating.
 *   - Sharp 90° die V-shape; cannot do partial coining.
 *
 * Module computes:
 *
 *   - Required tonnage (Diebold's rule of thumb).
 *   - Pass / warn / fail vs press capability.
 *   - Recommended die-V opening + punch radius for inside R.
 */

export type Material = 'mild-steel' | 'stainless-304' | 'aluminum-5052' | 'aluminum-6061' | 'copper-c110';

export interface MaterialParams {
  /** Ultimate tensile strength, MPa. */
  utsMpa: number;
  /** Minimum bend radius factor (× thickness). */
  minBendRadiusFactor: number;
  name: string;
}

export const MATERIAL_DB: Record<Material, MaterialParams> = {
  'mild-steel':    { utsMpa: 450, minBendRadiusFactor: 0.5, name: 'Mild Steel' },
  'stainless-304': { utsMpa: 620, minBendRadiusFactor: 1.0, name: 'Stainless 304' },
  'aluminum-5052': { utsMpa: 230, minBendRadiusFactor: 0.5, name: 'Aluminum 5052' },
  'aluminum-6061': { utsMpa: 310, minBendRadiusFactor: 1.0, name: 'Aluminum 6061-T6' },
  'copper-c110':   { utsMpa: 220, minBendRadiusFactor: 0.5, name: 'Copper C110' },
};

export interface CoiningInput {
  material: Material;
  /** Sheet thickness (mm). */
  thicknessMm: number;
  /** Desired inside radius (mm). */
  insideRadiusMm: number;
  /** Bend length (mm) – total length of the bend along sheet. */
  bendLengthMm: number;
  /** Bend angle (deg). */
  angleDeg: number;
}

export interface PressCapability {
  /** Maximum tonnage (kN). */
  maxTonnageKn: number;
  /** Whether the press can do coining. */
  coiningCapable: boolean;
}

export interface CoiningResult {
  requiredTonnageKn: number;
  feasible: boolean;
  recommendedDieVMm: number;
  recommendedPunchRadiusMm: number;
  warnings: string[];
  /** Compared with air-bend tonnage. */
  coiningMultiple: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function checkCoining(input: CoiningInput, press: PressCapability): CoiningResult {
  const m = MATERIAL_DB[input.material];
  const warnings: string[] = [];
  // Air-bend tonnage: F = 1.42 × UTS × t² × L / V (per Diebold).
  // For coining, take 5× the air-bend value as approximation.
  const dieV = Math.max(6 * input.thicknessMm, 8); // 6t rule for V opening
  const airBendKn = (1.42 * m.utsMpa * input.thicknessMm ** 2 * input.bendLengthMm) / (dieV * 1000);
  const coiningKn = airBendKn * 5;
  const punchR = input.insideRadiusMm;
  const minR = m.minBendRadiusFactor * input.thicknessMm;
  if (input.insideRadiusMm < minR) {
    warnings.push(`Inside radius ${input.insideRadiusMm.toFixed(2)} mm < minimum ${minR.toFixed(2)} mm for ${m.name}; cracking risk.`);
  }
  if (input.angleDeg !== 90) {
    warnings.push(`Coining is best for 90° bends; ${input.angleDeg.toFixed(0)}° requested.`);
  }
  if (!press.coiningCapable) {
    warnings.push('Press is not coining-capable (probably worn dies / no chrome plating).');
  }
  const feasible = press.coiningCapable && coiningKn <= press.maxTonnageKn && warnings.length === 0;
  return {
    requiredTonnageKn: coiningKn,
    feasible,
    recommendedDieVMm: dieV,
    recommendedPunchRadiusMm: punchR,
    warnings,
    coiningMultiple: 5,
  };
}

// ── Pass-by-pass coining (multi-stroke for thick stock) ──────

export interface MultiPassPlan {
  totalPasses: number;
  perPassDepthMm: number[];
  totalTonnageKn: number;
}

export function multiPassPlan(input: CoiningInput, press: PressCapability): MultiPassPlan {
  const single = checkCoining(input, press);
  if (single.feasible) {
    return { totalPasses: 1, perPassDepthMm: [input.thicknessMm], totalTonnageKn: single.requiredTonnageKn };
  }
  const passes = Math.ceil(single.requiredTonnageKn / press.maxTonnageKn);
  const perPass = input.thicknessMm / passes;
  return {
    totalPasses: passes,
    perPassDepthMm: Array.from({ length: passes }, () => perPass),
    totalTonnageKn: single.requiredTonnageKn,
  };
}

// ── Compare coining vs air-bend ──────────────────────────────

export interface ProcessComparison {
  airBendTonnageKn: number;
  coiningTonnageKn: number;
  airBendDeflection: number;
  coiningSpringback: number;
  recommendedProcess: 'air-bend' | 'coining';
}

export function compareProcesses(input: CoiningInput): ProcessComparison {
  const m = MATERIAL_DB[input.material];
  const dieV = Math.max(6 * input.thicknessMm, 8);
  const airBend = (1.42 * m.utsMpa * input.thicknessMm ** 2 * input.bendLengthMm) / (dieV * 1000);
  const coining = airBend * 5;
  const airSpringback = 2;
  const coiningSpringback = 0.5;
  const recommend = input.insideRadiusMm < m.minBendRadiusFactor * input.thicknessMm * 1.5 ? 'coining' : 'air-bend';
  return {
    airBendTonnageKn: airBend,
    coiningTonnageKn: coining,
    airBendDeflection: airSpringback,
    coiningSpringback,
    recommendedProcess: recommend,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface CoiningSummary {
  feasible: boolean;
  requiredTonnageKn: number;
  warningCount: number;
}

export function summarize(result: CoiningResult): CoiningSummary {
  return {
    feasible: result.feasible,
    requiredTonnageKn: result.requiredTonnageKn,
    warningCount: result.warnings.length,
  };
}
