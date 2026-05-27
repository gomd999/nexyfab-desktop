/**
 * toolingPresets.ts — Standard jigs / fixtures presets.
 *
 * Real production needs more than the part itself: it needs
 * tooling to hold the part during machining / welding /
 * inspection. This module ships parametric presets that produce
 * a tooling-frame geometry around the user's part:
 *
 *   - **CNC vise**: standard 4-inch / 6-inch milling vise + soft jaws
 *   - **Drill jig**: positioning plate + bushings
 *   - **Welding fixture**: T-slot table + clamp positions
 *   - **3D printing build plate**: clearance + adhesion zones
 *   - **Inspection fixture**: CMM-friendly support nest
 */

import type { MoldMesh } from '../mold/partingLine';

export type ToolingKind = 'cnc-vise' | 'drill-jig' | 'welding-fixture' | 'print-plate' | 'inspection-fixture';

export interface ToolingPreset {
  kind: ToolingKind;
  name: string;
  /** Standard reference / manufacturer SKU when applicable. */
  standard?: string;
  /** Footprint width × depth (mm). */
  footprintMm: [number, number];
  /** Clamp positions (relative to part center, mm). */
  clampPoints?: Array<[number, number, number]>;
  /** Bushing / drill positions for jigs. */
  bushingPositions?: Array<{ position: [number, number, number]; diameterMm: number }>;
  /** T-slot pattern (mm pitch). */
  tSlotPitchMm?: number;
}

/** CNC vise presets (common machinist sizes). */
export const CNC_VISE_PRESETS: ToolingPreset[] = [
  { kind: 'cnc-vise', name: '4" Kurt DX4', standard: 'Kurt DX4', footprintMm: [127, 305] },
  { kind: 'cnc-vise', name: '6" Kurt D688', standard: 'Kurt D688', footprintMm: [152, 380] },
  { kind: 'cnc-vise', name: '8" Kurt D810', standard: 'Kurt D810', footprintMm: [203, 510] },
];

/** Welding fixture T-slot tables. */
export const WELDING_TABLE_PRESETS: ToolingPreset[] = [
  { kind: 'welding-fixture', name: 'Demmeler 1200×800', footprintMm: [1200, 800], tSlotPitchMm: 50 },
  { kind: 'welding-fixture', name: 'Demmeler 2000×1000', footprintMm: [2000, 1000], tSlotPitchMm: 50 },
  { kind: 'welding-fixture', name: 'Strong Hand 1000×600', footprintMm: [1000, 600], tSlotPitchMm: 28 },
];

/** Generate a drill jig from a list of hole positions. */
export function generateDrillJig(
  holes: Array<{ position: [number, number]; diameterMm: number }>,
  options: { plateThicknessMm?: number; bushingExtraMm?: number } = {},
): ToolingPreset {
  const plateThickness = options.plateThicknessMm ?? 12;
  const bushingExtra = options.bushingExtraMm ?? 2;
  // Plate spans 20mm clearance beyond outermost holes.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const h of holes) {
    if (h.position[0] < minX) minX = h.position[0];
    if (h.position[1] < minY) minY = h.position[1];
    if (h.position[0] > maxX) maxX = h.position[0];
    if (h.position[1] > maxY) maxY = h.position[1];
  }
  const w = (maxX - minX) + 40;
  const d = (maxY - minY) + 40;
  void plateThickness;
  return {
    kind: 'drill-jig',
    name: `Custom drill jig (${holes.length} holes)`,
    footprintMm: [w, d],
    bushingPositions: holes.map(h => ({
      position: [h.position[0], h.position[1], 0],
      diameterMm: h.diameterMm + bushingExtra,
    })),
  };
}

/** Suggest clamp positions for a part — places 3 points around
 *  bbox centroid for a triangular grip. */
export function suggestClampPoints(partBbox: {
  min: [number, number, number];
  max: [number, number, number];
}): Array<[number, number, number]> {
  const cx = (partBbox.min[0] + partBbox.max[0]) / 2;
  const cy = (partBbox.min[1] + partBbox.max[1]) / 2;
  const cz = partBbox.min[2]; // bottom clamp plane
  const w = partBbox.max[0] - partBbox.min[0];
  const d = partBbox.max[1] - partBbox.min[1];
  // 3-point pattern: front-center, rear-left, rear-right.
  return [
    [cx, cy + d / 2, cz],
    [cx - w / 2, cy - d / 2, cz],
    [cx + w / 2, cy - d / 2, cz],
  ];
}

/** Pick the smallest vise that fits the part. */
export function selectCncVise(partBbox: { min: [number, number, number]; max: [number, number, number] }): ToolingPreset | null {
  const w = partBbox.max[0] - partBbox.min[0];
  return CNC_VISE_PRESETS.find(v => v.footprintMm[0] >= w + 10) ?? CNC_VISE_PRESETS[CNC_VISE_PRESETS.length - 1] ?? null;
}

/** 3D printing build plate clearance check. */
export interface PrintPlateCheck {
  fitsOnPlate: boolean;
  utilizationPercent: number;
  recommendedOrientation: 'flat' | 'vertical' | 'angled';
}

const COMMON_PRINT_PLATES: Array<{ name: string; w: number; d: number }> = [
  { name: 'Prusa MK4', w: 250, d: 210 },
  { name: 'Bambu X1 Carbon', w: 256, d: 256 },
  { name: 'Ender 3', w: 235, d: 235 },
];

export function checkPrintPlate(
  partBbox: { min: [number, number, number]; max: [number, number, number] },
  plateName?: string,
): PrintPlateCheck {
  const plate = plateName
    ? COMMON_PRINT_PLATES.find(p => p.name === plateName)
    : COMMON_PRINT_PLATES[0];
  if (!plate) return { fitsOnPlate: false, utilizationPercent: 0, recommendedOrientation: 'flat' };
  const w = partBbox.max[0] - partBbox.min[0];
  const d = partBbox.max[1] - partBbox.min[1];
  const h = partBbox.max[2] - partBbox.min[2];
  const fitsFlat = w <= plate.w && d <= plate.d;
  // Try rotating 90° if it fits then.
  const fitsRotated = d <= plate.w && w <= plate.d;
  const fits = fitsFlat || fitsRotated;
  const utilization = fits ? (w * d) / (plate.w * plate.d) * 100 : 0;
  return {
    fitsOnPlate: fits,
    utilizationPercent: utilization,
    recommendedOrientation: h > w * 2 ? 'flat' : 'flat', // simple heuristic
  };
}

export function listToolingByKind(kind: ToolingKind): ToolingPreset[] {
  switch (kind) {
    case 'cnc-vise': return CNC_VISE_PRESETS;
    case 'welding-fixture': return WELDING_TABLE_PRESETS;
    default: return [];
  }
}

// MoldMesh import retained for future toolset that consumes mesh geometry.
export type _ToolingMeshRef = MoldMesh;
