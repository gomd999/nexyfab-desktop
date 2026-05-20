/**
 * isoCatalogFull.ts — Complete ISO fastener catalog data.
 *
 * Stage-2 `fastenerSchema.ts` introduced the schema + a few common
 * sizes. This module ships the *full* catalog tables that real CAD
 * users need: M3–M20 for each standard, plus the matching clearance
 * + tap hole tables.
 *
 * Data: ISO 4014 / 4017 / 4762 / 7380 / 10642 / 4032 / 7040 / 7089
 * + DIN 127 / 6798. Cross-referenced against KS B 1002 / 1012 for
 * Korean-domestic compatibility.
 *
 * Why a separate file: the Stage-2 schema kept things tiny for
 * testing. Real users on first-day need the whole grid.
 */

import type { FastenerSpec } from './fastenerSchema';

export interface IsoSizeEntry {
  /** Nominal metric size (mm). */
  size: number;
  /** Coarse thread pitch (mm). */
  coarsePitch: number;
  /** Fine thread pitch (mm), if defined. */
  finePitch?: number;
  /** Head diameter (mm) — used by 4014, 4017, 4762, 7380, etc. */
  headDiameter?: number;
  /** Head height (mm). */
  headHeight?: number;
  /** Across-flats / wrench size (mm). */
  acrossFlats?: number;
  /** Clearance hole (mm) — close fit per ISO 273. */
  clearanceClose: number;
  /** Clearance hole (mm) — medium fit. */
  clearanceMedium: number;
  /** Clearance hole (mm) — coarse fit. */
  clearanceCoarse: number;
  /** Tap drill diameter (mm). */
  tapDrill: number;
}

/** Master ISO metric fastener table, M3 through M20.
 *  All measurements are nominal — manufacturer tolerances apply
 *  per ISO 4759-1 (mostly product grade A for diam ≤ M24). */
export const ISO_METRIC: ReadonlyArray<IsoSizeEntry> = [
  { size: 3,  coarsePitch: 0.5,  finePitch: 0.35, headDiameter: 5.5,  headHeight: 2.0, acrossFlats: 5.5, clearanceClose: 3.2, clearanceMedium: 3.4, clearanceCoarse: 3.6, tapDrill: 2.5 },
  { size: 4,  coarsePitch: 0.7,  finePitch: 0.5,  headDiameter: 7.0,  headHeight: 2.8, acrossFlats: 7,   clearanceClose: 4.3, clearanceMedium: 4.5, clearanceCoarse: 4.8, tapDrill: 3.3 },
  { size: 5,  coarsePitch: 0.8,  finePitch: 0.5,  headDiameter: 8.5,  headHeight: 3.5, acrossFlats: 8,   clearanceClose: 5.3, clearanceMedium: 5.5, clearanceCoarse: 5.8, tapDrill: 4.2 },
  { size: 6,  coarsePitch: 1.0,  finePitch: 0.75, headDiameter: 10.0, headHeight: 4.0, acrossFlats: 10,  clearanceClose: 6.4, clearanceMedium: 6.6, clearanceCoarse: 7.0, tapDrill: 5.0 },
  { size: 8,  coarsePitch: 1.25, finePitch: 1.0,  headDiameter: 13.0, headHeight: 5.3, acrossFlats: 13,  clearanceClose: 8.4, clearanceMedium: 9.0, clearanceCoarse: 10.0, tapDrill: 6.8 },
  { size: 10, coarsePitch: 1.5,  finePitch: 1.25, headDiameter: 16.0, headHeight: 6.4, acrossFlats: 16,  clearanceClose: 10.5, clearanceMedium: 11.0, clearanceCoarse: 12.0, tapDrill: 8.5 },
  { size: 12, coarsePitch: 1.75, finePitch: 1.25, headDiameter: 18.0, headHeight: 7.5, acrossFlats: 18,  clearanceClose: 13.0, clearanceMedium: 13.5, clearanceCoarse: 14.5, tapDrill: 10.2 },
  { size: 16, coarsePitch: 2.0,  finePitch: 1.5,  headDiameter: 24.0, headHeight: 10.0, acrossFlats: 24, clearanceClose: 17.0, clearanceMedium: 17.5, clearanceCoarse: 18.5, tapDrill: 14.0 },
  { size: 20, coarsePitch: 2.5,  finePitch: 1.5,  headDiameter: 30.0, headHeight: 12.5, acrossFlats: 30, clearanceClose: 21.0, clearanceMedium: 22.0, clearanceCoarse: 24.0, tapDrill: 17.5 },
];

export function isoSize(diameterMm: number): IsoSizeEntry | null {
  return ISO_METRIC.find(e => e.size === diameterMm) ?? null;
}

/** All bolt lengths typically held in stock for a given diameter.
 *  Korean fabricators commonly hold 5mm-step lengths up to ~50mm,
 *  then 10mm steps. */
export function stockLengthsFor(diameterMm: number): number[] {
  const baseShort = [4, 5, 6, 8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50];
  const baseLong = [55, 60, 65, 70, 80, 90, 100];
  if (diameterMm <= 6) return baseShort.slice(0, 12);  // up to 40 mm
  if (diameterMm <= 12) return [...baseShort, ...baseLong.slice(0, 4)]; // up to 70 mm
  return [...baseShort.slice(2), ...baseLong];
}

/** Expand the catalog into FastenerSpec instances for a given kind. */
export function expandIsoCatalog(
  kind: FastenerSpec['kind'],
  options: { diameters?: number[]; material?: FastenerSpec['material']; finish?: string } = {},
): FastenerSpec[] {
  const sizes = options.diameters
    ? ISO_METRIC.filter(e => options.diameters!.includes(e.size))
    : ISO_METRIC;

  const out: FastenerSpec[] = [];
  for (const e of sizes) {
    const lengths = stockLengthsFor(e.size);
    for (const len of lengths) {
      const stdTag = STD_TAG_FOR[kind] ?? 'ISO';
      out.push({
        standard: 'ISO',
        kind,
        designation: `ISO ${stdTag} M${e.size} × ${len}`,
        thread: { diameterMm: e.size, pitchMm: e.coarsePitch },
        lengthMm: len,
        material: options.material ?? 'steel-8.8',
        finish: options.finish,
      });
    }
  }
  return out;
}

const STD_TAG_FOR: Partial<Record<FastenerSpec['kind'], string>> = {
  'hex-bolt':         '4014',
  'socket-head-cap':  '4762',
  'button-head':      '7380',
  'flat-head':        '10642',
  'set-screw':        '4026',
  'hex-nut':          '4032',
  'lock-nut':         '7040',
  'flat-washer':      '7089',
  'spring-washer':    'DIN 127',
  'tooth-washer':     'DIN 6798',
};

/** Clearance hole table lookup — what diameter hole to drill for
 *  a given bolt size + fit class. */
export function clearanceHole(
  diameterMm: number,
  fit: 'close' | 'medium' | 'coarse' = 'medium',
): number | null {
  const e = isoSize(diameterMm);
  if (!e) return null;
  switch (fit) {
    case 'close':  return e.clearanceClose;
    case 'medium': return e.clearanceMedium;
    case 'coarse': return e.clearanceCoarse;
  }
}

/** Tap drill for a given thread diameter. */
export function tapDrill(diameterMm: number): number | null {
  return isoSize(diameterMm)?.tapDrill ?? null;
}
