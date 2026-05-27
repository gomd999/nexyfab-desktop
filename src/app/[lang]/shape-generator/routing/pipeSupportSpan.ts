/**
 * pipeSupportSpan.ts — Compute the maximum span between pipe supports
 * limited by (a) allowable mid-span sag (deflection) and (b) allowable
 * bending stress, for a uniformly loaded simply-supported pipe.
 *
 * Treating the pipe as a uniformly loaded beam (w = weight per unit
 * length, full of fluid):
 *
 *   sag    δ = 5·w·L⁴ / (384·E·I)
 *   stress σ = w·L²·c / (8·I)        (c = OD/2, M = wL²/8)
 *
 * Span limited by sag:    L_sag = (384·E·I·δ_allow / (5·w))^(1/4)
 * Span limited by stress: L_str = sqrt(8·σ_allow·I / (w·c))
 *
 * The governing (smaller) span is the recommended maximum support
 * spacing. We also report the natural-frequency-based limit (avoid
 * resonance ~ keep first mode > 4 Hz, MSS SP-58 style).
 */

export interface PipeSupportInput {
  outerDiameterMm: number;
  wallThicknessMm: number;
  pipeMaterialDensityKgM3: number; // pipe material (e.g. steel 7850)
  fluidDensityKgM3?: number;       // contents, default 1000 (water)
  youngMpa: number;
  allowableStressMpa: number;
  allowableSagMm?: number;         // default span/360 resolved iteratively → use absolute, default 3 mm
  insulationMassPerMKg?: number;   // optional added mass
}

export interface PipeSupportResult {
  spanBySagMm: number;
  spanByStressMm: number;
  recommendedSpanMm: number;
  governing: 'sag' | 'stress';
  weightPerMeterN: number;
  momentOfInertiaMm4: number;
  firstNaturalFreqHz: number;
  warnings: string[];
}

export function compute(input: PipeSupportInput): PipeSupportResult {
  const warnings: string[] = [];
  const D = input.outerDiameterMm;
  const t = input.wallThicknessMm;
  if (D <= 0 || t <= 0 || t >= D / 2) warnings.push('Check OD / wall thickness.');
  if (input.youngMpa <= 0 || input.allowableStressMpa <= 0) warnings.push('E and allowable stress must be positive.');

  const Di = D - 2 * t;
  // Second moment of area of a hollow circle (mm⁴).
  const I = (Math.PI / 64) * (Math.pow(D, 4) - Math.pow(Di, 4));
  const c = D / 2;

  // Weight per metre (N/m): pipe metal + fluid + insulation.
  const areaMetalM2 = (Math.PI / 4) * (Math.pow(D, 2) - Math.pow(Di, 2)) * 1e-6;
  const areaBoreM2 = (Math.PI / 4) * Math.pow(Di, 2) * 1e-6;
  const g = 9.80665;
  const fluidDensity = input.fluidDensityKgM3 ?? 1000;
  const massPerM = areaMetalM2 * input.pipeMaterialDensityKgM3
    + areaBoreM2 * fluidDensity
    + (input.insulationMassPerMKg ?? 0);
  const wPerM = massPerM * g;       // N/m
  const wPerMm = wPerM / 1000;      // N/mm

  const sagAllow = input.allowableSagMm ?? 3;
  const E = input.youngMpa;

  // L_sag (mm): δ = 5wL⁴/(384EI) → L = (384·E·I·δ/(5·w))^(1/4)
  const Lsag = wPerMm > 0 ? Math.pow((384 * E * I * sagAllow) / (5 * wPerMm), 0.25) : Infinity;
  // L_str (mm): σ = wL²c/(8I) → L = sqrt(8·σ·I/(w·c))
  const Lstr = wPerMm > 0 ? Math.sqrt((8 * input.allowableStressMpa * I) / (wPerMm * c)) : Infinity;

  const governing: 'sag' | 'stress' = Lsag <= Lstr ? 'sag' : 'stress';
  const recommended = Math.min(Lsag, Lstr);

  // First natural frequency of a simply-supported beam (Hz):
  // f1 = (π/2)·sqrt(EI/(m·L⁴)) ; E in N/mm², I in mm⁴, m in kg/mm, L in mm.
  const mPerMm = massPerM / 1000; // kg/mm
  const Lm = recommended;
  const EI_N_mm2 = E * I; // N·mm²
  const f1 = (Lm > 0 && mPerMm > 0)
    ? (Math.PI / 2) * Math.sqrt(EI_N_mm2 / (mPerMm * Math.pow(Lm, 4)))
    : 0;
  if (f1 > 0 && f1 < 4) warnings.push(`First natural frequency ${f1.toFixed(1)} Hz < 4 Hz; reduce span to avoid resonance.`);

  return {
    spanBySagMm: Lsag,
    spanByStressMm: Lstr,
    recommendedSpanMm: recommended,
    governing,
    weightPerMeterN: wPerM,
    momentOfInertiaMm4: I,
    firstNaturalFreqHz: f1,
    warnings,
  };
}

/** Number of supports needed for a run of given length. */
export function supportCount(result: PipeSupportResult, runLengthMm: number): number {
  if (result.recommendedSpanMm <= 0) return 0;
  return Math.ceil(runLengthMm / result.recommendedSpanMm) + 1;
}

export function summarize(r: PipeSupportResult): { recommendedSpanMm: number; governing: 'sag' | 'stress'; firstNaturalFreqHz: number } {
  return { recommendedSpanMm: r.recommendedSpanMm, governing: r.governing, firstNaturalFreqHz: r.firstNaturalFreqHz };
}
