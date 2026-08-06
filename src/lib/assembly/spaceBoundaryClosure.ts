export interface BoundaryPoint2 { x: number; y: number }
export interface BoundarySegment2 { id: string; start: BoundaryPoint2; end: BoundaryPoint2 }
export interface SpaceBoundaryClosureInput { segments: BoundarySegment2[]; snapToleranceMm?: number; minimumAreaMm2?: number }
export interface SpaceBoundaryIssue { code: 'ZERO_LENGTH' | 'OPEN_VERTEX' | 'NON_MANIFOLD_VERTEX' | 'SELF_INTERSECTION' | 'DEGENERATE_LOOP'; segmentIds: string[]; point?: BoundaryPoint2 }
export interface SpaceBoundaryClosureResult {
  closed: boolean;
  openBoundaries: number;
  loopCount: number;
  loopAreasMm2: number[];
  issues: SpaceBoundaryIssue[];
  snappedVertexCount: number;
  method: 'snapped_planar_graph';
  conservative: true;
}

const distance = (a: BoundaryPoint2, b: BoundaryPoint2) => Math.hypot(a.x - b.x, a.y - b.y);
const orient = (a: BoundaryPoint2, b: BoundaryPoint2, c: BoundaryPoint2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function properIntersection(a: BoundaryPoint2, b: BoundaryPoint2, c: BoundaryPoint2, d: BoundaryPoint2, epsilon: number): BoundaryPoint2 | undefined {
  const abC = orient(a, b, c), abD = orient(a, b, d), cdA = orient(c, d, a), cdB = orient(c, d, b);
  if (!(((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon))
    && ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon)))) return undefined;
  const denominator = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (Math.abs(denominator) <= epsilon) return undefined;
  const determinantAB = a.x * b.y - a.y * b.x, determinantCD = c.x * d.y - c.y * d.x;
  return {
    x: (determinantAB * (c.x - d.x) - (a.x - b.x) * determinantCD) / denominator,
    y: (determinantAB * (c.y - d.y) - (a.y - b.y) * determinantCD) / denominator,
  };
}

/** Fail-closed 2D room-boundary topology check with deterministic endpoint snapping. */
export function verifySpaceBoundaryClosure(input: SpaceBoundaryClosureInput): SpaceBoundaryClosureResult {
  const tolerance = input.snapToleranceMm ?? 0.1;
  const minimumArea = input.minimumAreaMm2 ?? 1;
  if (!(tolerance >= 0) || !Number.isFinite(tolerance) || !(minimumArea >= 0) || !Number.isFinite(minimumArea)) throw new Error('Boundary tolerances must be finite and non-negative.');
  const issues: SpaceBoundaryIssue[] = [];
  const vertices: Array<{ point: BoundaryPoint2; edges: number[] }> = [];
  const edges: Array<{ id: string; a: number; b: number }> = [];
  const findVertex = (point: BoundaryPoint2) => {
    let best = -1, bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < vertices.length; i++) {
      const candidateDistance = distance(point, vertices[i]!.point);
      if (candidateDistance <= tolerance && candidateDistance < bestDistance) { best = i; bestDistance = candidateDistance; }
    }
    if (best >= 0) return best;
    vertices.push({ point: { ...point }, edges: [] }); return vertices.length - 1;
  };
  for (const segment of input.segments) {
    if (distance(segment.start, segment.end) <= tolerance) { issues.push({ code: 'ZERO_LENGTH', segmentIds: [segment.id], point: segment.start }); continue; }
    const a = findVertex(segment.start), b = findVertex(segment.end), index = edges.length;
    if (a === b) { issues.push({ code: 'ZERO_LENGTH', segmentIds: [segment.id], point: vertices[a]!.point }); continue; }
    edges.push({ id: segment.id, a, b }); vertices[a]!.edges.push(index); vertices[b]!.edges.push(index);
  }
  vertices.forEach(vertex => {
    if (vertex.edges.length === 2) return;
    issues.push({ code: vertex.edges.length < 2 ? 'OPEN_VERTEX' : 'NON_MANIFOLD_VERTEX', segmentIds: vertex.edges.map(index => edges[index]!.id), point: vertex.point });
  });
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const first = edges[i]!, second = edges[j]!;
    if (first.a === second.a || first.a === second.b || first.b === second.a || first.b === second.b) continue;
    const point = properIntersection(vertices[first.a]!.point, vertices[first.b]!.point, vertices[second.a]!.point, vertices[second.b]!.point, Math.max(1e-9, tolerance * 1e-6));
    if (point) issues.push({ code: 'SELF_INTERSECTION', segmentIds: [first.id, second.id], point });
  }
  const visited = new Set<number>(), loopAreas: number[] = [];
  for (let seed = 0; seed < edges.length; seed++) {
    if (visited.has(seed)) continue;
    const seedEdge = edges[seed]!; let vertex = seedEdge.a, edgeIndex = seed, area2 = 0, steps = 0, closed = false;
    while (!visited.has(edgeIndex) && steps <= edges.length) {
      visited.add(edgeIndex); const edge = edges[edgeIndex]!; const next = edge.a === vertex ? edge.b : edge.a;
      const a = vertices[vertex]!.point, b = vertices[next]!.point; area2 += a.x * b.y - b.x * a.y; vertex = next; steps++;
      if (vertex === seedEdge.a) { closed = true; break; }
      const candidates = vertices[vertex]!.edges.filter(index => index !== edgeIndex && !visited.has(index));
      if (candidates.length !== 1) break; edgeIndex = candidates[0]!;
    }
    if (closed) {
      const area = Math.abs(area2) / 2;
      if (area < minimumArea) issues.push({ code: 'DEGENERATE_LOOP', segmentIds: [seedEdge.id] }); else loopAreas.push(area);
    }
  }
  const openBoundaries = issues.filter(issue => issue.code !== 'DEGENERATE_LOOP').length + issues.filter(issue => issue.code === 'DEGENERATE_LOOP').length;
  return { closed: edges.length >= 3 && issues.length === 0 && loopAreas.length > 0, openBoundaries, loopCount: loopAreas.length, loopAreasMm2: loopAreas.sort((a, b) => b - a), issues, snappedVertexCount: vertices.length, method: 'snapped_planar_graph', conservative: true };
}
