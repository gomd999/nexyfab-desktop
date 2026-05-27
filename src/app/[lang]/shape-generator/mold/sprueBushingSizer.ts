/**
 * sprueBushingSizer.ts — Size sprue bushing for injection mold.
 *
 * The sprue connects the nozzle of the injection molding machine
 * to the runner system. Key dimensions:
 *
 *   - "O" diameter (orifice): smaller end matching machine nozzle.
 *   - "A" diameter (large end): wider end at parting line.
 *   - Length L: from machine nozzle face to parting line.
 *   - Taper: typically 0.5°-1.5° per side (radial).
 *
 * Sizing rules (DME):
 *
 *   - O = nozzle orifice + 1 mm (clearance).
 *   - A = O + 2·L·tan(taper).
 *   - L ≤ mold plate thickness − 5 mm.
 *
 * Module computes the bushing geometry and validates against
 * mold/machine constraints.
 */

export interface SprueOptions {
  /** Machine nozzle orifice (mm). */
  nozzleOrificeMm: number;
  /** Sprue length to parting line (mm). */
  lengthMm: number;
  /** Taper angle per side (deg). */
  taperDeg: number;
  /** Material flow rate (cm³/s). */
  flowRateCm3PerS: number;
  /** Polymer viscosity (Pa·s). */
  viscosityPaS: number;
  /** Mold plate thickness (mm). */
  moldPlateThicknessMm: number;
}

export const DEFAULT_OPTIONS: SprueOptions = {
  nozzleOrificeMm: 4,
  lengthMm: 50,
  taperDeg: 1.0,
  flowRateCm3PerS: 30,
  viscosityPaS: 500,
  moldPlateThicknessMm: 80,
};

export interface SprueGeometry {
  orificeDiameterMm: number;
  largeDiameterMm: number;
  lengthMm: number;
  taperPerSideDeg: number;
  volumeMm3: number;
  pressureDropKpa: number;
}

export interface SizeResult {
  geometry: SprueGeometry;
  feasible: boolean;
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function sizeSprue(options: Partial<SprueOptions> = {}): SizeResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const warnings: string[] = [];

  const orifice = opts.nozzleOrificeMm + 1;
  const taperPerSide = (opts.taperDeg * Math.PI) / 180;
  const largeDia = orifice + 2 * opts.lengthMm * Math.tan(taperPerSide);

  if (opts.lengthMm > opts.moldPlateThicknessMm - 5) {
    warnings.push(`Length ${opts.lengthMm} mm exceeds plate thickness − 5 mm.`);
  }
  if (opts.taperDeg < 0.5 || opts.taperDeg > 1.5) {
    warnings.push(`Taper ${opts.taperDeg}° outside recommended 0.5-1.5° range.`);
  }
  if (orifice < 3) {
    warnings.push('Orifice < 3 mm: may freeze prematurely.');
  }

  // Volume of frustum: V = (π·L/3)·(r1² + r1·r2 + r2²).
  const r1 = orifice / 2;
  const r2 = largeDia / 2;
  const volume = (Math.PI * opts.lengthMm / 3) * (r1 * r1 + r1 * r2 + r2 * r2);

  // Pressure drop using Hagen-Poiseuille for the average cross-section.
  const avgRadiusM = ((r1 + r2) / 2) / 1000;
  const lengthM = opts.lengthMm / 1000;
  const flowM3PerS = opts.flowRateCm3PerS * 1e-6;
  const dpPa = (8 * opts.viscosityPaS * lengthM * flowM3PerS) / (Math.PI * Math.pow(avgRadiusM, 4));
  const dpKpa = dpPa / 1000;

  return {
    geometry: {
      orificeDiameterMm: orifice,
      largeDiameterMm: largeDia,
      lengthMm: opts.lengthMm,
      taperPerSideDeg: opts.taperDeg,
      volumeMm3: volume,
      pressureDropKpa: dpKpa,
    },
    feasible: warnings.length === 0,
    warnings,
  };
}

// ── Standard DME bushing match ───────────────────────────────

export interface DmeBushing {
  partNumber: string;
  orificeMm: number;
  largeMm: number;
  lengthMm: number;
}

export const DME_CATALOG: DmeBushing[] = [
  { partNumber: 'SP-25-3',   orificeMm: 3,   largeMm: 6,   lengthMm: 25 },
  { partNumber: 'SP-37-4',   orificeMm: 4,   largeMm: 7,   lengthMm: 37 },
  { partNumber: 'SP-50-5',   orificeMm: 5,   largeMm: 9,   lengthMm: 50 },
  { partNumber: 'SP-75-6',   orificeMm: 6,   largeMm: 11,  lengthMm: 75 },
  { partNumber: 'SP-100-8',  orificeMm: 8,   largeMm: 14,  lengthMm: 100 },
];

export function matchStandard(geometry: SprueGeometry): DmeBushing | null {
  let best: DmeBushing | null = null;
  let bestScore = Infinity;
  for (const b of DME_CATALOG) {
    const oDelta = Math.abs(b.orificeMm - geometry.orificeDiameterMm);
    const aDelta = Math.abs(b.largeMm - geometry.largeDiameterMm);
    const lDelta = Math.abs(b.lengthMm - geometry.lengthMm);
    const score = oDelta * 3 + aDelta + lDelta * 0.5;
    if (score < bestScore) { bestScore = score; best = b; }
  }
  return best;
}

// ── Cycle time impact ────────────────────────────────────────

export function sprueCoolingTimeSec(geometry: SprueGeometry, wallThicknessMm: number, alphaMm2PerSec: number = 0.07): number {
  // Cooling time scales with squared half-thickness: t ≈ s²·ln(...)·... Simplified.
  const halfT = wallThicknessMm / 2;
  return (halfT * halfT) / (Math.PI * Math.PI * alphaMm2PerSec) * Math.log((4 / Math.PI) * 8);
}

// ── Summary ────────────────────────────────────────────────────

export interface SprueSummary {
  orificeDiameterMm: number;
  largeDiameterMm: number;
  lengthMm: number;
  volumeMm3: number;
  pressureDropKpa: number;
  feasible: boolean;
}

export function summarize(result: SizeResult): SprueSummary {
  return {
    orificeDiameterMm: result.geometry.orificeDiameterMm,
    largeDiameterMm: result.geometry.largeDiameterMm,
    lengthMm: result.geometry.lengthMm,
    volumeMm3: result.geometry.volumeMm3,
    pressureDropKpa: result.geometry.pressureDropKpa,
    feasible: result.feasible,
  };
}
