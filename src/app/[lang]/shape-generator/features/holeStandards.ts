/**
 * Standard hole specifications — barrel + interface + helpers.
 *
 * The catalog itself is split into per-standard files so the diff stays
 * readable and so a future i18n / ops alert can pull just the table it cares
 * about:
 *
 *   - holeStandards.iso.ts   — ISO 4762 (cap screw) + ISO 273 (clearance) +
 *                              KS B 0201 (Korean ISO metric, coarse + fine)
 *   - holeStandards.uts.ts   — UNC + UNF (ANSI/ASME inch threads)
 *   - holeStandards.pipe.ts  — NPT (tapered) + BSP/G (parallel) pipe threads
 *
 * Drill/tap/counterbore/countersink dimensions sourced from ISO 273, ISO 10642,
 * ISO 4762, KS B 0201, ASME B18.3, ASME B1.20.1, ISO 228-1. Values are
 * nominal — real shop tolerances are tighter.
 */

// ─── Core interface ─────────────────────────────────────────────────────────

export type HoleStandardUnit = 'mm' | 'in';

/**
 * Issuing-body identifier for a row. Used to drive UI grouping ("KS B 0201"
 * badge vs "ISO" badge) and to filter by standard in tests.
 *
 * - ISO     : ISO 4762 socket-cap-screw companion (and ISO metric generic)
 * - ISO273  : ISO 273 clearance-only metric table
 * - KSB0201 : KS B 0201 Korean ISO metric (coarse + fine pitch)
 * - ANSI    : ASME/ANSI inch (UNC + UNF) — kept as single tag for tooling
 * - NPT     : National Pipe Taper (ANSI/ASME B1.20.1)
 * - BSP     : British Standard Pipe parallel (G-thread, ISO 228-1)
 */
export type HoleStandardKind = 'ISO' | 'ISO273' | 'KSB0201' | 'ANSI' | 'NPT' | 'BSP';

/**
 * Three ISO-273-style fit classes for clearance-hole sizing. Stored as the
 * *final* hole diameter (not as an offset), so callers can use any field
 * directly without re-resolving against `nominal`.
 *
 * Invariant: close < normal < loose (strict). Enforced by unit tests.
 */
export interface HoleFitClassOffsets {
  close: number;
  normal: number;
  loose: number;
}

export interface HoleStandardSpec {
  /** Human-readable name, e.g. "M6", "#10-32", "1/4-20", "NPT 1/4". */
  name: string;
  /** Optional localized name (Korean). UI may fall back to `name`. */
  nameKo?: string;
  unit: HoleStandardUnit;
  /**
   * For threaded fasteners: nominal major diameter (mm or in).
   * For pipe threads: trade O.D. in mm (NPT 1/8 → ~10.29 mm).
   */
  nominal: number;
  /** Issuing-body tag (optional for back-compat with Wave 1 rows). */
  standard?: HoleStandardKind;

  // ─── Thread geometry ──────────────────────────────────────────────────────
  /** Thread pitch in mm. Optional — only meaningful for threaded standards. */
  pitch?: number;
  /** Threads per inch. Optional — only meaningful for ANSI / pipe rows. */
  tpi?: number;

  // ─── Drill / clearance (through-hole) ─────────────────────────────────────
  /**
   * Close-fit clearance hole diameter (ISO H11 / ASME normal). Kept as a
   * top-level field for backward compatibility with Wave 1 callers; new
   * code should prefer `fits.normal`.
   */
  clearance: number;
  /** Tap drill diameter for cutting an internal thread at this size. */
  tapDrill: number;
  /** Optional three-class clearance offsets (ISO 273 / ASME B18.2.8). */
  fits?: HoleFitClassOffsets;

  // ─── Counterbore (socket-cap-screw pocket) ────────────────────────────────
  counterboreDia: number;
  counterboreDepth: number;

  // ─── Countersink (flathead screw) ─────────────────────────────────────────
  countersinkDia: number;
  /** Included angle — 90° standard in machining, 82° common in imperial. */
  countersinkAngle: number;
}

// ─── Catalog re-exports ─────────────────────────────────────────────────────

export { ISO_METRIC, KS_B_0201_METRIC, ISO_273_CLEARANCE, ISO_273_FIT_OFFSETS } from './holeStandards.iso';
export { ANSI_IMPERIAL, UNC_INCH, UNF_INCH } from './holeStandards.uts';
export { NPT_PIPE, BSP_PIPE } from './holeStandards.pipe';

// Import for use within this file (registry + helpers)
import { ISO_METRIC, KS_B_0201_METRIC, ISO_273_CLEARANCE } from './holeStandards.iso';
import { ANSI_IMPERIAL, UNC_INCH, UNF_INCH } from './holeStandards.uts';
import { NPT_PIPE, BSP_PIPE } from './holeStandards.pipe';

// ─── Series registry ────────────────────────────────────────────────────────

/**
 * Top-level series shown in the wizard's series picker. ISO and ANSI keys
 * exist for Wave 1 back-compat; the new keys (KSB0201, ISO273, PIPE) light
 * up additional catalogs without breaking existing UI code.
 */
export type HoleStandardSeries = 'ISO' | 'ANSI' | 'KSB0201' | 'ISO273' | 'NPT' | 'BSP';

