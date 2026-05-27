/**
 * sprueRunnerSizer.ts — Size sprue & runners for injection mold.
 *
 * Sprue cone:
 *   - Bottom diameter D₁ = nozzle orifice + 1 mm (typical)
 *   - Top diameter   D₂ = D₁ + 2·L·tan(α/2), α = 3° draft typical
 *   - Length L from nozzle to parting line
 *
 * Runner sizing rule of thumb (Menges/Mohren):
 *   D_runner = √W × √⁴L_eff / 3.7    (W in g, L_eff in mm)
 *
 * Or simpler design rule: D_runner ≥ part_wall + 1 mm and ≤ 10 mm.
 * Cross-section can be: full-round, trapezoidal, hexagonal, half-round.
 *
 * Pressure drop estimate (Hagen-Poiseuille analog for non-Newtonian):
 *   Δp ≈ (8 · L · μ_apparent · Q) / (π · R⁴)
 */

export type RunnerCrossSection = 'full-round' | 'trapezoidal' | 'hexagonal' | 'half-round';

export interface SprueInput {
  nozzleOrificeDiameterMm: number;
  lengthMm: number;
  draftAngleDeg?: number; // default 3°
}

export interface SprueResult {
  bottomDiameterMm: number;
  topDiameterMm: number;
  volumeMm3: number;
  warnings: string[];
}

export interface RunnerInput {
  partWeightG: number;
  runnerLengthMm: number;
  partWallThicknessMm: number;
  crossSection: RunnerCrossSection;
}

export interface RunnerResult {
  primaryDiameterMm: number;
  hydraulicDiameterMm: number;
  crossSectionAreaMm2: number;
  meetsWallRule: boolean;
  warnings: string[];
}

export function sizeSprue(input: SprueInput): SprueResult {
  const warnings: string[] = [];
  const draft = input.draftAngleDeg ?? 3;
  if (input.nozzleOrificeDiameterMm <= 0) warnings.push('Nozzle orifice diameter must be positive.');
  if (input.lengthMm <= 0) warnings.push('Sprue length must be positive.');

  const D1 = input.nozzleOrificeDiameterMm + 1;
  const D2 = D1 + 2 * input.lengthMm * Math.tan((draft * Math.PI / 180) / 2);
  // Volume of a truncated cone
  const V = (Math.PI * input.lengthMm / 12) * (D1 * D1 + D1 * D2 + D2 * D2);

  return { bottomDiameterMm: D1, topDiameterMm: D2, volumeMm3: V, warnings };
}

export function sizeRunner(input: RunnerInput): RunnerResult {
  const warnings: string[] = [];
  if (input.partWeightG <= 0) warnings.push('Part weight must be positive.');
  if (input.runnerLengthMm <= 0) warnings.push('Runner length must be positive.');

  // Menges/Mohren rule
  const D = (Math.sqrt(input.partWeightG) * Math.pow(input.runnerLengthMm, 0.25)) / 3.7;
  const Dwall = input.partWallThicknessMm + 1;
  const Dprimary = Math.max(D, Dwall, 2); // ≥ 2 mm absolute minimum
  const Dclamped = Math.min(Dprimary, 10);

  const { area, hydraulic } = crossSectionMetrics(Dclamped, input.crossSection);
  return {
    primaryDiameterMm: Dclamped,
    hydraulicDiameterMm: hydraulic,
    crossSectionAreaMm2: area,
    meetsWallRule: Dclamped >= Dwall - 1e-6,
    warnings,
  };
}

function crossSectionMetrics(D: number, section: RunnerCrossSection): { area: number; hydraulic: number } {
  switch (section) {
    case 'full-round': {
      const area = Math.PI * D * D / 4;
      return { area, hydraulic: D };
    }
    case 'half-round': {
      const r = D / 2;
      const area = Math.PI * r * r / 2;
      const perim = Math.PI * r + 2 * r;
      return { area, hydraulic: 4 * area / perim };
    }
    case 'trapezoidal': {
      // top width = D, bottom = D × 0.7, height = D × 0.6 (typical)
      const w1 = D;
      const w2 = D * 0.7;
      const h = D * 0.6;
      const area = (w1 + w2) * h / 2;
      const slant = Math.hypot((w1 - w2) / 2, h);
      const perim = w1 + w2 + 2 * slant;
      return { area, hydraulic: 4 * area / perim };
    }
    case 'hexagonal': {
      // regular hexagon inscribed in circle of diameter D
      const s = D / 2;
      const area = (3 * Math.sqrt(3) / 2) * s * s;
      const perim = 6 * s;
      return { area, hydraulic: 4 * area / perim };
    }
  }
}

export function pressureDrop(
  runner: RunnerResult,
  flowRateMm3PerS: number,
  apparentViscosityPaS: number,
): number {
  // Δp = 8·L·μ·Q / (π·R⁴) — using primary diameter as R≈D/2
  // For runner sized at 1m equivalent length we'd need actual length; this is per-unit-length.
  const R = runner.hydraulicDiameterMm / 2 / 1000; // mm → m
  if (R <= 0) return 0;
  // Q in mm³/s → m³/s
  const Q = flowRateMm3PerS * 1e-9;
  const deltaP_per_m = (8 * apparentViscosityPaS * Q) / (Math.PI * Math.pow(R, 4));
  return deltaP_per_m; // Pa/m
}

export function summarizeSprue(r: SprueResult): { bottomDiameterMm: number; topDiameterMm: number; volumeMm3: number } {
  return { bottomDiameterMm: r.bottomDiameterMm, topDiameterMm: r.topDiameterMm, volumeMm3: r.volumeMm3 };
}

export function summarizeRunner(r: RunnerResult): { primaryDiameterMm: number; meetsWallRule: boolean; crossSectionAreaMm2: number } {
  return { primaryDiameterMm: r.primaryDiameterMm, meetsWallRule: r.meetsWallRule, crossSectionAreaMm2: r.crossSectionAreaMm2 };
}
