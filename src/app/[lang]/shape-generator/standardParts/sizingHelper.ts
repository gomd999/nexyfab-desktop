/**
 * sizingHelper.ts — Helper math for the interactive sizing UI.
 *
 * Stage-2 fastener cards were static lookups. Stage-3 lets the user
 * slide a "size" control and see live preview parameters. This
 * module is the headless math that the UI slider calls — given a
 * size, derive head dimensions, suggested length, thread pitch,
 * weight, all without touching the DOM.
 */

import { ISO_METRIC, isoSize } from './isoCatalogFull';
import type { FastenerSpec } from './fastenerSchema';

/** Snap a slider value (continuous) to the nearest catalog size. */
export function snapToCatalogSize(rawMm: number): number {
  const all = ISO_METRIC.map(e => e.size);
  let best = all[0]!;
  let bestDist = Math.abs(best - rawMm);
  for (const s of all.slice(1)) {
    const d = Math.abs(s - rawMm);
    if (d < bestDist) { best = s; bestDist = d; }
  }
  return best;
}

/** Snap a length to the typical stock-length grid. */
export function snapToStockLength(rawMm: number): number {
  const grid = [4, 5, 6, 8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 80, 90, 100];
  let best = grid[0]!;
  let bestDist = Math.abs(best - rawMm);
  for (const s of grid.slice(1)) {
    const d = Math.abs(s - rawMm);
    if (d < bestDist) { best = s; bestDist = d; }
  }
  return best;
}

/** Estimate fastener mass (g) — rough approximation as cylinder
 *  with head bump. Steel density 7850 kg/m³. */
export function estimateMassG(spec: FastenerSpec): number {
  const e = isoSize(spec.thread.diameterMm);
  if (!e) return 0;
  const shankR = spec.thread.diameterMm / 2;
  const shankVolMm3 = Math.PI * shankR * shankR * spec.lengthMm;
  const headVolMm3 = e.headDiameter && e.headHeight
    ? Math.PI * Math.pow(e.headDiameter / 2, 2) * e.headHeight
    : 0;
  const totalMm3 = shankVolMm3 + headVolMm3;
  const densityKgPerM3 = densityFor(spec.material);
  // 1 mm³ = 1e-9 m³; result in kg → multiply 1000 for grams.
  return totalMm3 * 1e-9 * densityKgPerM3 * 1000;
}

function densityFor(material: FastenerSpec['material']): number {
  switch (material) {
    case 'steel-8.8':
    case 'steel-10.9':
    case 'steel-12.9':
    case undefined: return 7850;
    case 'a2-stainless':
    case 'a4-stainless': return 8000;
    case 'brass': return 8500;
  }
}

/** Recommended preload (N) for a fastener — useful for FEA. */
export function recommendedPreloadN(spec: FastenerSpec): number {
  const e = isoSize(spec.thread.diameterMm);
  if (!e) return 0;
  // Tensile stress area for M-size (mm²). Rough approximation.
  const areaMm2 = 0.7854 * Math.pow(spec.thread.diameterMm - 0.9382 * e.coarsePitch, 2);
  const yieldMpa = yieldStrengthFor(spec.material);
  return areaMm2 * yieldMpa * 0.75; // ~75% of yield strength
}

function yieldStrengthFor(material: FastenerSpec['material']): number {
  switch (material) {
    case 'steel-8.8':  return 640;
    case 'steel-10.9': return 940;
    case 'steel-12.9': return 1100;
    case 'a2-stainless': return 210;
    case 'a4-stainless': return 240;
    case 'brass': return 200;
    default: return 640;
  }
}

/** Bundled preview info the UI can display while user slides the
 *  size slider — head + body + weight + cost hint. */
export interface SizingPreview {
  size: number;
  pitch: number;
  headDiameter: number | null;
  headHeight: number | null;
  acrossFlats: number | null;
  massG: number;
  preloadN: number;
}

export function computeSizingPreview(
  spec: FastenerSpec,
): SizingPreview {
  const e = isoSize(spec.thread.diameterMm);
  return {
    size: spec.thread.diameterMm,
    pitch: spec.thread.pitchMm,
    headDiameter: e?.headDiameter ?? null,
    headHeight: e?.headHeight ?? null,
    acrossFlats: e?.acrossFlats ?? null,
    massG: estimateMassG(spec),
    preloadN: recommendedPreloadN(spec),
  };
}
