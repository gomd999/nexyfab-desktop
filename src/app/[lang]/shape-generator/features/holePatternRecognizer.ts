/**
 * holePatternRecognizer.ts — Identify hole patterns (rectangular grid,
 * circular bolt circle, linear) from a list of hole positions.
 *
 * SolidWorks "Hole Wizard" + DimXpert use pattern detection to:
 *   - Group holes into a single dimension callout ("8× ⌀ 6.5 EQL SP").
 *   - Generate a smart tap drill table from grouped holes.
 *   - Drive a manufacturing pattern (linear pattern, circular pattern)
 *     instead of repeating the hole feature one-by-one.
 *
 * This module is the *recognizer*: given an unstructured list of
 * holes, find any patterns and report (pattern, members).
 *
 * Three pattern types:
 *   - **rectangular** — N × M grid, axis-aligned (rows + cols).
 *   - **circular** — bolt-hole circle (N holes evenly around a center).
 *   - **linear** — N holes evenly spaced on a line.
 *
 * Output keeps the ungrouped holes too, so the caller can show
 * "Pattern A (4 holes) + Pattern B (8 holes) + 2 standalone holes".
 */

export interface HolePosition {
  /** Stable id (e.g. feature id). */
  id: string;
  /** Hole center in 2D (mm) — caller projects to a sketch plane. */
  position: [number, number];
  /** Hole diameter (mm). */
  diameterMm: number;
}

export type PatternKind = 'rectangular' | 'circular' | 'linear' | 'none';

export interface RecognizedPattern {
  kind: PatternKind;
  /** Hole ids that belong to this pattern. */
  memberIds: string[];
  /** Pattern-specific metadata. */
  metadata: Record<string, number | string>;
  /** Confidence 0..1 — how well the holes fit the pattern. */
  confidence: number;
}

export interface RecognitionResult {
  patterns: RecognizedPattern[];
  /** Hole ids not assigned to any pattern. */
  ungroupedHoleIds: string[];
}

const TOLERANCE_MM = 0.5; // hole position tolerance when matching patterns
const DIAMETER_TOLERANCE_MM = 0.1;

function approxEqual(a: number, b: number, tol: number = TOLERANCE_MM): boolean {
  return Math.abs(a - b) < tol;
}

function distance(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

// ── Rectangular grid detection ──────────────────────────────────

function detectRectangular(holes: HolePosition[]): RecognizedPattern | null {
  if (holes.length < 4) return null;
  // All holes must share the same diameter.
  const dia = holes[0]!.diameterMm;
  if (!holes.every(h => approxEqual(h.diameterMm, dia, DIAMETER_TOLERANCE_MM))) return null;

  // Sort by x then y; look for axis-aligned grid.
  const xs = Array.from(new Set(holes.map(h => Math.round(h.position[0] / TOLERANCE_MM) * TOLERANCE_MM))).sort((a, b) => a - b);
  const ys = Array.from(new Set(holes.map(h => Math.round(h.position[1] / TOLERANCE_MM) * TOLERANCE_MM))).sort((a, b) => a - b);

  if (xs.length < 2 || ys.length < 2) return null;
  if (xs.length * ys.length !== holes.length) return null;

  // Verify uniform spacing along each axis.
  const xSpacing = (xs[xs.length - 1]! - xs[0]!) / (xs.length - 1);
  const ySpacing = (ys[ys.length - 1]! - ys[0]!) / (ys.length - 1);
  for (let i = 1; i < xs.length; i++) {
    if (!approxEqual(xs[i]! - xs[i - 1]!, xSpacing, TOLERANCE_MM)) return null;
  }
  for (let i = 1; i < ys.length; i++) {
    if (!approxEqual(ys[i]! - ys[i - 1]!, ySpacing, TOLERANCE_MM)) return null;
  }

  return {
    kind: 'rectangular',
    memberIds: holes.map(h => h.id),
    metadata: {
      rows: ys.length,
      cols: xs.length,
      xSpacingMm: xSpacing,
      ySpacingMm: ySpacing,
      diameterMm: dia,
    },
    confidence: 1,
  };
}

// ── Circular pattern (bolt circle) ──────────────────────────────

function detectCircular(holes: HolePosition[]): RecognizedPattern | null {
  if (holes.length < 3) return null;
  // All holes share same diameter.
  const dia = holes[0]!.diameterMm;
  if (!holes.every(h => approxEqual(h.diameterMm, dia, DIAMETER_TOLERANCE_MM))) return null;

  // Compute centroid as candidate center.
  let cx = 0, cy = 0;
  for (const h of holes) { cx += h.position[0]; cy += h.position[1]; }
  cx /= holes.length; cy /= holes.length;

  // All holes must lie on a circle of radius R from centroid.
  const radii = holes.map(h => distance(h.position, [cx, cy]));
  const meanR = radii.reduce((s, r) => s + r, 0) / radii.length;
  const radialOk = radii.every(r => approxEqual(r, meanR, TOLERANCE_MM));
  if (!radialOk) return null;

  // Check uniform angular spacing.
  const angles = holes.map(h => Math.atan2(h.position[1] - cy, h.position[0] - cx))
    .map(a => (a + Math.PI * 2) % (Math.PI * 2))
    .sort((a, b) => a - b);
  const targetAngle = (Math.PI * 2) / holes.length;
  for (let i = 1; i < angles.length; i++) {
    if (!approxEqual(angles[i]! - angles[i - 1]!, targetAngle, 0.05)) return null;
  }
  // Wrap-around check.
  const lastGap = (Math.PI * 2) - angles[angles.length - 1]! + angles[0]!;
  if (!approxEqual(lastGap, targetAngle, 0.05)) return null;

  return {
    kind: 'circular',
    memberIds: holes.map(h => h.id),
    metadata: {
      centerX: cx,
      centerY: cy,
      radiusMm: meanR,
      count: holes.length,
      diameterMm: dia,
      angularSpacingDeg: 360 / holes.length,
    },
    confidence: 1,
  };
}

// ── Linear pattern ──────────────────────────────────────────────

function detectLinear(holes: HolePosition[]): RecognizedPattern | null {
  if (holes.length < 3) return null;
  const dia = holes[0]!.diameterMm;
  if (!holes.every(h => approxEqual(h.diameterMm, dia, DIAMETER_TOLERANCE_MM))) return null;

  // Best-fit line via least squares on holes.
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const h of holes) {
    sumX += h.position[0]; sumY += h.position[1];
    sumXY += h.position[0] * h.position[1];
    sumX2 += h.position[0] * h.position[0];
  }
  const n = holes.length;
  const denom = n * sumX2 - sumX * sumX;
  // Vertical or horizontal line case.
  if (Math.abs(denom) < 1e-6) {
    // Vertical: all share same x. Check y monotonic spacing.
    const ySorted = holes.map(h => h.position[1]).sort((a, b) => a - b);
    return checkLinearAlong(ySorted, holes, dia);
  }
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  // Check that all holes are within tolerance of the fitted line.
  for (const h of holes) {
    const yLine = slope * h.position[0] + intercept;
    if (!approxEqual(h.position[1], yLine, TOLERANCE_MM)) return null;
  }
  // Project holes onto line direction + check uniform spacing.
  const lineDir: [number, number] = [1 / Math.hypot(1, slope), slope / Math.hypot(1, slope)];
  const projections = holes.map(h => h.position[0] * lineDir[0] + h.position[1] * lineDir[1]).sort((a, b) => a - b);
  return checkLinearAlong(projections, holes, dia);
}

