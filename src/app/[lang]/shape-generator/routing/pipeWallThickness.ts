/**
 * pipeWallThickness.ts — Compute the minimum pressure-design wall
 * thickness of a pipe per ASME B31.3 (process piping), then add
 * mechanical/corrosion allowances and pick the next schedule.
 *
 * B31.3 thin-wall formula (t < D/6):
 *   t = P·D / (2·(S·E·W + P·Y))
 *
 * where:
 *   P = internal design pressure
 *   D = outside diameter
 *   S = allowable stress at temperature
 *   E = quality (weld joint) factor
 *   W = weld strength reduction factor
 *   Y = temperature coefficient (0.4 for ferritic < 482 °C)
 *
 * Required ordered thickness:  t_m = t + c   (c = corrosion + thread/groove allowance)
 * then divided by (1 − mill tolerance, e.g. 12.5 %) to get the nominal
 * wall to order:  t_order = t_m / (1 − millTol).
 */

export interface PipeWallInput {
  designPressureMpa: number;
  outerDiameterMm: number;
  allowableStressMpa: number;   // S
  jointFactor?: number;         // E, default 1.0 (seamless)
  weldReductionFactor?: number; // W, default 1.0
  yCoefficient?: number;        // Y, default 0.4
  corrosionAllowanceMm?: number;// c, default 1.5
  millTolerancePercent?: number;// default 12.5
}

export interface PipeWallResult {
  pressureThicknessMm: number;  // t (pressure only)
  minRequiredThicknessMm: number; // t_m = t + c
  orderThicknessMm: number;     // accounting for mill tolerance
  thinWallValid: boolean;       // t < D/6 check
  hoopStressAtNominalMpa: (nominalWallMm: number) => number;
  warnings: string[];
}

export function compute(input: PipeWallInput): PipeWallResult {
  const warnings: string[] = [];
  const P = input.designPressureMpa;
  const D = input.outerDiameterMm;
  const S = input.allowableStressMpa;
  if (P <= 0) warnings.push('Design pressure must be positive.');
  if (D <= 0) warnings.push('Outer diameter must be positive.');
  if (S <= 0) warnings.push('Allowable stress must be positive.');

  const E = input.jointFactor ?? 1.0;
  const W = input.weldReductionFactor ?? 1.0;
  const Y = input.yCoefficient ?? 0.4;
  const c = input.corrosionAllowanceMm ?? 1.5;
  const millTol = (input.millTolerancePercent ?? 12.5) / 100;

  const denom = 2 * (S * E * W + P * Y);
  const t = denom > 0 ? (P * D) / denom : 0;

  const tm = t + c;
  const tOrder = millTol < 1 ? tm / (1 - millTol) : tm;

  const thinWallValid = t < D / 6;
  if (!thinWallValid) warnings.push('t ≥ D/6: thin-wall formula not valid; use thick-wall (Lamé) design.');

  // Hoop stress at an as-built nominal wall (Barlow): σ = P·D / (2·t).
  const hoopStressAtNominalMpa = (nominalWallMm: number) =>
    nominalWallMm > 0 ? (P * D) / (2 * nominalWallMm) : Infinity;

  return {
    pressureThicknessMm: t,
    minRequiredThicknessMm: tm,
    orderThicknessMm: tOrder,
    thinWallValid,
    hoopStressAtNominalMpa,
    warnings,
  };
}

/** Maximum allowable working pressure (MAWP) for a given nominal wall. */
export function mawpMpa(input: PipeWallInput, nominalWallMm: number): number {
  const S = input.allowableStressMpa;
  const D = input.outerDiameterMm;
  const E = input.jointFactor ?? 1.0;
  const W = input.weldReductionFactor ?? 1.0;
  const Y = input.yCoefficient ?? 0.4;
  const c = input.corrosionAllowanceMm ?? 1.5;
  const tAvail = nominalWallMm * (1 - (input.millTolerancePercent ?? 12.5) / 100) - c;
  if (tAvail <= 0) return 0;
  // invert t = PD/(2(SEW+PY)) → P = 2·t·S·E·W / (D − 2·t·Y)
  const num = 2 * tAvail * S * E * W;
  const den = D - 2 * tAvail * Y;
  return den > 0 ? num / den : 0;
}

export function summarize(r: PipeWallResult): { pressureThicknessMm: number; orderThicknessMm: number; thinWallValid: boolean } {
  return { pressureThicknessMm: r.pressureThicknessMm, orderThicknessMm: r.orderThicknessMm, thinWallValid: r.thinWallValid };
}
