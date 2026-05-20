/**
 * machineHourRate.ts — Build up a machine's true hourly cost rate from
 * capital depreciation, energy, maintenance, floor space, and operator
 * labour, divided by productive (utilised) hours per year.
 *
 *   depreciationPerYr = (capital − salvage) / lifeYears
 *   capitalRate       = (depreciationPerYr + capital·interestRate) / annualHours
 *   energyRate        = connectedKW · loadFactor · energyPrice
 *   maintRate         = capital · maintFraction / annualHours
 *   spaceRate         = floorM2 · spaceCostPerM2Yr / annualHours
 *   total             = capital + energy + maint + space + labour·(1+burden)
 *
 * annualHours = shifts·hoursPerShift·daysPerYear·utilisation.
 */

export interface MachineHourRateInput {
  capitalCost: number;
  salvageValue?: number;
  lifeYears: number;
  interestRate?: number;        // capital cost of money, default 0.06
  connectedKW: number;
  loadFactor?: number;          // avg fraction of connected load, default 0.6
  energyPricePerKWh: number;
  maintFractionPerYr?: number;  // maintenance as fraction of capital/yr, default 0.05
  floorAreaM2?: number;
  spaceCostPerM2Yr?: number;
  operatorRatePerHour?: number;
  operatorBurden?: number;      // benefits overhead, default 0.3
  shiftsPerDay?: number;        // default 1
  hoursPerShift?: number;       // default 8
  daysPerYear?: number;         // default 240
  utilisation?: number;         // productive fraction, default 0.75
}

export interface MachineHourRateResult {
  annualProductiveHours: number;
  capitalRatePerHour: number;
  energyRatePerHour: number;
  maintenanceRatePerHour: number;
  spaceRatePerHour: number;
  labourRatePerHour: number;
  totalRatePerHour: number;
  warnings: string[];
}

export function compute(input: MachineHourRateInput): MachineHourRateResult {
  const warnings: string[] = [];
  if (input.capitalCost <= 0) warnings.push('Capital cost must be positive.');
  if (input.lifeYears <= 0) warnings.push('Life years must be positive.');

  const shifts = input.shiftsPerDay ?? 1;
  const hps = input.hoursPerShift ?? 8;
  const days = input.daysPerYear ?? 240;
  const util = input.utilisation ?? 0.75;
  const annualHours = Math.max(1, shifts * hps * days * util);

  const salvage = input.salvageValue ?? 0;
  const interest = input.interestRate ?? 0.06;
  const depreciationPerYr = (input.capitalCost - salvage) / input.lifeYears;
  const capitalRate = (depreciationPerYr + input.capitalCost * interest) / annualHours;

  const loadFactor = input.loadFactor ?? 0.6;
  const energyRate = input.connectedKW * loadFactor * input.energyPricePerKWh;

  const maintFrac = input.maintFractionPerYr ?? 0.05;
  const maintRate = (input.capitalCost * maintFrac) / annualHours;

  const spaceRate = (input.floorAreaM2 && input.spaceCostPerM2Yr)
    ? (input.floorAreaM2 * input.spaceCostPerM2Yr) / annualHours
    : 0;

  const burden = input.operatorBurden ?? 0.3;
  const labourRate = (input.operatorRatePerHour ?? 0) * (1 + burden);

  const total = capitalRate + energyRate + maintRate + spaceRate + labourRate;

  return {
    annualProductiveHours: annualHours,
    capitalRatePerHour: capitalRate,
    energyRatePerHour: energyRate,
    maintenanceRatePerHour: maintRate,
    spaceRatePerHour: spaceRate,
    labourRatePerHour: labourRate,
    totalRatePerHour: total,
    warnings,
  };
}

/** Each component's share of the total rate (for cost-driver analysis). */
export function rateBreakdown(r: MachineHourRateResult): { component: string; fraction: number }[] {
  const t = r.totalRatePerHour;
  if (t <= 0) return [];
  return [
    { component: 'capital', fraction: r.capitalRatePerHour / t },
    { component: 'energy', fraction: r.energyRatePerHour / t },
    { component: 'maintenance', fraction: r.maintenanceRatePerHour / t },
    { component: 'space', fraction: r.spaceRatePerHour / t },
    { component: 'labour', fraction: r.labourRatePerHour / t },
  ].sort((a, b) => b.fraction - a.fraction);
}

export function summarize(r: MachineHourRateResult): { totalRatePerHour: number; capitalRatePerHour: number; annualProductiveHours: number } {
  return { totalRatePerHour: r.totalRatePerHour, capitalRatePerHour: r.capitalRatePerHour, annualProductiveHours: r.annualProductiveHours };
}
