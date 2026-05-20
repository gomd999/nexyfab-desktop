/**
 * frequencyResponseSweep.ts — Frequency response analysis for an FEA
 * model: response amplitude + phase across a frequency range.
 *
 * Single-DOF model:
 *   H(ω) = 1 / sqrt((1 - r²)² + (2·ζ·r)²)
 *   where r = ω/ω_n.
 *
 * Module supports:
 *   - Single mode (analytic).
 *   - Modal superposition for multi-mode.
 *   - Peak frequency / Q-factor.
 *   - Half-power bandwidth.
 */

export interface ModalParameters {
  /** Natural frequency (Hz). */
  fnHz: number;
  /** Damping ratio (0..1). */
  zeta: number;
  /** Mode mass (kg). */
  modalMassKg: number;
  /** Mode participation factor for the loaded DOF. */
  participationFactor: number;
}

export interface FrequencyPoint {
  freqHz: number;
  amplitude: number;
  phaseDeg: number;
}

export interface SweepOptions {
  freqMinHz: number;
  freqMaxHz: number;
  samples: number;
  /** Excitation amplitude (N). */
  excitationN: number;
}

export const DEFAULT_OPTIONS: SweepOptions = {
  freqMinHz: 1,
  freqMaxHz: 500,
  samples: 200,
  excitationN: 1,
};

export interface SweepResult {
  points: FrequencyPoint[];
  peakFreqHz: number;
  peakAmplitude: number;
  /** Q-factor for the most amplified mode. */
  qFactor: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function sweepFrequency(modes: ModalParameters[], options: Partial<SweepOptions> = {}): SweepResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const points: FrequencyPoint[] = [];
  for (let i = 0; i <= opts.samples; i++) {
    const ratio = i / opts.samples;
    // Log-spaced sweep.
    const freq = opts.freqMinHz * Math.pow(opts.freqMaxHz / opts.freqMinHz, ratio);
    const omega = 2 * Math.PI * freq;
    let realSum = 0, imagSum = 0;
    for (const m of modes) {
      const omegaN = 2 * Math.PI * m.fnHz;
      const r = omega / omegaN;
      const denom = (1 - r * r);
      const damp = 2 * m.zeta * r;
      const denomMagSq = denom * denom + damp * damp;
      // SDOF complex response.
      const modeReal = denom / denomMagSq;
      const modeImag = -damp / denomMagSq;
      const k = omegaN * omegaN * m.modalMassKg;
      const scale = (m.participationFactor * m.participationFactor * opts.excitationN) / Math.max(0.001, k);
      realSum += modeReal * scale;
      imagSum += modeImag * scale;
    }
    const amplitude = Math.hypot(realSum, imagSum);
    const phase = (Math.atan2(imagSum, realSum) * 180) / Math.PI;
    points.push({ freqHz: freq, amplitude, phaseDeg: phase });
  }

  let peakAmp = 0;
  let peakFreq = opts.freqMinHz;
  for (const p of points) {
    if (p.amplitude > peakAmp) {
      peakAmp = p.amplitude;
      peakFreq = p.freqHz;
    }
  }

  // Q-factor from half-power bandwidth.
  const halfPower = peakAmp / Math.SQRT2;
  let lowFreq = peakFreq, highFreq = peakFreq;
  for (let i = 0; i < points.length; i++) {
    if (points[i]!.freqHz < peakFreq && points[i]!.amplitude >= halfPower) lowFreq = points[i]!.freqHz;
  }
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i]!.freqHz > peakFreq && points[i]!.amplitude >= halfPower) highFreq = points[i]!.freqHz;
  }
  const bandwidth = highFreq - lowFreq;
  const q = bandwidth > 0 ? peakFreq / bandwidth : Infinity;

  return { points, peakFreqHz: peakFreq, peakAmplitude: peakAmp, qFactor: q };
}

// ── Half-power bandwidth ─────────────────────────────────────

export function halfPowerBandwidth(result: SweepResult): { lowHz: number; highHz: number; bandwidthHz: number } {
  const halfPower = result.peakAmplitude / Math.SQRT2;
  let low = result.peakFreqHz;
  let high = result.peakFreqHz;
  for (const p of result.points) {
    if (p.freqHz < result.peakFreqHz && p.amplitude >= halfPower && p.freqHz < low) low = p.freqHz;
  }
  for (const p of result.points) {
    if (p.freqHz > result.peakFreqHz && p.amplitude >= halfPower && p.freqHz > high) high = p.freqHz;
  }
  return { lowHz: low, highHz: high, bandwidthHz: high - low };
}

// ── Damping ratio inverse from Q ─────────────────────────────

export function dampingFromQ(qFactor: number): number {
  if (qFactor <= 0) return 0;
  return 1 / (2 * qFactor);
}

// ── Summary ────────────────────────────────────────────────────

export interface SweepSummary {
  sampleCount: number;
  peakFreqHz: number;
  peakAmplitude: number;
  qFactor: number;
}

export function summarize(result: SweepResult): SweepSummary {
  return {
    sampleCount: result.points.length,
    peakFreqHz: result.peakFreqHz,
    peakAmplitude: result.peakAmplitude,
    qFactor: result.qFactor,
  };
}
