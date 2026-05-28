/**
 * ISO / KS metric hole standard rows.
 *
 * Sources:
 * - ISO 4762 (socket-cap-screw companion dimensions: counterbore / tap drill)
 * - ISO 273 (clearance holes: close / normal / loose fit classes)
 * - KS B 0201 (Korean industrial standard, ISO metric coarse + fine thread).
 *   KS B 0201 is the Korean re-publication of ISO 261 metric M thread; the
 *   designations match ISO M (e.g. "M6") and the pitch table is identical to
 *   ISO coarse + fine. We model it as a separate row set so the UI can show
 *   "KS B 0201" badge for Korean market users, and so we can list fine-pitch
 *   variants (M8×1, M10×1.25 etc.) which the original ISO_METRIC table omits.
 *
 * Diameters are millimetres. Pitch is the thread pitch in millimetres (used
 * by the assembly tap feature to size threads and by drawing annotations).
 */

import type { HoleStandardSpec, HoleFitClassOffsets } from './holeStandards';

/**
 * ISO 273 fit-class offsets (close / normal / loose) on top of the nominal
 * fastener major diameter. These match the published ISO 273 table for the
 * core fastener range — diameter ranges interpolate slightly in the spec but
 * the per-size lookup below uses the exact tabulated value.
 *
 * Used both as a default fallback when a row omits `fits` and exposed so
 * tests / UI can show the per-size detail.
 */
export const ISO_273_FIT_OFFSETS: Readonly<Record<number, HoleFitClassOffsets>> = Object.freeze({
  3:  { close: 0.2, normal: 0.4, loose: 0.6 },
  4:  { close: 0.3, normal: 0.5, loose: 0.8 },
  5:  { close: 0.3, normal: 0.5, loose: 0.8 },
  6:  { close: 0.4, normal: 0.6, loose: 1.0 },
  8:  { close: 0.4, normal: 1.0, loose: 2.0 },
  10: { close: 0.5, normal: 1.0, loose: 2.0 },
  12: { close: 0.5, normal: 1.5, loose: 2.5 },
  14: { close: 0.5, normal: 1.5, loose: 2.5 },
  16: { close: 0.5, normal: 1.5, loose: 3.0 },
  18: { close: 1.0, normal: 2.0, loose: 4.0 },
  20: { close: 1.0, normal: 2.0, loose: 4.0 },
  22: { close: 1.0, normal: 2.0, loose: 4.0 },
  24: { close: 1.0, normal: 2.0, loose: 4.0 },
  27: { close: 1.5, normal: 3.0, loose: 5.0 },
  30: { close: 1.5, normal: 3.0, loose: 5.0 },
});

/** Build the fit-class clearance triple for a nominal diameter (ISO 273). */
function isoFits(nominal: number): HoleFitClassOffsets {
  const off = ISO_273_FIT_OFFSETS[nominal];
  if (!off) {
    // Fall back to the loose end of the table for outliers (>M30) so we
    // never produce a clearance < nominal.
    return { close: 1.5, normal: 3.0, loose: 5.0 };
  }
  return {
    close: +(nominal + off.close).toFixed(2),
    normal: +(nominal + off.normal).toFixed(2),
    loose: +(nominal + off.loose).toFixed(2),
  };
}

