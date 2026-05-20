/**
 * turningSurfaceFinish.ts — Theoretical surface roughness in single-point turning.
 *
 *   Ra   ≈ f² / (32 · rε)       (peak-to-valley arithmetic mean, geometric)
 *   Rmax ≈ f² / (8  · rε)       (max profile height)
 *
 * f = feed per revolution, rε = tool nose radius (mm). Result in µm.
 * Below a minimum feed the model breaks down (built-up edge dominates).
 */

export interface TurningFinishInput {
  feedMmPerRev: number;          // f
  noseRadiusMm: number;          // rε
  targetRaMicrometer?: number;   // optional acceptance
}

export interface TurningFinishResult {
  raMicrometer: number;
  rmaxMicrometer: number;
  isoGradeN: number;             // N-number (ISO 1302) for Ra
  meetsTarget: boolean;          // true if no target or Ra ≤ target
  warnings: string[];
}

// ISO 1302 roughness grade upper bounds (µm Ra).
const N_GRADE_RA: { n: number; max: number }[] = [
  { n: 1, max: 0.025 }, { n: 2, max: 0.05 }, { n: 3, max: 0.1 }, { n: 4, max: 0.2 },
  { n: 5, max: 0.4 }, { n: 6, max: 0.8 }, { n: 7, max: 1.6 }, { n: 8, max: 3.2 },
  { n: 9, max: 6.3 }, { n: 10, max: 12.5 }, { n: 11, max: 25 }, { n: 12, max: 50 },
];

function isoGrade(raUm: number): number {
  for (const g of N_GRADE_RA) if (raUm <= g.max) return g.n;
  return 12;
}

export function compute(input: TurningFinishInput): TurningFinishResult {
  const warnings: string[] = [];
  const { feedMmPerRev: f, noseRadiusMm: r } = input;
  if (f <= 0) warnings.push('Feed must be positive.');
  if (r <= 0) warnings.push('Nose radius must be positive.');

  const raMm = r > 0 ? (f * f) / (32 * r) : Infinity;
  const rmaxMm = r > 0 ? (f * f) / (8 * r) : Infinity;
  const raUm = raMm * 1000;
  const rmaxUm = rmaxMm * 1000;

  if (f > 0 && r > 0 && f < 0.05) warnings.push('Feed < 0.05 mm/rev: built-up edge may dominate, model optimistic.');

  const meets = input.targetRaMicrometer === undefined || raUm <= input.targetRaMicrometer;
  if (input.targetRaMicrometer !== undefined && !meets) {
    warnings.push(`Ra ${raUm.toFixed(2)} µm exceeds target ${input.targetRaMicrometer} µm.`);
  }

  return {
    raMicrometer: raUm,
    rmaxMicrometer: rmaxUm,
    isoGradeN: isoGrade(raUm),
    meetsTarget: meets,
    warnings,
  };
}

/** Largest feed (mm/rev) that still meets a target Ra at a given nose radius. */
export function feedForTargetRa(noseRadiusMm: number, targetRaMicrometer: number): number {
  const raMm = targetRaMicrometer / 1000;
  return Math.sqrt(32 * noseRadiusMm * raMm);
}

export function summarize(r: TurningFinishResult): {
  raMicrometer: number; isoGradeN: number; meetsTarget: boolean;
} {
  return { raMicrometer: r.raMicrometer, isoGradeN: r.isoGradeN, meetsTarget: r.meetsTarget };
}
