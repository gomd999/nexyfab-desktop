/**
 * Standard hole specifications (ISO metric + ANSI imperial).
 *
 * Drill/tap/counterbore/countersink dimensions sourced from ISO 273 (clearance
 * holes), ISO 10642 / ISO 4762 (counterbore/countersink for socket screws),
 * and ASME B18.3 (imperial socket screws). Values are nominal — real shop
 * tolerances are tighter. Used by HoleWizardModal to pre-fill hole feature
 * params with one click.
 */

export type HoleStandardUnit = 'mm' | 'in';

export interface HoleStandardSpec {
  /** Human-readable name, e.g. "M6", "#10-32", "1/4-20". */
  name: string;
  unit: HoleStandardUnit;
  /** Nominal fastener / thread major diameter (unit). */
  nominal: number;

  // ─── Drill / clearance (through-hole) ─────────────────────────────────────
  /** Close-fit clearance hole diameter (ISO H11 / ASME normal). */
  clearance: number;
  /** Tap drill diameter for cutting an internal thread at this size. */
  tapDrill: number;

  // ─── Counterbore (socket-cap-screw pocket) ────────────────────────────────
  counterboreDia: number;
  counterboreDepth: number;

  // ─── Countersink (flathead screw) ─────────────────────────────────────────
  countersinkDia: number;
  /** Included angle — 90° standard in machining, 82° common in imperial. */
  countersinkAngle: number;
}

/** ISO metric hexagon socket cap screw holes (ISO 4762 companion dimensions). */
export const ISO_METRIC: HoleStandardSpec[] = [
  { name: 'M3',  unit: 'mm', nominal: 3,  clearance: 3.4,  tapDrill: 2.5,  counterboreDia: 6.5,  counterboreDepth: 3.3, countersinkDia: 6.72,  countersinkAngle: 90 },
  { name: 'M4',  unit: 'mm', nominal: 4,  clearance: 4.5,  tapDrill: 3.3,  counterboreDia: 8.0,  counterboreDepth: 4.4, countersinkDia: 8.96,  countersinkAngle: 90 },
  { name: 'M5',  unit: 'mm', nominal: 5,  clearance: 5.5,  tapDrill: 4.2,  counterboreDia: 9.5,  counterboreDepth: 5.4, countersinkDia: 11.2,  countersinkAngle: 90 },
  { name: 'M6',  unit: 'mm', nominal: 6,  clearance: 6.6,  tapDrill: 5.0,  counterboreDia: 11.0, counterboreDepth: 6.5, countersinkDia: 13.44, countersinkAngle: 90 },
  { name: 'M8',  unit: 'mm', nominal: 8,  clearance: 9.0,  tapDrill: 6.8,  counterboreDia: 15.0, counterboreDepth: 8.6, countersinkDia: 17.92, countersinkAngle: 90 },
  { name: 'M10', unit: 'mm', nominal: 10, clearance: 11.0, tapDrill: 8.5,  counterboreDia: 18.0, counterboreDepth: 10.8, countersinkDia: 22.4, countersinkAngle: 90 },
  { name: 'M12', unit: 'mm', nominal: 12, clearance: 13.5, tapDrill: 10.2, counterboreDia: 20.0, counterboreDepth: 13.0, countersinkDia: 26.88, countersinkAngle: 90 },
  { name: 'M16', unit: 'mm', nominal: 16, clearance: 17.5, tapDrill: 14.0, counterboreDia: 26.0, counterboreDepth: 17.5, countersinkDia: 33.6, countersinkAngle: 90 },
  { name: 'M20', unit: 'mm', nominal: 20, clearance: 22.0, tapDrill: 17.5, counterboreDia: 33.0, counterboreDepth: 21.5, countersinkDia: 40.32, countersinkAngle: 90 },
];

/**
 * ANSI imperial socket cap screw holes (ASME B18.3). Dimensions converted to
 * millimeters since the feature pipeline operates in mm; the original imperial
 * name is preserved in `name` for engineer familiarity.
 */
