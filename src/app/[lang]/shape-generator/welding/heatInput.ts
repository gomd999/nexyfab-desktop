/**
 * heatInput.ts — Arc-welding heat input and t8/5 cooling time (EN 1011-2).
 *
 *   HI [kJ/mm] = η · V · I · 60 / (v[mm/min] · 1000)
 *
 * Cooling time from 800→500 °C (t8/5) governs HAZ microstructure:
 *   3-D (thick): t8/5 = (6700 − 5·T0)·Q·(1/(500−T0) − 1/(800−T0))·F3
 *   2-D (thin):  t8/5 = (4300 − 4.3·T0)·1e5·(Q/d)²·(1/(500−T0)² − 1/(800−T0)²)·F2
 * with Q = HI [kJ/mm], T0 = preheat/interpass [°C], d = plate thickness [mm].
 * Transition thickness selects 2-D vs 3-D heat flow.
 */

export type WeldProcess = 'SAW' | 'GMAW' | 'FCAW' | 'SMAW' | 'GTAW';

const ARC_EFFICIENCY: Record<WeldProcess, number> = {
  SAW: 0.95, GMAW: 0.8, FCAW: 0.8, SMAW: 0.8, GTAW: 0.6,
};

export interface HeatInputInput {
  process: WeldProcess;
  voltageV: number;
  currentA: number;
  travelSpeedMmPerMin: number;
  plateThicknessMm: number;
  preheatTempC?: number;       // T0, interpass; default 20
  jointFactor?: number;        // F2/F3 shape factor; default 1 (bead-on-plate)
  efficiencyOverride?: number;
}

export interface HeatInputResult {
  arcEfficiency: number;
  heatInputKJPerMm: number;
  heatFlowMode: '2D' | '3D';
  transitionThicknessMm: number;
  t8_5Seconds: number;
  coolingRateCPerS: number;    // mean rate over 800→500 window
  warnings: string[];
}

export function compute(input: HeatInputInput): HeatInputResult {
  const warnings: string[] = [];
  const eta = input.efficiencyOverride ?? ARC_EFFICIENCY[input.process] ?? 0.8;
  const T0 = input.preheatTempC ?? 20;
  const F = input.jointFactor ?? 1;
  const d = input.plateThicknessMm;

  if (input.travelSpeedMmPerMin <= 0) warnings.push('Travel speed must be positive.');
  if (d <= 0) warnings.push('Plate thickness must be positive.');
  if (T0 >= 500) warnings.push('Preheat too high for a valid t8/5 estimate.');

  const v = input.travelSpeedMmPerMin > 0 ? input.travelSpeedMmPerMin : 1;
  const Q = (eta * input.voltageV * input.currentA * 60) / (v * 1000); // kJ/mm

  // Transition thickness where 2-D and 3-D give the same t8/5.
  const transition = Math.sqrt(
    Q * (1 / (500 - T0) + 1 / (800 - T0)) / (2 * (4300 - 4.3 * T0) / (6700 - 5 * T0) / 1e5)
  ) || 0;
  const mode: '2D' | '3D' = d <= transition ? '2D' : '3D';

  let t8_5: number;
  if (mode === '3D') {
    t8_5 = (6700 - 5 * T0) * Q * (1 / (500 - T0) - 1 / (800 - T0)) * F;
  } else {
    t8_5 = (4300 - 4.3 * T0) * 1e5 * Math.pow(Q / d, 2)
      * (1 / Math.pow(500 - T0, 2) - 1 / Math.pow(800 - T0, 2)) * F;
  }
  t8_5 = Math.max(t8_5, 0);

  const coolingRate = t8_5 > 0 ? 300 / t8_5 : Infinity;

  return {
    arcEfficiency: eta,
    heatInputKJPerMm: Q,
    heatFlowMode: mode,
    transitionThicknessMm: transition,
    t8_5Seconds: t8_5,
    coolingRateCPerS: coolingRate,
    warnings,
  };
}

/** Travel speed (mm/min) needed to hit a target heat input. */
export function travelSpeedForHeatInput(
  process: WeldProcess, voltageV: number, currentA: number, targetKJPerMm: number,
): number {
  const eta = ARC_EFFICIENCY[process] ?? 0.8;
  return targetKJPerMm > 0 ? (eta * voltageV * currentA * 60) / (targetKJPerMm * 1000) : Infinity;
}

export function summarize(r: HeatInputResult): {
  heatInputKJPerMm: number; t8_5Seconds: number; heatFlowMode: '2D' | '3D';
} {
  return { heatInputKJPerMm: r.heatInputKJPerMm, t8_5Seconds: r.t8_5Seconds, heatFlowMode: r.heatFlowMode };
}
