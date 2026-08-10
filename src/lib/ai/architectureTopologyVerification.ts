import type { ArchitectureBoundaryEdge, ArchitectureDocument, ArchitectureWall } from './architectureInteriorDocuments';

export interface ArchitectureTopologyGate { id: 'space-wall-loop' | 'opening-host-range' | 'opening-overlap' | 'opening-vertical-fit'; status: 'passed' | 'failed' | 'not_run'; reasons: string[] }
export interface ArchitectureTopologyResult { gates: ArchitectureTopologyGate[]; releaseReady: boolean; spaceAreasMm2: Record<string, number> }

const wallLength = (wall: ArchitectureWall) => wall.kind === 'line'
  ? Math.hypot(wall.endMm[0] - wall.startMm[0], wall.endMm[1] - wall.startMm[1])
  : Math.abs(wall.endAngleDeg - wall.startAngleDeg) * Math.PI / 180 * wall.radiusMm;
const close = (a: [number, number], b: [number, number], tolerance: number) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance;
const rad = (degrees: number) => degrees * Math.PI / 180;
const arcPoint = (edge: Extract<ArchitectureBoundaryEdge, { kind: 'arc' }>, end = false): [number, number] => { const angle = rad(end ? edge.endAngleDeg : edge.startAngleDeg); return [edge.centerMm[0] + edge.radiusMm * Math.cos(angle), edge.centerMm[1] + edge.radiusMm * Math.sin(angle)]; };
const edgeStart = (edge: ArchitectureBoundaryEdge) => edge.kind === 'line' ? edge.startMm : arcPoint(edge);
const edgeEnd = (edge: ArchitectureBoundaryEdge) => edge.kind === 'line' ? edge.endMm : arcPoint(edge, true);
const angleClose = (a: number, b: number, toleranceDeg: number) => { const delta = ((a - b + 180) % 360 + 360) % 360 - 180; return Math.abs(delta) <= toleranceDeg; };

export function measureBoundaryAreaMm2(edges: readonly ArchitectureBoundaryEdge[]): number {
  let integral = 0;
  for (const edge of edges) {
    if (edge.kind === 'line') integral += edge.startMm[0] * edge.endMm[1] - edge.startMm[1] * edge.endMm[0];
    else {
      const a = rad(edge.startAngleDeg), b = rad(edge.endAngleDeg), [cx, cy] = edge.centerMm, radius = edge.radiusMm;
      integral += cx * radius * (Math.sin(b) - Math.sin(a)) + cy * radius * (Math.cos(a) - Math.cos(b)) + radius * radius * (b - a);
    }
  }
  return Math.abs(integral) / 2;
}

