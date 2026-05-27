/**
 * weldJointCost.ts — Estimate the cost of a welded joint from its groove
 * cross-section (deposited weld volume), travel speed, and consumable +
 * labour rates. Complements electrodeConsumption with a groove-geometry
 * front end (V / bevel / fillet).
 *
 *   grooveArea  = f(jointType, thickness, gap, angle)        [mm²]
 *   weldVolume  = grooveArea · length                         [mm³]
 *   depositMass = volume · density · 1e-3 / efficiency        [g]
 *   weldTime    = length / travelSpeed                         [min]
 *   cost = depositMass/1000·fillerPrice + weldTime/60·(labour+power)
 */

export type JointType = 'fillet' | 'single-V' | 'double-V' | 'single-bevel' | 'square-butt';

export interface WeldJointCostInput {
  jointType: JointType;
  thicknessMm: number;
  lengthMm: number;
  legOrGapMm?: number;          // fillet leg, or root gap for grooves
  grooveAngleDeg?: number;      // included angle for V/bevel, default 60
  travelSpeedMmMin: number;
  fillerDensityGcm3?: number;   // default 7.85
  depositionEfficiency?: number;// default 0.85
  fillerPricePerKg: number;
  labourRatePerHour: number;
  passes?: number;              // multi-pass multiplier on volume cap
}

export interface WeldJointCostResult {
  grooveAreaMm2: number;
  weldVolumeMm3: number;
  depositMassG: number;
  weldTimeMin: number;
  fillerCost: number;
  labourCost: number;
  totalCost: number;
  warnings: string[];
}

export function estimate(input: WeldJointCostInput): WeldJointCostResult {
  const warnings: string[] = [];
  if (input.thicknessMm <= 0) warnings.push('Thickness must be positive.');
  if (input.travelSpeedMmMin <= 0) warnings.push('Travel speed must be positive.');

  const area = grooveArea(input);
  const volume = area * input.lengthMm;

  const density = input.fillerDensityGcm3 ?? 7.85;
  const eff = input.depositionEfficiency ?? 0.85;
  const depositMass = (volume * 1e-3 * density) / eff;

  const weldTime = input.travelSpeedMmMin > 0 ? input.lengthMm / input.travelSpeedMmMin : 0;
  // multi-pass increases time roughly with passes (volume already full).
  const passes = Math.max(1, input.passes ?? 1);
  const totalWeldTime = weldTime * passes;

  const fillerCost = (depositMass / 1000) * input.fillerPricePerKg;
  const labourCost = (totalWeldTime / 60) * input.labourRatePerHour;

  return {
    grooveAreaMm2: area,
    weldVolumeMm3: volume,
    depositMassG: depositMass,
    weldTimeMin: totalWeldTime,
    fillerCost,
    labourCost,
    totalCost: fillerCost + labourCost,
    warnings,
  };
}

/** Cross-section area of the weld for a joint type (mm²). */
export function grooveArea(input: Pick<WeldJointCostInput, 'jointType' | 'thicknessMm' | 'legOrGapMm' | 'grooveAngleDeg'>): number {
  const t = input.thicknessMm;
  const gap = input.legOrGapMm ?? 2;
  const halfAngle = ((input.grooveAngleDeg ?? 60) / 2) * Math.PI / 180;
  switch (input.jointType) {
    case 'fillet': {
      const leg = input.legOrGapMm ?? t; // leg ≈ thickness if not given
      return 0.5 * leg * leg;
    }
    case 'square-butt':
      return t * gap;
    case 'single-V':
      // triangle of width t·tan(half)·2 at top + root gap rectangle
      return t * t * Math.tan(halfAngle) + t * gap;
    case 'double-V':
      return 0.5 * (t * t * Math.tan(halfAngle)) + t * gap;
    case 'single-bevel':
      return 0.5 * t * t * Math.tan(halfAngle) + t * gap;
  }
}

export function summarize(r: WeldJointCostResult): { totalCost: number; depositMassG: number; weldTimeMin: number } {
  return { totalCost: r.totalCost, depositMassG: r.depositMassG, weldTimeMin: r.weldTimeMin };
}
