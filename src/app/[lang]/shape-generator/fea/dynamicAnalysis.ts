/**
 * dynamicAnalysis.ts — Drop test, random vibration, harmonic response.
 *
 * Stage 1 FEA covers static + modal analysis. Stage 2 nonlinear adds
 * plastic deformation. This module covers the *dynamic* loading cases
 * that SolidWorks Simulation Premium ships:
 *
 *   - **Drop test** — explicit time integration of impact with the
 *     ground. Newmark-β or central difference integrator.
 *   - **Random vibration (PSD)** — frequency-domain response to a
 *     Power-Spectral-Density input (e.g. MIL-STD-810 vibration spec).
 *     Output: RMS displacement / stress per node.
 *   - **Harmonic response** — sinusoidal forcing at a sweep of
 *     frequencies. Output: response amplitude vs frequency.
 *   - **Transient (modal superposition)** — time-domain response to
 *     arbitrary load history, summed across natural modes.
 *
 * The actual solver runs in the FEA worker; this module provides
 * the *math primitives* + *result reduction* (max disp, RMS, peak G).
 */

// ── Drop test (explicit time integration) ────────────────────────

export interface DropTestInput {
  /** Mass of the part (kg). */
  massKg: number;
  /** Drop height (m). */
  dropHeightM: number;
  /** Effective stiffness at impact (N/m) — equivalent spring of the
   *  part + ground contact. */
  contactStiffnessNm: number;
  /** Damping ratio at the contact (typical 0.05). */
  dampingRatio: number;
  /** Optional rebound coefficient (0..1). 1 = elastic, 0 = plastic. */
  reboundCoefficient?: number;
}

export interface DropTestResult {
  /** Impact velocity (m/s). */
  impactVelocityMs: number;
  /** Maximum penetration depth (mm). */
  maxPenetrationMm: number;
  /** Peak contact force (N). */
  peakForceN: number;
  /** Peak G load (1 G = 9.81 m/s²). */
  peakGLoad: number;
  /** Contact duration (ms). */
  contactDurationMs: number;
  /** Rebound velocity (m/s). */
  reboundVelocityMs: number;
}

/** Compute drop-test response from energy + spring model. The peak
 *  force comes from setting (1/2)·k·δ² = m·g·h. The G load = peakF / mg. */
export function analyzeDropTest(input: DropTestInput): DropTestResult {
  const g = 9.81;
  const v0 = Math.sqrt(2 * g * input.dropHeightM);
  // Effective spring response: peak deflection δ_max satisfies
  //   (1/2) · m · v² = (1/2) · k · δ² + ½ζ·k·v·δ
  // Approximation with damping ratio:
  const omega = Math.sqrt(input.contactStiffnessNm / input.massKg);
  // Without damping: δ_max = v0 / ω.
  const dMaxUndamped = v0 / omega;
  const damping = Math.max(0, Math.min(1, input.dampingRatio));
  const dMax = dMaxUndamped * (1 - damping * 0.5);
  const peakForce = input.contactStiffnessNm * dMax;
  const peakG = peakForce / (input.massKg * g);
  // Contact duration ≈ half-period of the spring system.
  const contactDuration = Math.PI / omega;
  const rebound = (input.reboundCoefficient ?? Math.exp(-Math.PI * damping)) * v0;
  return {
    impactVelocityMs: v0,
    maxPenetrationMm: dMax * 1000,
    peakForceN: peakForce,
    peakGLoad: peakG,
    contactDurationMs: contactDuration * 1000,
    reboundVelocityMs: rebound,
  };
}

// ── Random vibration (PSD) ───────────────────────────────────────

export interface PsdInput {
  /** Frequency points (Hz). */
  frequenciesHz: number[];
  /** PSD value at each frequency (g²/Hz typical). */
  psdValues: number[];
}

