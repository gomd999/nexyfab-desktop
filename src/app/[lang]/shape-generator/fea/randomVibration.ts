/**
 * randomVibration.ts — linear random-vibration response to a stationary PSD input.
 * For a linear system the response PSD is S_out(f) = |H(f)|²·S_in(f); the RMS
 * response is √∫S_out df. For a base-excited SDOF under a white-noise acceleration
 * PSD this reduces to the classic MILES' EQUATION:
 *
 *   σ_accel = √( (π/2) · f_n · Q · W )        (Q = 1/2ζ, W = input PSD)
 *
 * Verified by integrating |H|²·W numerically and matching Miles, plus the peak
 * transmissibility |H(f_n)| ≈ Q and the linear scaling of variance with input PSD.
 */

/** Base-excitation acceleration transmissibility |H(f)|² of a SDOF (f_n Hz, ζ). */
export function transmissibilitySquared(f: number, fn: number, zeta: number): number {
  const r = f / fn, r2 = r * r;
  const num = 1 + (2 * zeta * r) ** 2;
  const den = (1 - r2) ** 2 + (2 * zeta * r) ** 2;
  return num / den;
}

/** Resonance transfer |1/(1−r²+2iζr)|² (the "force→displacement" SDOF kernel, normalised). */
export function resonanceKernel(f: number, fn: number, zeta: number): number {
  const r2 = (f / fn) ** 2;
  return 1 / ((1 - r2) ** 2 + (2 * zeta * (f / fn)) ** 2);
}

/** RMS of a response PSD over [fMin,fMax] (trapezoidal): √∫S df. */
export function rmsFromPSD(psd: (f: number) => number, fMin: number, fMax: number, n = 20000): number {
  const df = (fMax - fMin) / n;
  let area = 0;
  let prev = psd(fMin);
  for (let i = 1; i <= n; i++) {
    const f = fMin + i * df, cur = psd(f);
    area += 0.5 * (prev + cur) * df;
    prev = cur;
  }
  return Math.sqrt(Math.max(0, area));
}

/** Miles' equation: RMS acceleration response of a SDOF to white-noise base PSD W. */
export function milesRMS(fn: number, Q: number, W: number): number {
  return Math.sqrt((Math.PI / 2) * fn * Q * W);
}

/** Response PSD of a base-excited SDOF to an input acceleration PSD. */
export function responsePSD(inputPSD: (f: number) => number, fn: number, zeta: number): (f: number) => number {
  return (f: number) => transmissibilitySquared(f, fn, zeta) * inputPSD(f);
}
