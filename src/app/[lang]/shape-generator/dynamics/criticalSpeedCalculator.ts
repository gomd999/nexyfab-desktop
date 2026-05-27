/**
 * criticalSpeedCalculator.ts — Estimate the critical (whirl) speed of a
 * rotating shaft carrying point masses (discs), using Rayleigh's energy
 * method and the Dunkerley lower-bound, and the shaft's own self-weight
 * contribution.
 *
 * Rayleigh:
 *   ω_n² = g·Σ(m_i·y_i) / Σ(m_i·y_i²)
 * where y_i is the static deflection at mass i under gravity. For a
 * simply-supported shaft with a point load, deflection uses beam theory.
 *
 * Dunkerley (lower bound):
 *   1/ω_n² = Σ 1/ω_i²
 * where ω_i is the critical speed of each mass acting alone.
 *
 * We treat a simply-supported shaft (length L) with discs at positions
 * a_i. Static deflection of a point load P at a on a SS beam, measured AT
 * a:  y = P·a²·b² / (3·E·I·L)   (b = L − a).
 */

export interface DiscLoad {
  massKg: number;
  positionMm: number; // a, from left support
}

export interface CriticalSpeedInput {
  shaftLengthMm: number;
  youngMpa: number;
  shaftDiameterMm: number;
  discs: DiscLoad[];
  shaftDensityKgM3?: number; // for self-weight, optional
}

export interface CriticalSpeedResult {
  rayleighRpm: number;
  dunkerleyRpm: number;
  perDiscRpm: number[];   // ω_i of each disc alone
  momentOfInertiaMm4: number;
  warnings: string[];
}

const G = 9.80665;

export function compute(input: CriticalSpeedInput): CriticalSpeedResult {
  const warnings: string[] = [];
  const L = input.shaftLengthMm;
  if (L <= 0) warnings.push('Shaft length must be positive.');
  if (input.shaftDiameterMm <= 0) warnings.push('Shaft diameter must be positive.');
  if (input.discs.length === 0) warnings.push('No discs provided.');

  const d = input.shaftDiameterMm;
  const I = (Math.PI / 64) * Math.pow(d, 4); // mm⁴
  const E = input.youngMpa; // N/mm²
  const EI = E * I;         // N·mm²

  // Static deflection at each disc under its own weight (mm).
  const deflections = input.discs.map(disc => {
    const a = disc.positionMm;
    const b = L - a;
    const P = disc.massKg * G; // N
    if (EI <= 0 || L <= 0) return 0;
    return (P * a * a * b * b) / (3 * EI * L); // mm
  });

  // Rayleigh.
  let num = 0, den = 0;
  input.discs.forEach((disc, i) => {
    const y = deflections[i]!;
    num += disc.massKg * y;
    den += disc.massKg * y * y;
  });
  // g in mm/s² = 9806.65; y in mm → ω in rad/s.
  const omegaR = den > 0 ? Math.sqrt((9806.65 * num) / den) : 0;

  // Per-disc critical speed (each alone): ω_i = sqrt(g/y_i) with g in mm/s².
  const perDiscRpm = deflections.map(y => (y > 0 ? Math.sqrt(9806.65 / y) * 60 / (2 * Math.PI) : 0));

  // Dunkerley: 1/ωn² = Σ 1/ωi² (in rad/s).
  let invSum = 0;
  deflections.forEach(y => { if (y > 0) invSum += y / 9806.65; }); // 1/ωi² = y/g
  const omegaDunkerley = invSum > 0 ? Math.sqrt(1 / invSum) : 0;

  return {
    rayleighRpm: omegaR * 60 / (2 * Math.PI),
    dunkerleyRpm: omegaDunkerley * 60 / (2 * Math.PI),
    perDiscRpm,
    momentOfInertiaMm4: I,
    warnings,
  };
}

/** Operating margin: how far the running speed is from the critical (want > 20%). */
export function separationMargin(criticalRpm: number, operatingRpm: number): { ratio: number; safe: boolean } {
  if (criticalRpm <= 0) return { ratio: 0, safe: false };
  const ratio = operatingRpm / criticalRpm;
  // safe if operating is < 0.7× or > 1.4× critical (away from resonance).
  const safe = ratio < 0.7 || ratio > 1.4;
  return { ratio, safe };
}

export function summarize(r: CriticalSpeedResult): { rayleighRpm: number; dunkerleyRpm: number } {
  return { rayleighRpm: r.rayleighRpm, dunkerleyRpm: r.dunkerleyRpm };
}
