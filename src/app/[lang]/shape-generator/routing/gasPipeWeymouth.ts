/**
 * gasPipeWeymouth.ts — Compressible gas pipeline flow (Weymouth equation, USCS).
 *
 *   Q = 433.5 · E · (Tb/Pb) · [ (P1² − P2²) / (G · Tavg · L · Z) ]^0.5 · D^2.667
 *
 *   Q   = volumetric flow at base conditions [scf/day]
 *   Tb  = base temperature [°R]   (default 519.67 = 60 °F)
 *   Pb  = base pressure [psia]    (default 14.696)
 *   P1,P2 = inlet/outlet pressure [psia]
 *   G   = gas specific gravity (air = 1)
 *   Tavg = flowing temperature [°R]
 *   L   = pipe length [miles]
 *   Z   = compressibility factor
 *   D   = inside diameter [in]
 *   E   = pipeline efficiency (0.85–0.95 typical)
 */

export interface GasPipeInput {
  inletPressurePsia: number;
  outletPressurePsia: number;
  innerDiameterIn: number;
  lengthMiles: number;
  gasGravity: number;            // G (air = 1)
  flowingTempR?: number;         // Tavg, default 520
  compressibility?: number;      // Z, default 0.9
  efficiency?: number;           // E, default 0.92
  baseTempR?: number;            // Tb, default 519.67
  basePressurePsia?: number;     // Pb, default 14.696
}

export interface GasPipeResult {
  flowScfPerDay: number;
  flowMMscfPerDay: number;       // million scf/day
  pressureDropPsi: number;
  averageVelocityFtPerSec: number;
  erosionalVelocityFtPerSec: number;  // API RP 14E C/√ρ guide
  velocityOk: boolean;
  warnings: string[];
}

const TB_DEFAULT = 519.67;
const PB_DEFAULT = 14.696;

export function compute(input: GasPipeInput): GasPipeResult {
  const warnings: string[] = [];
  const Tb = input.baseTempR ?? TB_DEFAULT;
  const Pb = input.basePressurePsia ?? PB_DEFAULT;
  const Tavg = input.flowingTempR ?? 520;
  const Z = input.compressibility ?? 0.9;
  const E = input.efficiency ?? 0.92;
  const { inletPressurePsia: P1, outletPressurePsia: P2, innerDiameterIn: D, lengthMiles: L, gasGravity: G } = input;

  if (P2 >= P1) warnings.push('Outlet pressure must be below inlet pressure.');
  if (D <= 0 || L <= 0) warnings.push('Diameter and length must be positive.');
  if (G <= 0) warnings.push('Gas gravity must be positive.');

  const dp2 = P1 * P1 - P2 * P2;
  const flow = (dp2 > 0 && D > 0 && L > 0 && G > 0)
    ? 433.5 * E * (Tb / Pb) * Math.sqrt(dp2 / (G * Tavg * L * Z)) * Math.pow(D, 2.667)
    : 0;

  // Average velocity (ft/s) at mean pressure: q_actual = Q_b·(Pb/Pavg)·(Tavg/Tb)·Z
  const Pavg = (P1 + P2) / 2;
  const areaFt2 = (Math.PI / 4) * Math.pow(D / 12, 2);
  const qActualFt3PerSec = Pavg > 0
    ? (flow / 86400) * (Pb / Pavg) * (Tavg / Tb) * Z
    : 0;
  const velocity = areaFt2 > 0 ? qActualFt3PerSec / areaFt2 : 0;

  // Gas density at flowing conditions (lb/ft³): ρ = 2.7·G·P/(Z·T)
  const rho = 2.7 * G * Pavg / (Z * Tavg);
  const erosional = rho > 0 ? 100 / Math.sqrt(rho) : Infinity; // C = 100 (continuous service)
  const velocityOk = velocity <= erosional;
  if (!velocityOk) warnings.push('Velocity exceeds API RP 14E erosional limit.');

  return {
    flowScfPerDay: flow,
    flowMMscfPerDay: flow / 1e6,
    pressureDropPsi: P1 - P2,
    averageVelocityFtPerSec: velocity,
    erosionalVelocityFtPerSec: erosional,
    velocityOk,
    warnings,
  };
}

/** Inverse: inside diameter (in) needed to carry a target flow (scf/day). */
export function diameterForFlow(input: Omit<GasPipeInput, 'innerDiameterIn'>, targetScfPerDay: number): number {
  const Tb = input.baseTempR ?? TB_DEFAULT;
  const Pb = input.basePressurePsia ?? PB_DEFAULT;
  const Tavg = input.flowingTempR ?? 520;
  const Z = input.compressibility ?? 0.9;
  const E = input.efficiency ?? 0.92;
  const dp2 = input.inletPressurePsia ** 2 - input.outletPressurePsia ** 2;
  if (dp2 <= 0 || targetScfPerDay <= 0) return Infinity;
  const k = 433.5 * E * (Tb / Pb) * Math.sqrt(dp2 / (input.gasGravity * Tavg * input.lengthMiles * Z));
  return Math.pow(targetScfPerDay / k, 1 / 2.667);
}

export function summarize(r: GasPipeResult): { flowMMscfPerDay: number; velocityOk: boolean } {
  return { flowMMscfPerDay: r.flowMMscfPerDay, velocityOk: r.velocityOk };
}