export const ANSI_IMPERIAL: HoleStandardSpec[] = [
  { name: '#4-40',   unit: 'in', nominal: 2.845, clearance: 3.2,  tapDrill: 2.26, counterboreDia: 5.94, counterboreDepth: 3.18, countersinkDia: 5.79, countersinkAngle: 82 },
  { name: '#6-32',   unit: 'in', nominal: 3.505, clearance: 3.97, tapDrill: 2.69, counterboreDia: 6.88, counterboreDepth: 3.78, countersinkDia: 7.14, countersinkAngle: 82 },
  { name: '#8-32',   unit: 'in', nominal: 4.166, clearance: 4.76, tapDrill: 3.40, counterboreDia: 7.94, counterboreDepth: 4.42, countersinkDia: 8.53, countersinkAngle: 82 },
  { name: '#10-24',  unit: 'in', nominal: 4.826, clearance: 5.56, tapDrill: 3.80, counterboreDia: 9.53, counterboreDepth: 5.13, countersinkDia: 9.91, countersinkAngle: 82 },
  { name: '#10-32',  unit: 'in', nominal: 4.826, clearance: 5.56, tapDrill: 4.22, counterboreDia: 9.53, counterboreDepth: 5.13, countersinkDia: 9.91, countersinkAngle: 82 },
  { name: '1/4-20',  unit: 'in', nominal: 6.35,  clearance: 7.14, tapDrill: 5.11, counterboreDia: 12.70, counterboreDepth: 6.76, countersinkDia: 13.08, countersinkAngle: 82 },
  { name: '5/16-18', unit: 'in', nominal: 7.94,  clearance: 8.73, tapDrill: 6.53, counterboreDia: 15.88, counterboreDepth: 8.46, countersinkDia: 16.26, countersinkAngle: 82 },
  { name: '3/8-16',  unit: 'in', nominal: 9.525, clearance: 10.32, tapDrill: 7.94, counterboreDia: 19.05, counterboreDepth: 10.16, countersinkDia: 19.46, countersinkAngle: 82 },
  { name: '1/2-13',  unit: 'in', nominal: 12.7,  clearance: 13.49, tapDrill: 10.72, counterboreDia: 25.40, counterboreDepth: 13.49, countersinkDia: 25.86, countersinkAngle: 82 },
];

export type HoleStandardSeries = 'ISO' | 'ANSI';
export const HOLE_STANDARD_SERIES: Record<HoleStandardSeries, HoleStandardSpec[]> = {
  ISO: ISO_METRIC,
  ANSI: ANSI_IMPERIAL,
};

export type HoleKind = 'through' | 'tap' | 'counterbore' | 'countersink';

/**
 * Map a (standard, kind) choice to the raw `hole` feature params. The caller
 * merges this with position (posX/posZ) and overall depth.
 *
 * `holeType` encoding (matches features/hole.ts):
 *   0 = through / tap (plain cylinder)
 *   1 = counterbore
 *   2 = countersink
 */
export function holeParamsFromStandard(
  spec: HoleStandardSpec,
  kind: HoleKind,
): {
  holeType: number;
  diameter: number;
  counterboreDia: number;
  counterboreDepth: number;
  countersinkAngle: number;
} {
  switch (kind) {
    case 'tap':
      return {
        holeType: 0,
        diameter: spec.tapDrill,
        counterboreDia: spec.counterboreDia,
        counterboreDepth: spec.counterboreDepth,
        countersinkAngle: spec.countersinkAngle,
      };
    case 'counterbore':
      return {
        holeType: 1,
        diameter: spec.clearance,
        counterboreDia: spec.counterboreDia,
        counterboreDepth: spec.counterboreDepth,
        countersinkAngle: spec.countersinkAngle,
      };
    case 'countersink':
      return {
        holeType: 2,
        diameter: spec.clearance,
        counterboreDia: spec.counterboreDia,
        counterboreDepth: spec.counterboreDepth,
        countersinkAngle: spec.countersinkAngle,
      };
    case 'through':
    default:
      return {
        holeType: 0,
        diameter: spec.clearance,
        counterboreDia: spec.counterboreDia,
        counterboreDepth: spec.counterboreDepth,
        countersinkAngle: spec.countersinkAngle,
      };
  }
}
