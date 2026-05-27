/**
 * harmonicResponse.ts — Steady-state harmonic frequency response
 * analysis for a structure under sinusoidal forcing.
 *
 * Given the structure's modal data (natural frequencies + damping
 * ratios + mode shapes) and a sinusoidal force at frequency f, the
 * displacement amplitude at each DOF can be computed by summing
 * each mode's amplification factor:
 *
 *     H(ω) = Σᵢ φᵢ φᵢᵀ / (ωᵢ² - ω² + 2j·ζᵢ·ωᵢ·ω)
 *
 * The displacement amplitude per DOF is then |H(ω) · F|.
 *
 * Module computes:
 *
 *   - Per-frequency, per-DOF displacement amplitude.
 *   - Resonance peaks (frequencies where any DOF amplitude exceeds
 *     a threshold).
 *   - Frequency sweep response curve.
 */

export interface Mode {
  index: number;
  /** Natural frequency, Hz. */
  frequencyHz: number;
  /** Damping ratio (0..1). */
  zeta: number;
  /** Mass-normalized eigenvector. */
  eigenvector: number[];
}

export interface ForcingSpec {
  /** DOF that receives the force. */
  dofIndex: number;
  /** Force amplitude, N. */
  amplitudeN: number;
}

export interface FrequencyPoint {
  frequencyHz: number;
  /** Per-DOF response amplitude (real magnitude). */
  amplitudes: number[];
  /** Max amplitude over all DOFs. */
  peakAmplitude: number;
}

export interface HarmonicResult {
  frequencyResponse: FrequencyPoint[];
  resonancePeaks: Array<{ frequencyHz: number; peakAmplitude: number }>;
  /** Mode contributing the most to the largest peak. */
  dominantModeIndex: number;
}

export interface SweepOptions {
  /** Hz range. */
  fromHz: number;
  toHz: number;
  /** Number of sample points. */
  samples: number;
  /** Peak detection threshold (relative to background). */
  peakThresholdRelative: number;
}

export const DEFAULT_OPTIONS: SweepOptions = {
  fromHz: 0,
  toHz: 1000,
  samples: 200,
  peakThresholdRelative: 3,
};

// ── Top-level entry ────────────────────────────────────────────

export function sweepResponse(modes: Mode[], forcing: ForcingSpec, options: Partial<SweepOptions> = {}): HarmonicResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (modes.length === 0 || forcing.amplitudeN === 0) {
    return { frequencyResponse: [], resonancePeaks: [], dominantModeIndex: -1 };
  }
  const numDof = modes[0]!.eigenvector.length;
  const sweep: FrequencyPoint[] = [];
  for (let s = 0; s < opts.samples; s++) {
    const t = opts.samples === 1 ? 0 : s / (opts.samples - 1);
    const f = opts.fromHz + (opts.toHz - opts.fromHz) * t;
    const point = responseAt(modes, forcing, f, numDof);
    sweep.push(point);
  }

  // Detect peaks (local maxima above threshold × mean).
  const meanAmp = sweep.reduce((s, p) => s + p.peakAmplitude, 0) / sweep.length;
  const threshold = meanAmp * opts.peakThresholdRelative;
  const peaks: Array<{ frequencyHz: number; peakAmplitude: number }> = [];
  for (let i = 1; i < sweep.length - 1; i++) {
    const prev = sweep[i - 1]!.peakAmplitude;
    const cur = sweep[i]!.peakAmplitude;
    const next = sweep[i + 1]!.peakAmplitude;
    if (cur > prev && cur > next && cur > threshold) {
      peaks.push({ frequencyHz: sweep[i]!.frequencyHz, peakAmplitude: cur });
    }
  }

  // Identify dominant mode: which mode's natural frequency is closest to the largest peak.
  let dominantIdx = -1;
  if (peaks.length > 0) {
    const biggest = peaks.reduce((m, p) => p.peakAmplitude > m.peakAmplitude ? p : m, peaks[0]!);
    let bestDist = Infinity;
    for (const m of modes) {
      const dist = Math.abs(m.frequencyHz - biggest.frequencyHz);
      if (dist < bestDist) {
        bestDist = dist;
        dominantIdx = m.index;
      }
    }
  }

  return {
    frequencyResponse: sweep,
    resonancePeaks: peaks,
    dominantModeIndex: dominantIdx,
  };
}