export interface ModeShape {
  /** Natural frequency (Hz). */
  frequencyHz: number;
  /** Modal damping ratio (typical 0.01–0.05 for metal structures). */
  dampingRatio: number;
  /** Modal participation factor — how much this mode responds to base motion. */
  participationFactor: number;
  /** Maximum modal displacement (mm). */
  modalDisplacementMm: number;
}

export interface RandomVibrationResult {
  /** RMS displacement per mode (mm). */
  rmsDisplacementByModeMm: number[];
  /** Combined RMS displacement (SRSS-summed across modes, mm). */
  rmsDisplacementMm: number;
  /** Peak (3-sigma) displacement (mm). */
  threeSigmaDisplacementMm: number;
  /** Per-mode contribution (% of total variance). */
  modeContributions: number[];
}

/** Random vibration response using single-degree-of-freedom modal
 *  summation. The mean-square response of each mode is:
 *
 *    σ_x² = (π / 4ζ) · (1 / ω³) · S(ω) · Γ²
 *
 *  where ω = 2π·f, ζ = damping, S = PSD value, Γ = participation. */
export function analyzeRandomVibration(
  modes: ModeShape[],
  psd: PsdInput,
): RandomVibrationResult {
  const rmsPerMode: number[] = [];
  let totalVariance = 0;
  for (const mode of modes) {
    // Look up PSD at mode's frequency (linear interpolation).
    const S = interpolatePsd(psd, mode.frequencyHz);
    const omega = 2 * Math.PI * mode.frequencyHz;
    if (omega === 0 || mode.dampingRatio === 0) {
      rmsPerMode.push(0);
      continue;
    }
    // RMS² for each mode.
    const variance = (Math.PI / (4 * mode.dampingRatio))
      * (1 / Math.pow(omega, 3))
      * S * mode.participationFactor * mode.participationFactor
      * mode.modalDisplacementMm * mode.modalDisplacementMm;
    rmsPerMode.push(Math.sqrt(Math.max(0, variance)));
    totalVariance += variance;
  }
  const rmsTotal = Math.sqrt(totalVariance);
  const contributions = totalVariance > 0
    ? rmsPerMode.map(r => (r * r) / totalVariance * 100)
    : rmsPerMode.map(() => 0);
  return {
    rmsDisplacementByModeMm: rmsPerMode,
    rmsDisplacementMm: rmsTotal,
    threeSigmaDisplacementMm: rmsTotal * 3,
    modeContributions: contributions,
  };
}

function interpolatePsd(psd: PsdInput, freq: number): number {
  const fs = psd.frequenciesHz;
  if (fs.length === 0) return 0;
  if (freq <= fs[0]!) return psd.psdValues[0]!;
  if (freq >= fs[fs.length - 1]!) return psd.psdValues[fs.length - 1]!;
  for (let i = 0; i < fs.length - 1; i++) {
    if (freq >= fs[i]! && freq <= fs[i + 1]!) {
      const t = (freq - fs[i]!) / (fs[i + 1]! - fs[i]!);
      return psd.psdValues[i]! * (1 - t) + psd.psdValues[i + 1]! * t;
    }
  }
  return 0;
}

// ── Harmonic response ────────────────────────────────────────────

export interface HarmonicInput {
  /** Sweep start (Hz). */
  startFreqHz: number;
  /** Sweep end (Hz). */
  endFreqHz: number;
  /** Number of sample points (log or linear). */
  samples: number;
  /** Log-frequency sweep? Default true. */
  logarithmic?: boolean;
  /** Force amplitude (N). */
  forceAmplitudeN: number;
}

export interface HarmonicResult {
  frequenciesHz: number[];
  /** Displacement amplitude per frequency (mm). */
  displacementMm: number[];
  /** Phase lag per frequency (radians). */
  phaseRad: number[];
  /** Resonance peaks (frequencies of local maxima). */
  resonanceFrequenciesHz: number[];
}

/** Harmonic response of an N-DOF modal system. Each mode contributes
 *  a Lorentzian-shaped peak around its natural frequency. */
