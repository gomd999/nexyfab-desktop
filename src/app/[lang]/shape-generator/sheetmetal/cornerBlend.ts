/**
 * cornerBlend.ts — Generate smooth corner blends at sheet-metal
 * bend intersections.
 *
 * When two bends meet at a corner (like a folded box), the inner
 * material gets stretched. Naively, a sharp inside corner cracks.
 * Standard practice: add a *blend* — a rounded transition between
 * the two bend edges. Variants:
 *
 *   - **Tangent arc**: smooth circular blend (inside radius = sheet
 *     thickness or larger).
 *   - **Chamfer**: 45° flat cut between the two edges (used when a
 *     full radius is too aggressive).
 *   - **Bezier**: smooth G2 curve (for Class A surfaces).
 *
 * Module accepts two intersecting bend edges (as 2D polylines) and
 * a blend type, and emits the replacement edge polyline + reports
 * material savings (or addition) vs the sharp corner.
 */

export interface Vec2 { x: number; y: number }

export type BlendKind = 'tangent-arc' | 'chamfer' | 'bezier';

export interface BendEdge {
  id: string;
  /** Polyline points (last point = corner). */
  points: Vec2[];
}

export interface BlendResult {
  /** Smoothed corner polyline (replaces the sharp intersection). */
  blendPolyline: Vec2[];
  /** Trimmed-back endpoints of the two original edges. */
  trimmedA: Vec2[];
  trimmedB: Vec2[];
  /** Estimated area saved (positive) or added (negative), mm². */
  areaDeltaMm2: number;
  /** Kind. */
  kind: BlendKind;
}

export interface BlendOptions {
  kind: BlendKind;
  /** Inside-corner radius for tangent-arc / bezier (mm). */
  radiusMm: number;
  /** Chamfer leg length (mm). */
  chamferLegMm: number;
  /** Bezier handle length fraction (0.55 ≈ G2 circle approx). */
  bezierHandleFraction: number;
  /** Samples for the curved blend output polyline. */
  curveSamples: number;
}

export const DEFAULT_OPTIONS: BlendOptions = {
  kind: 'tangent-arc',
  radiusMm: 2.0,
  chamferLegMm: 2.0,
  bezierHandleFraction: 0.55,
  curveSamples: 12,
};

// ── Top-level entry ────────────────────────────────────────────

export function blendCorner(edgeA: BendEdge, edgeB: BendEdge, options: Partial<BlendOptions> = {}): BlendResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const corner = edgeA.points[edgeA.points.length - 1]!;
  // Direction vectors *away from* the corner along each edge.
  const dirA = unitFromCorner(corner, edgeA.points[edgeA.points.length - 2] ?? corner);
  const dirB = unitFromCorner(corner, edgeB.points[edgeB.points.length - 2] ?? corner);

  switch (opts.kind) {
    case 'tangent-arc': return buildTangentArcBlend(corner, dirA, dirB, edgeA, edgeB, opts);
    case 'chamfer': return buildChamferBlend(corner, dirA, dirB, edgeA, edgeB, opts);
    case 'bezier': return buildBezierBlend(corner, dirA, dirB, edgeA, edgeB, opts);
  }
}

// ── Tangent arc ──────────────────────────────────────────────

function buildTangentArcBlend(corner: Vec2, dirA: Vec2, dirB: Vec2, edgeA: BendEdge, edgeB: BendEdge, opts: BlendOptions): BlendResult {
  const halfAngle = angleBetween(dirA, dirB) / 2;
  const tanHalf = Math.tan(halfAngle);
  if (tanHalf < 1e-6) {
    // Edges parallel; no blend possible.
    return { blendPolyline: [corner], trimmedA: edgeA.points, trimmedB: edgeB.points, areaDeltaMm2: 0, kind: 'tangent-arc' };
  }
  const setback = opts.radiusMm / tanHalf;
  const tangentA: Vec2 = { x: corner.x + dirA.x * setback, y: corner.y + dirA.y * setback };
  const tangentB: Vec2 = { x: corner.x + dirB.x * setback, y: corner.y + dirB.y * setback };
  // Center of arc = corner + bisector * (radius / sin(halfAngle)).
  const bisector: Vec2 = normalize({ x: dirA.x + dirB.x, y: dirA.y + dirB.y });
  const centerDist = opts.radiusMm / Math.sin(halfAngle);
  const center: Vec2 = { x: corner.x + bisector.x * centerDist, y: corner.y + bisector.y * centerDist };

  const startAngle = Math.atan2(tangentA.y - center.y, tangentA.x - center.x);
  let endAngle = Math.atan2(tangentB.y - center.y, tangentB.x - center.x);
  // Pick shorter arc direction.
  let sweep = endAngle - startAngle;
  if (sweep > Math.PI) sweep -= 2 * Math.PI;
  if (sweep < -Math.PI) sweep += 2 * Math.PI;

  const arcPoints: Vec2[] = [];
  for (let i = 0; i <= opts.curveSamples; i++) {
    const t = i / opts.curveSamples;
    const a = startAngle + sweep * t;
    arcPoints.push({
      x: center.x + opts.radiusMm * Math.cos(a),
      y: center.y + opts.radiusMm * Math.sin(a),
    });
  }

  const trimmedA = trimEdge(edgeA, tangentA);
  const trimmedB = trimEdge(edgeB, tangentB);
  // Area delta: roughly the triangle (corner, tangentA, tangentB) area minus the arc segment area.
  const tri = triangleArea(corner, tangentA, tangentB);
  const seg = arcSegmentArea(opts.radiusMm, Math.abs(sweep));
  return {
    blendPolyline: arcPoints,
    trimmedA,
    trimmedB,
    areaDeltaMm2: tri - seg,
    kind: 'tangent-arc',
  };
}

