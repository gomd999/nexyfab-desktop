/**
 * rotordynamics.ts — gyroscopic whirl of a spinning rotor (rigid disk on an elastic
 * support). The gyroscopic coupling splits the rest natural frequency into FORWARD
 * (co-rotating) and BACKWARD whirl whose frequencies depend on the spin speed Ω — the
 * Campbell diagram. Critical speeds occur where a whirl frequency meets the
 * synchronous (1×) line.
 *
 * Using the complex tilt coordinate z = θx + i·θy, the two coupled tilt equations
 *   It·θ̈x + Ip·Ω·θ̇y + k·θx = 0,   It·θ̈y − Ip·Ω·θ̇x + k·θy = 0
 * collapse to  It·z̈ − i·Ip·Ω·ż + k·z = 0, giving the whirl characteristic
 *   It·ω² − Ip·Ω·ω − k = 0.
 *
 * Verified: at Ω=0 the whirl is degenerate at √(k/It); forward whirl rises and
 * backward falls with Ω; the synchronous critical speeds are √(k/(It∓Ip)).
 *
 * It = transverse (diametral) moment of inertia, Ip = polar moment, k = support
 * angular stiffness, Ω = spin speed (rad/s). Whirl/critical results in rad/s.
 */

export interface WhirlFrequencies {
  /** Forward (co-rotating) whirl, rises with Ω. */
  forward: number;
  /** Backward whirl magnitude, falls with Ω. */
  backward: number;
}

/** Forward/backward whirl frequencies at a given spin speed. */
export function whirlFrequencies(It: number, Ip: number, k: number, Omega: number): WhirlFrequencies {
  const disc = Math.sqrt((Ip * Omega) ** 2 + 4 * It * k);
  return {
    forward: (Ip * Omega + disc) / (2 * It),          // positive root
    backward: (disc - Ip * Omega) / (2 * It),         // |negative root|
  };
}

export interface CriticalSpeeds {
  /** Forward synchronous critical speed √(k/(It−Ip)) — exists for It>Ip. */
  forward: number;
  /** Backward synchronous critical speed √(k/(It+Ip)). */
  backward: number;
}

/** Synchronous (Ω = ω) critical speeds. */
export function criticalSpeeds(It: number, Ip: number, k: number): CriticalSpeeds {
  return {
    forward: It > Ip ? Math.sqrt(k / (It - Ip)) : Infinity,
    backward: Math.sqrt(k / (It + Ip)),
  };
}

/** Campbell diagram: whirl frequencies sampled over a set of spin speeds. */
export function campbellDiagram(It: number, Ip: number, k: number, speeds: number[]): Array<{ Omega: number } & WhirlFrequencies> {
  return speeds.map((Omega) => ({ Omega, ...whirlFrequencies(It, Ip, k, Omega) }));
}

/** Residual of the whirl characteristic It·ω² − Ip·Ω·ω − k (≈0 for a whirl root). */
export function characteristicResidual(It: number, Ip: number, k: number, Omega: number, omega: number): number {
  return It * omega * omega - Ip * Omega * omega - k;
}