// ── Single-frequency response ─────────────────────────────────

export function responseAt(modes: Mode[], forcing: ForcingSpec, frequencyHz: number, numDof: number): FrequencyPoint {
  const omega = 2 * Math.PI * frequencyHz;
  const realDisp = new Array(numDof).fill(0);
  const imagDisp = new Array(numDof).fill(0);

  for (const mode of modes) {
    const wn = 2 * Math.PI * mode.frequencyHz;
    const denomReal = wn * wn - omega * omega;
    const denomImag = 2 * mode.zeta * wn * omega;
    const magSq = denomReal * denomReal + denomImag * denomImag;
    if (magSq < 1e-30) continue;
    const phiAtForcing = mode.eigenvector[forcing.dofIndex] ?? 0;
    // H_i(ω) = (φ_i^T · f) · φ_i / (denomReal + j·denomImag)
    const scalar = phiAtForcing * forcing.amplitudeN;
    // (a) / (c + jd) = (a·c - a·d·j) / (c² + d²)
    const factorReal = scalar * denomReal / magSq;
    const factorImag = -scalar * denomImag / magSq;
    for (let d = 0; d < numDof; d++) {
      const phi = mode.eigenvector[d] ?? 0;
      realDisp[d] += phi * factorReal;
      imagDisp[d] += phi * factorImag;
    }
  }

  // Magnitude per DOF.
  const amplitudes: number[] = realDisp.map((re, i) => Math.hypot(re, imagDisp[i]!));
  const peak = amplitudes.reduce((m, a) => Math.max(m, a), 0);
  return { frequencyHz, amplitudes, peakAmplitude: peak };
}

// ── Tip helpers ───────────────────────────────────────────────

/** Find the half-power bandwidth (-3 dB) around a peak frequency. */
export function halfPowerBandwidth(sweep: FrequencyPoint[], peakIdx: number): number {
  if (peakIdx <= 0 || peakIdx >= sweep.length - 1) return 0;
  const peakAmp = sweep[peakIdx]!.peakAmplitude;
  const halfAmp = peakAmp / Math.SQRT2;
  let lower = sweep[peakIdx]!.frequencyHz;
  let upper = sweep[peakIdx]!.frequencyHz;
  for (let i = peakIdx; i >= 0; i--) {
    if (sweep[i]!.peakAmplitude <= halfAmp) {
      lower = sweep[i]!.frequencyHz;
      break;
    }
  }
  for (let i = peakIdx; i < sweep.length; i++) {
    if (sweep[i]!.peakAmplitude <= halfAmp) {
      upper = sweep[i]!.frequencyHz;
      break;
    }
  }
  return upper - lower;
}

// ── Summary ────────────────────────────────────────────────────

export interface HarmonicSummary {
  sampleCount: number;
  peakCount: number;
  largestPeakHz: number;
  largestPeakAmplitude: number;
  dominantModeIndex: number;
}

export function summarize(result: HarmonicResult): HarmonicSummary {
  let largestHz = 0;
  let largestAmp = 0;
  for (const p of result.resonancePeaks) {
    if (p.peakAmplitude > largestAmp) {
      largestAmp = p.peakAmplitude;
      largestHz = p.frequencyHz;
    }
  }
  return {
    sampleCount: result.frequencyResponse.length,
    peakCount: result.resonancePeaks.length,
    largestPeakHz: largestHz,
    largestPeakAmplitude: largestAmp,
    dominantModeIndex: result.dominantModeIndex,
  };
}
