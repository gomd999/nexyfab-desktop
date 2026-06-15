/**
 * dimension — Phase 4.2 of NexyFab Pro own-CAD (ADR-013).
 *
 * Dimensions + tolerance + GD&T (Geometric Dimensioning & Tolerancing) IR.
 * A Dimension annotates a Viewport with a measured value displayed near
 * the geometry it refers to.
 *
 * Scope (Phase 4.2 minimal):
 *   - 5 dimension kinds: linear / aligned / radial / diametric / angular.
 *   - Tolerance forms: bilateral (+a/-b), unilateral (+a/-0 or +0/-b),
 *     limit (min..max), and ISO fit (e.g., H7/g6 — name-only for now).
 *   - 7 GD&T symbol kinds: straightness / flatness / circularity / cylindricity
 *     / position / concentricity / runout. Each with tolerance value + optional
 *     datum refs.
 *   - All dimensions reference SOURCE-model geometry by id (faces/edges/
 *     vertices). The renderer projects the dim line/text into the
 *     viewport's drawing space.
 *
 * Out of scope (Phase 4.x+):
 *   - Auto-dimensioning (sketch-driven dimensions from a sketch profile)
 *   - Multi-segment chain dimensions (baseline + ordinate dimensions)
 *   - Surface finish + welding symbols
 *   - DXF/DWG-specific dimension entity ID encoding (Phase 4.4)
 *   - Smart placement / collision avoidance (renderer concern)
 */

// ─── tolerance ───────────────────────────────────────────────────────────

export type Tolerance =
  | { kind: 'none' }
  | {
      kind: 'bilateral';
      /** Always positive numbers. The actual tolerance is [-lower, +upper]. */
      upper: number;
      lower: number;
    }
  | {
      kind: 'unilateral';
      /** Either upper or lower is 0; the other is the tolerance band. */
      upper: number;
      lower: number;
    }
  | { kind: 'limit'; min: number; max: number }
  | { kind: 'iso_fit'; designation: string }; // e.g. 'H7', 'g6'

export class ToleranceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToleranceError';
  }
}

export function validateTolerance(t: Tolerance): void {
  if (t.kind === 'bilateral') {
    if (t.upper < 0 || t.lower < 0) {
      throw new ToleranceError('bilateral upper/lower must be non-negative');
    }
  }
  if (t.kind === 'unilateral') {
    if (t.upper < 0 || t.lower < 0) {
      throw new ToleranceError('unilateral upper/lower must be non-negative');
    }
    if (t.upper > 0 && t.lower > 0) {
      throw new ToleranceError('unilateral: exactly one of upper/lower must be 0');
    }
  }
  if (t.kind === 'limit') {
    if (t.min > t.max) {
      throw new ToleranceError(`limit: min ${t.min} > max ${t.max}`);
    }
  }
  if (t.kind === 'iso_fit') {
    if (!/^[A-Za-z]+[0-9]+$/.test(t.designation)) {
      throw new ToleranceError(`iso_fit: invalid designation '${t.designation}'`);
    }
  }
}

/**
 * Format a tolerance for display alongside a nominal value. Returns the
 * string the renderer pastes after the dimension value (e.g., "20 ± 0.1").
 */
export function formatTolerance(t: Tolerance): string {
  switch (t.kind) {
    case 'none':
      return '';
    case 'bilateral':
      if (t.upper === t.lower) return ` ± ${t.upper}`;
      return ` +${t.upper}/-${t.lower}`;
    case 'unilateral':
      if (t.upper > 0) return ` +${t.upper}/-0`;
      return ` +0/-${t.lower}`;
    case 'limit':
      return ` (${t.min}..${t.max})`;
    case 'iso_fit':
      return ` ${t.designation}`;
  }
}

// ─── dimensions ──────────────────────────────────────────────────────────

export type DimensionKind = 'linear' | 'aligned' | 'radial' | 'diametric' | 'angular';

interface BaseDimension {
  id: string;
  viewportId: string;
  kind: DimensionKind;
  /** Source-model geometry ids the dimension refers to. */
  refs: ReadonlyArray<string>;
  /** Optional override — by default the renderer measures the geometry.
   *  Set this to display a different number (e.g., for fixed callouts). */
  valueOverride?: number;
  tolerance?: Tolerance;
  /** Optional prefix/suffix shown around the value (e.g., 'R', '⌀', '°'). */
  prefix?: string;
  suffix?: string;
}

