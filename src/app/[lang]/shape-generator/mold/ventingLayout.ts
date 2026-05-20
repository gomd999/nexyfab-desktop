/**
 * ventingLayout.ts — Size and place mold vents so trapped air/gas
 * escapes during injection without flashing.
 *
 * Vent depth must be below the flash threshold of the polymer (so melt
 * doesn't seep into the vent) but deep enough to release gas:
 *
 *   typical depth (mm): PE/PP 0.025, ABS/PS 0.038, PC/PA 0.013, PMMA 0.020
 *
 * Vent land length (the shallow section before the relief channel) is
 * usually 1–3 mm; the relief channel that follows is much deeper.
 *
 * Placement: vents go at the *last-to-fill* regions — typically the
 * ends of flow paths and weld-line locations. Given a list of candidate
 * perimeter points with a fill-time estimate, we pick the latest-filling
 * ones and space vents around the perimeter at a target pitch.
 */

export type VentPolymer = 'PE' | 'PP' | 'ABS' | 'PS' | 'PC' | 'PA' | 'PMMA' | 'POM';

const FLASH_DEPTH_MM: Record<VentPolymer, number> = {
  PE: 0.025, PP: 0.025, ABS: 0.038, PS: 0.038, PC: 0.013, PA: 0.013, PMMA: 0.020, POM: 0.020,
};

export interface PerimeterPoint {
  id: string;
  position: { x: number; y: number };
  fillTimeMs: number; // estimated time melt reaches this point
}

export interface VentingInput {
  polymer: VentPolymer;
  perimeter: PerimeterPoint[];
  ventWidthMm?: number;     // default 6
  ventLandLengthMm?: number; // default 1.5
  targetPitchMm?: number;   // spacing between vents along perimeter
}

export interface PlacedVent {
  atPointId: string;
  position: { x: number; y: number };
  depthMm: number;
  widthMm: number;
  landLengthMm: number;
  rank: number; // 1 = last-to-fill (highest priority)
}

export interface VentingResult {
  vents: PlacedVent[];
  ventDepthMm: number;
  totalVentCount: number;
  warnings: string[];
}

export function layoutVents(input: VentingInput): VentingResult {
  const warnings: string[] = [];
  const depth = FLASH_DEPTH_MM[input.polymer];
  if (depth == null) warnings.push(`Unknown polymer "${input.polymer}".`);
  if (input.perimeter.length === 0) warnings.push('No perimeter points.');

  const ventDepth = depth ?? 0.025;
  const width = input.ventWidthMm ?? 6;
  const land = input.ventLandLengthMm ?? 1.5;
  const pitch = input.targetPitchMm ?? 25;

  // Sort by fill time descending — last-to-fill first (highest priority).
  const ranked = [...input.perimeter].sort((a, b) => b.fillTimeMs - a.fillTimeMs);

  const vents: PlacedVent[] = [];
  const placed: { x: number; y: number }[] = [];
  let rank = 1;
  for (const p of ranked) {
    // Skip if too close to an already-placed vent (respect target pitch).
    const tooClose = placed.some(q => Math.hypot(q.x - p.position.x, q.y - p.position.y) < pitch);
    if (tooClose) continue;
    vents.push({
      atPointId: p.id,
      position: p.position,
      depthMm: ventDepth,
      widthMm: width,
      landLengthMm: land,
      rank: rank++,
    });
    placed.push(p.position);
  }

  return { vents, ventDepthMm: ventDepth, totalVentCount: vents.length, warnings };
}

/** Total vent cross-sectional area (mm²) — sanity check vs cavity volume. */
export function totalVentArea(result: VentingResult): number {
  return result.vents.reduce((sum, v) => sum + v.depthMm * v.widthMm, 0);
}

/** Check the vent depth doesn't exceed the flash threshold for the polymer. */
export function checkFlashRisk(depthMm: number, polymer: VentPolymer): { safe: boolean; thresholdMm: number } {
  const threshold = FLASH_DEPTH_MM[polymer] ?? 0.025;
  return { safe: depthMm <= threshold + 1e-9, thresholdMm: threshold };
}

export function summarize(r: VentingResult): { totalVentCount: number; ventDepthMm: number; totalAreaMm2: number } {
  return { totalVentCount: r.totalVentCount, ventDepthMm: r.ventDepthMm, totalAreaMm2: totalVentArea(r) };
}
