/**
 * ansiCatalog.ts — UNC / UNF inch fastener catalog for US/Canada
 * audience.
 *
 * Reference: ASME B18.2.1 (hex bolts) and ASME B18.3 (socket caps).
 * Sizes listed by nominal "thread number" (#8, #10, ...) for small
 * sizes and fractional inches (1/4, 5/16, ...) for larger ones.
 *
 * Korean fabs typically don't stock inch sizes, but US/Canada
 * customers in NexyFab's idea-startup target need them. This is a
 * smaller table — only the common 8-32 to 1/2-13 range.
 */

import type { FastenerSpec } from './fastenerSchema';

export type AnsiSeries = 'UNC' | 'UNF';

export interface AnsiSizeEntry {
  /** Display label ("#8", "1/4", etc). */
  label: string;
  /** Nominal major diameter (in). */
  diameterIn: number;
  /** Coarse (UNC) threads per inch. */
  unc?: number;
  /** Fine (UNF) threads per inch. */
  unf?: number;
  /** Across-flats wrench size (in) for hex bolts. */
  acrossFlatsIn?: number;
}

export const ANSI_INCH: ReadonlyArray<AnsiSizeEntry> = [
  { label: '#8',   diameterIn: 0.164, unc: 32, unf: 36 },
  { label: '#10',  diameterIn: 0.190, unc: 24, unf: 32 },
  { label: '1/4',  diameterIn: 0.250, unc: 20, unf: 28, acrossFlatsIn: 7/16 },
  { label: '5/16', diameterIn: 0.3125, unc: 18, unf: 24, acrossFlatsIn: 1/2 },
  { label: '3/8',  diameterIn: 0.375, unc: 16, unf: 24, acrossFlatsIn: 9/16 },
  { label: '7/16', diameterIn: 0.4375, unc: 14, unf: 20, acrossFlatsIn: 5/8 },
  { label: '1/2',  diameterIn: 0.500, unc: 13, unf: 20, acrossFlatsIn: 3/4 },
];

export function ansiSize(label: string): AnsiSizeEntry | null {
  return ANSI_INCH.find(e => e.label === label) ?? null;
}

const STOCK_LENGTHS_IN: ReadonlyArray<number> = [
  1/4, 3/8, 1/2, 5/8, 3/4, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4,
];

const STD_TAG_FOR_ANSI: Partial<Record<FastenerSpec['kind'], string>> = {
  'hex-bolt':         'B18.2.1',
  'socket-head-cap':  'B18.3',
  'button-head':      'B18.3.2',
  'flat-head':        'B18.3.4',
  'hex-nut':          'B18.2.2',
};

export interface AnsiCatalogOptions {
  series?: AnsiSeries;
  diameters?: string[];   // labels
  material?: FastenerSpec['material'];
}

export function expandAnsiCatalog(
  kind: FastenerSpec['kind'],
  opts: AnsiCatalogOptions = {},
): FastenerSpec[] {
  const series = opts.series ?? 'UNC';
  const sizes = opts.diameters
    ? ANSI_INCH.filter(e => opts.diameters!.includes(e.label))
    : ANSI_INCH;
  const tag = STD_TAG_FOR_ANSI[kind] ?? 'ANSI';
  const out: FastenerSpec[] = [];
  for (const e of sizes) {
    const tpi = series === 'UNC' ? e.unc : e.unf;
    if (!tpi) continue;
    const pitchMm = 25.4 / tpi;
    const diameterMm = e.diameterIn * 25.4;
    for (const lenIn of STOCK_LENGTHS_IN) {
      const lenMm = lenIn * 25.4;
      out.push({
        standard: 'ANSI',
        kind,
        designation: `ANSI ${tag} ${e.label}-${tpi} × ${lenIn}"`,
        thread: { diameterMm, pitchMm },
        lengthMm: lenMm,
        material: opts.material ?? 'steel-8.8',
      });
    }
  }
  return out;
}

/** Convert inch dimension to mm for cross-format comparison. */
export function inchToMm(inches: number): number {
  return inches * 25.4;
}
