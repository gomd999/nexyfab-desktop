/**
 * fanAffinityLaws.ts — Apply the fan (and pump) affinity laws to predict
 * flow, pressure, and power when speed or impeller diameter changes.
 *
 * Speed change (fixed diameter):
 *   Q₂/Q₁ = N₂/N₁
 *   P₂/P₁ = (N₂/N₁)²          (static pressure)
 *   W₂/W₁ = (N₂/N₁)³          (shaft power)
 *
 * Diameter change (fixed speed) — same exponents on D.
 *
 * We also solve the inverse: what speed hits a target flow, and the
 * resulting pressure/power, plus an energy-saving estimate vs throttling
 * (since power ∝ N³, a VFD turndown saves cubically).
 */

export interface FanState {
  flowM3PerS: number;
  pressurePa: number;
  powerW: number;
  speedRpm: number;
  diameterMm?: number;
}

export type AffinityDriver = 'speed' | 'diameter';

export interface AffinityInput {
  base: FanState;
  driver: AffinityDriver;
  newSpeedRpm?: number;
  newDiameterMm?: number;
}

export interface AffinityResult {
  ratio: number;        // N₂/N₁ or D₂/D₁
  flowM3PerS: number;
  pressurePa: number;
  powerW: number;
  warnings: string[];
}

export function apply(input: AffinityInput): AffinityResult {
  const warnings: string[] = [];
  const b = input.base;
  let ratio = 1;

  if (input.driver === 'speed') {
    if (!input.newSpeedRpm || b.speedRpm <= 0) {
      warnings.push('Speed driver needs positive base + new speed.');
    } else {
      ratio = input.newSpeedRpm / b.speedRpm;
    }
  } else {
    if (!input.newDiameterMm || !b.diameterMm || b.diameterMm <= 0) {
      warnings.push('Diameter driver needs positive base + new diameter.');
    } else {
      ratio = input.newDiameterMm / b.diameterMm;
    }
  }

  return {
    ratio,
    flowM3PerS: b.flowM3PerS * ratio,
    pressurePa: b.pressurePa * ratio * ratio,
    powerW: b.powerW * ratio * ratio * ratio,
    warnings,
  };
}

/** Speed needed to hit a target flow, with resulting pressure/power. */
export function speedForFlow(base: FanState, targetFlowM3PerS: number): { speedRpm: number; pressurePa: number; powerW: number } {
  if (base.flowM3PerS <= 0) return { speedRpm: 0, pressurePa: 0, powerW: 0 };
  const ratio = targetFlowM3PerS / base.flowM3PerS;
  return {
    speedRpm: base.speedRpm * ratio,
    pressurePa: base.pressurePa * ratio * ratio,
    powerW: base.powerW * ratio * ratio * ratio,
  };
}

/** Energy saved (W) of VFD speed reduction vs throttling at the same flow. */
export function vfdSavingW(base: FanState, targetFlowM3PerS: number): number {
  if (base.flowM3PerS <= 0) return 0;
  const ratio = targetFlowM3PerS / base.flowM3PerS;
  // Throttling keeps speed → power stays ~base (slightly less). VFD → base·ratio³.
  const vfdPower = base.powerW * ratio * ratio * ratio;
  const throttlePower = base.powerW; // approx: damper throttling holds shaft power
  return Math.max(0, throttlePower - vfdPower);
}

export function summarize(r: AffinityResult): { ratio: number; flowM3PerS: number; powerW: number } {
  return { ratio: r.ratio, flowM3PerS: r.flowM3PerS, powerW: r.powerW };
}
