/**
 * heatExchanger.ts — heat-exchanger sizing by the EFFECTIVENESS–NTU method.
 *
 *   NTU = UA/C_min,   Cr = C_min/C_max,   ε = Q/Q_max,   Q_max = C_min·(Th,in − Tc,in)
 *   counterflow:  ε = (1 − e^{−NTU(1−Cr)}) / (1 − Cr·e^{−NTU(1−Cr)})
 *   parallel:     ε = (1 − e^{−NTU(1+Cr)}) / (1 + Cr)
 *   limits:  Cr=0 ⇒ ε = 1 − e^{−NTU};  counterflow Cr=1 ⇒ ε = NTU/(1+NTU)
 *
 * Verified against those formulas and limits, the counterflow > parallel ordering,
 * the NTU→∞ behaviour, and the outlet-temperature energy balance.
 */

/** Counterflow effectiveness ε(NTU, Cr). */
export function counterflowEffectiveness(NTU: number, Cr: number): number {
  if (Math.abs(Cr - 1) < 1e-9) return NTU / (1 + NTU);     // Cr=1 limit
  const e = Math.exp(-NTU * (1 - Cr));
  return (1 - e) / (1 - Cr * e);
}

/** Parallel-flow effectiveness ε(NTU, Cr). */
export function parallelFlowEffectiveness(NTU: number, Cr: number): number {
  return (1 - Math.exp(-NTU * (1 + Cr))) / (1 + Cr);
}

/** Number of transfer units NTU = UA/C_min. */
export function ntu(UA: number, Cmin: number): number { return UA / Cmin; }

/** Actual heat-transfer rate Q = ε·C_min·(Th,in − Tc,in). */
export function heatTransferRate(eps: number, Cmin: number, ThIn: number, TcIn: number): number {
  return eps * Cmin * (ThIn - TcIn);
}

export interface OutletTemps { hotOut: number; coldOut: number; }
/** Outlet temperatures from the duty Q and the stream capacity rates. */
export function outletTemperatures(Q: number, Ch: number, Cc: number, ThIn: number, TcIn: number): OutletTemps {
  return { hotOut: ThIn - Q / Ch, coldOut: TcIn + Q / Cc };
}