function checkLinearAlong(sortedPositions: number[], holes: HolePosition[], dia: number): RecognizedPattern | null {
  if (sortedPositions.length < 2) return null;
  const totalLen = sortedPositions[sortedPositions.length - 1]! - sortedPositions[0]!;
  const spacing = totalLen / (sortedPositions.length - 1);
  for (let i = 1; i < sortedPositions.length; i++) {
    if (!approxEqual(sortedPositions[i]! - sortedPositions[i - 1]!, spacing, TOLERANCE_MM)) return null;
  }
  return {
    kind: 'linear',
    memberIds: holes.map(h => h.id),
    metadata: {
      count: holes.length,
      spacingMm: spacing,
      totalLengthMm: totalLen,
      diameterMm: dia,
    },
    confidence: 1,
  };
}

// ── Top-level recognizer ────────────────────────────────────────

/** Detect any patterns among the given hole list. */
export function recognizePatterns(holes: HolePosition[]): RecognitionResult {
  const patterns: RecognizedPattern[] = [];
  const ungrouped = new Set(holes.map(h => h.id));

  // Group by diameter first — patterns require equal diameters.
  const byDiameter = new Map<number, HolePosition[]>();
  for (const h of holes) {
    const key = Math.round(h.diameterMm / DIAMETER_TOLERANCE_MM) * DIAMETER_TOLERANCE_MM;
    if (!byDiameter.has(key)) byDiameter.set(key, []);
    byDiameter.get(key)!.push(h);
  }

  for (const group of byDiameter.values()) {
    // Try rectangular first (most specific).
    const rect = detectRectangular(group);
    if (rect) {
      patterns.push(rect);
      for (const id of rect.memberIds) ungrouped.delete(id);
      continue;
    }
    // Then circular.
    const circ = detectCircular(group);
    if (circ) {
      patterns.push(circ);
      for (const id of circ.memberIds) ungrouped.delete(id);
      continue;
    }
    // Then linear.
    const lin = detectLinear(group);
    if (lin) {
      patterns.push(lin);
      for (const id of lin.memberIds) ungrouped.delete(id);
    }
  }

  return {
    patterns,
    ungroupedHoleIds: Array.from(ungrouped),
  };
}

/** Generate a human-readable callout from a recognized pattern. */
export function patternCallout(pattern: RecognizedPattern): string {
  const dia = pattern.metadata.diameterMm as number;
  switch (pattern.kind) {
    case 'rectangular': {
      const rows = pattern.metadata.rows as number;
      const cols = pattern.metadata.cols as number;
      return `${rows * cols}× ⌀${dia} (${cols}×${rows} grid)`;
    }
    case 'circular': {
      const count = pattern.metadata.count as number;
      const radius = pattern.metadata.radiusMm as number;
      return `${count}× ⌀${dia} EQL SP on ⌀${(radius * 2).toFixed(1)} BC`;
    }
    case 'linear': {
      const count = pattern.metadata.count as number;
      const spacing = pattern.metadata.spacingMm as number;
      return `${count}× ⌀${dia} EQL SP @ ${spacing.toFixed(1)}mm`;
    }
    case 'none':
      return `${pattern.memberIds.length}× ⌀${dia}`;
  }
}