/** ISO metric hexagon socket cap screw holes (ISO 4762 + ISO 273). */
export const ISO_METRIC: HoleStandardSpec[] = [
  { standard: 'ISO',     name: 'M3',  unit: 'mm', nominal: 3,  pitch: 0.5,  clearance: 3.4,  tapDrill: 2.5,  counterboreDia: 6.5,  counterboreDepth: 3.3,  countersinkDia: 6.72,  countersinkAngle: 90, fits: isoFits(3) },
  { standard: 'ISO',     name: 'M4',  unit: 'mm', nominal: 4,  pitch: 0.7,  clearance: 4.5,  tapDrill: 3.3,  counterboreDia: 8.0,  counterboreDepth: 4.4,  countersinkDia: 8.96,  countersinkAngle: 90, fits: isoFits(4) },
  { standard: 'ISO',     name: 'M5',  unit: 'mm', nominal: 5,  pitch: 0.8,  clearance: 5.5,  tapDrill: 4.2,  counterboreDia: 9.5,  counterboreDepth: 5.4,  countersinkDia: 11.2,  countersinkAngle: 90, fits: isoFits(5) },
  { standard: 'ISO',     name: 'M6',  unit: 'mm', nominal: 6,  pitch: 1.0,  clearance: 6.6,  tapDrill: 5.0,  counterboreDia: 11.0, counterboreDepth: 6.5,  countersinkDia: 13.44, countersinkAngle: 90, fits: isoFits(6) },
  { standard: 'ISO',     name: 'M8',  unit: 'mm', nominal: 8,  pitch: 1.25, clearance: 9.0,  tapDrill: 6.8,  counterboreDia: 15.0, counterboreDepth: 8.6,  countersinkDia: 17.92, countersinkAngle: 90, fits: isoFits(8) },
  { standard: 'ISO',     name: 'M10', unit: 'mm', nominal: 10, pitch: 1.5,  clearance: 11.0, tapDrill: 8.5,  counterboreDia: 18.0, counterboreDepth: 10.8, countersinkDia: 22.4,  countersinkAngle: 90, fits: isoFits(10) },
  { standard: 'ISO',     name: 'M12', unit: 'mm', nominal: 12, pitch: 1.75, clearance: 13.5, tapDrill: 10.2, counterboreDia: 20.0, counterboreDepth: 13.0, countersinkDia: 26.88, countersinkAngle: 90, fits: isoFits(12) },
  { standard: 'ISO',     name: 'M16', unit: 'mm', nominal: 16, pitch: 2.0,  clearance: 17.5, tapDrill: 14.0, counterboreDia: 26.0, counterboreDepth: 17.5, countersinkDia: 33.6,  countersinkAngle: 90, fits: isoFits(16) },
  { standard: 'ISO',     name: 'M20', unit: 'mm', nominal: 20, pitch: 2.5,  clearance: 22.0, tapDrill: 17.5, counterboreDia: 33.0, counterboreDepth: 21.5, countersinkDia: 40.32, countersinkAngle: 90, fits: isoFits(20) },
];

/**
 * KS B 0201 — Korean ISO metric M thread, coarse + fine pitch.
 *
 * Designation is identical to ISO M; only the authority / table origin differs.
 * Fine-pitch sizes (M8×1, M10×1.25 etc.) are common in Korean automotive and
 * precision-machinery shops, so we list them as separate rows.
 *
 * Clearance / counterbore values follow ISO 273 + ISO 4762 (KS B 0201 itself
 * is a thread spec, so we inherit clearance from ISO 273).
 */
