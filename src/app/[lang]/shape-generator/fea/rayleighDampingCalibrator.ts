/**
 * rayleighDampingCalibrator.ts — Calibrate Rayleigh damping coefficients
 * (α, β) such that the structural damping matches a target damping
 * ratio at two specified frequencies.
 *
 * Rayleigh damping uses C = α·M + β·K. The modal damping ratio at
 * angular frequency ω is:
 *
 *   ζ(ω) = α / (2·ω) + β·ω / 2
 *
 * Given two target frequencies ω₁, ω₂ and the desired ratios ζ₁, ζ₂,
 * solve the linear 2×2 system:
 *
 *   [ 1/(2ω₁)   ω₁/2 ] [ α ]   [ ζ₁ ]
 *   [ 1/(2ω₂)   ω₂/2 ] [ β ] = [ ζ₂ ]
 *
 * In practice ζ₁ = ζ₂ = ζ_target so the U-shaped ζ(ω) curve sits AT
 * the target between ω₁ and ω₂ and rises outside.
 */

export interface RayleighInput {
  freq1Hz: number;
  freq2Hz: number;
  zeta1: number;
  zeta2: number;
}

export interface RayleighCoefficients {
  alpha: number; // mass-proportional
  beta: number;  // stiffness-proportional
  warnings: string[];
}

export function calibrate(input: RayleighInput): RayleighCoefficients {
  const warnings: string[] = [];
  if (input.freq1Hz <= 0 || input.freq2Hz <= 0) warnings.push('Frequencies must be positive.');
  if (input.freq1Hz === input.freq2Hz) warnings.push('Frequencies must differ.');
  if (input.zeta1 < 0 || input.zeta2 < 0) warnings.push('Damping ratios must be non-negative.');
  if (input.zeta1 > 1 || input.zeta2 > 1) warnings.push('Damping ratio > 1 (overdamped) is unusual.');

  const w1 = 2 * Math.PI * input.freq1Hz;
  const w2 = 2 * Math.PI * input.freq2Hz;

  // 2x2 solve:
  // [ 1/(2w1)   w1/2 ] [α]   [ζ1]
  // [ 1/(2w2)   w2/2 ] [β] = [ζ2]
  const a11 = 1 / (2 * w1);
  const a12 = w1 / 2;
  const a21 = 1 / (2 * w2);
  const a22 = w2 / 2;
  const det = a11 * a22 - a12 * a21;
  if (Math.abs(det) < 1e-12) {
    warnings.push('Linear system singular; check frequency inputs.');
    return { alpha: 0, beta: 0, warnings };
  }
  const alpha = (input.zeta1 * a22 - input.zeta2 * a12) / det;
  const beta = (a11 * input.zeta2 - a21 * input.zeta1) / det;

  return { alpha, beta, warnings };
}

/** Predicted modal damping ratio at an arbitrary frequency. */
export function predictRatio(coef: { alpha: number; beta: number }, freqHz: number): number {
  if (freqHz <= 0) return 0;
  const w = 2 * Math.PI * freqHz;
  return coef.alpha / (2 * w) + coef.beta * w / 2;
}

/** Plot data for an entire frequency sweep. */
export interface DampingPlot {
  freqHz: number;
  zeta: number;
}

export function plotSweep(coef: { alpha: number; beta: number }, freqMinHz: number, freqMaxHz: number, samples: number = 50): DampingPlot[] {
  const out: DampingPlot[] = [];
  const logMin = Math.log10(Math.max(1e-3, freqMinHz));
  const logMax = Math.log10(Math.max(freqMinHz + 1e-3, freqMaxHz));
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const freqHz = Math.pow(10, logMin + (logMax - logMin) * t);
    out.push({ freqHz, zeta: predictRatio(coef, freqHz) });
  }
  return out;
}

/** Frequency at which Rayleigh damping ratio is minimum (the trough between α and β). */
export function minimumDampingFrequencyHz(coef: { alpha: number; beta: number }): number | null {
  if (coef.alpha <= 0 || coef.beta <= 0) return null;
  // dζ/dω = -α/(2ω²) + β/2 = 0  →  ω = √(α/β)
  const wMin = Math.sqrt(coef.alpha / coef.beta);
  return wMin / (2 * Math.PI);
}

export function summarize(r: RayleighCoefficients): { alpha: number; beta: number; warningCount: number } {
  return { alpha: r.alpha, beta: r.beta, warningCount: r.warnings.length };
}
