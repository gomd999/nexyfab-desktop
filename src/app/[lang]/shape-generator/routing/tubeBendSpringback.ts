/**
 * tubeBendSpringback.ts — Compute springback for rotary-draw tube
 * bending and the overbend / corrected centre-line radius (CLR) needed
 * to hit a target bend angle and radius.
 *
 * When a tube is bent to angle θ over a die of radius R, elastic recovery
 * springs it back to a larger radius R' and smaller angle θ'. The
 * springback ratio K_s relates them:
 *
 *   K_s = θ' / θ = R / R'   (constant-arc-length recovery)
 *
 * K_s derives from the elastic/plastic strain split. A common engineering
 * estimate uses the ratio of yield strain to bend strain:
 *
 *   1/K_s ≈ 4·(R·σ_y/(E·t))³ − 3·(R·σ_y/(E·t)) + 1
 *
 * (the classic pure-bending springback polynomial, with t the tube wall).
 * To hit a target, overbend: θ_die = θ_target / K_s, R_die = R_target·K_s.
 */

export interface TubeBendInput {
  centerlineRadiusMm: number; // target CLR (R)
  bendAngleDeg: number;       // target angle θ
  tubeODmm: number;
  wallThicknessMm: number;
  youngMpa: number;           // E
  yieldMpa: number;           // σ_y
}

export interface TubeBendResult {
  springbackRatio: number;    // K_s (θ'/θ), <1
  overbendAngleDeg: number;   // angle to bend to
  correctedDieRadiusMm: number;
  springbackAngleDeg: number; // amount of recovery
  wallFactorOk: boolean;      // R/OD ratio sanity
  warnings: string[];
}

export function compute(input: TubeBendInput): TubeBendResult {
  const warnings: string[] = [];
  const R = input.centerlineRadiusMm;
  const t = input.wallThicknessMm;
  if (R <= 0) warnings.push('Centerline radius must be positive.');
  if (t <= 0) warnings.push('Wall thickness must be positive.');
  if (input.youngMpa <= 0 || input.yieldMpa <= 0) warnings.push('E and σ_y must be positive.');

  // Use the tube radius to the neutral axis ≈ CLR for the strain term;
  // strain at the outer fibre = (OD/2) / R.
  const fibreDist = input.tubeODmm / 2;
  // m = R·σ_y/(E·c) where c = distance to outer fibre.
  const m = (R * input.yieldMpa) / (input.youngMpa * Math.max(1e-9, fibreDist));
  // Springback polynomial (pure bending): K_s = R_i/R_f = 4·m³ − 3·m + 1.
  // K_s < 1 (radius grows on release); larger m → smaller K_s → more springback.
  let Ks = 4 * m * m * m - 3 * m + 1;
  if (Ks > 1) Ks = 1;        // never spring-forward
  if (Ks < 0.01) Ks = 0.01;  // floor for very compliant cases

  const overbendAngle = input.bendAngleDeg / Ks;
  const correctedRadius = R * Ks;
  const springbackAngle = overbendAngle - input.bendAngleDeg;

  const rOverOd = R / Math.max(1e-9, input.tubeODmm);
  const wallFactorOk = rOverOd >= 1.5; // tight bends below 1.5×OD risk wrinkling/flattening
  if (!wallFactorOk) warnings.push(`CLR/OD = ${rOverOd.toFixed(2)} < 1.5; risk of flattening/wrinkling, use a mandrel.`);

  return {
    springbackRatio: Ks,
    overbendAngleDeg: overbendAngle,
    correctedDieRadiusMm: correctedRadius,
    springbackAngleDeg: springbackAngle,
    wallFactorOk,
    warnings,
  };
}

/** Developed (cut) length of straight + bent tube for a single bend. */
export function developedLength(straightBeforeMm: number, straightAfterMm: number, clrMm: number, bendAngleDeg: number): number {
  const arc = clrMm * (bendAngleDeg * Math.PI / 180);
  return straightBeforeMm + arc + straightAfterMm;
}

/** Higher yield or smaller radius → more springback (lower K_s). */
export function summarize(r: TubeBendResult): { springbackRatio: number; overbendAngleDeg: number; correctedDieRadiusMm: number } {
  return { springbackRatio: r.springbackRatio, overbendAngleDeg: r.overbendAngleDeg, correctedDieRadiusMm: r.correctedDieRadiusMm };
}
