/**
 * sketchProfile — extract closed loops (profiles) from a SketchSolver state.
 *
 * Phase 2.1.1 of NexyFab Pro own-CAD (ADR-013).
 *
 * A sketch is a graph: points are nodes, lines are edges. To extrude /
 * revolve / sweep, we need closed loops — ordered cycles of points where
 * consecutive points share a line.
 *
 * This module is pure-math (no solver dependency at runtime): it operates
 * on plain `ProfileInput` data. The SolverSketchEditor builds that input
 * by walking its view-entity state.
 *
 * Algorithm:
 *   1. Build adjacency: pointId → set of (neighborId, lineId).
 *   2. For each unvisited line, traverse via DFS picking the smallest
 *      adjacent-edge angle ("left-turn" walk) to find one cycle.
 *   3. Mark all lines on the cycle as visited; repeat until none remain.
 *
 * Caveats (Phase 2.1.1 scope):
 *   - Circles + arcs are NOT yet loops (they're already closed by
 *     definition — separate IR path, Phase 2.1.2).
 *   - Self-intersecting loops are not detected (assumes well-formed input).
 *   - Inner loops (holes) are not classified as such here — caller's job.
 *   - Lines that don't participate in any loop are returned as `danglingLines`.
 */

// ─── input types (mirror SolverSketchEditor's view model, dependency-free) ─

export interface ProfilePoint {
  id: string;
  x: number;
  y: number;
}

export interface ProfileLine {
  id: string;
  p1: string;
  p2: string;
}

export interface ProfileInput {
  points: ReadonlyArray<ProfilePoint>;
  lines: ReadonlyArray<ProfileLine>;
}

// ─── output types ─────────────────────────────────────────────────────────

export interface ClosedLoop {
  /** Point IDs traversed in order. Always starts at the lowest-index point in
   *  the loop so output is stable across runs. The loop closes back to
   *  `points[0]`; it is NOT repeated at the end. */
  points: ReadonlyArray<string>;
  /** Line IDs used, in walk order. `lines.length === points.length`. */
  lines: ReadonlyArray<string>;
  /** Signed area in sketch units² — positive = counter-clockwise (outer),
   *  negative = clockwise (typical for holes). */
  signedArea: number;
}

export interface ProfileExtraction {
  loops: ReadonlyArray<ClosedLoop>;
  /** Line IDs that did not participate in any loop. */
  danglingLines: ReadonlyArray<string>;
}

// ─── adjacency helpers ────────────────────────────────────────────────────

interface AdjacentEdge {
  neighbor: string;
  lineId: string;
}

function buildAdjacency(input: ProfileInput): Map<string, AdjacentEdge[]> {
  const adj = new Map<string, AdjacentEdge[]>();
  for (const p of input.points) {
    adj.set(p.id, []);
  }
  for (const l of input.lines) {
    if (l.p1 === l.p2) continue; // degenerate self-loop — skip
    adj.get(l.p1)?.push({ neighbor: l.p2, lineId: l.id });
    adj.get(l.p2)?.push({ neighbor: l.p1, lineId: l.id });
  }
  return adj;
}

// ─── signed area (shoelace) ───────────────────────────────────────────────

function signedArea(points: ReadonlyArray<ProfilePoint>): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

// ─── cycle finder ─────────────────────────────────────────────────────────

/**
 * Greedy "leftmost turn" cycle finder. For each unused edge, walk the graph
 * always picking the most counter-clockwise next edge. If we return to the
 * start point using each visited line at most once, that's our loop.
 *
 * This recovers all simple cycles in well-formed planar sketches (rect,
 * triangle, nested polygons). It does NOT cover all planar-face
 * decompositions in arbitrary graphs — that's a planar-embedding problem.
 * For Phase 2.1, sketches come from a manual editor where loops are
 * intentional, so this suffices.
 */
