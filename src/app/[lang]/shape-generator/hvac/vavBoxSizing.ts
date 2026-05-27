/**
 * vavBoxSizing.ts — Size a VAV (variable-air-volume) terminal box: pick
 * the inlet size from max airflow + velocity limit, check minimum
 * turndown airflow against the box's controllable minimum, and compute
 * the inlet velocity pressure (for the velocity-sensor signal).
 *
 *   inletArea = maxFlow / maxInletVelocity
 *   inletDia  = sqrt(4·A/π)
 *   velocityPressure Pv = 0.5·ρ·V²
 *
 * VAV boxes have a controllable minimum velocity (~1.5–2 m/s for accurate
 * flow sensing). If the design minimum flow falls below that velocity in
 * the chosen inlet, the box can't control it — step down a size.
 */

// Standard round VAV inlet sizes (mm).
const INLET_SIZES_MM = [100, 125, 150, 200, 250, 300, 350, 400];

export interface VavBoxInput {
  maxFlowM3PerS: number;
  minFlowM3PerS: number;
  maxInletVelocityMS?: number;   // default 5
  minControllableVelocityMS?: number; // default 1.5
  airDensityKgM3?: number;       // default 1.2
}

export interface VavBoxResult {
  selectedInletMm: number | null;
  inletAreaM2: number;
  maxVelocityMS: number;
  minVelocityMS: number;
  maxVelocityPressurePa: number;
  controllableAtMin: boolean;
  turndownRatio: number;
  warnings: string[];
}

export function size(input: VavBoxInput): VavBoxResult {
  const warnings: string[] = [];
  if (input.maxFlowM3PerS <= 0) warnings.push('Max flow must be positive.');
  if (input.minFlowM3PerS < 0) warnings.push('Min flow must be non-negative.');
  if (input.minFlowM3PerS > input.maxFlowM3PerS) warnings.push('Min flow exceeds max flow.');

  const vMax = input.maxInletVelocityMS ?? 5;
  const vMinCtrl = input.minControllableVelocityMS ?? 1.5;
  const rho = input.airDensityKgM3 ?? 1.2;

  // Smallest inlet whose max-flow velocity ≤ limit.
  let selected: number | null = null;
  for (const dia of INLET_SIZES_MM) {
    const area = (Math.PI / 4) * Math.pow(dia / 1000, 2);
    if (input.maxFlowM3PerS / area <= vMax) { selected = dia; break; }
  }
  if (!selected) {
    warnings.push('Max flow exceeds largest inlet at the velocity limit; use a larger/duplex box.');
    selected = INLET_SIZES_MM[INLET_SIZES_MM.length - 1]!;
  }

  const area = (Math.PI / 4) * Math.pow(selected / 1000, 2);
  const vMaxActual = input.maxFlowM3PerS / area;
  const vMinActual = input.minFlowM3PerS / area;
  const pvMax = 0.5 * rho * vMaxActual * vMaxActual;

  const controllableAtMin = vMinActual >= vMinCtrl || input.minFlowM3PerS === 0;
  if (!controllableAtMin) warnings.push(`Min-flow velocity ${vMinActual.toFixed(2)} m/s < controllable ${vMinCtrl} m/s; step down inlet size.`);

  const turndown = input.minFlowM3PerS > 0 ? input.maxFlowM3PerS / input.minFlowM3PerS : Infinity;

  return {
    selectedInletMm: selected,
    inletAreaM2: area,
    maxVelocityMS: vMaxActual,
    minVelocityMS: vMinActual,
    maxVelocityPressurePa: pvMax,
    controllableAtMin,
    turndownRatio: turndown,
    warnings,
  };
}

/** Reheat coil load for a VAV box at minimum flow (sensible). */
export function reheatLoadKW(minFlowM3PerS: number, supplyTempC: number, roomSetpointC: number, airDensityKgM3: number = 1.2): number {
  const mdot = minFlowM3PerS * airDensityKgM3;
  return mdot * 1.006 * (roomSetpointC - supplyTempC);
}

export function summarize(r: VavBoxResult): { selectedInletMm: number | null; maxVelocityMS: number; controllableAtMin: boolean } {
  return { selectedInletMm: r.selectedInletMm, maxVelocityMS: r.maxVelocityMS, controllableAtMin: r.controllableAtMin };
}
