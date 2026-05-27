/**
 * unbalanceResponse.ts — Forced vibration response of a rotor to residual
 * unbalance as a function of speed, using the single-DOF rotating-
 * unbalance model.
 *
 * Steady-state amplitude:
 *   X(r) = (m_u·e / M) · r² / sqrt((1 − r²)² + (2ζr)²)
 *
 * where r = ω/ω_n, m_u·e is the unbalance (kg·m), M is the rotor mass.
 * The transmitted force and the phase lag follow standard SDOF forms.
 * At resonance (r = 1) the amplitude peaks ≈ (m_u·e/M)/(2ζ) (the Q
 * amplification). Far above resonance X → m_u·e/M (self-centring).
 */

export interface UnbalanceResponseInput {
  rotorMassKg: number;
  unbalanceKgMm: number;        // m_u·e in kg·mm
  naturalFrequencyHz: number;
  dampingRatio?: number;        // ζ, default 0.05
  operatingSpeedRpm?: number;   // evaluate response here
}

export interface ResponsePoint {
  speedRpm: number;
  frequencyRatio: number;
  amplitudeMm: number;
  phaseDeg: number;
}

export interface UnbalanceResponseResult {
  resonanceRpm: number;
  peakAmplitudeMm: number;       // at resonance
  qFactor: number;
  selfCentringAmplitudeMm: number; // far-above-resonance limit
  operatingPoint: ResponsePoint | null;
  warnings: string[];
}

export function compute(input: UnbalanceResponseInput): UnbalanceResponseResult {
  const warnings: string[] = [];
  if (input.rotorMassKg <= 0) warnings.push('Rotor mass must be positive.');
  if (input.naturalFrequencyHz <= 0) warnings.push('Natural frequency must be positive.');

  const zeta = input.dampingRatio ?? 0.05;
  const eqEcc = input.unbalanceKgMm / input.rotorMassKg; // mm (m_u·e / M)
  const resonanceRpm = input.naturalFrequencyHz * 60;

  const Q = zeta > 0 ? 1 / (2 * zeta) : Infinity;
  const peak = eqEcc * Q; // approx amplitude at r=1
  const selfCentring = eqEcc;

  let operatingPoint: ResponsePoint | null = null;
  if (input.operatingSpeedRpm != null) {
    operatingPoint = responseAt(input.operatingSpeedRpm, input.naturalFrequencyHz, eqEcc, zeta);
    if (Math.abs(operatingPoint.frequencyRatio - 1) < 0.1) {
      warnings.push('Operating speed within 10% of resonance — high vibration.');
    }
  }

  return {
    resonanceRpm,
    peakAmplitudeMm: peak,
    qFactor: Q,
    selfCentringAmplitudeMm: selfCentring,
    operatingPoint,
    warnings,
  };
}

function responseAt(speedRpm: number, fnHz: number, eqEccMm: number, zeta: number): ResponsePoint {
  const r = (speedRpm / 60) / fnHz;
  const denom = Math.sqrt((1 - r * r) ** 2 + (2 * zeta * r) ** 2);
  const amplitude = denom > 0 ? eqEccMm * (r * r) / denom : 0;
  const phase = Math.atan2(2 * zeta * r, 1 - r * r) * 180 / Math.PI;
  return { speedRpm, frequencyRatio: r, amplitudeMm: amplitude, phaseDeg: phase };
}

/** Sample the response curve across a speed range for plotting. */
export function responseCurve(input: UnbalanceResponseInput, maxSpeedRpm: number, samples = 40): ResponsePoint[] {
  const zeta = input.dampingRatio ?? 0.05;
  const eqEcc = input.unbalanceKgMm / Math.max(1e-9, input.rotorMassKg);
  return Array.from({ length: samples + 1 }, (_, i) => {
    const speed = (i / samples) * maxSpeedRpm;
    return responseAt(speed, input.naturalFrequencyHz, eqEcc, zeta);
  });
}

export function summarize(r: UnbalanceResponseResult): { resonanceRpm: number; peakAmplitudeMm: number; qFactor: number } {
  return { resonanceRpm: r.resonanceRpm, peakAmplitudeMm: r.peakAmplitudeMm, qFactor: r.qFactor };
}