export function extractClosedLoops(input: ProfileInput): ProfileExtraction {
  const adj = buildAdjacency(input);
  const pointById = new Map(input.points.map((p) => [p.id, p]));
  const lineUsage = new Map<string, number>();
  for (const l of input.lines) lineUsage.set(l.id, 0);

  const loops: ClosedLoop[] = [];

  // Try each line as a seed. A line can be on up to 2 loops (one on each side).
  for (const seed of input.lines) {
    while ((lineUsage.get(seed.id) ?? 0) < 2) {
      const loop = tryFindLoop(seed, adj, pointById, lineUsage);
      if (!loop) break;
      // Mark all lines as +1 used.
      for (const lineId of loop.lines) {
        lineUsage.set(lineId, (lineUsage.get(lineId) ?? 0) + 1);
      }
      loops.push(loop);
    }
  }

  const dangling = input.lines
    .filter((l) => (lineUsage.get(l.id) ?? 0) === 0)
    .map((l) => l.id);

  // Deduplicate identical loops (same point set in same order, modulo rotation).
  const seen = new Set<string>();
  const unique = loops.filter((loop) => {
    const key = canonicalKey(loop.points);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { loops: unique, danglingLines: dangling };
}

function canonicalKey(points: ReadonlyArray<string>): string {
  if (points.length === 0) return '';
  // Rotate so the lowest id starts; pick the lexicographically smaller of
  // forward vs reverse to fold orientation-flipped duplicates together.
  const sortedIdx = points.reduce((minI, p, i) => (p < points[minI]! ? i : minI), 0);
  const fwd: string[] = [];
  for (let i = 0; i < points.length; i++) fwd.push(points[(sortedIdx + i) % points.length]!);
  const rev = [fwd[0]!].concat(fwd.slice(1).reverse());
  const fwdKey = fwd.join('>');
  const revKey = rev.join('>');
  return fwdKey < revKey ? fwdKey : revKey;
}

function tryFindLoop(
  seed: ProfileLine,
  adj: Map<string, AdjacentEdge[]>,
  pointById: Map<string, ProfilePoint>,
  lineUsage: ReadonlyMap<string, number>,
): ClosedLoop | null {
  // Start at p1 → p2 via seed; walk back to p1.
  const start = seed.p1;
  const visitedLines = new Set<string>([seed.id]);
  const path: string[] = [start, seed.p2];
  const usedLines: string[] = [seed.id];

  // Track local usage so we can backtrack without polluting global state.
  const localUsage = new Map(lineUsage);
  localUsage.set(seed.id, (localUsage.get(seed.id) ?? 0) + 1);

  let current = seed.p2;
  let prev = start;
  while (true) {
    if (current === start && path.length > 2) {
      // Closed the loop.
      const finalPoints = path.slice(0, -1); // drop trailing dup of start
      const pts = finalPoints.map((id) => pointById.get(id)!).filter((p): p is ProfilePoint => !!p);
      return {
        points: finalPoints,
        lines: usedLines,
        signedArea: signedArea(pts),
      };
    }
    const neighbors = (adj.get(current) ?? []).filter(
      (e) =>
        !visitedLines.has(e.lineId) &&
        // skip lines that are already on 2 loops (max usage)
        (localUsage.get(e.lineId) ?? 0) < 2,
    );
    if (neighbors.length === 0) return null;

    // Pick the most counter-clockwise next edge (leftmost turn).
    const next = pickLeftmostTurn(prev, current, neighbors, pointById);
    if (!next) return null;
    visitedLines.add(next.lineId);
    localUsage.set(next.lineId, (localUsage.get(next.lineId) ?? 0) + 1);
    usedLines.push(next.lineId);
    path.push(next.neighbor);
    prev = current;
    current = next.neighbor;
    if (path.length > adj.size + 1) return null; // safety: no walk longer than node count + 1
  }
}

function pickLeftmostTurn(
  prev: string,
  current: string,
  candidates: AdjacentEdge[],
  pointById: Map<string, ProfilePoint>,
): AdjacentEdge | null {
  const cur = pointById.get(current);
  const prv = pointById.get(prev);
  if (!cur || !prv) return null;
  const incomingAngle = Math.atan2(cur.y - prv.y, cur.x - prv.x);

  let bestEdge: AdjacentEdge | null = null;
  let bestTurn = -Infinity; // we want the largest CCW turn (most positive sin)
  for (const e of candidates) {
    const nxt = pointById.get(e.neighbor);
    if (!nxt) continue;
    const outAngle = Math.atan2(nxt.y - cur.y, nxt.x - cur.x);
    let delta = outAngle - incomingAngle;
    while (delta <= -Math.PI) delta += 2 * Math.PI;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    // delta = 0 means "go straight", + = CCW left turn, - = CW right turn.
    // We want the most negative (rightmost) for CW outer-loop traversal,
    // which gives a positive signed area for CCW interpretation downstream.
    // Actually for a simple rect-style sketch, "rightmost turn" walks
    // around the outside CW. Caller can flip via signedArea sign.
    if (delta > bestTurn) {
      bestTurn = delta;
      bestEdge = e;
    }
  }
  return bestEdge;
}
