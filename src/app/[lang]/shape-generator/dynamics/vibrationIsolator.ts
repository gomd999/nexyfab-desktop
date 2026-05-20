/**
 * vibrationIsolator.ts — Size a vibration isolator (spring/mount) and
 * compute the transmissibility of force/motion from a machine to its
 * foundation.
 *
 * Natural frequency from static deflection δ (m):
 *   f_n = (1/2π)·sqrt(g/δ)
 *
 * Frequency ratio r = f_forcing / f_n. Transmissibility (with damping ζ):
 *
 *   TR = sqrt(1 + (2ζr)²) / sqrt((1 − r²)² + (2ζr)²)
 *
 * Isolation only occurs for r > √2 (TR < 1). Isolation efficiency:
 *   η = (1 − TR)·100 %
 *
 * We solve the required static deflection (→ spring rate) for a target
 * isolation efficiency at the forcing frequency.
 */

export interface IsolatorInput {
  machineMassKg: number;
  forcingFrequencyHz: number;
  staticDeflectionMm?: number;   // if known; else derive from target
  dampingRatio?: number;         // ζ, default 0.05
  targetIsolationPercent?: number; // if no deflection given
}

export interface IsolatorResult {
  naturalFrequencyHz: number;
  frequencyRatio: number;
  transmissibility: number;
  isolationPercent: number;
  staticDeflectionMm: number;
  springRateNmm: number;        // per-mount basis = total
  isolating: boolean;
  warnings: string[];
}

const G = 9.80665;

export function compute(input: IsolatorInput): IsolatorResult {
  const warnings: string[] = [];
  if (input.machineMassKg <= 0) warnings.push('Machine mass must be positive.');
  if (input.forcingFrequencyHz <= 0) warnings.push('Forcing frequency must be positive.');

  const zeta = input.dampingRatio ?? 0.05;

  let deflectionMm: number;
  if (input.staticDeflectionMm != null && input.staticDeflectionMm > 0) {
    deflectionMm = input.staticDeflectionMm;
  } else {
    // Solve deflection for target isolation: choose fn so r gives target TR.
    const targetIso = (input.targetIsolationPercent ?? 90) / 100;
    const targetTR = Math.max(0.001, 1 - targetIso);
    // Undamped TR ≈ 1/(r²−1) for r>√2 → r = sqrt(1 + 1/TR).
    const r = Math.sqrt(1 + 1 / targetTR);
    const fn = input.forcingFrequencyHz / r;
    const omega = 2 * Math.PI * fn;
    // δ = g/ωn²  (m) → mm.
    deflectionMm = (G / (omega * omega)) * 1000;
  }

  const deflM = deflectionMm / 1000;
  const fn = deflM > 0 ? (1 / (2 * Math.PI)) * Math.sqrt(G / deflM) : 0;
  const r = fn > 0 ? input.forcingFrequencyHz / fn : 0;

  const num = Math.sqrt(1 + Math.pow(2 * zeta * r, 2));
  const den = Math.sqrt(Math.pow(1 - r * r, 2) + Math.pow(2 * zeta * r, 2));
  const TR = den > 0 ? num / den : 0;
  const isolationPercent = (1 - TR) * 100;

  // Spring rate: k = m·ωn² (total). N/mm.
  const omegaN = 2 * Math.PI * fn;
  const kNmm = (input.machineMassKg * omegaN * omegaN) / 1000;

  const isolating = r > Math.SQRT2;
  if (!isolating && fn > 0) warnings.push(`Frequency ratio ${r.toFixed(2)} ≤ √2: amplifies vibration. Soften the mount (more deflection).`);

  return {
    naturalFrequencyHz: fn,
    frequencyRatio: r,
    transmissibility: TR,
    isolationPercent,
    staticDeflectionMm: deflectionMm,
    springRateNmm: kNmm,
    isolating,
    warnings,
  };
}

/** Transmissibility at an arbitrary frequency ratio + damping. */
export function transmissibility(r: number, zeta: number): number {
  const num = Math.sqrt(1 + Math.pow(2 * zeta * r, 2));
  const den = Math.sqrt(Math.pow(1 - r * r, 2) + Math.pow(2 * zeta * r, 2));
  return den > 0 ? num / den : 0;
}

export function summarize(r: IsolatorResult): { naturalFrequencyHz: number; transmissibility: number; isolationPercent: number; isolating: boolean } {
  return { naturalFrequencyHz: r.naturalFrequencyHz, transmissibility: r.transmissibility, isolationPercent: r.isolationPercent, isolating: r.isolating };
}
