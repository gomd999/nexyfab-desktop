/**
 * clampForceEstimator.ts — Estimate the injection-molding machine clamp
 * (tonnage) force needed to keep the mold shut against cavity pressure.
 *
 *   F_clamp = projectedArea · cavityPressure · safetyFactor
 *
 * The projected area is the part (plus runners) silhouette in the plane
 * perpendicular to the mold-opening direction — the area the melt
 * pressure pushes the mold open across. Cavity pressure depends on the
 * polymer + wall thickness + flow length (thin/long → higher pressure).
 *
 * Output is in tonnes-force (metric) and kN, with the recommended
 * machine size (next standard tonnage up).
 */

export type ClampPolymer = 'PP' | 'PE' | 'ABS' | 'PS' | 'PC' | 'PA' | 'POM' | 'PMMA';

// Typical specific cavity pressure (MPa) — moderate flow length baseline.
const CAVITY_PRESSURE_MPA: Record<ClampPolymer, number> = {
  PP: 30, PE: 30, ABS: 40, PS: 35, PC: 50, PA: 45, POM: 45, PMMA: 45,
};

export interface ClampForceInput {
  projectedAreaMm2: number;       // part(s) + runners silhouette
  polymer: ClampPolymer;
  cavityCount?: number;           // multiply projected area, default 1
  flowLengthToWallRatio?: number; // L/t — raises pressure if high
  safetyFactor?: number;          // default 1.2
  overridePressureMpa?: number;
}

export interface ClampForceResult {
  cavityPressureMpa: number;
  totalProjectedAreaMm2: number;
  clampForceKn: number;
  clampForceTonnes: number;
  recommendedMachineTonnes: number;
  warnings: string[];
}

const STANDARD_TONNAGES = [50, 80, 100, 150, 180, 220, 250, 320, 400, 500, 650, 800, 1000, 1300, 1600, 2000, 2500, 3000];

export function estimate(input: ClampForceInput): ClampForceResult {
  const warnings: string[] = [];
  if (input.projectedAreaMm2 <= 0) warnings.push('Projected area must be positive.');

  const cavities = Math.max(1, input.cavityCount ?? 1);
  const basePressure = input.overridePressureMpa ?? CAVITY_PRESSURE_MPA[input.polymer] ?? 40;
  if (!CAVITY_PRESSURE_MPA[input.polymer] && input.overridePressureMpa == null) {
    warnings.push(`Unknown polymer "${input.polymer}"; defaulting to 40 MPa.`);
  }

  // Flow-length factor: above L/t≈150 pressure climbs.
  const lt = input.flowLengthToWallRatio ?? 100;
  const flowFactor = 1 + Math.max(0, (lt - 150) / 150) * 0.5;
  const pressure = basePressure * flowFactor;

  const safety = input.safetyFactor ?? 1.2;
  const totalArea = input.projectedAreaMm2 * cavities;

  // Force = pressure[MPa = N/mm²] × area[mm²] = N. ×safety.
  const forceN = pressure * totalArea * safety;
  const forceKn = forceN / 1000;
  const forceTonnes = forceN / 9806.65; // N → tonne-force

  const recommended = STANDARD_TONNAGES.find(t => t >= forceTonnes) ?? STANDARD_TONNAGES[STANDARD_TONNAGES.length - 1]!;

  return {
    cavityPressureMpa: pressure,
    totalProjectedAreaMm2: totalArea,
    clampForceKn: forceKn,
    clampForceTonnes: forceTonnes,
    recommendedMachineTonnes: recommended,
    warnings,
  };
}

/** Projected area of a simple rectangle / circle helper. */
export function rectangleProjectedArea(widthMm: number, heightMm: number): number {
  return widthMm * heightMm;
}

export function circleProjectedArea(diameterMm: number): number {
  return Math.PI * diameterMm * diameterMm / 4;
}

export function summarize(r: ClampForceResult): { clampForceTonnes: number; recommendedMachineTonnes: number; cavityPressureMpa: number } {
  return {
    clampForceTonnes: r.clampForceTonnes,
    recommendedMachineTonnes: r.recommendedMachineTonnes,
    cavityPressureMpa: r.cavityPressureMpa,
  };
}
