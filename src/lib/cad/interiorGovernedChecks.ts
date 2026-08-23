import type { DoorSwingClearanceInput } from '@/lib/assembly/doorSwingClearance';
import type { EgressRouteInput } from '@/lib/assembly/egressRouteVerification';
import type { SpaceBoundaryClosureInput } from '@/lib/assembly/spaceBoundaryClosure';
import type { InteriorSpatialAssembly, InteriorSpatialParameters } from './interiorSpatialModel';

/** Builds the room topology check from the same dimensions used by plan and 3D. */
export function buildInteriorBoundaryCheckInput(
  params: InteriorSpatialParameters,
): SpaceBoundaryClosureInput {
  const { width, depth } = params;
  return {
    snapToleranceMm: 0.1,
    minimumAreaMm2: 1,
    segments: [
      { id: 'room-front', start: { x: 0, y: 0 }, end: { x: width, y: 0 } },
      { id: 'room-right', start: { x: width, y: 0 }, end: { x: width, y: depth } },
      { id: 'room-back', start: { x: width, y: depth }, end: { x: 0, y: depth } },
      { id: 'room-left', start: { x: 0, y: depth }, end: { x: 0, y: 0 } },
    ],
  };
}

function obstaclePolygons(assembly: InteriorSpatialAssembly): DoorSwingClearanceInput['obstacles'] {
  return assembly.parts.flatMap(part => {
    if (part.role !== 'table' && part.role !== 'counter') return [];
    const width = Number(part.params.width);
    const depth = Number(part.params.depth);
    if (!(width > 0) || !(depth > 0)) return [];
    const x = part.at.tx;
    const y = part.at.ty;
    return [{
      id: part.id,
      polygon: [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + depth },
        { x, y: y + depth },
      ],
    }];
  });
}

type Point = { x: number; y: number };

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

function pointSegmentDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 > 0
    ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length2))
    : 0;
  return distance(point, { x: start.x + t * dx, y: start.y + t * dy });
}

const orientation = (a: Point, b: Point, c: Point): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
    && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return Math.abs(abC) < 1e-9 && pointSegmentDistance(c, a, b) < 1e-9
    || Math.abs(abD) < 1e-9 && pointSegmentDistance(d, a, b) < 1e-9
    || Math.abs(cdA) < 1e-9 && pointSegmentDistance(a, c, d) < 1e-9
    || Math.abs(cdB) < 1e-9 && pointSegmentDistance(b, c, d) < 1e-9;
}

function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  );
}

function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index]!;
    const b = polygon[previous]!;
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function segmentPolygonDistance(start: Point, end: Point, polygon: readonly Point[]): number {
  if (pointInPolygon(start, polygon) || pointInPolygon(end, polygon)) return 0;
  let minimum = Number.POSITIVE_INFINITY;
  polygon.forEach((point, index) => {
    minimum = Math.min(minimum, segmentDistance(start, end, point, polygon[(index + 1) % polygon.length]!));
  });
  return minimum;
}

function segmentClearWidth(
  start: Point,
  end: Point,
  width: number,
  depth: number,
  obstacles: DoorSwingClearanceInput['obstacles'],
): number {
  const wallClearance = Math.min(start.x, end.x, width - start.x, width - end.x, start.y, end.y, depth - start.y, depth - end.y);
  const obstacleClearance = obstacles.length
    ? Math.min(...obstacles.map(obstacle => segmentPolygonDistance(start, end, obstacle.polygon)))
    : Number.POSITIVE_INFINITY;
  return Math.max(0, 2 * Math.min(wallClearance, obstacleClearance));
}

/**
 * Builds a bounded, obstacle-aware lattice from the canonical layout. The
 * verifier checks every free lattice node as an origin, which is conservative
 * for the supplied graph. The UI still labels this PREVIEW until surveyed
 * host geometry and governed rules are approved.
 */