export const HOLE_STANDARD_SERIES: Record<HoleStandardSeries, HoleStandardSpec[]> = {
  ISO: ISO_METRIC,
  ANSI: ANSI_IMPERIAL,
  KSB0201: KS_B_0201_METRIC,
  ISO273: ISO_273_CLEARANCE,
  NPT: NPT_PIPE,
  BSP: BSP_PIPE,
};

/**
 * Full catalog flat list — every row from every standard. Useful for
 * smart-matching (smartFastener.suggestFasteners) and tests.
 */
export const ALL_HOLE_STANDARD_ROWS: HoleStandardSpec[] = [
  ...ISO_METRIC,
  ...KS_B_0201_METRIC,
  ...ISO_273_CLEARANCE,
  ...UNC_INCH,
  ...UNF_INCH,
  ...NPT_PIPE,
  ...BSP_PIPE,
];

/**
 * Look up a row by issuing-body + designation. Returns undefined if no row
 * matches — callers should treat that as a programmer error (the designation
 * came from a UI dropdown of the same catalog).
 */
export function findStandardRow(
  series: HoleStandardSeries,
  designation: string,
): HoleStandardSpec | undefined {
  return HOLE_STANDARD_SERIES[series].find((row) => row.name === designation);
}

// ─── Feature helpers ────────────────────────────────────────────────────────

export type HoleKind = 'through' | 'tap' | 'counterbore' | 'countersink' | 'spotface';

/**
 * Spotface depth heuristic — a spotface is a shallow facing operation to give
 * a flat seat for a fastener head, typically 0.5-1.5mm rather than the full
 * counterbore depth. We approximate as 30% of the spec's counterbore depth.
 */
function spotfaceDepth(spec: HoleStandardSpec): number {
  return Math.max(0.5, +(spec.counterboreDepth * 0.3).toFixed(2));
}

/**
 * Resolve the through-hole clearance diameter for a given fit class. Falls
 * back to the row's flat `clearance` field when the row predates the
 * fit-class extension (Wave 1 rows without `fits`).
 */
export function resolveClearance(
  spec: HoleStandardSpec,
  fit: 'close' | 'normal' | 'loose' = 'normal',
): number {
  if (spec.fits) return spec.fits[fit];
  return spec.clearance;
}

/**
 * Map a (standard, kind) choice to the raw `hole` feature params. The caller
 * merges this with position (posX/posZ) and overall depth.
 *
 * `holeType` encoding (matches features/hole.ts):
 *   0 = through / tap (plain cylinder)
 *   1 = counterbore (and spotface — shallow counterbore variant)
 *   2 = countersink
 */
export function holeParamsFromStandard(
  spec: HoleStandardSpec,
  kind: HoleKind,
  fit: 'close' | 'normal' | 'loose' = 'normal',
): {
  holeType: number;
  diameter: number;
  counterboreDia: number;
  counterboreDepth: number;
  countersinkAngle: number;
} {
  const clearance = resolveClearance(spec, fit);
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
        diameter: clearance,
        counterboreDia: spec.counterboreDia,
        counterboreDepth: spec.counterboreDepth,
        countersinkAngle: spec.countersinkAngle,
      };
    case 'spotface':
      // Same outer dia as counterbore, but shallower — used to flatten a
      // casting/forging surface so the fastener head seats square.
      return {
        holeType: 1,
        diameter: clearance,
        counterboreDia: spec.counterboreDia,
        counterboreDepth: spotfaceDepth(spec),
        countersinkAngle: spec.countersinkAngle,
      };
    case 'countersink':
      return {
        holeType: 2,
        diameter: clearance,
        counterboreDia: spec.counterboreDia,
        counterboreDepth: spec.counterboreDepth,
        countersinkAngle: spec.countersinkAngle,
      };
    case 'through':
    default:
      return {
        holeType: 0,
        diameter: clearance,
        counterboreDia: spec.counterboreDia,
        counterboreDepth: spec.counterboreDepth,
        countersinkAngle: spec.countersinkAngle,
      };
  }
}

/**
 * Standard depth presets for blind holes. Engineers commonly choose
 * 1×D, 1.5×D, 2×D as conventional depths rather than typing arbitrary numbers.
 * 999 is the "through-all" sentinel (matches features/hole.ts depth==999).
 */
export interface HoleDepthPreset {
  /** i18n label key in HoleWizardModal dict (depthThroughAll, depth1xD, etc.). */
  labelKey: 'depthThroughAll' | 'depth1xD' | 'depth1_5xD' | 'depth2xD';
  /** Multiplier applied to the resolved diameter. Use Infinity sentinel for through-all. */
  multiplier: number;
}

export const HOLE_DEPTH_PRESETS: HoleDepthPreset[] = [
  { labelKey: 'depthThroughAll', multiplier: Infinity },
  { labelKey: 'depth1xD',  multiplier: 1.0 },
  { labelKey: 'depth1_5xD', multiplier: 1.5 },
  { labelKey: 'depth2xD',  multiplier: 2.0 },
];

/**
 * Resolve a preset to a numeric depth value. Infinity → 999 sentinel (the
 * through-all marker for the hole feature). Otherwise: ceil(diameter × mult)
 * so the hole goes a bit deeper than the bare arithmetic.
 */
export function depthFromPreset(preset: HoleDepthPreset, diameter: number): number {
  if (!Number.isFinite(preset.multiplier)) return 999;
  return Math.max(1, Math.ceil(diameter * preset.multiplier));
}