// ── Chamfer ──────────────────────────────────────────────────

function buildChamferBlend(corner: Vec2, dirA: Vec2, dirB: Vec2, edgeA: BendEdge, edgeB: BendEdge, opts: BlendOptions): BlendResult {
  const tA: Vec2 = { x: corner.x + dirA.x * opts.chamferLegMm, y: corner.y + dirA.y * opts.chamferLegMm };
  const tB: Vec2 = { x: corner.x + dirB.x * opts.chamferLegMm, y: corner.y + dirB.y * opts.chamferLegMm };
  return {
    blendPolyline: [tA, tB],
    trimmedA: trimEdge(edgeA, tA),
    trimmedB: trimEdge(edgeB, tB),
    areaDeltaMm2: triangleArea(corner, tA, tB),
    kind: 'chamfer',
  };
}

// ── Bezier ───────────────────────────────────────────────────

function buildBezierBlend(corner: Vec2, dirA: Vec2, dirB: Vec2, edgeA: BendEdge, edgeB: BendEdge, opts: BlendOptions): BlendResult {
  const setback = opts.radiusMm;
  const tA: Vec2 = { x: corner.x + dirA.x * setback, y: corner.y + dirA.y * setback };
  const tB: Vec2 = { x: corner.x + dirB.x * setback, y: corner.y + dirB.y * setback };
  const handleLen = setback * opts.bezierHandleFraction;
  // Control points pull toward the corner.
  const cp1: Vec2 = { x: tA.x - dirA.x * handleLen, y: tA.y - dirA.y * handleLen };
  const cp2: Vec2 = { x: tB.x - dirB.x * handleLen, y: tB.y - dirB.y * handleLen };
  const points: Vec2[] = [];
  for (let i = 0; i <= opts.curveSamples; i++) {
    const t = i / opts.curveSamples;
    points.push(cubicBezier(tA, cp1, cp2, tB, t));
  }
  return {
    blendPolyline: points,
    trimmedA: trimEdge(edgeA, tA),
    trimmedB: trimEdge(edgeB, tB),
    areaDeltaMm2: triangleArea(corner, tA, tB) * 0.7, // approx
    kind: 'bezier',
  };
}

// ── Geometry helpers ──────────────────────────────────────────

function unitFromCorner(corner: Vec2, second: Vec2): Vec2 {
  const dx = second.x - corner.x;
  const dy = second.y - corner.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return { x: 1, y: 0 };
  return { x: dx / len, y: dy / len };
}

function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  if (len < 1e-9) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

function angleBetween(a: Vec2, b: Vec2): number {
  const dot = a.x * b.x + a.y * b.y;
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

function triangleArea(p1: Vec2, p2: Vec2, p3: Vec2): number {
  return Math.abs((p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x)) / 2;
}

function arcSegmentArea(r: number, angleRad: number): number {
  return 0.5 * r * r * (angleRad - Math.sin(angleRad));
}

function trimEdge(edge: BendEdge, newEnd: Vec2): Vec2[] {
  // Replace last point with newEnd.
  return [...edge.points.slice(0, -1), newEnd];
}

function cubicBezier(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
    y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface BlendSummary {
  kind: BlendKind;
  blendPointCount: number;
  areaDeltaMm2: number;
  isMaterialRemoved: boolean;
}

export function summarize(result: BlendResult): BlendSummary {
  return {
    kind: result.kind,
    blendPointCount: result.blendPolyline.length,
    areaDeltaMm2: result.areaDeltaMm2,
    isMaterialRemoved: result.areaDeltaMm2 > 0,
  };
}
