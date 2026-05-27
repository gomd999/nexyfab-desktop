/**
 * torsionalVibration.ts — Compute the torsional natural frequency of a
 * shaft-disc(s) system and check it against an excitation frequency
 * (e.g. engine firing order) for resonance.
 *
 * Torsional stiffness of a circular shaft segment:
 *   k_t = G · J / L          [N·m/rad],  J = π·d⁴/32
 *
 * Single-disc (inertia I) on a shaft (other end fixed):
 *   ω_n = sqrt(k_t / I)
 *
 * Two-disc system (I1, I2) on a shaft of stiffness k_t:
 *   ω_n = sqrt( k_t·(I1+I2) / (I1·I2) )    (the non-zero mode)
 *
 * We support 1- or 2-disc systems and report the natural frequency in
 * Hz + rpm, and the resonance margin against an excitation order.
 */

export interface ShaftSegment {
  diameterMm: number;
  lengthMm: number;
  shearModulusGPa: number; // G (steel ≈ 79)
}

export interface TorsionalInput {
  shaft: ShaftSegment;
  inertia1KgM2: number;
  inertia2KgM2?: number;   // omit for single-disc (fixed-free)
}

export interface TorsionalResult {
  torsionalStiffnessNmPerRad: number;
  naturalFrequencyHz: number;
  naturalFrequencyRpm: number;
  polarMomentMm4: number;
  mode: 'single-disc' | 'two-disc';
  warnings: string[];
}

export function compute(input: TorsionalInput): TorsionalResult {
  const warnings: string[] = [];
  const d = input.shaft.diameterMm;
  const L = input.shaft.lengthMm;
  if (d <= 0 || L <= 0) warnings.push('Shaft diameter and length must be positive.');
  if (input.inertia1KgM2 <= 0) warnings.push('Inertia must be positive.');

  const J = (Math.PI / 32) * Math.pow(d, 4); // mm⁴
  const G = input.shaft.shearModulusGPa * 1e9; // Pa = N/m²
  const Jm4 = J * 1e-12; // mm⁴ → m⁴
  const Lm = L / 1000;   // mm → m
  const kt = Lm > 0 ? (G * Jm4) / Lm : 0; // N·m/rad

  let omega: number;
  let mode: 'single-disc' | 'two-disc';
  if (input.inertia2KgM2 != null && input.inertia2KgM2 > 0) {
    mode = 'two-disc';
    const I1 = input.inertia1KgM2, I2 = input.inertia2KgM2;
    const equivI = (I1 * I2) / (I1 + I2);
    omega = equivI > 0 ? Math.sqrt(kt / equivI) : 0;
  } else {
    mode = 'single-disc';
    omega = input.inertia1KgM2 > 0 ? Math.sqrt(kt / input.inertia1KgM2) : 0;
  }

  const fHz = omega / (2 * Math.PI);
  return {
    torsionalStiffnessNmPerRad: kt,
    naturalFrequencyHz: fHz,
    naturalFrequencyRpm: fHz * 60,
    polarMomentMm4: J,
    mode,
    warnings,
  };
}

/** Resonance check against an excitation: order × running speed. */
export function resonanceCheck(result: TorsionalResult, runningRpm: number, excitationOrder: number): { excitationHz: number; ratio: number; nearResonance: boolean } {
  const excitationHz = (runningRpm / 60) * excitationOrder;
  const ratio = result.naturalFrequencyHz > 0 ? excitationHz / result.naturalFrequencyHz : 0;
  // Within ±15% of natural frequency is a resonance risk.
  const nearResonance = ratio > 0.85 && ratio < 1.15;
  return { excitationHz, ratio, nearResonance };
}

/** Equivalent two-disc inertia I1·I2/(I1+I2). */
export function equivalentInertia(I1: number, I2: number): number {
  return (I1 + I2) > 0 ? (I1 * I2) / (I1 + I2) : 0;
}

export function summarize(r: TorsionalResult): { naturalFrequencyHz: number; naturalFrequencyRpm: number; mode: string } {
  return { naturalFrequencyHz: r.naturalFrequencyHz, naturalFrequencyRpm: r.naturalFrequencyRpm, mode: r.mode };
}
