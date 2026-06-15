/**
 * nusselt.ts — convective heat-transfer correlations for internal pipe flow.
 *
 *   Reynolds:        Re = ρ·v·D/μ = v·D/ν
 *   Prandtl:         Pr = μ·c_p/k = ν/α
 *   Dittus–Boelter:  Nu = 0.023·Re^0.8·Pr^n         (n=0.4 heating, 0.3 cooling; turbulent)
 *   laminar pipe:    Nu = 3.66                       (fully developed, constant wall T)
 *   coefficient:     h  = Nu·k/D
 *
 * Verified against the Reynolds/Prandtl definitions, the Dittus–Boelter value for a
 * textbook case, the heating>cooling Nusselt ordering for Pr>1, the laminar Nu=3.66,
 * and the h = Nu·k/D conversion.
 */

/** Pipe Reynolds number Re = ρvD/μ. */
export function reynoldsPipe(rho: number, v: number, D: number, mu: number): number { return (rho * v * D) / mu; }
/** Prandtl number Pr = μ·c_p/k. */
export function prandtl(mu: number, cp: number, k: number): number { return (mu * cp) / k; }
/** Dittus–Boelter turbulent Nusselt Nu = 0.023·Re^0.8·Pr^n (n=0.4 heating, 0.3 cooling). */
export function dittusBoelter(Re: number, Pr: number, heating: boolean): number {
  return 0.023 * Re ** 0.8 * Pr ** (heating ? 0.4 : 0.3);
}
/** Fully-developed laminar pipe Nusselt (constant wall temperature). */
export function laminarPipeNusselt(): number { return 3.66; }
/** Convective heat-transfer coefficient h = Nu·k/D. */
export function heatTransferCoefficient(Nu: number, k: number, D: number): number { return (Nu * k) / D; }
