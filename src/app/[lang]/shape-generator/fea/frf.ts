/**
 * frf.ts — frequency-response functions with STRUCTURAL (hysteretic) damping, the
 * model for viscoelastic materials. The stiffness is complex k(1+iη) (η = loss
 * factor = E''/E'), so the SDOF receptance is
 *
 *   H(ω) = 1 / (k − mω² + i·k·η)
 *
 * The magnitude peaks at ω_n=√(k/m) with |H_peak| = 1/(kη) and −90° phase; the
 * half-power (−3 dB) bandwidth gives the loss factor η = Δω/ω_n. Verified against
 * those closed forms and the complex-modulus identity η = E''/E'.
 */

export interface Complex { re: number; im: number; }

/** SDOF receptance FRF with structural damping (complex). */
export function sdofFRF(omega: number, m: number, k: number, eta: number): Complex {
  const reDen = k - m * omega * omega, imDen = k * eta;
  const d = reDen * reDen + imDen * imDen;
  return { re: reDen / d, im: -imDen / d };   // 1/(reDen + i·imDen)
}

export function magnitude(h: Complex): number { return Math.hypot(h.re, h.im); }
/** Phase in radians (−π..π). */
export function phase(h: Complex): number { return Math.atan2(h.im, h.re); }

/**
 * Estimate the loss factor from the half-power bandwidth of a sampled |H(f)| curve:
 * η ≈ (f₂ − f₁) / f_peak, where f₁,f₂ are the −3 dB (|H_peak|/√2) points.
 */
export function halfPowerLossFactor(freqs: number[], mags: number[]): number {
  let iPeak = 0;
  for (let i = 1; i < mags.length; i++) if (mags[i] > mags[iPeak]) iPeak = i;
  const half = mags[iPeak] / Math.SQRT2;
  // interpolate the crossing on each side of the peak.
  const cross = (lo: number, hi: number) => {
    const t = (half - mags[lo]) / (mags[hi] - mags[lo]);
    return freqs[lo] + t * (freqs[hi] - freqs[lo]);
  };
  let f1 = freqs[0];
  for (let i = iPeak; i > 0; i--) if (mags[i] >= half && mags[i - 1] < half) { f1 = cross(i - 1, i); break; }
  let f2 = freqs[freqs.length - 1];
  for (let i = iPeak; i < mags.length - 1; i++) if (mags[i] >= half && mags[i + 1] < half) { f2 = cross(i + 1, i); break; }
  return (f2 - f1) / freqs[iPeak];
}

export interface ComplexModulus {
  storage: number;   // E' (real part)
  loss: number;      // E'' (imaginary part)
  lossFactor: number; // η = E''/E'
}

/** Complex modulus E* = E'(1 + iη). */
export function complexModulus(storage: number, eta: number): ComplexModulus {
  return { storage, loss: storage * eta, lossFactor: eta };
}
