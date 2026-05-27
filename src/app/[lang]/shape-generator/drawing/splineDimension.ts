/**
 * splineDimension.ts — Dimension a 2D spline / polyline curve on a
 * drawing.
 *
 * Splines (and complex polylines) need more than a simple length
 * dimension. Common annotations:
 *
 *   - Arc length (chord-summed).
 *   - Chord length (start → end straight line).
 *   - Bounding box width × height.
 *   - Radius of curvature at named "control points" (highest curvature).
 *   - Tangent angle at start + end.
 *
 * Module emits a structured set of dimension records the drawing
 * pipeline lays out on the sheet.
 */

export interface Vec2 { x: number; y: number }

export interface SplineCurve {
  /** Densely-sampled points along the spline. */
  points: Vec2[];
}

export interface SplineDimensions {
  arcLengthMm: number;
  chordLengthMm: number;
  bbox: { min: Vec2; max: Vec2 };
  bboxWidthMm: number;
  bboxHeightMm: number;
  startTangentDeg: number;
  endTangentDeg: number;
  /** Top-N curvature peaks. */
  curvaturePeaks: CurvaturePoint[];
}

export interface CurvaturePoint {
  /** Index in the polyline. */
  index: number;
  /** World position. */
  position: Vec2;
  /** Radius of curvature, mm (Infinity for straight). */
  radiusMm: number;
  /** Curvature κ = 1/r. */
  curvature: number;
}

export interface DimensionOptions {
  /** N highest-curvature peaks to record. */
  curvaturePeakCount: number;
  /** Smoothing window for curvature (number of adjacent samples to average). */
  curvatureSmoothing: number;
}

export const DEFAULT_OPTIONS: DimensionOptions = {
  curvaturePeakCount: 3,
  curvatureSmoothing: 2,
};

// ── Top-level entry ────────────────────────────────────────────

export function dimensionSpline(spline: SplineCurve, options: Partial<DimensionOptions> = {}): SplineDimensions {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (spline.points.length < 2) {
    return {
      arcLengthMm: 0,
      chordLengthMm: 0,
      bbox: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } },
      bboxWidthMm: 0,
      bboxHeightMm: 0,
      startTangentDeg: 0,
      endTangentDeg: 0,
      curvaturePeaks: [],
    };
  }

  const pts = spline.points;
  const n = pts.length;

  // Arc length (sum of segment lengths).
  let arcLen = 0;
  for (let i = 1; i < n; i++) {
    arcLen += distance(pts[i - 1]!, pts[i]!);
  }

  // Chord length.
  const chord = distance(pts[0]!, pts[n - 1]!);

  // BBox.
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const p of pts) {
    if (p.x < xMin) xMin = p.x;
    if (p.y < yMin) yMin = p.y;
    if (p.x > xMax) xMax = p.x;
    if (p.y > yMax) yMax = p.y;
  }

  // Tangent angles.
  const startTangent = Math.atan2(pts[1]!.y - pts[0]!.y, pts[1]!.x - pts[0]!.x);
  const endTangent = Math.atan2(pts[n - 1]!.y - pts[n - 2]!.y, pts[n - 1]!.x - pts[n - 2]!.x);

  // Curvature: at internal point i, fit a circle to (i-1, i, i+1).
  const curvatures: CurvaturePoint[] = [];
  for (let i = 1; i < n - 1; i++) {
    const r = fitCircleRadius(pts[i - 1]!, pts[i]!, pts[i + 1]!);
    curvatures.push({
      index: i,
      position: pts[i]!,
      radiusMm: r,
      curvature: r > 0 && Number.isFinite(r) ? 1 / r : 0,
    });
  }
  // Smooth.
  const smoothed = smoothCurvature(curvatures, opts.curvatureSmoothing);
  // Pick top peaks.
  const peaks = pickPeaks(smoothed, opts.curvaturePeakCount);

  return {
    arcLengthMm: arcLen,
    chordLengthMm: chord,
    bbox: { min: { x: xMin, y: yMin }, max: { x: xMax, y: yMax } },
    bboxWidthMm: xMax - xMin,
    bboxHeightMm: yMax - yMin,
    startTangentDeg: radToDeg(startTangent),
    endTangentDeg: radToDeg(endTangent),
    curvaturePeaks: peaks,
  };
}

// ── Curvature helpers ────────────────────────────────────────

export function fitCircleRadius(a: Vec2, b: Vec2, c: Vec2): number {
  // Triangle side lengths.
  const ab = distance(a, b);
  const bc = distance(b, c);
  const ca = distance(c, a);
  // Triangle area (Heron-like via cross product).
  const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
  if (area < 1e-9) return Infinity;
  return (ab * bc * ca) / (4 * area);
}

function smoothCurvature(points: CurvaturePoint[], window: number): CurvaturePoint[] {
  if (window <= 0) return points;
  const out: CurvaturePoint[] = [];
  for (let i = 0; i < points.length; i++) {
    let sum = 0;
    let count = 0;
    for (let k = -window; k <= window; k++) {
      const j = i + k;
      if (j >= 0 && j < points.length) {
        sum += points[j]!.curvature;
        count++;
      }
    }
    const avg = count > 0 ? sum / count : points[i]!.curvature;
    out.push({
      index: points[i]!.index,
      position: points[i]!.position,
      radiusMm: avg > 0 ? 1 / avg : Infinity,
      curvature: avg,
    });
  }
  return out;
}

function pickPeaks(curvatures: CurvaturePoint[], topN: number): CurvaturePoint[] {
  return [...curvatures]
    .sort((a, b) => b.curvature - a.curvature)
    .slice(0, topN);
}

// ── Helpers ────────────────────────────────────────────────────

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

// ── Summary ────────────────────────────────────────────────────

export interface DimensionSummary {
  arcLengthMm: number;
  chordLengthMm: number;
  arcToChordRatio: number;
  minRadiusMm: number;
  bboxArea: number;
}

export function summarize(dims: SplineDimensions): DimensionSummary {
  const minR = dims.curvaturePeaks.length > 0 ? dims.curvaturePeaks[0]!.radiusMm : Infinity;
  return {
    arcLengthMm: dims.arcLengthMm,
    chordLengthMm: dims.chordLengthMm,
    arcToChordRatio: dims.chordLengthMm > 0 ? dims.arcLengthMm / dims.chordLengthMm : 1,
    minRadiusMm: minR,
    bboxArea: dims.bboxWidthMm * dims.bboxHeightMm,
  };
}
