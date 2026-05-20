/**
 * partingLineDetector.ts — Detect the parting line of a part for a given
 * mold pull (draft) direction.
 *
 * For a pull direction d (unit vector), each surface facet is classified
 * by the sign of (faceNormal · d):
 *
 *   > +ε   → faces the "core/top" half  (cavity side)
 *   < −ε   → faces the "cavity/bottom" half (core side)
 *   ≈ 0    → vertical wall (parallel to pull) — undercut risk / parting candidate
 *
 * The parting line is the set of edges shared between a top-facing facet
 * and a bottom-facing facet. We also flag undercut facets (those whose
 * normal·d has the wrong sign for the half they belong to — i.e. they
 * can't be released along d).
 *
 * 2-D simplification: a closed polygon profile, pull direction in-plane;
 * each edge is classified by its outward normal.
 */

export interface Point2D { x: number; y: number }
export type Polygon = Point2D[];

export interface PartingLineInput {
  profile: Polygon; // closed, CCW
  pullDirection: { x: number; y: number };
  draftThresholdDeg?: number; // walls within this of vertical are flagged, default 1°
}

export type EdgeClass = 'top' | 'bottom' | 'vertical';

export interface ClassifiedEdge {
  index: number;
  start: Point2D;
  end: Point2D;
  classification: EdgeClass;
  normalDotPull: number;
}

export interface PartingLineResult {
  edges: ClassifiedEdge[];
  partingPoints: Point2D[]; // vertices where top meets bottom
  undercutEdgeIndices: number[];
  verticalWallCount: number;
  warnings: string[];
}

export function detect(input: PartingLineInput): PartingLineResult {
  const warnings: string[] = [];
  if (input.profile.length < 3) warnings.push('Profile needs at least 3 vertices.');

  const dLen = Math.hypot(input.pullDirection.x, input.pullDirection.y);
  if (dLen < 1e-9) {
    return { edges: [], partingPoints: [], undercutEdgeIndices: [], verticalWallCount: 0, warnings: ['Pull direction is zero.'] };
  }
  const d = { x: input.pullDirection.x / dLen, y: input.pullDirection.y / dLen };
  const thresh = Math.sin((input.draftThresholdDeg ?? 1) * Math.PI / 180);

  const edges: ClassifiedEdge[] = [];
  const n = input.profile.length;
  for (let i = 0; i < n; i++) {
    const a = input.profile[i]!;
    const b = input.profile[(i + 1) % n]!;
    const ex = b.x - a.x, ey = b.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    // outward normal for CCW polygon = (dy, -dx) ... right-normal
    const nx = ey / len, ny = -ex / len;
    const dot = nx * d.x + ny * d.y;
    let classification: EdgeClass;
    if (Math.abs(dot) <= thresh) classification = 'vertical';
    else if (dot > 0) classification = 'top';
    else classification = 'bottom';
    edges.push({ index: i, start: a, end: b, classification, normalDotPull: dot });
  }

  // Parting points: vertices where edge classification flips top↔bottom.
  const partingPoints: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    const cur = edges[i]!;
    const next = edges[(i + 1) % n]!;
    const flip =
      (cur.classification === 'top' && next.classification === 'bottom')
      || (cur.classification === 'bottom' && next.classification === 'top');
    if (flip) partingPoints.push(cur.end);
  }

  // Undercut: a wall whose normal is nearly vertical AND tucked under (concave) is
  // simplistically flagged as the vertical walls here (full undercut needs 3-D / visibility).
  const undercutEdgeIndices = edges.filter(e => e.classification === 'vertical').map(e => e.index);
  const verticalWallCount = undercutEdgeIndices.length;

  return { edges, partingPoints, undercutEdgeIndices, verticalWallCount, warnings };
}

/** Suggest the pull direction that minimises vertical-wall count over candidate angles. */
export function suggestPullDirection(profile: Polygon, candidateCount: number = 36): { angleDeg: number; verticalWalls: number } {
  let best = { angleDeg: 0, verticalWalls: Infinity };
  for (let i = 0; i < candidateCount; i++) {
    const angleDeg = (i * 360) / candidateCount;
    const t = angleDeg * Math.PI / 180;
    const r = detect({ profile, pullDirection: { x: Math.cos(t), y: Math.sin(t) } });
    if (r.verticalWallCount < best.verticalWalls) {
      best = { angleDeg, verticalWalls: r.verticalWallCount };
    }
  }
  return best;
}

export function summarize(r: PartingLineResult): { partingPointCount: number; verticalWallCount: number; undercutCount: number } {
  return {
    partingPointCount: r.partingPoints.length,
    verticalWallCount: r.verticalWallCount,
    undercutCount: r.undercutEdgeIndices.length,
  };
}
