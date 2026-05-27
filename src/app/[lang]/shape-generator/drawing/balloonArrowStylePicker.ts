/**
 * balloonArrowStylePicker.ts — Choose the right arrowhead style for
 * balloon leaders based on what the leader points to.
 *
 * ASME Y14.2 / ISO 128 conventions:
 *
 *   - Solid arrowhead: leader points at a line/edge (default).
 *   - Dot: leader lands on a face (interior of face).
 *   - Open arrow: reference dimension or call-out.
 *   - No head: leader continues without ending on a feature.
 *
 * Module:
 *   - Determines the appropriate style from feature type.
 *   - Validates leader does not cross another leader or dimension.
 *   - Produces drawing-ready arrow geometry.
 */

export type ArrowStyle = 'solid' | 'dot' | 'open' | 'none';

export type LeaderTarget = 'edge' | 'face' | 'point' | 'centerline' | 'reference';

export interface Vec2 { x: number; y: number }

export interface Balloon {
  id: string;
  /** Balloon centre on the drawing. */
  position: Vec2;
  /** Item number inside the balloon. */
  itemNumber: number;
  /** Target on the part. */
  target: { type: LeaderTarget; point: Vec2 };
  /** Required if target='reference'. */
  isReference?: boolean;
}

export interface LeaderGeometry {
  balloonId: string;
  /** Arrowhead style. */
  style: ArrowStyle;
  /** Leader polyline: from balloon edge to feature. */
  polyline: Vec2[];
  /** Arrowhead position (tip). */
  tipPosition: Vec2;
  /** Arrowhead direction (unit). */
  tipDirection: Vec2;
}

// ── Top-level entry ────────────────────────────────────────────

export function chooseArrowStyle(balloon: Balloon): ArrowStyle {
  if (balloon.isReference) return 'open';
  switch (balloon.target.type) {
    case 'edge': return 'solid';
    case 'face': return 'dot';
    case 'point': return 'solid';
    case 'centerline': return 'solid';
    case 'reference': return 'open';
  }
}

// ── Build a leader for a balloon ─────────────────────────────

export function buildLeader(balloon: Balloon): LeaderGeometry {
  const style = chooseArrowStyle(balloon);
  const tip = balloon.target.point;
  const dx = tip.x - balloon.position.x;
  const dy = tip.y - balloon.position.y;
  const len = Math.hypot(dx, dy);
  const dirX = len === 0 ? 1 : dx / len;
  const dirY = len === 0 ? 0 : dy / len;
  return {
    balloonId: balloon.id,
    style,
    polyline: [balloon.position, tip],
    tipPosition: tip,
    tipDirection: { x: dirX, y: dirY },
  };
}

// ── Cross-check leaders for collisions ───────────────────────

export interface LeaderConflict {
  balloonA: string;
  balloonB: string;
}

export function findCrossingLeaders(leaders: LeaderGeometry[]): LeaderConflict[] {
  const conflicts: LeaderConflict[] = [];
  for (let i = 0; i < leaders.length; i++) {
    for (let j = i + 1; j < leaders.length; j++) {
      if (segmentsCross(leaders[i]!.polyline, leaders[j]!.polyline)) {
        conflicts.push({ balloonA: leaders[i]!.balloonId, balloonB: leaders[j]!.balloonId });
      }
    }
  }
  return conflicts;
}

function segmentsCross(a: Vec2[], b: Vec2[]): boolean {
  if (a.length < 2 || b.length < 2) return false;
  const a0 = a[0]!, a1 = a[a.length - 1]!;
  const b0 = b[0]!, b1 = b[b.length - 1]!;
  return lineSegIntersect(a0, a1, b0, b1);
}

function lineSegIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d1 = direction(p3, p4, p1);
  const d2 = direction(p3, p4, p2);
  const d3 = direction(p1, p2, p3);
  const d4 = direction(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}

function direction(a: Vec2, b: Vec2, c: Vec2): number {
  return (c.x - a.x) * (b.y - a.y) - (b.x - a.x) * (c.y - a.y);
}

// ── Arrow head polygon (for rendering) ────────────────────────

export interface ArrowHead {
  style: ArrowStyle;
  /** Polygon vertices. */
  vertices: Vec2[];
  /** Whether filled. */
  filled: boolean;
}

export function arrowHeadPolygon(leader: LeaderGeometry, sizeMm: number = 3): ArrowHead {
  const { tipPosition: tip, tipDirection: dir, style } = leader;
  if (style === 'none') return { style, vertices: [], filled: false };
  if (style === 'dot') {
    const radius = sizeMm * 0.4;
    const samples = 8;
    const verts: Vec2[] = [];
    for (let i = 0; i < samples; i++) {
      const t = (i / samples) * 2 * Math.PI;
      verts.push({ x: tip.x + radius * Math.cos(t), y: tip.y + radius * Math.sin(t) });
    }
    return { style, vertices: verts, filled: true };
  }
  // Triangular head.
  const halfWidth = sizeMm * 0.4;
  const perpX = -dir.y;
  const perpY = dir.x;
  const baseCenterX = tip.x - dir.x * sizeMm;
  const baseCenterY = tip.y - dir.y * sizeMm;
  const verts: Vec2[] = [
    { x: tip.x, y: tip.y },
    { x: baseCenterX + perpX * halfWidth, y: baseCenterY + perpY * halfWidth },
    { x: baseCenterX - perpX * halfWidth, y: baseCenterY - perpY * halfWidth },
  ];
  return { style, vertices: verts, filled: style === 'solid' };
}

// ── Bulk validate ────────────────────────────────────────────

export interface BulkValidation {
  balloonCount: number;
  leaders: LeaderGeometry[];
  conflicts: LeaderConflict[];
  styleCounts: Record<ArrowStyle, number>;
}

export function validateBulk(balloons: Balloon[]): BulkValidation {
  const leaders = balloons.map(buildLeader);
  const conflicts = findCrossingLeaders(leaders);
  const counts: Record<ArrowStyle, number> = { solid: 0, dot: 0, open: 0, none: 0 };
  for (const l of leaders) counts[l.style]++;
  return { balloonCount: balloons.length, leaders, conflicts, styleCounts: counts };
}

// ── Summary ────────────────────────────────────────────────────

export interface BalloonSummary {
  balloonCount: number;
  conflictCount: number;
  solidCount: number;
  dotCount: number;
}

export function summarize(result: BulkValidation): BalloonSummary {
  return {
    balloonCount: result.balloonCount,
    conflictCount: result.conflicts.length,
    solidCount: result.styleCounts.solid,
    dotCount: result.styleCounts.dot,
  };
}
