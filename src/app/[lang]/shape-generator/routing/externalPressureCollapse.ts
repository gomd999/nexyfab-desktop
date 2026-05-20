/**
 * externalPressureCollapse.ts — Check a pipe/cylinder under EXTERNAL
 * pressure (vacuum, jacketed, subsea) against elastic buckling collapse,
 * for long ("infinitely long") and short cylinders.
 *
 * Long-cylinder elastic collapse (no end support):
 *   P_c = 2·E / (1 − ν²) · (t/D)³
 *
 * Short cylinders (length-dependent) use a higher buckling pressure; we
 * apply a length factor. The allowable external pressure = P_c / SF
 * (SF ≈ 3 per ASME UG-28 elastic regime). We report the collapse margin
 * and the minimum wall to resist a target external pressure.
 */

export interface ExternalPressureInput {
  outerDiameterMm: number;
  wallThicknessMm: number;
  lengthMm: number;
  youngMpa: number;
  poisson?: number;            // default 0.3
  externalPressureMpa: number; // design (e.g. 0.1 for full vacuum)
  safetyFactor?: number;       // default 3
}

export interface ExternalPressureResult {
  classification: 'long' | 'short';
  criticalPressureMpa: number;
  allowablePressureMpa: number;
  adequate: boolean;
  collapseMargin: number;      // allowable / design
  minWallForDesignMm: number;
  warnings: string[];
}

export function compute(input: ExternalPressureInput): ExternalPressureResult {
  const warnings: string[] = [];
  const D = input.outerDiameterMm;
  const t = input.wallThicknessMm;
  if (D <= 0 || t <= 0) warnings.push('Diameter and wall must be positive.');
  const nu = input.poisson ?? 0.3;
  const E = input.youngMpa;

  // Long vs short by L/D and D/t.
  const LD = input.lengthMm / D;
  const isLong = LD > 4; // beyond ~4 the long formula governs
  const classification: 'long' | 'short' = isLong ? 'long' : 'short';

  const longPc = (2 * E / (1 - nu * nu)) * Math.pow(t / D, 3);
  // Short-cylinder factor: stiffer, scale up by (1 + k/(L/D)) — simple boost.
  const shortFactor = isLong ? 1 : 1 + 2 / Math.max(0.5, LD);
  const Pc = longPc * shortFactor;

  const sf = input.safetyFactor ?? 3;
  const allowable = Pc / sf;
  const adequate = input.externalPressureMpa <= allowable;
  const margin = input.externalPressureMpa > 0 ? allowable / input.externalPressureMpa : Infinity;
  if (!adequate) warnings.push(`External pressure ${input.externalPressureMpa} MPa exceeds allowable ${allowable.toFixed(3)} MPa; increase wall or add stiffening rings.`);

  // Min wall for design (invert long formula at SF): t = D·(P·SF·(1−ν²)/(2E))^(1/3) / shortFactor^(1/3)
  const minWall = D * Math.pow((input.externalPressureMpa * sf * (1 - nu * nu)) / (2 * E * shortFactor), 1 / 3);

  return {
    classification,
    criticalPressureMpa: Pc,
    allowablePressureMpa: allowable,
    adequate,
    collapseMargin: margin,
    minWallForDesignMm: minWall,
    warnings,
  };
}

/** Critical collapse pressure for a long cylinder (MPa). */
export function longCylinderCollapseMpa(youngMpa: number, poisson: number, t: number, D: number): number {
  return (2 * youngMpa / (1 - poisson * poisson)) * Math.pow(t / D, 3);
}

export function summarize(r: ExternalPressureResult): { allowablePressureMpa: number; adequate: boolean; minWallForDesignMm: number } {
  return { allowablePressureMpa: r.allowablePressureMpa, adequate: r.adequate, minWallForDesignMm: r.minWallForDesignMm };
}
