/**
 * hydraulicPressureDrop.ts — Pressure-drop calculations for hydraulic
 * systems built from fittings + pipe.
 *
 * Engineers sizing a hydraulic line need to know: given pipe length,
 * inner diameter, flow rate, viscosity, and the fittings in between,
 * what's the total pressure drop? Too high and the pump can't deliver
 * the design flow; too low and the line is over-spec'd (cost waste).
 *
 * Two regimes:
 *
 *   - **Laminar** (Re < 2300): ΔP = (32·μ·L·V) / D²
 *   - **Turbulent** (Re ≥ 4000): Darcy-Weisbach formula
 *       ΔP = f · (L/D) · (ρ·V²/2)
 *     friction factor f computed by Swamee-Jain explicit formula.
 *   - Transition zone (2300 ≤ Re < 4000): linear interpolation between.
 *
 * Fitting losses use the equivalent length (Le/D) method, with K
 * factors for each common shape (elbow 30 / tee 60 / valve 340 etc).
 */

export type FluidState = 'laminar' | 'transitional' | 'turbulent';

export interface FluidProperties {
  /** Density (kg/m³). */
  densityKgM3: number;
  /** Dynamic viscosity (Pa·s). */
  viscosityPaS: number;
}

/** Common hydraulic fluids. */
export const FLUID_PRESETS: Record<string, FluidProperties> = {
  // ISO VG 46 hydraulic oil at 40 °C — most common.
  'iso-vg-46-40c': { densityKgM3: 875, viscosityPaS: 0.040 },
  'iso-vg-32-40c': { densityKgM3: 870, viscosityPaS: 0.029 },
  'iso-vg-68-40c': { densityKgM3: 880, viscosityPaS: 0.060 },
  'water-20c': { densityKgM3: 998, viscosityPaS: 0.001 },
  'air-20c-7bar': { densityKgM3: 8.4, viscosityPaS: 1.8e-5 },
};

/** K factor for typical hydraulic / pneumatic fittings. */
export const FITTING_K: Record<string, number> = {
  'straight':       0.05,
  'elbow-90-sharp': 1.5,
  'elbow-90-radius': 0.75,
  'elbow-45':       0.4,
  'tee-flow-through': 0.6,
  'tee-branch':     1.8,
  'reducer':        0.2,
  'gate-valve-open': 0.15,
  'ball-valve-open': 0.05,
  'check-valve':    2.0,
  'globe-valve':    10.0,
  'flange':         0.04,
  'cap':            0.0,
};

export interface ReynoldsResult {
  reynolds: number;
  state: FluidState;
  /** Bulk velocity (m/s). */
  velocityMs: number;
}

/** Reynolds number: Re = ρVD/μ. */
export function reynolds(
  flowLpm: number,
  innerDiameterMm: number,
  fluid: FluidProperties,
): ReynoldsResult {
  if (innerDiameterMm <= 0 || flowLpm <= 0) {
    return { reynolds: 0, state: 'laminar', velocityMs: 0 };
  }
  const dM = innerDiameterMm / 1000;
  const qM3PerS = flowLpm / 60_000;
  const area = Math.PI * dM * dM / 4;
  const velocity = qM3PerS / area;
  const re = (fluid.densityKgM3 * velocity * dM) / fluid.viscosityPaS;
  let state: FluidState;
  if (re < 2300) state = 'laminar';
  else if (re < 4000) state = 'transitional';
  else state = 'turbulent';
  return { reynolds: re, state, velocityMs: velocity };
}

/** Swamee-Jain explicit friction-factor formula for turbulent flow. */
export function swameeJainFriction(reynolds: number, relativeRoughness: number): number {
  if (reynolds < 1) return 0;
  const term = relativeRoughness / 3.7 + 5.74 / Math.pow(reynolds, 0.9);
  return 0.25 / Math.pow(Math.log10(term), 2);
}

/** Friction factor across all regimes. */
export function frictionFactor(reynolds: number, relativeRoughness: number): number {
  if (reynolds < 2300) {
    // Laminar — independent of roughness.
    return 64 / Math.max(1, reynolds);
  }
  if (reynolds < 4000) {
    const fLam = 64 / reynolds;
    const fTurb = swameeJainFriction(4000, relativeRoughness);
    const t = (reynolds - 2300) / 1700;
    return fLam * (1 - t) + fTurb * t;
  }
  return swameeJainFriction(reynolds, relativeRoughness);
}