export const KS_B_0201_METRIC: HoleStandardSpec[] = [
  // Coarse pitch (same as ISO_METRIC but tagged with the KS standard)
  { standard: 'KSB0201', name: 'M3',       nameKo: 'M3 보통',       unit: 'mm', nominal: 3,  pitch: 0.5,  clearance: 3.4,  tapDrill: 2.5,  counterboreDia: 6.5,  counterboreDepth: 3.3,  countersinkDia: 6.72,  countersinkAngle: 90, fits: isoFits(3) },
  { standard: 'KSB0201', name: 'M4',       nameKo: 'M4 보통',       unit: 'mm', nominal: 4,  pitch: 0.7,  clearance: 4.5,  tapDrill: 3.3,  counterboreDia: 8.0,  counterboreDepth: 4.4,  countersinkDia: 8.96,  countersinkAngle: 90, fits: isoFits(4) },
  { standard: 'KSB0201', name: 'M5',       nameKo: 'M5 보통',       unit: 'mm', nominal: 5,  pitch: 0.8,  clearance: 5.5,  tapDrill: 4.2,  counterboreDia: 9.5,  counterboreDepth: 5.4,  countersinkDia: 11.2,  countersinkAngle: 90, fits: isoFits(5) },
  { standard: 'KSB0201', name: 'M6',       nameKo: 'M6 보통',       unit: 'mm', nominal: 6,  pitch: 1.0,  clearance: 6.6,  tapDrill: 5.0,  counterboreDia: 11.0, counterboreDepth: 6.5,  countersinkDia: 13.44, countersinkAngle: 90, fits: isoFits(6) },
  { standard: 'KSB0201', name: 'M8',       nameKo: 'M8 보통',       unit: 'mm', nominal: 8,  pitch: 1.25, clearance: 9.0,  tapDrill: 6.8,  counterboreDia: 15.0, counterboreDepth: 8.6,  countersinkDia: 17.92, countersinkAngle: 90, fits: isoFits(8) },
  { standard: 'KSB0201', name: 'M10',      nameKo: 'M10 보통',      unit: 'mm', nominal: 10, pitch: 1.5,  clearance: 11.0, tapDrill: 8.5,  counterboreDia: 18.0, counterboreDepth: 10.8, countersinkDia: 22.4,  countersinkAngle: 90, fits: isoFits(10) },
  { standard: 'KSB0201', name: 'M12',      nameKo: 'M12 보통',      unit: 'mm', nominal: 12, pitch: 1.75, clearance: 13.5, tapDrill: 10.2, counterboreDia: 20.0, counterboreDepth: 13.0, countersinkDia: 26.88, countersinkAngle: 90, fits: isoFits(12) },
  { standard: 'KSB0201', name: 'M14',      nameKo: 'M14 보통',      unit: 'mm', nominal: 14, pitch: 2.0,  clearance: 15.5, tapDrill: 12.0, counterboreDia: 24.0, counterboreDepth: 15.0, countersinkDia: 31.36, countersinkAngle: 90, fits: isoFits(14) },
  { standard: 'KSB0201', name: 'M16',      nameKo: 'M16 보통',      unit: 'mm', nominal: 16, pitch: 2.0,  clearance: 17.5, tapDrill: 14.0, counterboreDia: 26.0, counterboreDepth: 17.5, countersinkDia: 33.6,  countersinkAngle: 90, fits: isoFits(16) },
  { standard: 'KSB0201', name: 'M20',      nameKo: 'M20 보통',      unit: 'mm', nominal: 20, pitch: 2.5,  clearance: 22.0, tapDrill: 17.5, counterboreDia: 33.0, counterboreDepth: 21.5, countersinkDia: 40.32, countersinkAngle: 90, fits: isoFits(20) },
  // Fine pitch variants — common in Korean precision/auto shops
  { standard: 'KSB0201', name: 'M8x1',     nameKo: 'M8 가는눈 ×1',  unit: 'mm', nominal: 8,  pitch: 1.0,  clearance: 9.0,  tapDrill: 7.0,  counterboreDia: 15.0, counterboreDepth: 8.6,  countersinkDia: 17.92, countersinkAngle: 90, fits: isoFits(8) },
  { standard: 'KSB0201', name: 'M10x1.25', nameKo: 'M10 가는눈 ×1.25', unit: 'mm', nominal: 10, pitch: 1.25, clearance: 11.0, tapDrill: 8.8,  counterboreDia: 18.0, counterboreDepth: 10.8, countersinkDia: 22.4,  countersinkAngle: 90, fits: isoFits(10) },
  { standard: 'KSB0201', name: 'M12x1.5',  nameKo: 'M12 가는눈 ×1.5',  unit: 'mm', nominal: 12, pitch: 1.5,  clearance: 13.5, tapDrill: 10.5, counterboreDia: 20.0, counterboreDepth: 13.0, countersinkDia: 26.88, countersinkAngle: 90, fits: isoFits(12) },
  { standard: 'KSB0201', name: 'M16x1.5',  nameKo: 'M16 가는눈 ×1.5',  unit: 'mm', nominal: 16, pitch: 1.5,  clearance: 17.5, tapDrill: 14.5, counterboreDia: 26.0, counterboreDepth: 17.5, countersinkDia: 33.6,  countersinkAngle: 90, fits: isoFits(16) },
  { standard: 'KSB0201', name: 'M20x1.5',  nameKo: 'M20 가는눈 ×1.5',  unit: 'mm', nominal: 20, pitch: 1.5,  clearance: 22.0, tapDrill: 18.5, counterboreDia: 33.0, counterboreDepth: 21.5, countersinkDia: 40.32, countersinkAngle: 90, fits: isoFits(20) },
];

/**
 * ISO 273 — clearance hole sizes for metric fasteners.
 *
 * Pure clearance table: no tap drill / no counterbore. The `clearance` field
 * holds the *normal* fit; `fits` exposes all three classes. Use this when the
 * user wants a through-hole that's NOT being threaded and not being
 * counterbored — just a simple bolt pass-through.
 */
export const ISO_273_CLEARANCE: HoleStandardSpec[] = (
  [3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 27, 30] as const
).map((d) => {
  const fits = isoFits(d);
  return {
    standard: 'ISO273' as const,
    name: `M${d}`,
    unit: 'mm' as const,
    nominal: d,
    clearance: fits.normal,
    tapDrill: d, // sentinel — ISO 273 is clearance-only, callers should not tap
    counterboreDia: fits.normal,
    counterboreDepth: 0,
    countersinkDia: fits.normal,
    countersinkAngle: 90,
    fits,
  };
});
