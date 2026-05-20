/**
 * jogBendDeveloper.ts — Develop the flat pattern for a "jog" (a.k.a.
 * joggle / Z-bend / offset bend): two opposite bends close together that
 * step the material to a parallel plane offset by a small amount.
 *
 * A jog is defined by:
 *   - offset height H (the step between the two parallel faces)
 *   - bend angle θ (each bend; for a square Z-bend θ = 90°)
 *   - inside radius r, material thickness t
 *
 * The flat length of the jogged region differs from the formed length
 * because of bend allowance at each of the two bends. We compute:
 *
 *   bend allowance per bend  BA = (θ_rad)·(r + K·t)   (K = neutral factor)
 *   web length between bends  Lw = H / sin(θ)
 *   flat addition = 2·BA + Lw_flat − formed projection
 *
 * Minimum jog offset: if H is too small relative to t the two bends
 * collide — the press brake can't form it (rule of thumb H ≥ ~2.5·t).
 */

export interface JogBendInput {
  offsetHeightMm: number;   // H
  bendAngleDeg?: number;    // θ per bend, default 90
  insideRadiusMm: number;   // r
  thicknessMm: number;      // t
  kFactor?: number;         // neutral-axis factor, default 0.42
  flangeBeforeMm: number;   // flat run before the jog
  flangeAfterMm: number;    // flat run after the jog
}

export interface JogBendResult {
  bendAllowancePerBendMm: number;
  webLengthMm: number;       // slanted web between the two bends (formed)
  flatLengthMm: number;      // total developed flat length
  formedLengthMm: number;    // length the part occupies when formed (along run)
  minOffsetMm: number;       // minimum formable offset
  formable: boolean;
  warnings: string[];
}

export function develop(input: JogBendInput): JogBendResult {
  const warnings: string[] = [];
  const t = input.thicknessMm;
  const r = input.insideRadiusMm;
  const H = input.offsetHeightMm;
  if (t <= 0) warnings.push('Thickness must be positive.');
  if (H <= 0) warnings.push('Offset height must be positive.');

  const thetaDeg = input.bendAngleDeg ?? 90;
  const theta = thetaDeg * Math.PI / 180;
  const K = input.kFactor ?? 0.42;

  const BA = theta * (r + K * t);
  const sinT = Math.sin(theta);
  const web = sinT > 1e-6 ? H / sinT : H;

  // Formed projection along the run direction = horizontal component of the web
  // (the part shifts laterally as it steps). cos component of the slanted web.
  const webHorizontal = web * Math.cos(theta);

  const flatLength = input.flangeBeforeMm + BA + web + BA + input.flangeAfterMm;
  const formedLength = input.flangeBeforeMm + webHorizontal + input.flangeAfterMm;

  const minOffset = 2.5 * t; // brake-tooling rule of thumb
  const formable = H >= minOffset - 1e-9;
  if (!formable) warnings.push(`Offset ${H} mm below minimum formable ~${minOffset.toFixed(2)} mm (bends collide).`);

  return {
    bendAllowancePerBendMm: BA,
    webLengthMm: web,
    flatLengthMm: flatLength,
    formedLengthMm: formedLength,
    minOffsetMm: minOffset,
    formable,
    warnings,
  };
}

/** Bend deduction equivalent (flat = sum of flanges − BD). */
export function bendDeduction(result: JogBendResult, input: JogBendInput): number {
  const outsideSetback = result.flatLengthMm - (input.flangeBeforeMm + input.flangeAfterMm + result.webLengthMm);
  // BD is the negative of the developed addition vs naive sum.
  return -outsideSetback;
}

/** Springback-adjusted target angle to hit a nominal formed angle. */
export function springbackCompensation(nominalAngleDeg: number, springbackFactor: number = 0.97): number {
  // overbend so that after springback the angle relaxes to nominal.
  return nominalAngleDeg / springbackFactor;
}

export function summarize(r: JogBendResult): { flatLengthMm: number; webLengthMm: number; formable: boolean } {
  return { flatLengthMm: r.flatLengthMm, webLengthMm: r.webLengthMm, formable: r.formable };
}
