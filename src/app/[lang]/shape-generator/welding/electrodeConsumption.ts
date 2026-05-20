/**
 * electrodeConsumption.ts — Estimate filler-metal consumption, arc time,
 * and consumable cost for a weld of given joint cross-section + length.
 *
 *   weldVolume   = jointAreaMm2 · lengthMm            [mm³]
 *   depositMassG = weldVolume · density · 1e-3        [g]  (density g/cm³)
 *   filler needed= depositMass / depositionEfficiency  (spatter/slag loss)
 *   arcTime      = depositMass / depositionRate        (kg/h → g/min)
 *   cost         = fillerMass·pricePerKg + arcTime·(power·kWhPrice) + labour
 *
 * Deposition efficiency by process: SMAW ≈ 0.6, GMAW ≈ 0.9, FCAW ≈ 0.85,
 * SAW ≈ 1.0 (flux recovered).
 */

export type WeldProcess = 'SMAW' | 'GMAW' | 'FCAW' | 'SAW' | 'GTAW';

const DEPOSITION_EFFICIENCY: Record<WeldProcess, number> = {
  SMAW: 0.6, GMAW: 0.9, FCAW: 0.85, SAW: 1.0, GTAW: 0.95,
};

export interface ElectrodeConsumptionInput {
  jointAreaMm2: number;        // weld cross-section (e.g. ½·leg² for fillet)
  weldLengthMm: number;
  process: WeldProcess;
  fillerDensityGcm3?: number;  // default 7.85 (steel)
  depositionRateKgH: number;   // process deposition rate
  fillerPricePerKg: number;
  labourRatePerHour?: number;
  operatingFactor?: number;    // arc-on duty fraction, default 0.4
}

export interface ElectrodeConsumptionResult {
  weldVolumeMm3: number;
  depositMassG: number;
  fillerMassG: number;         // incl. loss
  arcTimeMin: number;
  totalTimeMin: number;        // incl. operating factor
  fillerCost: number;
  labourCost: number;
  totalCost: number;
  warnings: string[];
}

export function estimate(input: ElectrodeConsumptionInput): ElectrodeConsumptionResult {
  const warnings: string[] = [];
  if (input.jointAreaMm2 <= 0) warnings.push('Joint area must be positive.');
  if (input.depositionRateKgH <= 0) warnings.push('Deposition rate must be positive.');

  const eff = DEPOSITION_EFFICIENCY[input.process] ?? 0.8;
  if (!DEPOSITION_EFFICIENCY[input.process]) warnings.push(`Unknown process "${input.process}".`);

  const density = input.fillerDensityGcm3 ?? 7.85; // g/cm³
  const weldVolume = input.jointAreaMm2 * input.weldLengthMm; // mm³
  const depositMassG = weldVolume * 1e-3 * density; // mm³→cm³ (÷1000) × g/cm³
  const fillerMassG = eff > 0 ? depositMassG / eff : depositMassG;

  // Arc time: deposit mass (g) / (rate kg/h → g/min = rate·1000/60).
  const ratePerMin = input.depositionRateKgH * 1000 / 60;
  const arcTimeMin = ratePerMin > 0 ? depositMassG / ratePerMin : 0;

  const opFactor = input.operatingFactor ?? 0.4;
  const totalTimeMin = opFactor > 0 ? arcTimeMin / opFactor : arcTimeMin;

  const fillerCost = (fillerMassG / 1000) * input.fillerPricePerKg;
  const labourCost = (totalTimeMin / 60) * (input.labourRatePerHour ?? 0);

  return {
    weldVolumeMm3: weldVolume,
    depositMassG,
    fillerMassG,
    arcTimeMin,
    totalTimeMin,
    fillerCost,
    labourCost,
    totalCost: fillerCost + labourCost,
    warnings,
  };
}

/** Fillet weld cross-section area from leg size (mm²). */
export function filletJointArea(legMm: number): number {
  return 0.5 * legMm * legMm;
}

/** Deposition efficiency for a process. */
export function depositionEfficiency(process: WeldProcess): number {
  return DEPOSITION_EFFICIENCY[process] ?? 0.8;
}

export function summarize(r: ElectrodeConsumptionResult): { fillerMassG: number; arcTimeMin: number; totalCost: number } {
  return { fillerMassG: r.fillerMassG, arcTimeMin: r.arcTimeMin, totalCost: r.totalCost };
}
