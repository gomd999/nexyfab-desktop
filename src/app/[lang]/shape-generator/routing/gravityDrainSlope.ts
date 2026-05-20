/**
 * gravityDrainSlope.ts — Open-channel / partially-full circular pipe flow
 * by Manning's equation, for gravity drains and sewers.
 *
 *   Q = (1/n) · A · R^(2/3) · S^(1/2)        [m³/s]
 *
 * where n = Manning roughness, A = flow area, R = hydraulic radius (A/P),
 * S = slope (m/m). For a circular pipe partially full at depth ratio
 * d/D (= y), A and P come from the circular-segment geometry via the
 * fill angle θ:
 *
 *   θ = 2·acos(1 − 2y)
 *   A = (D²/8)(θ − sinθ),  P = D·θ/2
 *
 * We compute Q at a given fill, the velocity (self-cleansing ≥ 0.6 m/s),
 * and solve the slope needed for a target full-bore flow.
 */

export interface GravityDrainInput {
  diameterMm: number;
  slope: number;               // m/m (e.g. 0.01 = 1%)
  manningN?: number;           // default 0.013 (concrete/PVC)
  fillRatio?: number;          // d/D, default 1 (full bore... use 0.93 for max Q)
}

export interface GravityDrainResult {
  flowAreaM2: number;
  hydraulicRadiusM: number;
  flowM3S: number;
  flowLPerS: number;
  velocityMS: number;
  selfCleansing: boolean;      // velocity ≥ 0.6 m/s
  warnings: string[];
}

export function compute(input: GravityDrainInput): GravityDrainResult {
  const warnings: string[] = [];
  const D = input.diameterMm / 1000; // m
  if (D <= 0) warnings.push('Diameter must be positive.');
  if (input.slope <= 0) warnings.push('Slope must be positive (gravity flow).');
  const n = input.manningN ?? 0.013;
  const y = Math.max(0.001, Math.min(1, input.fillRatio ?? 0.93));

  // Fill angle.
  const theta = 2 * Math.acos(1 - 2 * y); // radians
  const A = (D * D / 8) * (theta - Math.sin(theta));
  const P = (D * theta) / 2;
  const R = P > 0 ? A / P : 0;

  const Q = n > 0 ? (1 / n) * A * Math.pow(R, 2 / 3) * Math.sqrt(input.slope) : 0;
  const v = A > 0 ? Q / A : 0;

  const selfCleansing = v >= 0.6;
  if (!selfCleansing && Q > 0) warnings.push(`Velocity ${v.toFixed(2)} m/s < 0.6 m/s self-cleansing — risk of siltation; steepen slope.`);

  return {
    flowAreaM2: A,
    hydraulicRadiusM: R,
    flowM3S: Q,
    flowLPerS: Q * 1000,
    velocityMS: v,
    selfCleansing,
    warnings,
  };
}

/** Slope required to carry a target flow at a given fill ratio. */
export function slopeForFlow(diameterMm: number, targetFlowM3S: number, manningN = 0.013, fillRatio = 0.93): number {
  const D = diameterMm / 1000;
  const y = Math.max(0.001, Math.min(1, fillRatio));
  const theta = 2 * Math.acos(1 - 2 * y);
  const A = (D * D / 8) * (theta - Math.sin(theta));
  const P = (D * theta) / 2;
  const R = P > 0 ? A / P : 0;
  // Q = (1/n)·A·R^(2/3)·√S → S = (Q·n / (A·R^(2/3)))²
  const denom = A * Math.pow(R, 2 / 3);
  if (denom <= 0) return Infinity;
  return Math.pow((targetFlowM3S * manningN) / denom, 2);
}

/** Full-bore capacity (m³/s) at a slope. */
export function fullBoreFlow(diameterMm: number, slope: number, manningN = 0.013): number {
  return compute({ diameterMm, slope, manningN, fillRatio: 1 }).flowM3S;
}

export function summarize(r: GravityDrainResult): { flowLPerS: number; velocityMS: number; selfCleansing: boolean } {
  return { flowLPerS: r.flowLPerS, velocityMS: r.velocityMS, selfCleansing: r.selfCleansing };
}
