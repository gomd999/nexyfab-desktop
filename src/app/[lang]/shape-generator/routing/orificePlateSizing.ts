/**
 * orificePlateSizing.ts — Size a concentric square-edged orifice plate
 * for flow measurement (ISO 5167) and compute flow from differential
 * pressure, or the bore needed for a target Δp.
 *
 * Mass flow:
 *   q_m = (C / sqrt(1 − β⁴)) · ε · (π/4)·d² · sqrt(2·Δp·ρ)
 *
 * where:
 *   β  = d/D  (bore / pipe ID)
 *   C  = discharge coefficient (Reader-Harris/Gallagher ≈ 0.6 for clean β)
 *   ε  = expansibility (1.0 for incompressible liquids)
 *   d  = orifice bore, D = pipe ID, ρ = density
 *
 * We also solve the inverse: bore d for a target Δp at design flow.
 */

export interface OrificeFlowInput {
  pipeInnerDiameterMm: number; // D
  boreDiameterMm: number;      // d
  differentialPressurePa: number; // Δp
  fluidDensityKgM3: number;
  dischargeCoefficient?: number;  // C, default 0.61
  expansibility?: number;         // ε, default 1.0 (liquid)
}

export interface OrificeFlowResult {
  beta: number;
  massFlowKgS: number;
  volumeFlowM3S: number;
  velocityThroughBoreMS: number;
  betaInValidRange: boolean;
  warnings: string[];
}

export function flowFromDp(input: OrificeFlowInput): OrificeFlowResult {
  const warnings: string[] = [];
  const D = input.pipeInnerDiameterMm;
  const d = input.boreDiameterMm;
  if (D <= 0 || d <= 0) warnings.push('Diameters must be positive.');
  if (d >= D) warnings.push('Bore must be smaller than pipe ID.');

  const beta = D > 0 ? d / D : 0;
  const C = input.dischargeCoefficient ?? 0.61;
  const eps = input.expansibility ?? 1.0;
  const rho = input.fluidDensityKgM3;
  const dp = Math.max(0, input.differentialPressurePa);

  const dM = d / 1000;
  const boreArea = (Math.PI / 4) * dM * dM;
  const beta4 = Math.pow(beta, 4);
  const denom = Math.sqrt(Math.max(1e-9, 1 - beta4));
  const qm = (C / denom) * eps * boreArea * Math.sqrt(2 * dp * rho); // kg/s
  const qv = rho > 0 ? qm / rho : 0;
  const velocity = boreArea > 0 ? qv / boreArea : 0;

  const betaOk = beta >= 0.2 && beta <= 0.75; // ISO 5167 typical valid range
  if (!betaOk) warnings.push(`β = ${beta.toFixed(2)} outside ISO 5167 valid 0.2–0.75 range.`);

  return {
    beta,
    massFlowKgS: qm,
    volumeFlowM3S: qv,
    velocityThroughBoreMS: velocity,
    betaInValidRange: betaOk,
    warnings,
  };
}

/** Solve bore diameter (mm) for a target Δp at a design mass flow. */
export function boreForFlow(
  pipeInnerDiameterMm: number,
  targetMassFlowKgS: number,
  differentialPressurePa: number,
  fluidDensityKgM3: number,
  dischargeCoefficient: number = 0.61,
): number {
  const D = pipeInnerDiameterMm;
  if (D <= 0 || differentialPressurePa <= 0 || fluidDensityKgM3 <= 0) return 0;
  // Iterate on β since C/√(1−β⁴) couples to β.
  let beta = 0.5;
  for (let i = 0; i < 50; i++) {
    const dM = (beta * D) / 1000;
    const boreArea = (Math.PI / 4) * dM * dM;
    const denom = Math.sqrt(Math.max(1e-9, 1 - Math.pow(beta, 4)));
    const qm = (dischargeCoefficient / denom) * boreArea * Math.sqrt(2 * differentialPressurePa * fluidDensityKgM3);
    // adjust beta proportional to sqrt(target/qm) on area (∝ d² ∝ β²)
    if (qm <= 0) break;
    const factor = Math.sqrt(targetMassFlowKgS / qm);
    beta = Math.max(0.05, Math.min(0.85, beta * Math.sqrt(factor)));
  }
  return beta * D;
}

/** Permanent pressure loss (a fraction of Δp, rises as β falls). */
export function permanentPressureLossPa(beta: number, differentialPressurePa: number): number {
  // ISO 5167 approx: ΔΩ/Δp ≈ (1 − β^1.9).
  const ratio = 1 - Math.pow(beta, 1.9);
  return ratio * differentialPressurePa;
}

export function summarize(r: OrificeFlowResult): { beta: number; massFlowKgS: number; betaInValidRange: boolean } {
  return { beta: r.beta, massFlowKgS: r.massFlowKgS, betaInValidRange: r.betaInValidRange };
}
