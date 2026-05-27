/**
 * datumReferenceFrame.ts — ASME Y14.5 Datum Reference Frame (DRF)
 * construction + Material Boundary Condition (MBC) resolution.
 *
 * A DRF is the 3-2-1 alignment chain that every Geometric Tolerance
 * references. Primary datum (A) constrains 3 DOFs (plane = 3 contact
 * points); secondary (B) constrains 2 more (line = 2 points); tertiary
 * (C) the last (point = 1 point). Together they immobilize the part.
 *
 * Material modifiers (M / L / S) alter how the datum simulator
 * applies tolerance: at Maximum Material Condition the simulator
 * shrinks/grows to true position size, producing a "bonus tolerance".
 * Drawing renderer needs the resolved MBC to draw the feature
 * control frame correctly.
 *
 * Reference: ASME Y14.5-2018 §4 Datum Reference Frames.
 */

export type Material = 'M' | 'L' | 'S' | null;
//   M = Maximum Material Condition (bolt large, hole small)
//   L = Least Material Condition   (bolt small, hole large)
//   S = Regardless of Feature Size
//   null = no modifier (planar datum)

export interface DatumFeature {
  /** Datum letter (A, B, C, ...). */
  letter: string;
  /** Datum feature surface type. */
  kind: 'plane' | 'cylinder' | 'point' | 'axis';
  /** Material modifier applied to this datum. */
  modifier: Material;
}

export interface DatumReferenceFrame {
  primary: DatumFeature;
  secondary?: DatumFeature;
  tertiary?: DatumFeature;
}

export type ToleranceType =
  | 'flatness' | 'straightness' | 'circularity' | 'cylindricity'
  | 'perpendicularity' | 'parallelism' | 'angularity'
  | 'position' | 'concentricity' | 'symmetry'
  | 'runout' | 'totalRunout'
  | 'profileLine' | 'profileSurface';

export interface FeatureControlFrame {
  type: ToleranceType;
  /** Tolerance value (mm). */
  tolerance: number;
  /** Material modifier on the tolerance value itself (M, L, S). */
  toleranceMaterial: Material;
  drf: DatumReferenceFrame;
}

/** DOFs constrained by each datum-feature kind when chosen as
 *  primary/secondary/tertiary. The classical 3-2-1 sequence. */
const DOF_BY_KIND: Record<DatumFeature['kind'], number[]> = {
  plane:    [3, 2, 1],
  cylinder: [4, 1, 0],
  point:    [3, 0, 0],
  axis:     [4, 1, 0],
};

export interface DofReport {
  primaryDof: number;
  secondaryDof: number;
  tertiaryDof: number;
  totalDof: number;
  isOverConstrained: boolean;
  isUnderConstrained: boolean;
}

/** Validate a DRF — reports the DOFs locked and flags inconsistency. */
export function validateDrf(drf: DatumReferenceFrame): DofReport {
  const p = DOF_BY_KIND[drf.primary.kind][0]!;
  const s = drf.secondary ? DOF_BY_KIND[drf.secondary.kind][1]! : 0;
  const t = drf.tertiary ? DOF_BY_KIND[drf.tertiary.kind][2]! : 0;
  const total = p + s + t;
  return {
    primaryDof: p,
    secondaryDof: s,
    tertiaryDof: t,
    totalDof: total,
    isOverConstrained: total > 6,
    isUnderConstrained: total < 6 && drf.tertiary !== undefined,
  };
}

/** Compute bonus tolerance for an MMC/LMC feature. The "bonus" is
 *  the deviation from MMB/LMB that the inspector gets to *add* to
 *  the stated tolerance — fundamental to ASME Y14.5 economic intent. */
export function bonusTolerance(
  fcf: FeatureControlFrame,
  /** Actual measured feature size (mm). */
  actualSize: number,
  /** Maximum material size (mm). For holes this is the smallest, for shafts the largest. */
  maximumMaterialSize: number,
  /** Least material size (mm). */
  leastMaterialSize: number,
): number {
  if (fcf.toleranceMaterial === 'S' || fcf.toleranceMaterial === null) return 0;
  if (fcf.toleranceMaterial === 'M') {
    return Math.abs(actualSize - maximumMaterialSize);
  }
  // L
  return Math.abs(leastMaterialSize - actualSize);
}

/** Render the canonical FCF text per ASME Y14.5.
 *  Example: ⌭ ⌀0.25 Ⓜ A B Ⓛ C
 *  (We use ASCII fallbacks here; the drawing renderer maps to Unicode.) */
export function formatFcf(fcf: FeatureControlFrame): string {
  const sym = SYMBOL[fcf.type];
  const tolSize = fcf.type === 'position' || fcf.type === 'concentricity'
    ? `⌀${fcf.tolerance}`
    : `${fcf.tolerance}`;
  const tolMat = fcf.toleranceMaterial ? `(${fcf.toleranceMaterial})` : '';
  const datums = [fcf.drf.primary, fcf.drf.secondary, fcf.drf.tertiary]
    .filter((d): d is DatumFeature => !!d)
    .map(d => d.modifier ? `${d.letter}(${d.modifier})` : d.letter)
    .join('|');
  return `[${sym}|${tolSize}${tolMat}|${datums}]`;
}

const SYMBOL: Record<ToleranceType, string> = {
  flatness: '▱',
  straightness: '—',
  circularity: '○',
  cylindricity: '⌭',
  perpendicularity: '⊥',
  parallelism: '∥',
  angularity: '∠',
  position: '⌖',
  concentricity: '◎',
  symmetry: '⌯',
  runout: '↗',
  totalRunout: '↗↗',
  profileLine: '⌒',
  profileSurface: '⌓',
};

/** Build a fully-typed FCF from short user input. */
export function buildFcf(input: {
  type: ToleranceType;
  tolerance: number;
  primary: string;
  primaryKind?: DatumFeature['kind'];
  primaryModifier?: Material;
  secondary?: string;
  secondaryKind?: DatumFeature['kind'];
  secondaryModifier?: Material;
  tertiary?: string;
  tertiaryKind?: DatumFeature['kind'];
  tertiaryModifier?: Material;
  toleranceMaterial?: Material;
}): FeatureControlFrame {
  const drf: DatumReferenceFrame = {
    primary: { letter: input.primary, kind: input.primaryKind ?? 'plane', modifier: input.primaryModifier ?? null },
  };
  if (input.secondary) {
    drf.secondary = { letter: input.secondary, kind: input.secondaryKind ?? 'plane', modifier: input.secondaryModifier ?? null };
  }
  if (input.tertiary) {
    drf.tertiary = { letter: input.tertiary, kind: input.tertiaryKind ?? 'plane', modifier: input.tertiaryModifier ?? null };
  }
  return {
    type: input.type,
    tolerance: input.tolerance,
    toleranceMaterial: input.toleranceMaterial ?? null,
    drf,
  };
}