export interface LinearDimension extends BaseDimension { kind: 'linear' }
export interface AlignedDimension extends BaseDimension { kind: 'aligned' }
export interface RadialDimension extends BaseDimension { kind: 'radial' }
export interface DiametricDimension extends BaseDimension { kind: 'diametric' }
export interface AngularDimension extends BaseDimension { kind: 'angular' }

export type Dimension =
  | LinearDimension
  | AlignedDimension
  | RadialDimension
  | DiametricDimension
  | AngularDimension;

// Per-kind ref-count expectations.
const KIND_REF_COUNT: Record<DimensionKind, number> = {
  linear: 2,      // two parallel surfaces or two points
  aligned: 2,     // two non-parallel points (measures along their line)
  radial: 1,      // single arc/circle edge
  diametric: 1,   // single circle edge
  angular: 2,     // two intersecting lines or planes
};

export class DimensionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DimensionError';
  }
}

export function validateDimension(d: Dimension): void {
  if (!d.id) throw new DimensionError('dimension id is empty');
  if (!d.viewportId) throw new DimensionError(`dimension ${d.id}: viewportId is empty`);
  const expected = KIND_REF_COUNT[d.kind];
  if (d.refs.length !== expected) {
    throw new DimensionError(
      `dimension ${d.id}: kind '${d.kind}' needs ${expected} refs, got ${d.refs.length}`,
    );
  }
  if (d.tolerance) validateTolerance(d.tolerance);
}

// ─── GD&T ────────────────────────────────────────────────────────────────

export type GdtKind =
  | 'straightness'
  | 'flatness'
  | 'circularity'
  | 'cylindricity'
  | 'position'
  | 'concentricity'
  | 'runout';

export interface GdtCallout {
  id: string;
  viewportId: string;
  kind: GdtKind;
  /** Source-model geometry id this controls (face/edge id). */
  targetRef: string;
  /** Tolerance zone size in mm. */
  toleranceValue: number;
  /** Datum references (e.g., ['A', 'B', 'C']) — letter labels used in the
   *  feature control frame, resolved separately to actual faces/datums. */
  datums?: ReadonlyArray<string>;
  /** Material condition modifier: M = maximum material, L = least material,
   *  '' = regardless of feature size. */
  materialCondition?: 'M' | 'L' | '';
}

// Per-kind datum count expectations (minimum required).
const GDT_DATUM_MIN: Record<GdtKind, number> = {
  straightness: 0,
  flatness: 0,
  circularity: 0,
  cylindricity: 0,
  position: 1,
  concentricity: 1,
  runout: 1,
};

export class GdtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GdtError';
  }
}

export function validateGdt(g: GdtCallout): void {
  if (!g.id) throw new GdtError('GD&T id is empty');
  if (!g.viewportId) throw new GdtError(`GD&T ${g.id}: viewportId is empty`);
  if (g.toleranceValue <= 0) {
    throw new GdtError(`GD&T ${g.id}: tolerance must be positive`);
  }
  const minDatums = GDT_DATUM_MIN[g.kind];
  if ((g.datums?.length ?? 0) < minDatums) {
    throw new GdtError(
      `GD&T ${g.id}: kind '${g.kind}' requires ≥${minDatums} datums, got ${g.datums?.length ?? 0}`,
    );
  }
}

/**
 * Render a GD&T feature control frame as a textual representation.
 * (The visual frame with symbols is renderer-specific; this is the
 * fallback / DXF-text-mode rendering.)
 */
export function formatGdt(g: GdtCallout): string {
  const sym = gdtSymbol(g.kind);
  const tol = g.toleranceValue.toString();
  const mc = g.materialCondition ? `(${g.materialCondition})` : '';
  const datums = g.datums && g.datums.length > 0 ? `|${g.datums.join('|')}` : '';
  return `[${sym}|${tol}${mc}${datums}]`;
}

function gdtSymbol(kind: GdtKind): string {
  switch (kind) {
    case 'straightness': return 'STR';
    case 'flatness': return 'FLT';
    case 'circularity': return 'CIR';
    case 'cylindricity': return 'CYL';
    case 'position': return 'POS';
    case 'concentricity': return 'CON';
    case 'runout': return 'RUN';
  }
}
