/**
 * campbellDiagram.ts — Build a Campbell (interference) diagram: plot a
 * rotating system's natural frequencies against running speed and find
 * where excitation-order lines (n× rpm) cross them — the critical speeds.
 *
 * Excitation frequency of order k at speed N (rpm):  f_k = k · N/60  [Hz]
 * A resonance (critical speed) occurs where f_k = f_natural_m.
 * Solving for the crossing speed:  N_crit = 60 · f_m / k  [rpm]
 *
 * Natural frequencies may rise with speed (gyroscopic stiffening); we
 * accept either constant modes or a linear speed dependence
 * f_m(N) = f0_m + slope_m·N, and solve the crossing numerically.
 */

export interface NaturalMode {
  id: string;
  baseFreqHz: number;       // f0 at zero speed
  speedSlopeHzPerRpm?: number; // gyroscopic stiffening (default 0)
}

export interface CampbellInput {
  modes: NaturalMode[];
  excitationOrders: number[]; // e.g. [1, 2, 3] or blade-pass count
  maxSpeedRpm: number;
  operatingRpm?: number;      // flag criticals near operating speed
}

export interface CriticalCrossing {
  modeId: string;
  order: number;
  speedRpm: number;
  frequencyHz: number;
  nearOperating: boolean;
}

export interface CampbellResult {
  crossings: CriticalCrossing[];
  operatingMarginRpm: number | null; // distance to nearest critical
  warnings: string[];
}

export function compute(input: CampbellInput): CampbellResult {
  const warnings: string[] = [];
  if (input.modes.length === 0) warnings.push('No natural modes provided.');
  if (input.excitationOrders.length === 0) warnings.push('No excitation orders provided.');

  const crossings: CriticalCrossing[] = [];
  for (const mode of input.modes) {
    const slope = mode.speedSlopeHzPerRpm ?? 0;
    for (const k of input.excitationOrders) {
      // f_k(N) = k·N/60 ; f_m(N) = f0 + slope·N. Crossing: k·N/60 = f0 + slope·N
      // N·(k/60 − slope) = f0  →  N = f0 / (k/60 − slope)
      const denom = k / 60 - slope;
      if (Math.abs(denom) < 1e-12) continue;
      const N = mode.baseFreqHz / denom;
      if (N <= 0 || N > input.maxSpeedRpm) continue;
      const f = (k * N) / 60;
      const nearOp = input.operatingRpm != null
        ? Math.abs(N - input.operatingRpm) / input.operatingRpm < 0.1
        : false;
      crossings.push({ modeId: mode.id, order: k, speedRpm: N, frequencyHz: f, nearOperating: nearOp });
    }
  }

  crossings.sort((a, b) => a.speedRpm - b.speedRpm);

  let margin: number | null = null;
  if (input.operatingRpm != null && crossings.length > 0) {
    margin = Math.min(...crossings.map(c => Math.abs(c.speedRpm - input.operatingRpm!)));
    if (crossings.some(c => c.nearOperating)) {
      warnings.push('A critical speed lies within 10% of operating speed — resonance risk.');
    }
  }

  return { crossings, operatingMarginRpm: margin, warnings };
}

/** Excitation frequency (Hz) of an order at a speed. */
export function excitationHz(order: number, rpm: number): number {
  return (order * rpm) / 60;
}

/** Sample a mode's frequency curve vs speed for plotting. */
export function modeCurve(mode: NaturalMode, maxSpeedRpm: number, samples = 20): { rpm: number; freqHz: number }[] {
  const slope = mode.speedSlopeHzPerRpm ?? 0;
  return Array.from({ length: samples + 1 }, (_, i) => {
    const rpm = (i / samples) * maxSpeedRpm;
    return { rpm, freqHz: mode.baseFreqHz + slope * rpm };
  });
}

export function summarize(r: CampbellResult): { criticalCount: number; operatingMarginRpm: number | null } {
  return { criticalCount: r.crossings.length, operatingMarginRpm: r.operatingMarginRpm };
}
