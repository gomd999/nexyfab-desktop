/**
 * beltDriveTension.ts — Size a flat / V-belt drive: belt length, wrap
 * angle, tight/slack side tensions, and the power it can transmit.
 *
 * Centre distance C, pulley pitch diameters D1 (driver) and D2 (driven):
 *
 *   belt length (open drive):
 *     L = 2C + (π/2)(D1+D2) + (D2−D1)²/(4C)
 *   wrap angle on small pulley:
 *     θ = π − 2·asin((D2−D1)/(2C))
 *
 * Tension ratio (capstan / Euler, V-belt effective μ' = μ/sin(β/2)):
 *   T1/T2 = e^(μ'·θ)
 * Power: P = (T1 − T2)·v    (v = belt speed)
 * Centrifugal tension: Tc = m·v²   (m = belt mass per length)
 *
 * Effective pull (T1−T2) limited by the tension ratio at a given T1 max.
 */

export interface BeltDriveInput {
  driverDiameterMm: number;
  drivenDiameterMm: number;
  centreDistanceMm: number;
  driverRpm: number;
  frictionCoefficient: number;
  grooveAngleDeg?: number;       // V-belt included groove angle; omit for flat belt
  beltMassPerMeterKg?: number;   // for centrifugal tension
  maxTightTensionN?: number;     // belt rated max tension
}

export interface BeltDriveResult {
  beltLengthMm: number;
  wrapAngleSmallRad: number;
  beltSpeedMS: number;
  tensionRatio: number;
  drivenRpm: number;
  centrifugalTensionN: number;
  maxPowerW: number | null;      // if maxTightTension given
  warnings: string[];
}

export function compute(input: BeltDriveInput): BeltDriveResult {
  const warnings: string[] = [];
  const D1 = input.driverDiameterMm;
  const D2 = input.drivenDiameterMm;
  const C = input.centreDistanceMm;
  if (D1 <= 0 || D2 <= 0) warnings.push('Pulley diameters must be positive.');
  if (C <= 0) warnings.push('Centre distance must be positive.');

  const L = 2 * C + (Math.PI / 2) * (D1 + D2) + Math.pow(D2 - D1, 2) / (4 * C);

  // Wrap angle on the SMALL pulley.
  const small = Math.min(D1, D2);
  const large = Math.max(D1, D2);
  const wrapSmall = Math.PI - 2 * Math.asin(Math.max(-1, Math.min(1, (large - small) / (2 * C))));

  // Belt speed at driver pitch line.
  const v = (Math.PI * (D1 / 1000) * input.driverRpm) / 60; // m/s

  // Effective friction for V-belt.
  let muEff = input.frictionCoefficient;
  if (input.grooveAngleDeg != null && input.grooveAngleDeg > 0) {
    muEff = input.frictionCoefficient / Math.sin((input.grooveAngleDeg * Math.PI / 180) / 2);
  }
  const tensionRatio = Math.exp(muEff * wrapSmall);

  const drivenRpm = D2 > 0 ? input.driverRpm * (D1 / D2) : 0;

  const Tc = (input.beltMassPerMeterKg ?? 0) * v * v;

  let maxPower: number | null = null;
  if (input.maxTightTensionN != null) {
    // Usable tension at tight side after centrifugal: T1 − Tc.
    const T1eff = input.maxTightTensionN - Tc;
    if (T1eff > 0) {
      // T2 = T1eff / ratio ; effective pull = T1eff − T2
      const T2 = T1eff / tensionRatio;
      maxPower = (T1eff - T2) * v;
    } else {
      maxPower = 0;
      warnings.push('Centrifugal tension exceeds rated tight-side tension; belt overspeeded.');
    }
  }

  return {
    beltLengthMm: L,
    wrapAngleSmallRad: wrapSmall,
    beltSpeedMS: v,
    tensionRatio,
    drivenRpm,
    centrifugalTensionN: Tc,
    maxPowerW: maxPower,
    warnings,
  };
}

/** Required tight-side tension to transmit a target power. */
export function tightTensionForPowerN(result: BeltDriveResult, targetPowerW: number): number {
  if (result.beltSpeedMS <= 0 || result.tensionRatio <= 1) return Infinity;
  // P = (T1−T2)v, T2 = T1/r → P = T1(1−1/r)v → T1 = P / ((1−1/r)v) + Tc
  const T1eff = targetPowerW / ((1 - 1 / result.tensionRatio) * result.beltSpeedMS);
  return T1eff + result.centrifugalTensionN;
}

export function summarize(r: BeltDriveResult): { beltLengthMm: number; tensionRatio: number; drivenRpm: number } {
  return { beltLengthMm: r.beltLengthMm, tensionRatio: r.tensionRatio, drivenRpm: r.drivenRpm };
}
