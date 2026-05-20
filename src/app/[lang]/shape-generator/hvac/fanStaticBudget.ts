/**
 * fanStaticBudget.ts — Build the external static pressure (ESP) budget
 * for an air-handling system: sum the pressure drops of every component
 * along the critical path, add ductwork friction + fittings, and size
 * the fan static pressure with a safety margin.
 *
 *   ESP = Σ component drops + duct friction·length + Σ fitting losses
 *   fan static = ESP × (1 + safetyMargin)
 *
 * We also compute the fan power from total static and flow:
 *   P_air = Q · ΔP        (W, air power)
 *   P_shaft = P_air / fanEfficiency
 */

export interface PressureComponent {
  name: string;
  dropPa: number;
}

export interface FanStaticBudgetInput {
  components: PressureComponent[]; // coils, filters, dampers, terminals…
  ductLengthM: number;
  frictionRatePaPerM: number;      // duct friction (e.g. 0.8 Pa/m)
  fittingLossesPa?: number;        // elbows/transitions total
  flowRateM3PerS: number;
  fanEfficiency?: number;          // default 0.65
  safetyMarginPercent?: number;    // default 10
}

export interface FanStaticBudgetResult {
  componentTotalPa: number;
  ductFrictionPa: number;
  fittingLossesPa: number;
  externalStaticPa: number;
  fanStaticPa: number;
  airPowerW: number;
  shaftPowerW: number;
  dominantComponent: string | null;
  warnings: string[];
}

export function compute(input: FanStaticBudgetInput): FanStaticBudgetResult {
  const warnings: string[] = [];
  if (input.flowRateM3PerS <= 0) warnings.push('Flow rate must be positive.');

  const componentTotal = input.components.reduce((s, c) => s + c.dropPa, 0);
  const ductFriction = Math.max(0, input.ductLengthM) * Math.max(0, input.frictionRatePaPerM);
  const fittings = input.fittingLossesPa ?? 0;

  const esp = componentTotal + ductFriction + fittings;
  const margin = (input.safetyMarginPercent ?? 10) / 100;
  const fanStatic = esp * (1 + margin);

  const airPower = input.flowRateM3PerS * fanStatic; // W
  const eff = input.fanEfficiency ?? 0.65;
  const shaftPower = eff > 0 ? airPower / eff : 0;

  let dominant: string | null = null;
  let maxDrop = -1;
  for (const c of input.components) {
    if (c.dropPa > maxDrop) { maxDrop = c.dropPa; dominant = c.name; }
  }
  if (ductFriction > maxDrop) dominant = 'ductwork';

  return {
    componentTotalPa: componentTotal,
    ductFrictionPa: ductFriction,
    fittingLossesPa: fittings,
    externalStaticPa: esp,
    fanStaticPa: fanStatic,
    airPowerW: airPower,
    shaftPowerW: shaftPower,
    dominantComponent: dominant,
    warnings,
  };
}

/** Each component's share of the total ESP (for a Pareto / where-to-cut analysis). */
export function pressureShares(result: FanStaticBudgetResult, input: FanStaticBudgetInput): { name: string; fraction: number }[] {
  const total = result.externalStaticPa;
  if (total <= 0) return [];
  const shares = input.components.map(c => ({ name: c.name, fraction: c.dropPa / total }));
  shares.push({ name: 'ductwork', fraction: result.ductFrictionPa / total });
  if (result.fittingLossesPa > 0) shares.push({ name: 'fittings', fraction: result.fittingLossesPa / total });
  return shares.sort((a, b) => b.fraction - a.fraction);
}

export function summarize(r: FanStaticBudgetResult): { externalStaticPa: number; fanStaticPa: number; shaftPowerW: number } {
  return { externalStaticPa: r.externalStaticPa, fanStaticPa: r.fanStaticPa, shaftPowerW: r.shaftPowerW };
}
