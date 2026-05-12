/**
 * ISO metric fastener reference (M3 ~ M16).
 *
 * Coarse-thread pitches per ISO 261. Used by:
 *   - intentToScad to produce dimensionally-accurate threaded parts
 *   - serverBrepAdapter for B-rep helical thread generation
 *   - fastPath classifier so prompts like "M8 볼트 50mm" map directly
 *
 * Numbers double-checked against ASME B18.3 and ISO 4762 standards.
 */

export interface MetricFastener {
  /** Nominal diameter in mm (e.g. 8 for M8). */
  d: number;
  /** Coarse-thread pitch in mm. */
  pitch: number;
  /** Recommended drill (clearance hole, medium fit) in mm. */
  clearanceHole: number;
  /** Recommended drill (tap, ~75% thread) in mm. */
  tapHole: number;
  /** Across-flats hex size in mm (DIN 934 nut / DIN 933 bolt head). */
  hexAcrossFlats: number;
  /** Hex socket cap drive size in mm (ISO 4762). */
  hexSocketDrive: number;
}

export const METRIC_FASTENERS: Record<string, MetricFastener> = {
  M3:  { d: 3,  pitch: 0.5,  clearanceHole: 3.4,  tapHole: 2.5,  hexAcrossFlats: 5.5, hexSocketDrive: 2.5 },
  M4:  { d: 4,  pitch: 0.7,  clearanceHole: 4.5,  tapHole: 3.3,  hexAcrossFlats: 7,   hexSocketDrive: 3 },
  M5:  { d: 5,  pitch: 0.8,  clearanceHole: 5.5,  tapHole: 4.2,  hexAcrossFlats: 8,   hexSocketDrive: 4 },
  M6:  { d: 6,  pitch: 1.0,  clearanceHole: 6.6,  tapHole: 5.0,  hexAcrossFlats: 10,  hexSocketDrive: 5 },
  M8:  { d: 8,  pitch: 1.25, clearanceHole: 9,    tapHole: 6.8,  hexAcrossFlats: 13,  hexSocketDrive: 6 },
  M10: { d: 10, pitch: 1.5,  clearanceHole: 11,   tapHole: 8.5,  hexAcrossFlats: 17,  hexSocketDrive: 8 },
  M12: { d: 12, pitch: 1.75, clearanceHole: 14,   tapHole: 10.2, hexAcrossFlats: 19,  hexSocketDrive: 10 },
  M14: { d: 14, pitch: 2.0,  clearanceHole: 16,   tapHole: 12.0, hexAcrossFlats: 22,  hexSocketDrive: 12 },
  M16: { d: 16, pitch: 2.0,  clearanceHole: 18,   tapHole: 14.0, hexAcrossFlats: 24,  hexSocketDrive: 14 },
};

/** Map size key (case-insensitive) → entry. Returns null for unknown sizes. */
export function lookupMetric(spec: string): MetricFastener | null {
  const key = spec.toUpperCase();
  return METRIC_FASTENERS[key] ?? null;
}

/** All supported size keys, in nominal-diameter order. */
export const METRIC_SIZES = Object.keys(METRIC_FASTENERS) as readonly (keyof typeof METRIC_FASTENERS)[];

/**
 * BOSL2 spec string for `screw()` / `threaded_rod()` etc.
 * Includes the coarse-thread pitch so BOSL2 generates correct threads.
 */
export function bosl2Spec(size: string, length: number): string | null {
  const f = lookupMetric(size);
  if (!f) return null;
  return `${size}x${f.pitch},${length}`;
}
