/**
 * filletThroatSizer.ts — Size a fillet weld (leg + throat) for a given
 * load and check the resulting shear stress per AWS D1.1 / Eurocode.
 *
 * For an equal-leg fillet of leg w, the design throat is:
 *   a = 0.707 · w        (45° throat)
 *
 * The weld shear capacity over a length L:
 *   F = a · L · τ_allow
 *
 * Conversely the minimum leg for a load F:
 *   w_min = F / (0.707 · L · τ_allow)
 *
 * AWS minimum fillet size by the thicker joined plate is enforced, and a
 * maximum (≤ thinner plate − 1.5 mm for plates ≥ 6 mm) is checked.
 */

export type LoadType = 'transverse' | 'longitudinal';

export interface FilletWeldInput {
  legSizeMm?: number;       // if omitted, solve from load
  weldLengthMm: number;
  appliedLoadN: number;
  allowableShearMpa: number;
  thinnerPlateMm: number;
  thickerPlateMm: number;
  loadType?: LoadType;      // transverse welds ~30% stronger (AWS allows it)
  /**
   * Heat-affected-zone strength-retention factor (0..1). Hardenable steels and
   * heat-treated aluminium lose strength in the HAZ; multiplying the allowable
   * shear by this factor couples that loss into capacity + the pass check.
   * Default 1.0 (no softening) — back-compatible. Derive from a material class
   * via {@link hazSofteningFactor}.
   */
  hazSofteningFactor?: number;
}

export interface FilletWeldResult {
  legSizeMm: number;
  throatMm: number;
  shearStressMpa: number | null;
  capacityN: number;
  minLegForLoadMm: number;
  awsMinLegMm: number;
  awsMaxLegMm: number;
  legWithinAwsRange: boolean;
  passed: boolean | null;
  /** Allowable shear after HAZ softening (= allowableShearMpa × hazSofteningFactor). */
  effectiveAllowableShearMpa: number;
  warnings: string[];
}

export function size(input: FilletWeldInput): FilletWeldResult {
  const warnings: string[] = [];
  if (input.weldLengthMm <= 0) warnings.push('Weld length must be positive.');
  if (input.allowableShearMpa <= 0) warnings.push('Allowable shear must be positive.');

  // AWS D1.1 minimum fillet size by thicker plate.
  const awsMin = awsMinFillet(input.thickerPlateMm);
  // Maximum: for plate ≥ 6 mm, max = thinner − 1.5 mm; else = thinner.
  const awsMax = input.thinnerPlateMm >= 6 ? input.thinnerPlateMm - 1.5 : input.thinnerPlateMm;

  // Transverse fillets carry ~1.0; longitudinal ~0.75 of the simple value
  // (or transverse +30%); use a directional factor on capacity.
  const dirFactor = (input.loadType ?? 'transverse') === 'transverse' ? 1.0 : 0.75;

  // HAZ softening reduces the usable allowable shear (hardenable steels /
  // heat-treated Al lose strength in the heat-affected zone). Default 1.0.
  const hazFactor = input.hazSofteningFactor ?? 1.0;
  const effectiveAllowable = input.allowableShearMpa * hazFactor;
  if (hazFactor < 1) {
    warnings.push(`HAZ softening ${(hazFactor * 100).toFixed(0)}% applied — allowable shear reduced ${input.allowableShearMpa} → ${effectiveAllowable.toFixed(1)} MPa.`);
  }

  const minLeg = (0.707 * input.weldLengthMm * effectiveAllowable * dirFactor) > 0
    ? input.appliedLoadN / (0.707 * input.weldLengthMm * effectiveAllowable * dirFactor)
    : Infinity;

  const leg = input.legSizeMm ?? Math.max(minLeg, awsMin);
  const throat = 0.707 * leg;
  const capacity = throat * input.weldLengthMm * effectiveAllowable * dirFactor;

  let shearStress: number | null = null;
  let passed: boolean | null = null;
  if (input.legSizeMm != null && input.legSizeMm > 0) {
    shearStress = input.appliedLoadN / (0.707 * input.legSizeMm * input.weldLengthMm * dirFactor);
    passed = shearStress <= effectiveAllowable + 1e-9;
  }

  const withinRange = leg >= awsMin - 1e-9 && leg <= awsMax + 1e-9;
  if (!withinRange && input.legSizeMm != null) {
    if (leg < awsMin) warnings.push(`Leg ${leg.toFixed(1)} mm below AWS minimum ${awsMin} mm for ${input.thickerPlateMm} mm plate.`);
    if (leg > awsMax) warnings.push(`Leg ${leg.toFixed(1)} mm exceeds AWS maximum ${awsMax.toFixed(1)} mm for ${input.thinnerPlateMm} mm plate.`);
  }

  return {
    legSizeMm: leg,
    throatMm: throat,
    shearStressMpa: shearStress,
    capacityN: capacity,
    minLegForLoadMm: minLeg,
    awsMinLegMm: awsMin,
    awsMaxLegMm: awsMax,
    legWithinAwsRange: withinRange,
    passed,
    effectiveAllowableShearMpa: effectiveAllowable,
    warnings,
  };
}

// ── HAZ softening by material class ────────────────────────────────────────

export type WeldMaterialClass =
  | 'mild-steel'
  | 'stainless'
  | 'quenched-tempered-steel'
  | 'non-heat-treated-aluminum'
  | 'heat-treated-aluminum';

/**
 * Typical HAZ strength-retention factors. As-rolled mild steel keeps its
 * strength; quenched-&-tempered steel is tempered back in the HAZ; heat-treated
 * (precipitation-hardened) aluminium over-ages worst.
 */
export const HAZ_SOFTENING: Record<WeldMaterialClass, number> = {
  'mild-steel': 1.0,
  'stainless': 0.95,
  'quenched-tempered-steel': 0.85,
  'non-heat-treated-aluminum': 0.9,
  'heat-treated-aluminum': 0.7,
};

export function hazSofteningFactor(materialClass: WeldMaterialClass): number {
  return HAZ_SOFTENING[materialClass] ?? 1.0;
}

/** AWS D1.1 Table 5.8 minimum fillet size (mm) by thicker part thickness. */
export function awsMinFillet(thickerPlateMm: number): number {
  if (thickerPlateMm <= 6) return 3;
  if (thickerPlateMm <= 12) return 5;
  if (thickerPlateMm <= 20) return 6;
  return 8;
}

/** Safety factor at the applied load. */
export function safetyFactor(result: FilletWeldResult, appliedLoadN: number): number {
  if (appliedLoadN <= 0) return Infinity;
  return result.capacityN / appliedLoadN;
}

export function summarize(r: FilletWeldResult): { legSizeMm: number; throatMm: number; capacityN: number } {
  return { legSizeMm: r.legSizeMm, throatMm: r.throatMm, capacityN: r.capacityN };
}
