/**
 * louverPattern.ts — Generate louver (gilled vent) cut + form
 * pattern for sheet-metal ventilation.
 *
 * Louvers are partial cuts in a sheet that are then formed into
 * scoops — providing air flow without a separate grille. Each
 * louver:
 *
 *   - Cut shape: U-cut (3 sides) leaving one side hinged.
 *   - Forming: hinged side pushed down to create the scoop.
 *
 * Module produces:
 *
 *   - Cut polylines per louver.
 *   - Forming axis line per louver.
 *   - Air-flow opening area + scoop volume estimate.
 *   - Grid placement.
 */

export interface Vec2 { x: number; y: number }

export interface LouverShape {
  id: string;
  /** Center of the louver on the sheet. */
  center: Vec2;
  /** Long dimension (mm). */
  lengthMm: number;
  /** Short dimension / opening height (mm). */
  widthMm: number;
  /** Corner radius (mm). */
  cornerRadiusMm: number;
  /** Orientation: which side is hinged (0 = +Y / top hinge). */
  hingeAngleRad: number;
  /** Form depth (how far the scoop is pushed down), mm. */
  formDepthMm: number;
}

export interface LouverPolyline {
  /** Cut polyline points (open: 3 sides). */
  cutPoints: Vec2[];
  /** Hinge line endpoints. */
  hingeStart: Vec2;
  hingeEnd: Vec2;
}

export interface PatternInput {
  /** Region bounding box for grid placement. */
  regionMin: Vec2;
  regionMax: Vec2;
  /** Per-louver dimensions. */
  shape: Omit<LouverShape, 'id' | 'center'>;
  /** Grid rows × cols. */
  rows: number;
  cols: number;
  /** Staggered (hex) arrangement. */
  staggered: boolean;
}

export interface PatternResult {
  louvers: LouverShape[];
  polylines: LouverPolyline[];
  /** Total cut length, mm. */
  totalCutLengthMm: number;
  /** Total opening area, mm² (estimate). */
  totalOpeningAreaMm2: number;
  /** Total scoop air-flow area normal to the sheet. */
  airflowAreaMm2: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function generateLouverPattern(input: PatternInput): PatternResult {
  const regionWidth = input.regionMax.x - input.regionMin.x;
  const regionHeight = input.regionMax.y - input.regionMin.y;
  const stepX = regionWidth / input.cols;
  const stepY = regionHeight / input.rows;
  const louvers: LouverShape[] = [];
  const polylines: LouverPolyline[] = [];

  let id = 0;
  for (let r = 0; r < input.rows; r++) {
    const rowOffsetX = input.staggered && r % 2 === 1 ? stepX / 2 : 0;
    for (let c = 0; c < input.cols; c++) {
      const cx = input.regionMin.x + rowOffsetX + (c + 0.5) * stepX;
      if (cx > input.regionMax.x) continue;
      const cy = input.regionMin.y + (r + 0.5) * stepY;
      const louver: LouverShape = {
        ...input.shape,
        id: `lv-${id++}`,
        center: { x: cx, y: cy },
      };
      louvers.push(louver);
      polylines.push(buildLouverPolyline(louver));
    }
  }

  let totalCut = 0;
  let openingArea = 0;
  let airflow = 0;
  for (const p of polylines) {
    totalCut += polylineLength(p.cutPoints);
  }
  for (const l of louvers) {
    openingArea += l.lengthMm * l.widthMm;
    airflow += l.lengthMm * l.formDepthMm;
  }

  return {
    louvers,
    polylines,
    totalCutLengthMm: totalCut,
    totalOpeningAreaMm2: openingArea,
    airflowAreaMm2: airflow,
  };
}

// ── Build a single louver polyline ────────────────────────────

function buildLouverPolyline(shape: LouverShape): LouverPolyline {
  const cos = Math.cos(shape.hingeAngleRad);
  const sin = Math.sin(shape.hingeAngleRad);
  const halfL = shape.lengthMm / 2;
  const halfW = shape.widthMm / 2;
  const r = Math.min(shape.cornerRadiusMm, halfW);

  // Local coords (hinge on +Y side).
  const local: Vec2[] = [
    { x: -halfL + r, y: halfW },          // hinge start (upper-left, corner radius offset)
    { x: -halfL, y: halfW - r },          // upper-left after corner
    { x: -halfL, y: -halfW + r },         // lower-left
    { x: -halfL + r, y: -halfW },         // bottom-left after corner
    { x: halfL - r, y: -halfW },          // bottom-right before corner
    { x: halfL, y: -halfW + r },          // right side after corner
    { x: halfL, y: halfW - r },           // right side near hinge
    { x: halfL - r, y: halfW },           // hinge end (upper-right)
  ];

  const cutPoints = local.map(p => ({
    x: shape.center.x + p.x * cos - p.y * sin,
    y: shape.center.y + p.x * sin + p.y * cos,
  }));
  const hingeStart = cutPoints[0]!;
  const hingeEnd = cutPoints[cutPoints.length - 1]!;
  return { cutPoints, hingeStart, hingeEnd };
}

function polylineLength(points: Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

// ── Coverage analysis ─────────────────────────────────────────

export interface CoverageAnalysis {
  regionAreaMm2: number;
  louverFootprintMm2: number;
  openAreaFraction: number;
  louverDensityPerMm2: number;
}

export function computeCoverage(result: PatternResult, regionMin: Vec2, regionMax: Vec2): CoverageAnalysis {
  const regionArea = (regionMax.x - regionMin.x) * (regionMax.y - regionMin.y);
  const louverFootprint = result.louvers.reduce((s, l) => s + l.lengthMm * l.widthMm, 0);
  return {
    regionAreaMm2: regionArea,
    louverFootprintMm2: louverFootprint,
    openAreaFraction: regionArea > 0 ? louverFootprint / regionArea : 0,
    louverDensityPerMm2: regionArea > 0 ? result.louvers.length / regionArea : 0,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface PatternSummary {
  louverCount: number;
  totalCutLengthMm: number;
  airflowAreaMm2: number;
  isStaggered: boolean;
}

export function summarize(result: PatternResult, isStaggered: boolean): PatternSummary {
  return {
    louverCount: result.louvers.length,
    totalCutLengthMm: result.totalCutLengthMm,
    airflowAreaMm2: result.airflowAreaMm2,
    isStaggered,
  };
}
