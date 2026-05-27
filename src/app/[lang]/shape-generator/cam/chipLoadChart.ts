/**
 * chipLoadChart.ts — Chip-load (cut chart) lookup table for CNC
 * milling.
 *
 * "Chip load" is the thickness of material removed by each cutter
 * flute per revolution (mm/tooth). It defines safe feed rates:
 *
 *     feedrate (mm/min) = chip_load × flutes × RPM
 *
 * Bigger chip load → faster but riskier (tool can break or chatter).
 * Smaller chip load → safer but slower and tool wears faster (rubbing).
 *
 * The chart is keyed by (material × tool type × cutter diameter).
 * Tool manufacturers publish these in catalogs; this module ships
 * a reference table for common materials.
 *
 * Usage: caller picks a row + a diameter, then feeds it into
 * `feedrateFor(...)` to get the recommended SFM/IPM (or RPM/feed
 * in metric).
 */

export type CutterMaterial = 'HSS' | 'carbide-uncoated' | 'carbide-coated' | 'ceramic';

export type WorkMaterial =
  | 'aluminum-6061'
  | 'aluminum-7075'
  | 'mild-steel-A36'
  | 'tool-steel-D2'
  | 'stainless-304'
  | 'titanium-Ti6Al4V'
  | 'brass-C360'
  | 'copper-C110'
  | 'plastic-ABS'
  | 'plastic-acetal'
  | 'wood';

export type CutterType = 'endmill-flat' | 'endmill-ball' | 'drill' | 'face-mill' | 'reamer';

export interface ChipLoadRow {
  cutter: CutterMaterial;
  workMaterial: WorkMaterial;
  cutterType: CutterType;
  /** Suggested SFM (surface feet per minute) — convert to m/min via × 0.3048. */
  sfm: number;
  /** Chip load mm/tooth at the reference diameter. */
  chipLoadMm: number;
  /** Reference cutter diameter (mm). Smaller diameters reduce chip load. */
  referenceDiameterMm: number;
}

// ── Built-in chart ─────────────────────────────────────────────

export const CHIP_LOAD_LIBRARY: ChipLoadRow[] = [
  { cutter: 'HSS', workMaterial: 'aluminum-6061', cutterType: 'endmill-flat', sfm: 350, chipLoadMm: 0.05, referenceDiameterMm: 10 },
  { cutter: 'carbide-uncoated', workMaterial: 'aluminum-6061', cutterType: 'endmill-flat', sfm: 1000, chipLoadMm: 0.08, referenceDiameterMm: 10 },
  { cutter: 'carbide-coated', workMaterial: 'aluminum-6061', cutterType: 'endmill-flat', sfm: 1500, chipLoadMm: 0.10, referenceDiameterMm: 10 },
  { cutter: 'HSS', workMaterial: 'mild-steel-A36', cutterType: 'endmill-flat', sfm: 100, chipLoadMm: 0.03, referenceDiameterMm: 10 },
  { cutter: 'carbide-uncoated', workMaterial: 'mild-steel-A36', cutterType: 'endmill-flat', sfm: 300, chipLoadMm: 0.05, referenceDiameterMm: 10 },
  { cutter: 'carbide-coated', workMaterial: 'mild-steel-A36', cutterType: 'endmill-flat', sfm: 500, chipLoadMm: 0.07, referenceDiameterMm: 10 },
  { cutter: 'carbide-coated', workMaterial: 'tool-steel-D2', cutterType: 'endmill-flat', sfm: 200, chipLoadMm: 0.03, referenceDiameterMm: 10 },
  { cutter: 'carbide-coated', workMaterial: 'stainless-304', cutterType: 'endmill-flat', sfm: 250, chipLoadMm: 0.04, referenceDiameterMm: 10 },
  { cutter: 'carbide-coated', workMaterial: 'titanium-Ti6Al4V', cutterType: 'endmill-flat', sfm: 150, chipLoadMm: 0.03, referenceDiameterMm: 10 },
  { cutter: 'carbide-coated', workMaterial: 'brass-C360', cutterType: 'endmill-flat', sfm: 800, chipLoadMm: 0.10, referenceDiameterMm: 10 },
  { cutter: 'HSS', workMaterial: 'plastic-ABS', cutterType: 'endmill-flat', sfm: 400, chipLoadMm: 0.07, referenceDiameterMm: 10 },
  { cutter: 'HSS', workMaterial: 'wood', cutterType: 'endmill-flat', sfm: 600, chipLoadMm: 0.20, referenceDiameterMm: 10 },
  // Drills (smaller chip load).
  { cutter: 'HSS', workMaterial: 'mild-steel-A36', cutterType: 'drill', sfm: 80, chipLoadMm: 0.05, referenceDiameterMm: 10 },
  { cutter: 'carbide-coated', workMaterial: 'aluminum-6061', cutterType: 'drill', sfm: 800, chipLoadMm: 0.10, referenceDiameterMm: 10 },
];

