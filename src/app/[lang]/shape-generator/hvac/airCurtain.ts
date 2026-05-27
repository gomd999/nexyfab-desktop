/**
 * airCurtain.ts — Size a door air curtain: discharge velocity needed to
 * "seal" an opening against the stack/wind pressure, the airflow, and the
 * infiltration-reduction effectiveness.
 *
 * The jet must overcome the pressure difference across the door. A
 * deflection modulus / momentum criterion gives a required discharge
 * velocity ~ proportional to sqrt(ΔP) and door height:
 *
 *   v_jet ≈ K · sqrt(2·ΔP/ρ) · (H / nozzleWidth)^0.25
 *
 * Airflow = v_jet · nozzleArea. Effectiveness η (sealing) = 1 − leakage
 * fraction; well-sized curtains reach 0.7–0.9. We report the required
 * velocity, fan airflow, and the heat-loss reduction vs an open door.
 */

export interface AirCurtainInput {
  doorWidthMm: number;
  doorHeightMm: number;
  nozzleWidthMm: number;       // discharge slot width
  pressureDiffPa: number;      // stack + wind across the door
  airDensityKgM3?: number;     // default 1.2
  jetConstant?: number;        // K, default 1.2
  openDoorHeatLossKW?: number; // baseline loss with door fully open
}

export interface AirCurtainResult {
  requiredVelocityMS: number;
  nozzleAreaM2: number;
  airflowM3PerS: number;
  airflowM3PerH: number;
  sealingEffectiveness: number; // 0..1
  heatLossReductionKW: number | null;
  warnings: string[];
}

export function size(input: AirCurtainInput): AirCurtainResult {
  const warnings: string[] = [];
  const H = input.doorHeightMm / 1000;
  const W = input.doorWidthMm / 1000;
  const slot = input.nozzleWidthMm / 1000;
  if (H <= 0 || W <= 0) warnings.push('Door dimensions must be positive.');
  if (slot <= 0) warnings.push('Nozzle width must be positive.');

  const rho = input.airDensityKgM3 ?? 1.2;
  const K = input.jetConstant ?? 1.2;
  const dP = Math.max(0, input.pressureDiffPa);

  const baseVel = Math.sqrt((2 * dP) / rho);
  const heightFactor = slot > 0 ? Math.pow(H / slot, 0.25) : 1;
  const vJet = K * baseVel * heightFactor;

  const nozzleArea = W * slot;
  const airflow = vJet * nozzleArea;

  // Sealing effectiveness rises with jet momentum relative to ΔP; cap 0.9.
  // Simple model: η = 1 − 1/(1 + momentumRatio).
  const momentum = rho * vJet * vJet; // dynamic pressure of jet
  const momentumRatio = dP > 0 ? momentum / dP : 10;
  const effectiveness = Math.min(0.9, 1 - 1 / (1 + momentumRatio));

  let heatLossReduction: number | null = null;
  if (input.openDoorHeatLossKW != null) {
    heatLossReduction = input.openDoorHeatLossKW * effectiveness;
  }

  if (effectiveness < 0.5) warnings.push('Low sealing effectiveness — increase discharge velocity or reduce slot/height ratio.');

  return {
    requiredVelocityMS: vJet,
    nozzleAreaM2: nozzleArea,
    airflowM3PerS: airflow,
    airflowM3PerH: airflow * 3600,
    sealingEffectiveness: effectiveness,
    heatLossReductionKW: heatLossReduction,
    warnings,
  };
}

/** Fan power estimate (W) from airflow + discharge velocity (kinetic + duct). */
export function fanPowerW(result: AirCurtainResult, fanEfficiency = 0.5): number {
  // air power ≈ ½·ρ·A·v³ ; shaft = / efficiency.
  const rho = 1.2;
  const airPower = 0.5 * rho * result.nozzleAreaM2 * Math.pow(result.requiredVelocityMS, 3);
  return fanEfficiency > 0 ? airPower / fanEfficiency : airPower;
}

export function summarize(r: AirCurtainResult): { requiredVelocityMS: number; airflowM3PerH: number; sealingEffectiveness: number } {
  return { requiredVelocityMS: r.requiredVelocityMS, airflowM3PerH: r.airflowM3PerH, sealingEffectiveness: r.sealingEffectiveness };
}
