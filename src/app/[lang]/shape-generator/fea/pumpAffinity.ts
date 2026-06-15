/**
 * pumpAffinity.ts — turbomachine (pump/fan) AFFINITY LAWS for scaling performance with
 * speed N and impeller diameter D:
 *
 *   flow:   Q ∝ N·D³        head:  H ∝ N²·D²        power:  P ∝ N³·D⁵
 *   specific speed:  N_s = N·√Q / H^{3/4}
 *   hydraulic power: P = ρ·g·Q·H / η
 *
 * Verified: the speed (Q∝N, H∝N², P∝N³) and diameter scalings, their consistency
 * (P ∝ Q·H), the specific speed, and the hydraulic power.
 */

export const G = 9.80665;

/** Scale flow: Q2 = Q1·(N2/N1)·(D2/D1)³. */
export function scaleFlow(Q1: number, N1: number, N2: number, D1 = 1, D2 = 1): number {
  return Q1 * (N2 / N1) * (D2 / D1) ** 3;
}
/** Scale head: H2 = H1·(N2/N1)²·(D2/D1)². */
export function scaleHead(H1: number, N1: number, N2: number, D1 = 1, D2 = 1): number {
  return H1 * (N2 / N1) ** 2 * (D2 / D1) ** 2;
}
/** Scale power: P2 = P1·(N2/N1)³·(D2/D1)⁵. */
export function scalePower(P1: number, N1: number, N2: number, D1 = 1, D2 = 1): number {
  return P1 * (N2 / N1) ** 3 * (D2 / D1) ** 5;
}

/** Specific speed N_s = N·√Q / H^{3/4} (consistent units). */
export function specificSpeed(N: number, Q: number, H: number): number {
  return (N * Math.sqrt(Q)) / Math.pow(H, 0.75);
}

/** Hydraulic (water) power P = ρ·g·Q·H / η. */
export function hydraulicPower(rho: number, Q: number, H: number, eta: number): number {
  return (rho * G * Q * H) / eta;
}