// ── Lookup ─────────────────────────────────────────────────────

export function findChipLoad(
  workMaterial: WorkMaterial,
  cutter: CutterMaterial,
  cutterType: CutterType,
): ChipLoadRow | null {
  return CHIP_LOAD_LIBRARY.find(r =>
    r.workMaterial === workMaterial &&
    r.cutter === cutter &&
    r.cutterType === cutterType,
  ) ?? null;
}

export function listForMaterial(workMaterial: WorkMaterial): ChipLoadRow[] {
  return CHIP_LOAD_LIBRARY.filter(r => r.workMaterial === workMaterial);
}

// ── Calculations ───────────────────────────────────────────────

export interface CuttingParams {
  /** Cutter diameter, mm. */
  diameterMm: number;
  /** Number of flutes. */
  flutes: number;
  /** Optional override RPM. */
  rpmOverride?: number;
}

export interface CuttingRecommendation {
  rpm: number;
  feedrateMmPerMin: number;
  chipLoadMm: number;
  surfaceSpeedMpm: number;
}

export function recommendCutting(row: ChipLoadRow, params: CuttingParams): CuttingRecommendation {
  // SFM → m/min: × 0.3048.
  const surfaceSpeedMpm = row.sfm * 0.3048;
  // RPM = SFM × 12 / (π × diameter_inches) — equivalent in metric:
  //       RPM = SurfaceSpeed (mm/min) / (π × diameter_mm)
  //           = (SFM × 0.3048 × 1000) / (π × diameter_mm)
  const computedRpm = (surfaceSpeedMpm * 1000) / (Math.PI * params.diameterMm);
  const rpm = params.rpmOverride ?? computedRpm;
  // Diameter scaling for chip load: shrinks linearly below reference diameter.
  const diameterScale = Math.min(1, params.diameterMm / row.referenceDiameterMm);
  const chipLoad = row.chipLoadMm * diameterScale;
  const feed = chipLoad * params.flutes * rpm;
  return { rpm, feedrateMmPerMin: feed, chipLoadMm: chipLoad, surfaceSpeedMpm };
}

// ── Safety + warnings ─────────────────────────────────────────

export interface CuttingWarning {
  field: 'rpm' | 'feedrate' | 'chip-load';
  message: string;
}

export function validateRecommendation(
  rec: CuttingRecommendation,
  machineMaxRpm: number,
  machineMaxFeedMmPerMin: number,
): CuttingWarning[] {
  const warnings: CuttingWarning[] = [];
  if (rec.rpm > machineMaxRpm) {
    warnings.push({ field: 'rpm', message: `RPM ${rec.rpm.toFixed(0)} exceeds machine max ${machineMaxRpm}.` });
  }
  if (rec.feedrateMmPerMin > machineMaxFeedMmPerMin) {
    warnings.push({ field: 'feedrate', message: `Feedrate ${rec.feedrateMmPerMin.toFixed(0)} exceeds machine max ${machineMaxFeedMmPerMin}.` });
  }
  if (rec.chipLoadMm < 0.01) {
    warnings.push({ field: 'chip-load', message: 'Chip load < 0.01 mm → rubbing wear risk.' });
  }
  return warnings;
}

// ── Summary ────────────────────────────────────────────────────

export interface ChartSummary {
  rowCount: number;
  uniqueMaterials: number;
  uniqueCutterTypes: number;
  fastestSfm: number;
}

export function summarize(): ChartSummary {
  const materials = new Set(CHIP_LOAD_LIBRARY.map(r => r.workMaterial));
  const types = new Set(CHIP_LOAD_LIBRARY.map(r => r.cutterType));
  const maxSfm = CHIP_LOAD_LIBRARY.reduce((m, r) => Math.max(m, r.sfm), 0);
  return {
    rowCount: CHIP_LOAD_LIBRARY.length,
    uniqueMaterials: materials.size,
    uniqueCutterTypes: types.size,
    fastestSfm: maxSfm,
  };
}