/** Exact semantic topology gate. Curved room boundaries remain not_run until an arc-edge boundary IR is supplied. */
export function verifyArchitectureTopology(document: ArchitectureDocument, toleranceMm = 0.1): ArchitectureTopologyResult {
  if (!(toleranceMm >= 0) || !Number.isFinite(toleranceMm)) throw new Error('Topology tolerance must be finite and non-negative.');
  const walls = new Map(document.walls.map(wall => [wall.id, wall])), loopReasons: string[] = [], curvedSpaces: string[] = [], spaceAreasMm2: Record<string, number> = {};
  for (const space of document.spaces) {
    const edges: ArchitectureBoundaryEdge[] = space.boundaryEdges ?? space.boundaryMm.map((startMm, index) => ({ kind: 'line' as const, startMm, endMm: space.boundaryMm[(index + 1) % space.boundaryMm.length]! }));
    if (space.wallIds.length !== edges.length) { loopReasons.push(`${space.id}: wall and boundary edge counts differ.`); continue; }
    edges.forEach((edge, index) => { if (!close(edgeEnd(edge), edgeStart(edges[(index + 1) % edges.length]!), toleranceMm)) loopReasons.push(`${space.id}: boundary edges ${index} and ${(index + 1) % edges.length} are open.`); });
    spaceAreasMm2[space.id] = measureBoundaryAreaMm2(edges);
    if (!(spaceAreasMm2[space.id]! > toleranceMm * toleranceMm)) loopReasons.push(`${space.id}: boundary area is degenerate.`);
    space.wallIds.forEach((wallId, index) => {
      const wall = walls.get(wallId), edge = edges[index]!;
      if (!wall) loopReasons.push(`${space.id}: wall ${wallId} is missing.`);
      else if (wall.kind === 'arc' && !space.boundaryEdges) curvedSpaces.push(space.id);
      else if (wall.kind !== edge.kind) loopReasons.push(`${space.id}: wall ${wallId} and boundary edge ${index} have different geometry kinds.`);
      else if (wall.kind === 'line' && edge.kind === 'line') {
        const forward = close(wall.startMm, edge.startMm, toleranceMm) && close(wall.endMm, edge.endMm, toleranceMm);
        const reverse = close(wall.startMm, edge.endMm, toleranceMm) && close(wall.endMm, edge.startMm, toleranceMm);
        if (!forward && !reverse) loopReasons.push(`${space.id}: wall ${wallId} does not match boundary edge ${index}.`);
      }
      else if (wall.kind === 'arc' && edge.kind === 'arc') {
        const angularTolerance = Math.max(1e-9, toleranceMm / Math.max(wall.radiusMm, edge.radiusMm) * 180 / Math.PI);
        if (!close(wall.centerMm, edge.centerMm, toleranceMm) || Math.abs(wall.radiusMm - edge.radiusMm) > toleranceMm || !angleClose(wall.startAngleDeg, edge.startAngleDeg, angularTolerance) || !angleClose(wall.endAngleDeg, edge.endAngleDeg, angularTolerance)) loopReasons.push(`${space.id}: arc wall ${wallId} does not match boundary arc ${index}.`);
      }
    });
  }
  const intervalReasons: string[] = [], verticalReasons: string[] = [], overlapReasons: string[] = [];
  for (const opening of document.openings) {
    const wall = walls.get(opening.hostWallId); if (!wall) { intervalReasons.push(`${opening.id}: host wall is missing.`); continue; }
    const half = opening.widthMm / 2, start = opening.offsetMm - half, end = opening.offsetMm + half;
    if (start < -toleranceMm || end > wallLength(wall) + toleranceMm) intervalReasons.push(`${opening.id}: full opening width exceeds host wall.`);
    if (opening.sillMm + opening.heightMm > wall.heightMm + toleranceMm) verticalReasons.push(`${opening.id}: opening exceeds host wall height.`);
  }
  for (const wall of document.walls) {
    const openings = document.openings.filter(item => item.hostWallId === wall.id).sort((a, b) => a.offsetMm - b.offsetMm);
    for (let index = 1; index < openings.length; index++) {
      const previous = openings[index - 1]!, current = openings[index]!;
      if (previous.offsetMm + previous.widthMm / 2 > current.offsetMm - current.widthMm / 2 + toleranceMm) overlapReasons.push(`${previous.id} overlaps ${current.id} on ${wall.id}.`);
    }
  }
  const loopGate: ArchitectureTopologyGate = loopReasons.length ? { id: 'space-wall-loop', status: 'failed', reasons: loopReasons }
    : curvedSpaces.length ? { id: 'space-wall-loop', status: 'not_run', reasons: [`Arc-edge boundary evidence is required for: ${[...new Set(curvedSpaces)].join(', ')}.`] }
      : { id: 'space-wall-loop', status: 'passed', reasons: [] };
  const gates: ArchitectureTopologyGate[] = [loopGate,
    { id: 'opening-host-range', status: intervalReasons.length ? 'failed' : 'passed', reasons: intervalReasons },
    { id: 'opening-overlap', status: overlapReasons.length ? 'failed' : 'passed', reasons: overlapReasons },
    { id: 'opening-vertical-fit', status: verticalReasons.length ? 'failed' : 'passed', reasons: verticalReasons },
  ];
  return { gates, releaseReady: gates.every(gate => gate.status === 'passed'), spaceAreasMm2 };
}

export interface WallOpeningBooleanPlan { wallId: string; wallKind: ArchitectureWall['kind']; cuts: Array<{ openingId: string; alongStartMm: number; alongEndMm: number; bottomMm: number; topMm: number; depthMm: number }> }

/** Creates deterministic wall-local cut contracts for an exact B-Rep/CSG executor. */
export function planWallOpeningBooleans(document: ArchitectureDocument): WallOpeningBooleanPlan[] {
  const topology = verifyArchitectureTopology(document);
  const blocking = topology.gates.filter(gate => gate.id !== 'space-wall-loop' && gate.status !== 'passed');
  if (blocking.length) throw new Error(blocking.flatMap(gate => gate.reasons).join(' '));
  return document.walls.map(wall => ({ wallId: wall.id, wallKind: wall.kind, cuts: document.openings.filter(item => item.hostWallId === wall.id).map(opening => ({ openingId: opening.id, alongStartMm: opening.offsetMm - opening.widthMm / 2, alongEndMm: opening.offsetMm + opening.widthMm / 2, bottomMm: opening.sillMm, topMm: opening.sillMm + opening.heightMm, depthMm: wall.thicknessMm })) })).filter(plan => plan.cuts.length > 0);
}