export function analyzeHarmonicResponse(
  modes: ModeShape[],
  input: HarmonicInput,
): HarmonicResult {
  const freqs: number[] = [];
  for (let i = 0; i < input.samples; i++) {
    const t = i / (input.samples - 1);
    const f = input.logarithmic !== false
      ? input.startFreqHz * Math.pow(input.endFreqHz / input.startFreqHz, t)
      : input.startFreqHz + (input.endFreqHz - input.startFreqHz) * t;
    freqs.push(f);
  }
  const displacements: number[] = [];
  const phases: number[] = [];
  for (const f of freqs) {
    let amp = 0;
    let phaseSum = 0;
    for (const m of modes) {
      const ratio = f / m.frequencyHz;
      const denom = Math.sqrt(
        Math.pow(1 - ratio * ratio, 2)
        + Math.pow(2 * m.dampingRatio * ratio, 2),
      );
      const modal = (input.forceAmplitudeN * m.participationFactor) / (denom * m.frequencyHz);
      amp += modal;
      const phase = Math.atan2(
        2 * m.dampingRatio * ratio,
        1 - ratio * ratio,
      );
      phaseSum += phase;
    }
    displacements.push(amp);
    phases.push(phaseSum / Math.max(1, modes.length));
  }
  // Find local maxima.
  const peaks: number[] = [];
  for (let i = 1; i < displacements.length - 1; i++) {
    if (displacements[i]! > displacements[i - 1]! && displacements[i]! > displacements[i + 1]!) {
      peaks.push(freqs[i]!);
    }
  }
  return {
    frequenciesHz: freqs,
    displacementMm: displacements,
    phaseRad: phases,
    resonanceFrequenciesHz: peaks,
  };
}

// ── Transient (Newmark-β time integration) ──────────────────────

export interface NewmarkParams {
  /** β parameter (typ 0.25 for unconditionally stable). */
  beta: number;
  /** γ parameter (typ 0.5). */
  gamma: number;
  /** Time step (s). */
  timeStepS: number;
  /** Total simulation time (s). */
  totalTimeS: number;
}

export interface TransientResponse {
  times: number[];
  /** Per-mode time history. */
  modeHistory: Array<{
    frequencyHz: number;
    displacement: number[];
    velocity: number[];
    acceleration: number[];
  }>;
}

/** Time-domain transient response of an SDOF (per-mode) system to
 *  an arbitrary external force time history. */
export function transientSdof(
  mass: number, stiffness: number, damping: number,
  forceTimeHistory: number[],
  params: NewmarkParams,
): { displacement: number[]; velocity: number[]; acceleration: number[] } {
  const dt = params.timeStepS;
  const b = params.beta;
  const g = params.gamma;
  const N = forceTimeHistory.length;
  const u: number[] = [0];
  const v: number[] = [0];
  const a: number[] = [forceTimeHistory[0]! / mass];
  // Constants.
  const kEff = stiffness + (1 / (b * dt * dt)) * mass + (g / (b * dt)) * damping;
  for (let i = 1; i < N; i++) {
    const fext = forceTimeHistory[i]!;
    const uPrev = u[i - 1]!;
    const vPrev = v[i - 1]!;
    const aPrev = a[i - 1]!;
    const rhs = fext
      + mass * (uPrev / (b * dt * dt) + vPrev / (b * dt) + (0.5 / b - 1) * aPrev)
      + damping * (g * uPrev / (b * dt) + (g / b - 1) * vPrev + dt * (g / (2 * b) - 1) * aPrev);
    const uNext = rhs / kEff;
    const aNext = (uNext - uPrev) / (b * dt * dt) - vPrev / (b * dt) - (0.5 / b - 1) * aPrev;
    const vNext = vPrev + (1 - g) * dt * aPrev + g * dt * aNext;
    u.push(uNext); v.push(vNext); a.push(aNext);
  }
  return { displacement: u, velocity: v, acceleration: a };
}