export function buildInteriorEgressCheckInput(
  params: InteriorSpatialParameters,
  assembly: InteriorSpatialAssembly,
  maximumTravelDistanceMm: number,
  minimumClearWidthMm: number,
  minimumIndependentExits: number,
): EgressRouteInput | null {
  if (!(maximumTravelDistanceMm > 0) || !Number.isFinite(maximumTravelDistanceMm)) return null;
  if (!(minimumClearWidthMm > 0) || !Number.isFinite(minimumClearWidthMm)) return null;
  if (!Number.isSafeInteger(minimumIndependentExits) || minimumIndependentExits <= 0) return null;

  const width = params.width;
  const depth = params.depth;
  const radius = minimumClearWidthMm / 2;
  if (radius * 2 >= width || radius * 2 >= depth) return null;
  const obstacles = obstaclePolygons(assembly);
  const spacing = Math.max(500, Math.ceil(Math.max(width, depth) / 12));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let x = radius; x <= width - radius + 1e-9; x += spacing) xs.push(Math.min(x, width - radius));
  for (let y = radius; y <= depth - radius + 1e-9; y += spacing) ys.push(Math.min(y, depth - radius));
  if (xs.at(-1) !== width - radius) xs.push(width - radius);
  if (ys.at(-1) !== depth - radius) ys.push(depth - radius);

  const nodes: EgressRouteInput['nodes'] = [];
  const nodeAt = new Map<string, string>();
  ys.forEach((y, row) => xs.forEach((x, col) => {
    const point = { x, y };
    if (segmentClearWidth(point, point, width, depth, obstacles) + 1e-9 < minimumClearWidthMm) return;
    const id = `cell-${row}-${col}`;
    nodes.push({ id, point, kind: 'origin' });
    nodeAt.set(`${row}:${col}`, id);
  }));

  const edges: EgressRouteInput['edges'] = [];
  const connect = (firstId: string | undefined, secondId: string | undefined) => {
    if (!firstId || !secondId) return;
    const first = nodes.find(node => node.id === firstId)!;
    const second = nodes.find(node => node.id === secondId)!;
    const clearWidthMm = segmentClearWidth(first.point, second.point, width, depth, obstacles);
    edges.push({ id: `edge-${firstId}-${secondId}`, from: firstId, to: secondId, clearWidthMm });
  };
  ys.forEach((_, row) => xs.forEach((_, col) => {
    const id = nodeAt.get(`${row}:${col}`);
    connect(id, nodeAt.get(`${row}:${col + 1}`));
    connect(id, nodeAt.get(`${row + 1}:${col}`));
  }));

  const exitNodeIds: string[] = [];
  assembly.exits.forEach((exit, index) => {
    const atFront = Math.abs(exit.y) <= 1e-6;
    const portalPoint = { x: exit.x, y: atFront ? radius : depth - radius };
    const candidates = nodes
      .filter(node => segmentClearWidth(node.point, portalPoint, width, depth, obstacles) + 1e-9 >= minimumClearWidthMm)
      .sort((a, b) => distance(a.point, portalPoint) - distance(b.point, portalPoint));
    const nearest = candidates[0];
    if (!nearest) return;
    const id = `exit-${index}`;
    nodes.push({ id, point: { x: exit.x, y: exit.y }, kind: 'exit' });
    exitNodeIds.push(id);
    edges.push({
      id: `edge-${nearest.id}-${id}`,
      from: nearest.id,
      to: id,
      clearWidthMm: Math.min(exit.widthMm, segmentClearWidth(nearest.point, portalPoint, width, depth, obstacles)),
    });
  });

  const originNodeIds = nodes.filter(node => node.kind === 'origin').map(node => node.id);
  if (!originNodeIds.length || !exitNodeIds.length) return null;
  return {
    nodes,
    edges,
    originNodeIds,
    exitNodeIds,
    maximumTravelDistanceMm,
    minimumClearWidthMm,
    minimumIndependentExits,
  };
}

/**
 * Door thickness is deliberately caller supplied. Returning null keeps the
 * governed check at NOT_RUN instead of inventing a release-relevant value.
 */
export function buildInteriorDoorSwingCheckInput(
  params: InteriorSpatialParameters,
  assembly: InteriorSpatialAssembly,
  doorThicknessMm: number,
  requiredClearanceMm: number,
): DoorSwingClearanceInput | null {
  if (!(doorThicknessMm > 0) || !Number.isFinite(doorThicknessMm)) return null;
  if (!(requiredClearanceMm >= 0) || !Number.isFinite(requiredClearanceMm)) return null;
  return {
    pivot: { x: params.width / 2 - params.doorWidth / 2, y: 0 },
    closedAngleDeg: 0,
    openAngleDeg: 90,
    widthMm: params.doorWidth,
    thicknessMm: doorThicknessMm,
    requiredClearanceMm,
    obstacles: obstaclePolygons(assembly),
  };
}
