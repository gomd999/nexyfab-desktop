/**
 * injectionPressure.ts — Estimate injection-mold fill pressure from flow geometry.
 *
 *   flow-length ratio  FLR = flowLengthMm / wallThicknessMm
 *   fill pressure      P   ≈ C_material · FLR        [MPa]
 *
 * C_material packs melt viscosity (low-visc PP → low C, high-visc PC → high C).
 * Each polymer also has a practical max FLR; exceeding it risks a short shot.
 */

export type MoldPolymer = 'PP' | 'PE' | 'ABS' | 'PA66' | 'PC' | 'PMMA';

interface PolymerProps {
  pressureCoeff: number;   // MPa per unit FLR
  maxFlowRatio: number;    // practical L/t limit
}

const POLYMERS: Record<MoldPolymer, PolymerProps> = {
  PP:   { pressureCoeff: 0.15, maxFlowRatio: 280 },
  PE:   { pressureCoeff: 0.14, maxFlowRatio: 300 },
  ABS:  { pressureCoeff: 0.25, maxFlowRatio: 200 },
  PA66: { pressureCoeff: 0.22, maxFlowRatio: 220 },
  PC:   { pressureCoeff: 0.40, maxFlowRatio: 120 },
  PMMA: { pressureCoeff: 0.35, maxFlowRatio: 130 },
};

export interface InjectionPressureInput {
  polymer: MoldPolymer;
  flowLengthMm: number;          // longest flow path from gate
  wallThicknessMm: number;
  machineMaxPressureMPa?: number; // default 180
  thinWallFactor?: number;        // multiplier for thin walls < 1 mm, default auto
}

export interface InjectionPressureResult {
  flowLengthRatio: number;
  fillPressureMPa: number;
  maxFlowRatio: number;
  flowFeasible: boolean;         // FLR ≤ material max
  withinMachine: boolean;        // pressure ≤ machine max
  pressureMarginPct: number;     // headroom vs machine max
  warnings: string[];
}

export function compute(input: InjectionPressureInput): InjectionPressureResult {
  const warnings: string[] = [];
  const props = POLYMERS[input.polymer];
  if (!props) warnings.push(`Unknown polymer "${input.polymer}".`);
  const p = props ?? POLYMERS.PP;
  const machineMax = input.machineMaxPressureMPa ?? 180;

  if (input.wallThicknessMm <= 0) warnings.push('Wall thickness must be positive.');
  if (input.flowLengthMm <= 0) warnings.push('Flow length must be positive.');

  const flr = input.wallThicknessMm > 0 ? input.flowLengthMm / input.wallThicknessMm : Infinity;

  // Thin walls (< 1 mm) need disproportionately more pressure.
  const thinFactor = input.thinWallFactor
    ?? (input.wallThicknessMm < 1 ? 1 + (1 - input.wallThicknessMm) : 1);

  const pressure = p.pressureCoeff * flr * thinFactor;

  const flowFeasible = flr <= p.maxFlowRatio;
  if (!flowFeasible) warnings.push(`Flow-length ratio ${flr.toFixed(0)} exceeds ${input.polymer} limit ${p.maxFlowRatio}: short-shot risk.`);

  const withinMachine = pressure <= machineMax;
  if (!withinMachine) warnings.push(`Fill pressure ${pressure.toFixed(0)} MPa exceeds machine max ${machineMax} MPa.`);

  return {
    flowLengthRatio: flr,
    fillPressureMPa: pressure,
    maxFlowRatio: p.maxFlowRatio,
    flowFeasible,
    withinMachine,
    pressureMarginPct: machineMax > 0 ? (machineMax - pressure) / machineMax * 100 : 0,
    warnings,
  };
}

/** Minimum wall thickness (mm) to keep flow ratio within the material limit. */
export function minWallForFlow(polymer: MoldPolymer, flowLengthMm: number): number {
  const props = POLYMERS[polymer] ?? POLYMERS.PP;
  return props.maxFlowRatio > 0 ? flowLengthMm / props.maxFlowRatio : Infinity;
}

export function summarize(r: InjectionPressureResult): {
  fillPressureMPa: number; flowFeasible: boolean; withinMachine: boolean;
} {
  return { fillPressureMPa: r.fillPressureMPa, flowFeasible: r.flowFeasible, withinMachine: r.withinMachine };
}