export interface PipeSegment {
  /** Inner diameter (mm). */
  innerDiameterMm: number;
  /** Length (m). */
  lengthM: number;
  /** Absolute roughness (mm). Default: 0.0015 (smooth drawn steel). */
  roughnessMm?: number;
}

export interface FittingSegment {
  /** Type key into FITTING_K. */
  type: string;
  /** Quantity. */
  count: number;
  /** Bore (mm) used for the local velocity calc. */
  boreMm: number;
}

export interface PressureDropResult {
  /** Total pressure drop (bar). */
  pressureDropBar: number;
  /** Per-segment breakdown. */
  pipeDropBar: number;
  fittingDropBar: number;
  /** Detailed list of segments and their losses. */
  pipeDetails: Array<{
    re: number;
    state: FluidState;
    velocityMs: number;
    frictionFactor: number;
    dropBar: number;
  }>;
  fittingDetails: Array<{
    type: string;
    k: number;
    count: number;
    dropBar: number;
  }>;
}

/** Compute total pressure drop through a chain of pipes + fittings. */
export function pressureDrop(
  pipes: PipeSegment[],
  fittings: FittingSegment[],
  flowLpm: number,
  fluid: FluidProperties,
): PressureDropResult {
  let pipeDrop = 0;
  let fittingDrop = 0;
  const pipeDetails: PressureDropResult['pipeDetails'] = [];
  const fittingDetails: PressureDropResult['fittingDetails'] = [];

  for (const p of pipes) {
    const re = reynolds(flowLpm, p.innerDiameterMm, fluid);
    const rough = (p.roughnessMm ?? 0.0015) / Math.max(0.001, p.innerDiameterMm);
    const f = frictionFactor(re.reynolds, rough);
    const dM = p.innerDiameterMm / 1000;
    // Darcy-Weisbach: ΔP = f · (L/D) · ρV²/2  (Pa)
    const dropPa = f * (p.lengthM / dM) * (fluid.densityKgM3 * re.velocityMs * re.velocityMs / 2);
    const dropBar = dropPa / 100_000;
    pipeDrop += dropBar;
    pipeDetails.push({
      re: re.reynolds,
      state: re.state,
      velocityMs: re.velocityMs,
      frictionFactor: f,
      dropBar,
    });
  }

  for (const f of fittings) {
    const k = FITTING_K[f.type] ?? 0;
    const v = reynolds(flowLpm, f.boreMm, fluid).velocityMs;
    // Minor loss: ΔP = K · ρV²/2  (Pa)
    const dropPa = k * (fluid.densityKgM3 * v * v / 2) * f.count;
    const dropBar = dropPa / 100_000;
    fittingDrop += dropBar;
    fittingDetails.push({ type: f.type, k, count: f.count, dropBar });
  }

  return {
    pressureDropBar: pipeDrop + fittingDrop,
    pipeDropBar: pipeDrop,
    fittingDropBar: fittingDrop,
    pipeDetails,
    fittingDetails,
  };
}

/** Convenience: target velocity sizing — pick the smallest standard
 *  bore that keeps velocity under the recommendation:
 *    - suction:  ≤ 1.5 m/s
 *    - return:   ≤ 3.0 m/s
 *    - pressure: ≤ 6.0 m/s */
const STANDARD_BORES_MM = [4, 6, 8, 10, 12, 16, 19, 25, 32, 38, 50];

export function suggestBore(
  flowLpm: number,
  lineType: 'suction' | 'return' | 'pressure',
): number {
  const target = lineType === 'suction' ? 1.5 : lineType === 'return' ? 3.0 : 6.0;
  for (const b of STANDARD_BORES_MM) {
    const r = reynolds(flowLpm, b, { densityKgM3: 875, viscosityPaS: 0.040 });
    if (r.velocityMs <= target) return b;
  }
  return STANDARD_BORES_MM[STANDARD_BORES_MM.length - 1]!;
}
