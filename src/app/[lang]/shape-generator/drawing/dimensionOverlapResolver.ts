/**
 * dimensionOverlapResolver.ts — Resolve overlapping dimension labels
 * on a drawing.
 *
 * When several dimensions cluster (e.g., a long edge with multiple
 * step measurements), their text labels can collide. ISO 129 / ASME
 * Y14.5 require clear, non-overlapping labels.
 *
 * Module:
 *   - Takes a list of dimension labels (axis-aligned text bounding
 *     boxes).
 *   - Detects overlaps.
 *   - Moves overlapping labels along the dimension direction by
 *     minimal displacement until no overlap remains.
 *   - Fallback to staggered placement (alternating above/below the
 *     dimension line) for dense clusters.
 *
 * Uses a sweep + push-apart algorithm.
 */

export interface DimensionLabel {
  id: string;
  /** Centre of the text bbox. */
  centre: { x: number; y: number };
  widthMm: number;
  heightMm: number;
  /** Preferred direction along which the label can slide (unit vec). */
  slideDirection: { x: number; y: number };
  /** Whether the label can stagger to opposite side of dim line. */
  canStagger: boolean;
  /** Offset perpendicular to dimension line for stagger. */
  staggerOffsetMm: number;
}

export interface ResolveOptions {
  /** Minimum clearance between bboxes. */
  clearanceMm: number;
  /** Max iterations to converge. */
  maxIterations: number;
}

export const DEFAULT_OPTIONS: ResolveOptions = {
  clearanceMm: 1,
  maxIterations: 100,
};

export interface ResolvedLabel {
  id: string;
  newCentre: { x: number; y: number };
  /** Displacement applied (mm). */
  displacementMm: number;
  /** True if label was staggered to opposite side. */
  staggered: boolean;
}

// ── Top-level entry ────────────────────────────────────────────

export function resolveOverlaps(
  labels: DimensionLabel[],
  options: Partial<ResolveOptions> = {},
): ResolvedLabel[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  // Working copy.
  const positions = new Map<string, { x: number; y: number; staggered: boolean }>();
  for (const l of labels) positions.set(l.id, { ...l.centre, staggered: false });

  let iter = 0;
  while (iter < opts.maxIterations) {
    let anyOverlap = false;
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i]!;
        const b = labels[j]!;
        const pa = positions.get(a.id)!;
        const pb = positions.get(b.id)!;
        const overlap = computeOverlap(pa, a, pb, b, opts.clearanceMm);
        if (overlap.x > 0 && overlap.y > 0) {
          anyOverlap = true;
          pushApart(a, pa, b, pb, overlap);
        }
      }
    }
    if (!anyOverlap) break;
    iter++;
  }

  // For labels that still overlap after sliding, stagger.
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i]!;
      const b = labels[j]!;
      const pa = positions.get(a.id)!;
      const pb = positions.get(b.id)!;
      const o = computeOverlap(pa, a, pb, b, opts.clearanceMm);
      if (o.x > 0 && o.y > 0) {
        // Stagger the smaller label.
        const target = a.widthMm * a.heightMm <= b.widthMm * b.heightMm ? a : b;
        const p = positions.get(target.id)!;
        if (target.canStagger) {
          // Move perpendicular to slide direction.
          const perpX = -target.slideDirection.y;
          const perpY = target.slideDirection.x;
          p.x += perpX * target.staggerOffsetMm;
          p.y += perpY * target.staggerOffsetMm;
          p.staggered = true;
        }
      }
    }
  }

  return labels.map(l => {
    const p = positions.get(l.id)!;
    return {
      id: l.id,
      newCentre: { x: p.x, y: p.y },
      displacementMm: Math.hypot(p.x - l.centre.x, p.y - l.centre.y),
      staggered: p.staggered,
    };
  });
}

// ── Overlap calculation ───────────────────────────────────────

function computeOverlap(
  pa: { x: number; y: number },
  a: DimensionLabel,
  pb: { x: number; y: number },
  b: DimensionLabel,
  clearance: number,
): { x: number; y: number } {
  const aMinX = pa.x - a.widthMm / 2 - clearance / 2;
  const aMaxX = pa.x + a.widthMm / 2 + clearance / 2;
  const aMinY = pa.y - a.heightMm / 2 - clearance / 2;
  const aMaxY = pa.y + a.heightMm / 2 + clearance / 2;
  const bMinX = pb.x - b.widthMm / 2 - clearance / 2;
  const bMaxX = pb.x + b.widthMm / 2 + clearance / 2;
  const bMinY = pb.y - b.heightMm / 2 - clearance / 2;
  const bMaxY = pb.y + b.heightMm / 2 + clearance / 2;
  return {
    x: Math.min(aMaxX, bMaxX) - Math.max(aMinX, bMinX),
    y: Math.min(aMaxY, bMaxY) - Math.max(aMinY, bMinY),
  };
}

function pushApart(
  a: DimensionLabel,
  pa: { x: number; y: number; staggered: boolean },
  b: DimensionLabel,
  pb: { x: number; y: number; staggered: boolean },
  overlap: { x: number; y: number },
): void {
  // Use min overlap as the push amount, along respective slide direction.
  const push = Math.min(overlap.x, overlap.y) / 2 + 0.01;
  const ax = pa.x < pb.x ? -1 : 1;
  pa.x += a.slideDirection.x * push * ax;
  pa.y += a.slideDirection.y * push * ax;
  pb.x -= b.slideDirection.x * push * ax;
  pb.y -= b.slideDirection.y * push * ax;
}

// ── Detect remaining overlaps ─────────────────────────────────

export function findRemainingOverlaps(
  labels: DimensionLabel[],
  resolved: ResolvedLabel[],
  clearance: number = 1,
): { a: string; b: string }[] {
  const out: { a: string; b: string }[] = [];
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const ra = resolved.find(r => r.id === labels[i]!.id)!;
      const rb = resolved.find(r => r.id === labels[j]!.id)!;
      const pa = { x: ra.newCentre.x, y: ra.newCentre.y };
      const pb = { x: rb.newCentre.x, y: rb.newCentre.y };
      const o = computeOverlap(pa, labels[i]!, pb, labels[j]!, clearance);
      if (o.x > 0 && o.y > 0) out.push({ a: labels[i]!.id, b: labels[j]!.id });
    }
  }
  return out;
}

// ── Summary ────────────────────────────────────────────────────

export interface ResolveSummary {
  labelCount: number;
  resolvedCount: number;
  staggeredCount: number;
  maxDisplacementMm: number;
}

export function summarize(resolved: ResolvedLabel[]): ResolveSummary {
  let staggered = 0;
  let maxDisp = 0;
  let resolvedAny = 0;
  for (const r of resolved) {
    if (r.staggered) staggered++;
    if (r.displacementMm > maxDisp) maxDisp = r.displacementMm;
    if (r.displacementMm > 0 || r.staggered) resolvedAny++;
  }
  return {
    labelCount: resolved.length,
    resolvedCount: resolvedAny,
    staggeredCount: staggered,
    maxDisplacementMm: maxDisp,
  };
}
