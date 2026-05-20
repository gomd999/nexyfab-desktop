/**
 * flatBeltSlip.ts — Flat-belt drive elastic creep + gross slip analysis.
 *
 * Two distinct speed losses:
 *  1. Elastic creep (always present): the belt stretches more on the
 *     tight side than the slack side, so it travels slightly slower than
 *     the driver. Creep ≈ (T1 − T2)/(A·E_belt).
 *  2. Gross slip (failure): occurs when the required tension ratio
 *     exceeds the capstan limit e^(μθ). Below that, no gross slip.
 *
 * We compute the creep speed loss %, the driven-pulley speed, and the
 * slip margin = capstan-limit ratio / required ratio.
 */

export interface FlatBeltSlipInput {
  tightTensionN: number;       // T1
  slackTensionN: number;       // T2
  beltCrossSectionMm2: number; // A
  beltModulusMpa: number;      // E_belt
  driverDiameterMm: number;
  drivenDiameterMm: number;
  driverRpm: number;
  wrapAngleRad: number;        // on the smaller pulley
  frictionCoefficient: number;
}

export interface FlatBeltSlipResult {
  tensionRatio: number;        // T1/T2
  capstanLimitRatio: number;   // e^(μθ)
  grossSlip: boolean;
  slipMargin: number;          // limit / required (>1 safe)
  creepLossPercent: number;
  idealDrivenRpm: number;
  actualDrivenRpm: number;     // after creep loss
  warnings: string[];
}

export function compute(input: FlatBeltSlipInput): FlatBeltSlipResult {
  const warnings: string[] = [];
  if (input.slackTensionN <= 0) warnings.push('Slack tension must be positive.');
  if (input.beltCrossSectionMm2 <= 0 || input.beltModulusMpa <= 0) warnings.push('Belt section + modulus must be positive.');

  const ratio = input.slackTensionN > 0 ? input.tightTensionN / input.slackTensionN : Infinity;
  const capstanLimit = Math.exp(input.frictionCoefficient * input.wrapAngleRad);
  const grossSlip = ratio > capstanLimit;
  const slipMargin = ratio > 0 ? capstanLimit / ratio : Infinity;
  if (grossSlip) warnings.push('Required tension ratio exceeds capstan limit — gross slip; increase preload or wrap angle.');

  // Elastic creep: speed loss ≈ (T1 − T2)/(A·E).
  const AE = input.beltCrossSectionMm2 * input.beltModulusMpa; // N
  const creep = AE > 0 ? (input.tightTensionN - input.slackTensionN) / AE : 0;
  const creepLossPercent = creep * 100;

  const idealDriven = input.drivenDiameterMm > 0
    ? input.driverRpm * (input.driverDiameterMm / input.drivenDiameterMm)
    : 0;
  const actualDriven = idealDriven * (1 - creep);

  return {
    tensionRatio: ratio,
    capstanLimitRatio: capstanLimit,
    grossSlip,
    slipMargin,
    creepLossPercent,
    idealDrivenRpm: idealDriven,
    actualDrivenRpm: actualDriven,
    warnings,
  };
}

/** Minimum slack tension to avoid gross slip for a given power demand. */
export function minSlackTensionN(powerW: number, beltSpeedMS: number, frictionCoefficient: number, wrapAngleRad: number): number {
  if (beltSpeedMS <= 0) return Infinity;
  const effectivePull = powerW / beltSpeedMS; // T1 − T2
  const r = Math.exp(frictionCoefficient * wrapAngleRad);
  // T1 − T2 = effectivePull, T1 = r·T2 → T2(r−1) = pull → T2 = pull/(r−1)
  return r > 1 ? effectivePull / (r - 1) : Infinity;
}

export function summarize(r: FlatBeltSlipResult): { grossSlip: boolean; slipMargin: number; creepLossPercent: number } {
  return { grossSlip: r.grossSlip, slipMargin: r.slipMargin, creepLossPercent: r.creepLossPercent };
}
