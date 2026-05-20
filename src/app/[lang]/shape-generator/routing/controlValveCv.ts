/**
 * controlValveCv.ts — Size a control valve flow coefficient (Cv) for
 * liquid service (ISA/IEC), checking for choked (cavitating) flow, and
 * apply the inherent characteristic (linear / equal-percentage) to map
 * travel → flow.
 *
 * Liquid Cv (non-choked, US units mix kept consistent in SI-ish form):
 *   Cv = Q · sqrt(SG / ΔP)        (Q gpm, ΔP psi)  — classic form
 * We work in SI and convert: Q in m³/h, ΔP in bar:
 *   Kv = Q · sqrt(SG / ΔP)        (Kv, m³/h at 1 bar)   ; Cv = 1.156·Kv
 *
 * Choked flow when ΔP ≥ FL²·(P1 − FF·Pv). We report required Kv/Cv,
 * choked flag, and the % valve opening at the design point for a chosen
 * inherent characteristic with rangeability R.
 */

export type ValveCharacteristic = 'linear' | 'equal-percentage' | 'quick-open';

export interface ControlValveInput {
  flowM3H: number;
  specificGravity: number;     // SG (water = 1)
  inletPressureBar: number;    // P1
  outletPressureBar: number;   // P2
  vapourPressureBar?: number;  // Pv (for choke check)
  liquidPressureRecoveryFL?: number; // FL, default 0.9
  ratedKv: number;             // valve's rated Kv (100% open)
  characteristic?: ValveCharacteristic;
  rangeability?: number;       // R, default 50
}

export interface ControlValveResult {
  pressureDropBar: number;
  requiredKv: number;
  requiredCv: number;
  choked: boolean;
  valveOpeningFraction: number; // 0..1 travel at design flow
  withinControllableRange: boolean;
  warnings: string[];
}

export function size(input: ControlValveInput): ControlValveResult {
  const warnings: string[] = [];
  const dP = input.inletPressureBar - input.outletPressureBar;
  if (dP <= 0) warnings.push('Inlet pressure must exceed outlet.');
  if (input.ratedKv <= 0) warnings.push('Rated Kv must be positive.');

  // Choke check.
  const FL = input.liquidPressureRecoveryFL ?? 0.9;
  const Pv = input.vapourPressureBar ?? 0;
  const FF = 0.96 - 0.28 * Math.sqrt(Math.max(0, Pv) / 221.2); // critical pressure ratio factor
  const dPchoked = FL * FL * (input.inletPressureBar - FF * Pv);
  const choked = dP >= dPchoked && dPchoked > 0;
  const dPeffective = choked ? dPchoked : dP;

  const reqKv = dPeffective > 0 ? input.flowM3H * Math.sqrt(input.specificGravity / dPeffective) : Infinity;
  const reqCv = reqKv * 1.156;

  // Required flow fraction of rated → invert inherent characteristic to travel.
  const flowFraction = input.ratedKv > 0 ? Math.min(1, reqKv / input.ratedKv) : 1;
  const opening = inverseCharacteristic(flowFraction, input.characteristic ?? 'equal-percentage', input.rangeability ?? 50);

  // Good control: valve operates between ~10% and ~90% travel at design.
  const within = opening >= 0.1 && opening <= 0.9;
  if (!within) warnings.push(`Design opening ${(opening * 100).toFixed(0)}% outside 10–90% — resize valve.`);
  if (choked) warnings.push('Flow is choked (ΔP ≥ choke limit); cavitation/flashing risk.');

  return {
    pressureDropBar: dP,
    requiredKv: reqKv,
    requiredCv: reqCv,
    choked,
    valveOpeningFraction: opening,
    withinControllableRange: within,
    warnings,
  };
}

/** travel (0..1) that produces a given flow fraction, per characteristic. */
function inverseCharacteristic(flowFraction: number, ch: ValveCharacteristic, R: number): number {
  const f = Math.max(1e-4, Math.min(1, flowFraction));
  switch (ch) {
    case 'linear': return f;
    case 'quick-open': return f * f; // flow ∝ √travel → travel = f²
    case 'equal-percentage': {
      // flow = R^(h−1) → h = 1 + ln(f)/ln(R)
      return Math.max(0, Math.min(1, 1 + Math.log(f) / Math.log(R)));
    }
  }
}

/** Forward characteristic: flow fraction at a travel fraction. */
export function flowAtTravel(travel: number, ch: ValveCharacteristic, R: number = 50): number {
  const h = Math.max(0, Math.min(1, travel));
  switch (ch) {
    case 'linear': return h;
    case 'quick-open': return Math.sqrt(h);
    case 'equal-percentage': return Math.pow(R, h - 1);
  }
}

export function summarize(r: ControlValveResult): { requiredCv: number; valveOpeningFraction: number; choked: boolean } {
  return { requiredCv: r.requiredCv, valveOpeningFraction: r.valveOpeningFraction, choked: r.choked };
}
