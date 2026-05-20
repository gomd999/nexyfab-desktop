/**
 * pumpSystemCurve.ts — Find the operating point where a pump's H-Q curve
 * intersects the system resistance curve.
 *
 * System curve:  H_sys(Q) = H_static + k·Q²    (k from a known duty point)
 * Pump curve:    H_pump(Q) = a − b·Q²           (quadratic fit, 2-3 points)
 *
 * Operating point = Q* where H_pump(Q*) = H_sys(Q*). With both quadratic
 * in Q², this is solved in closed form:
 *
 *   a − b·Q² = H_static + k·Q²  →  Q*² = (a − H_static)/(b + k)
 *
 * We return Q*, the head at that point, and a margin check vs the duty
 * requirement.
 */

export interface PumpSystemInput {
  staticHeadM: number;          // H_static
  systemDutyFlowM3H: number;    // known system point flow
  systemDutyHeadM: number;      // known system point head (> static)
  pumpShutoffHeadM: number;     // a (head at Q=0)
  pumpDutyFlowM3H: number;      // a second pump-curve point
  pumpDutyHeadM: number;
  requiredFlowM3H?: number;     // duty requirement for margin check
}

export interface PumpSystemResult {
  systemResistanceK: number;    // k in H = Hstat + k·Q²
  pumpCoeffB: number;           // b in H = a − b·Q²
  operatingFlowM3H: number;     // Q*
  operatingHeadM: number;       // H*
  meetsRequiredFlow: boolean | null;
  warnings: string[];
}

export function compute(input: PumpSystemInput): PumpSystemResult {
  const warnings: string[] = [];
  if (input.systemDutyFlowM3H <= 0 || input.pumpDutyFlowM3H <= 0) warnings.push('Duty flows must be positive.');

  // System k from duty point: H_duty = H_static + k·Q_duty²
  const k = input.systemDutyFlowM3H > 0
    ? (input.systemDutyHeadM - input.staticHeadM) / (input.systemDutyFlowM3H ** 2)
    : 0;
  if (k < 0) warnings.push('System duty head below static head — check inputs.');

  // Pump b from shutoff + duty: a − b·Qp² = Hp → b = (a − Hp)/Qp²
  const a = input.pumpShutoffHeadM;
  const b = input.pumpDutyFlowM3H > 0
    ? (a - input.pumpDutyHeadM) / (input.pumpDutyFlowM3H ** 2)
    : 0;
  if (b <= 0) warnings.push('Pump curve not descending — check shutoff/duty points.');

  // Intersection: Q*² = (a − Hstatic)/(b + k)
  const denom = b + k;
  const qSq = denom > 0 ? (a - input.staticHeadM) / denom : 0;
  const qStar = qSq > 0 ? Math.sqrt(qSq) : 0;
  const hStar = a - b * qSq;

  let meets: boolean | null = null;
  if (input.requiredFlowM3H != null) {
    meets = qStar >= input.requiredFlowM3H;
    if (!meets) warnings.push(`Operating flow ${qStar.toFixed(1)} m³/h below required ${input.requiredFlowM3H} m³/h. Trim system loss or pick a bigger pump.`);
  }

  return {
    systemResistanceK: k,
    pumpCoeffB: b,
    operatingFlowM3H: qStar,
    operatingHeadM: hStar,
    meetsRequiredFlow: meets,
    warnings,
  };
}

/** System head at an arbitrary flow. */
export function systemHeadM(staticHeadM: number, k: number, flowM3H: number): number {
  return staticHeadM + k * flowM3H * flowM3H;
}

/** Pump head at an arbitrary flow. */
export function pumpHeadM(shutoffHeadM: number, b: number, flowM3H: number): number {
  return shutoffHeadM - b * flowM3H * flowM3H;
}

export function summarize(r: PumpSystemResult): { operatingFlowM3H: number; operatingHeadM: number; meetsRequiredFlow: boolean | null } {
  return { operatingFlowM3H: r.operatingFlowM3H, operatingHeadM: r.operatingHeadM, meetsRequiredFlow: r.meetsRequiredFlow };
}
