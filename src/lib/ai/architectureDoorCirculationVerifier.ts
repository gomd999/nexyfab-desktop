import {
  validateArchitectureDocument,
  validateInteriorDocument,
  type ArchitectureDocument,
  type ArchitectureOpening,
  type ArchitectureSpace,
  type ArchitectureWall,
  type InteriorDocument,
} from './architectureInteriorDocuments';
import { designRevisionSha256 } from '@/lib/designArtifactBinding';

/**
 * Document-bound door/swing/route verification. This is a geometric
 * consistency check only: dimensions are caller-supplied criteria and the
 * result makes no accessibility-code, egress, native-format, or release
 * readiness claim.
 */
export const ARCHITECTURE_DOOR_CIRCULATION_VERIFIER_SCHEMA = 'nexyfab.architecture-door-circulation-verifier.v1' as const;

type V2 = [number, number];

export type ArchitectureAccessibleRoute = {
  id: string;
  storeyId: string;
  spaceIds: string[];
  doorIds: string[];
  pathMm: V2[];
  clearWidthMm: number;
  clearHeightMm: number;
  sourceArchitectureRevision: number;
};

export type ArchitectureDoorCirculationRules = {
  minimumDoorClearWidthMm: number;
  minimumAccessibleRouteWidthMm: number;
  minimumAccessibleRouteHeightMm: number;
  sampleStepMm?: number;
};

/**
 * An optional, document-bound obstacle envelope. positionMm is the footprint
 * centre and sizeMm is the full XYZ extent; rotation is a plan rotation about
 * that centre. This is a clearance consistency primitive, not a code or native
 * model claim.
 */
export type ArchitectureCirculationObstacle = {
  id: string;
  spaceId: string;
  positionMm: [number, number, number];
  sizeMm: [number, number, number];
  clearanceMm: number;
  rotationDeg?: number;
  sourceArchitectureRevision: number;
};

export type ArchitectureDoorCirculationObstacleBinding = {
  architectureDocumentId: string;
  architectureRevision: number;
  architectureContentHash: string;
  sourceRevision: number;
  sourceContentHash: string;
};

export type ArchitectureDoorCirculationFailure = {
  objectId: string;
  code: string;
  measured?: number;
  required?: number;
};

export type ArchitectureDoorCirculationVerification = {
  schema: typeof ARCHITECTURE_DOOR_CIRCULATION_VERIFIER_SCHEMA;
  status: 'passed' | 'failed' | 'not_run';
  architectureRevision: number;
  failures: ArchitectureDoorCirculationFailure[];
  crossings: ArchitectureDoorRouteCrossing[];
  obstacleCheck: 'not_run' | 'passed' | 'failed';
  method: 'sampled_document_bound_swing_and_route_v1';
};

export type ArchitectureDoorRouteCrossing = {
  routeId: string;
  doorId: string;
  hostWallId: string;
  offsetMm: number;
  pathDistanceMm: number;
  segmentIndex: number;
  segmentT: number;
};

const EPSILON = 1e-7;
const MIN_SAMPLE_STEP_MM = 10;
const MAX_SAMPLE_STEP_MM = 250;
const MAX_ROUTES = 128;
const MAX_PATH_POINTS = 4096;
const MAX_SAMPLES_PER_ROUTE = 100_000;
const MAX_OBSTACLES = 2_048;
const SHA256 = /^[a-f0-9]{64}$/;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const finitePoint = (point: V2): boolean => Array.isArray(point) && point.length === 2 && point.every(finite);
const positive = (value: unknown): value is number => finite(value) && value > 0;

function pointOnSegment(point: V2, start: V2, end: V2): boolean {
  const cross = (end[0] - start[0]) * (point[1] - start[1]) - (end[1] - start[1]) * (point[0] - start[0]);
  return Math.abs(cross) <= EPSILON
    && point[0] >= Math.min(start[0], end[0]) - EPSILON && point[0] <= Math.max(start[0], end[0]) + EPSILON
    && point[1] >= Math.min(start[1], end[1]) - EPSILON && point[1] <= Math.max(start[1], end[1]) + EPSILON;
}

function pointInPolygon(point: V2, polygon: readonly V2[]): boolean {
  let inside = false;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]!;
    const end = polygon[(index + 1) % polygon.length]!;
    if (pointOnSegment(point, start, end)) return true;
    if ((start[1] > point[1]) !== (end[1] > point[1]) && point[0] < ((end[0] - start[0]) * (point[1] - start[1])) / (end[1] - start[1]) + start[0]) inside = !inside;
  }
  return inside;
}

function distance(start: V2, end: V2): number {
  return Math.hypot(end[0] - start[0], end[1] - start[1]);
}

function sampleSegment(start: V2, end: V2, stepMm: number): V2[] {
  const length = distance(start, end);
  const count = Math.max(1, Math.ceil(length / stepMm));
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count;
    return [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t];
  });
}

function spaceContains(space: ArchitectureSpace, point: V2): boolean {
  return pointInPolygon(point, space.boundaryMm);
}

function routeSpaces(route: ArchitectureAccessibleRoute, spaces: Map<string, ArchitectureSpace>): ArchitectureSpace[] | undefined {
  const resolved = route.spaceIds.map(id => spaces.get(id));
  return resolved.every((space): space is ArchitectureSpace => Boolean(space)) ? resolved : undefined;
}

function connectedDoor(door: ArchitectureOpening, leftSpaceId: string, rightSpaceId: string): boolean {
  const connections = door.connectsSpaceIds;
  return Boolean(connections && connections.length === 2
    && ((connections[0] === leftSpaceId && connections[1] === rightSpaceId) || (connections[0] === rightSpaceId && connections[1] === leftSpaceId)));
}

type WallCrossing = { offsetMm: number; pathDistanceMm: number; segmentIndex: number; segmentT: number };

/**
 * Return strict side-to-side crossings of a line wall. A path endpoint on a
 * wall is deliberately treated as ambiguous: silently accepting it could
 * turn a route that stops at a wall into a claimed doorway traversal.
 */
function lineWallCrossings(path: readonly V2[], wall: Extract<ArchitectureWall, { kind: 'line' }>): WallCrossing[] | 'ambiguous' {
  const dx = wall.endMm[0] - wall.startMm[0];
  const dy = wall.endMm[1] - wall.startMm[1];
  const length = Math.hypot(dx, dy);
  if (!finite(length) || length <= EPSILON) return 'ambiguous';
  const side = (point: V2) => dx * (point[1] - wall.startMm[1]) - dy * (point[0] - wall.startMm[0]);
  const crossings: WallCrossing[] = [];
  let pathDistanceMm = 0;
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1]!;
    const current = path[index]!;
    const firstSide = side(previous);
    const secondSide = side(current);
    const segmentLengthMm = distance(previous, current);
    const segmentStartDistanceMm = pathDistanceMm;
    pathDistanceMm += segmentLengthMm;
    if (Math.abs(firstSide) <= EPSILON) {
      const offsetMm = ((previous[0] - wall.startMm[0]) * dx + (previous[1] - wall.startMm[1]) * dy) / length;
      if (offsetMm >= -EPSILON && offsetMm <= length + EPSILON) return 'ambiguous';
    }
    if (Math.abs(secondSide) <= EPSILON) {
      const offsetMm = ((current[0] - wall.startMm[0]) * dx + (current[1] - wall.startMm[1]) * dy) / length;
      if (offsetMm >= -EPSILON && offsetMm <= length + EPSILON) return 'ambiguous';
    }
    if (firstSide * secondSide >= 0) continue;
    const t = firstSide / (firstSide - secondSide);
    const x = previous[0] + (current[0] - previous[0]) * t;
    const y = previous[1] + (current[1] - previous[1]) * t;
    const offsetMm = ((x - wall.startMm[0]) * dx + (y - wall.startMm[1]) * dy) / length;
    if (offsetMm < -EPSILON || offsetMm > length + EPSILON) continue;
    crossings.push({ offsetMm, pathDistanceMm: segmentStartDistanceMm + t * segmentLengthMm, segmentIndex: index - 1, segmentT: t });
  }
  return crossings;
}

function positiveAngleDelta(from: number, to: number): number {
  const fullTurn = Math.PI * 2;
  const delta = (to - from) % fullTurn;
  return delta < 0 ? delta + fullTurn : delta;
}

function directedArcOffset(point: V2, wall: Extract<ArchitectureWall, { kind: 'arc' }>): number | null {
  const sweepRad = (wall.endAngleDeg - wall.startAngleDeg) * Math.PI / 180;
  const totalSweepRad = Math.abs(sweepRad);
  if (!finite(sweepRad) || !finite(wall.radiusMm) || wall.radiusMm <= EPSILON || totalSweepRad <= EPSILON || totalSweepRad >= Math.PI * 2 - EPSILON) return null;
  const pointAngle = Math.atan2(point[1] - wall.centerMm[1], point[0] - wall.centerMm[0]);
  const startAngle = wall.startAngleDeg * Math.PI / 180;
  const delta = sweepRad > 0 ? positiveAngleDelta(startAngle, pointAngle) : positiveAngleDelta(pointAngle, startAngle);
  const angleTolerance = EPSILON / Math.max(wall.radiusMm, 1);
  if (delta > totalSweepRad + angleTolerance) return null;
  if (delta <= angleTolerance || delta >= totalSweepRad - angleTolerance) return Number.NaN;
  return delta * wall.radiusMm;
}

/** Analytic line-segment/circle intersections filtered by directed arc membership. */
function arcWallCrossings(path: readonly V2[], wall: Extract<ArchitectureWall, { kind: 'arc' }>): WallCrossing[] | 'ambiguous' {
  const sweepRad = (wall.endAngleDeg - wall.startAngleDeg) * Math.PI / 180;
  if (!finite(sweepRad) || !finite(wall.radiusMm) || wall.radiusMm <= EPSILON || Math.abs(sweepRad) <= EPSILON || Math.abs(sweepRad) >= Math.PI * 2 - EPSILON) return 'ambiguous';
  const crossings: WallCrossing[] = [];
  let pathDistanceMm = 0;
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1]!;
    const current = path[index]!;
    const dx = current[0] - previous[0], dy = current[1] - previous[1];
    const fx = previous[0] - wall.centerMm[0], fy = previous[1] - wall.centerMm[1];
    const a = dx * dx + dy * dy;
    const segmentLengthMm = distance(previous, current);
    const segmentStartDistanceMm = pathDistanceMm;
    pathDistanceMm += segmentLengthMm;
    if (!finite(a) || a <= EPSILON * EPSILON) continue;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - wall.radiusMm * wall.radiusMm;
    const discriminant = b * b - 4 * a * c;
    const discriminantTolerance = EPSILON * Math.max(1, Math.abs(b * b), Math.abs(4 * a * c));
    if (discriminant < -discriminantTolerance) continue;
    if (Math.abs(discriminant) <= discriminantTolerance) {
      const t = -b / (2 * a);
      if (t >= -EPSILON && t <= 1 + EPSILON) {
        const point: V2 = [previous[0] + dx * t, previous[1] + dy * t];
        const offset = directedArcOffset(point, wall);
        if (offset !== null) return 'ambiguous';
      }
      continue;
    }
    const root = Math.sqrt(discriminant);
    for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
      if (t < -EPSILON || t > 1 + EPSILON) continue;
      const point: V2 = [previous[0] + dx * t, previous[1] + dy * t];
      const offset = directedArcOffset(point, wall);
      if (Number.isNaN(offset) || (t <= EPSILON || t >= 1 - EPSILON) && offset !== null) return 'ambiguous';
      if (offset !== null) crossings.push({ offsetMm: offset, pathDistanceMm: segmentStartDistanceMm + t * segmentLengthMm, segmentIndex: index - 1, segmentT: t });
    }
  }
  return crossings;
}

type RouteDoorGeometryResult = { issues: string[]; crossings: WallCrossing[] };

function routeDoorGeometry(route: ArchitectureAccessibleRoute, door: ArchitectureOpening, architecture: ArchitectureDocument): RouteDoorGeometryResult {
  const wall = architecture.walls.find(candidate => candidate.id === door.hostWallId);
  if (!wall) return { issues: ['ROUTE_DOOR_HOST_WALL_MISSING'], crossings: [] };
  const wallLengthMm = wall.kind === 'line'
    ? distance(wall.startMm, wall.endMm)
    : wall.radiusMm * Math.abs((wall.endAngleDeg - wall.startAngleDeg) * Math.PI / 180);
  if (!finite(wallLengthMm) || wallLengthMm <= EPSILON) return { issues: ['ROUTE_DOOR_HOST_GEOMETRY_UNSUPPORTED'], crossings: [] };
  if (!finite(door.offsetMm) || !finite(door.widthMm) || door.offsetMm < -EPSILON || door.widthMm <= EPSILON || door.offsetMm + door.widthMm > wallLengthMm + EPSILON) return { issues: ['ROUTE_DOOR_APERTURE_INVALID'], crossings: [] };
  if (wall.kind === 'arc') {
    const sweepRad = Math.abs((wall.endAngleDeg - wall.startAngleDeg) * Math.PI / 180);
    if (sweepRad >= Math.PI * 2 - EPSILON) return { issues: ['ROUTE_DOOR_HOST_GEOMETRY_UNSUPPORTED'], crossings: [] };
  }
  const crossings = wall.kind === 'line' ? lineWallCrossings(route.pathMm, wall) : arcWallCrossings(route.pathMm, wall);
  if (crossings === 'ambiguous') return { issues: ['ROUTE_DOOR_CROSSING_AMBIGUOUS'], crossings: [] };
  if (crossings.length === 0) return { issues: ['ROUTE_DOOR_CROSSING_MISSING'], crossings: [] };
  const openingStart = door.offsetMm;
  const openingEnd = door.offsetMm + door.widthMm;
  const issues: string[] = [];
  if (crossings.length > 1) issues.push('ROUTE_DOOR_CROSSING_COUNT_INVALID');
  if (crossings.some(crossing => crossing.offsetMm < openingStart - EPSILON || crossing.offsetMm > openingEnd + EPSILON)) issues.push('ROUTE_DOOR_CROSSING_AWAY_FROM_APERTURE');
  return { issues, crossings };
}

function swingSamples(door: ArchitectureOpening, operation: NonNullable<ArchitectureOpening['doorOperation']>, stepMm: number): V2[] {
  const angleDelta = operation.openAngleDeg - operation.closedAngleDeg;
  const radius = door.widthMm;
  const count = Math.max(2, Math.ceil(Math.abs(angleDelta) / 10));
  const samples: V2[] = [];
  for (let angleIndex = 0; angleIndex <= count; angleIndex += 1) {
    const angle = (operation.closedAngleDeg + angleDelta * angleIndex / count) * Math.PI / 180;
    const tangent: V2 = [Math.cos(angle), Math.sin(angle)];
    const normal: V2 = [-tangent[1], tangent[0]];
    const leafCount = Math.max(1, Math.ceil(radius / stepMm));
    for (let leafIndex = 0; leafIndex <= leafCount; leafIndex += 1) {
      const along = radius * leafIndex / leafCount;
      const halfThickness = operation.leafThicknessMm / 2 + (operation.requiredClearanceMm ?? 0);
      samples.push(
        [operation.pivotMm[0] + tangent[0] * along, operation.pivotMm[1] + tangent[1] * along],
        [operation.pivotMm[0] + tangent[0] * along + normal[0] * halfThickness, operation.pivotMm[1] + tangent[1] * along + normal[1] * halfThickness],
        [operation.pivotMm[0] + tangent[0] * along - normal[0] * halfThickness, operation.pivotMm[1] + tangent[1] * along - normal[1] * halfThickness],
      );
    }
  }
  return samples;
}

type NormalizedObstacle = {
  id: string;
  spaceId: string;
  centerMm: V2;
  baseZMm: number;
  sizeMm: [number, number, number];
  clearanceMm: number;
  rotationDeg: number;
};

export function architectureCirculationObstacleEnvelopeHash(obstacles: readonly ArchitectureCirculationObstacle[], sourceRevision: number): string {
  return designRevisionSha256({ schema: 'nexyfab.architecture-circulation-obstacle-envelope.v1', sourceRevision, obstacles });
}

function obstacleSourceHash(interior: InteriorDocument | undefined, obstacles: readonly ArchitectureCirculationObstacle[] | undefined, sourceRevision: number): string {
  if (interior && obstacles) return designRevisionSha256({ sourceRevision, interior, obstacles });
  if (interior) return designRevisionSha256(interior);
  return architectureCirculationObstacleEnvelopeHash(obstacles ?? [], sourceRevision);
}

function normalizeObstacle(obstacle: ArchitectureCirculationObstacle, architectureRevision: number): NormalizedObstacle | null {
  if (!obstacle || typeof obstacle !== 'object' || typeof obstacle.id !== 'string' || !obstacle.id.trim() || typeof obstacle.spaceId !== 'string' || !obstacle.spaceId.trim()
    || !Array.isArray(obstacle.positionMm) || obstacle.positionMm.length !== 3 || obstacle.positionMm.some(value => !finite(value))
    || !Array.isArray(obstacle.sizeMm) || obstacle.sizeMm.length !== 3 || obstacle.sizeMm.some(value => !positive(value))
    || !finite(obstacle.clearanceMm) || obstacle.clearanceMm < 0 || !finite(obstacle.rotationDeg ?? 0)
    || obstacle.sourceArchitectureRevision !== architectureRevision) return null;
  return {
    id: obstacle.id,
    spaceId: obstacle.spaceId,
    centerMm: [obstacle.positionMm[0], obstacle.positionMm[1]],
    baseZMm: obstacle.positionMm[2],
    sizeMm: [obstacle.sizeMm[0], obstacle.sizeMm[1], obstacle.sizeMm[2]],
    clearanceMm: obstacle.clearanceMm,
    rotationDeg: obstacle.rotationDeg ?? 0,
  };
}

function normalizedInteriorObstacles(interior: InteriorDocument, architectureRevision: number): ArchitectureCirculationObstacle[] {
  const furniture = (Array.isArray(interior.furniture) ? interior.furniture : []).map(item => ({
    id: item.id, spaceId: item.spaceId, positionMm: item.positionMm, sizeMm: item.sizeMm,
    clearanceMm: item.clearanceMm, rotationDeg: item.rotationDeg, sourceArchitectureRevision: architectureRevision,
  }));
  const millwork = (Array.isArray(interior.millwork) ? interior.millwork : []).map(item => ({
    id: item.id, spaceId: item.spaceId,
    positionMm: [item.positionMm[0] + item.sizeMm[0] / 2, item.positionMm[1] + item.sizeMm[1] / 2, item.positionMm[2]] as [number, number, number],
    sizeMm: item.sizeMm, clearanceMm: item.clearanceMm, rotationDeg: 0, sourceArchitectureRevision: architectureRevision,
  }));
  return [...furniture, ...millwork];
}

function prepareObstacles(input: {
  architecture: ArchitectureDocument;
  architectureDocumentId?: string;
  architectureRevision: number;
  interior?: InteriorDocument;
  obstacles?: ArchitectureCirculationObstacle[];
  obstacleBinding?: ArchitectureDoorCirculationObstacleBinding;
}): { failures: ArchitectureDoorCirculationFailure[]; obstacles: NormalizedObstacle[]; status: 'not_run' | 'passed' | 'failed' } {
  const { architecture, architectureDocumentId, architectureRevision, interior, obstacles, obstacleBinding } = input;
  const supplied = interior !== undefined || obstacles !== undefined || obstacleBinding !== undefined;
  if (!supplied) return { failures: [], obstacles: [], status: 'not_run' };
  const failures: ArchitectureDoorCirculationFailure[] = [];
  if (!obstacleBinding || typeof obstacleBinding.architectureDocumentId !== 'string' || !obstacleBinding.architectureDocumentId.trim()
    || !Number.isSafeInteger(obstacleBinding.architectureRevision) || !Number.isSafeInteger(obstacleBinding.sourceRevision) || obstacleBinding.sourceRevision < 0
    || !SHA256.test(obstacleBinding.architectureContentHash) || !SHA256.test(obstacleBinding.sourceContentHash)) {
    failures.push({ objectId: 'obstacles', code: 'OBSTACLE_BINDING_INVALID' });
  } else {
    if (obstacleBinding.architectureRevision !== architecture.revision || architectureRevision !== architecture.revision) failures.push({ objectId: 'obstacles', code: 'OBSTACLE_ARCHITECTURE_REVISION_MISMATCH', measured: obstacleBinding.architectureRevision, required: architecture.revision });
    if (!architectureDocumentId?.trim() || obstacleBinding.architectureDocumentId !== architectureDocumentId) failures.push({ objectId: 'obstacles', code: 'OBSTACLE_ARCHITECTURE_ID_MISMATCH' });
    if (obstacleBinding.architectureContentHash !== designRevisionSha256(architecture)) failures.push({ objectId: 'obstacles', code: 'OBSTACLE_ARCHITECTURE_HASH_MISMATCH' });
    if (interior && (interior.architectureDocumentId !== obstacleBinding.architectureDocumentId || interior.architectureDocumentId !== architectureDocumentId)) failures.push({ objectId: 'obstacles', code: 'OBSTACLE_INTERIOR_ARCHITECTURE_ID_MISMATCH' });
  }
  if (interior === undefined && obstacles === undefined) failures.push({ objectId: 'obstacles', code: 'OBSTACLE_SOURCE_MISSING' });
  const interiorFurnitureCount = interior && Array.isArray(interior.furniture) ? interior.furniture.length : 0;
  const interiorMillworkCount = interior && Array.isArray(interior.millwork) ? interior.millwork.length : 0;
  const explicitCount = Array.isArray(obstacles) ? obstacles.length : 0;
  const declaredObjectCount = interiorFurnitureCount + interiorMillworkCount + explicitCount;
  if (declaredObjectCount > MAX_OBSTACLES) failures.push({ objectId: 'obstacles', code: 'OBSTACLE_COLLECTION_BUDGET_EXCEEDED', measured: declaredObjectCount, required: MAX_OBSTACLES });
  if (interior !== undefined) {
    let interiorIssues: string[] = [];
    if (interiorFurnitureCount + interiorMillworkCount <= MAX_OBSTACLES) {
      try { interiorIssues = validateInteriorDocument(interior, architecture); } catch { interiorIssues = ['malformed']; }
    } else interiorIssues = ['budget'];
    if (interiorIssues.length) failures.push({ objectId: 'interior', code: 'OBSTACLE_INTERIOR_DOCUMENT_INVALID' });
    if (obstacleBinding && obstacleBinding.sourceRevision !== interior.revision) failures.push({ objectId: 'interior', code: 'OBSTACLE_INTERIOR_REVISION_MISMATCH', measured: interior.revision, required: obstacleBinding.sourceRevision });
  }
  if (obstacles !== undefined && (!Array.isArray(obstacles) || obstacles.length > MAX_OBSTACLES)) failures.push({ objectId: 'obstacles', code: 'OBSTACLE_COLLECTION_INVALID_OR_BUDGET_EXCEEDED', measured: Array.isArray(obstacles) ? obstacles.length : undefined, required: MAX_OBSTACLES });
  const explicit = Array.isArray(obstacles) ? obstacles : [];
  let interiorObstacles: ArchitectureCirculationObstacle[] = [];
  if (interior && interiorFurnitureCount + interiorMillworkCount <= MAX_OBSTACLES) {
    try { interiorObstacles = normalizedInteriorObstacles(interior, architectureRevision); } catch { failures.push({ objectId: 'interior', code: 'OBSTACLE_INTERIOR_GEOMETRY_INVALID' }); }
  }
  const sourceObstacles = [...interiorObstacles, ...explicit];
  if (sourceObstacles.length > MAX_OBSTACLES) failures.push({ objectId: 'obstacles', code: 'OBSTACLE_COLLECTION_BUDGET_EXCEEDED', measured: sourceObstacles.length, required: MAX_OBSTACLES });
  if (obstacleBinding && (interior || obstacles) && sourceObstacles.length <= MAX_OBSTACLES && obstacleBinding.sourceContentHash !== obstacleSourceHash(interior, obstacles, obstacleBinding.sourceRevision)) failures.push({ objectId: 'obstacles', code: 'OBSTACLE_SOURCE_HASH_MISMATCH' });
  const ids = new Set<string>();
  const normalized: NormalizedObstacle[] = [];
  const candidates = sourceObstacles.length > MAX_OBSTACLES ? sourceObstacles.slice(0, MAX_OBSTACLES + 1) : sourceObstacles;
  for (const obstacle of candidates) {
    const item = normalizeObstacle(obstacle, architectureRevision);
    const space = item ? architecture.spaces.find(candidate => candidate.id === item.spaceId) : undefined;
    if (!item || !space || ids.has(item.id) || !obstacleContainedInSpace(item, space)) {
      failures.push({ objectId: typeof obstacle?.id === 'string' && obstacle.id.trim() ? obstacle.id : 'obstacles', code: 'OBSTACLE_GEOMETRY_OR_BINDING_INVALID' });
      continue;
    }
    ids.add(item.id);
    normalized.push(item);
  }
  return { failures, obstacles: normalized, status: failures.length ? 'failed' : 'passed' };
}

function obstacleVerticalOverlap(obstacle: NormalizedObstacle, lowerZMm: number, upperZMm: number): boolean {
  return obstacle.baseZMm < upperZMm - EPSILON && obstacle.baseZMm + obstacle.sizeMm[2] > lowerZMm + EPSILON;
}

function obstacleLocalPoint(point: V2, obstacle: NormalizedObstacle): V2 {
  const angle = -obstacle.rotationDeg * Math.PI / 180;
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  const dx = point[0] - obstacle.centerMm[0], dy = point[1] - obstacle.centerMm[1];
  return [dx * cosine - dy * sine, dx * sine + dy * cosine];
}

function obstacleFootprintCorners(obstacle: NormalizedObstacle): V2[] {
  // Containment is checked for the complete clearance envelope, rather than
  // only the object body. An envelope protruding through a space boundary
  // cannot be safely used for circulation verification.
  const halfX = obstacle.sizeMm[0] / 2 + obstacle.clearanceMm;
  const halfY = obstacle.sizeMm[1] / 2 + obstacle.clearanceMm;
  const angle = obstacle.rotationDeg * Math.PI / 180;
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  return ([-1, 1] as const).flatMap(xDirection => ([-1, 1] as const).map(yDirection => [
    obstacle.centerMm[0] + xDirection * halfX * cosine - yDirection * halfY * sine,
    obstacle.centerMm[1] + xDirection * halfX * sine + yDirection * halfY * cosine,
  ] as V2));
}

function obstacleContainedInSpace(obstacle: NormalizedObstacle, space: ArchitectureSpace): boolean {
  return obstacleFootprintCorners(obstacle).every(corner => spaceContains(space, corner));
}

function pointIntersectsObstacle(point: V2, obstacle: NormalizedObstacle, extraClearanceMm: number): boolean {
  const local = obstacleLocalPoint(point, obstacle);
  const halfX = obstacle.sizeMm[0] / 2 + obstacle.clearanceMm + extraClearanceMm;
  const halfY = obstacle.sizeMm[1] / 2 + obstacle.clearanceMm + extraClearanceMm;
  return Math.abs(local[0]) <= halfX + EPSILON && Math.abs(local[1]) <= halfY + EPSILON;
}

function segmentIntersectsObstacle(start: V2, end: V2, obstacle: NormalizedObstacle, extraClearanceMm: number): boolean {
  const first = obstacleLocalPoint(start, obstacle), second = obstacleLocalPoint(end, obstacle);
  const halfX = obstacle.sizeMm[0] / 2 + obstacle.clearanceMm + extraClearanceMm;
  const halfY = obstacle.sizeMm[1] / 2 + obstacle.clearanceMm + extraClearanceMm;
  const dx = second[0] - first[0], dy = second[1] - first[1];
  let enter = 0, exit = 1;
  for (const [origin, delta, extent] of [[first[0], dx, halfX], [first[1], dy, halfY]] as const) {
    if (Math.abs(delta) <= EPSILON) {
      if (origin < -extent - EPSILON || origin > extent + EPSILON) return false;
      continue;
    }
    const a = (-extent - origin) / delta, b = (extent - origin) / delta;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (enter > exit + EPSILON) return false;
  }
  return exit >= -EPSILON && enter <= 1 + EPSILON;
}

function failClosed(architecture: ArchitectureDocument, failures: ArchitectureDoorCirculationFailure[], crossings: ArchitectureDoorRouteCrossing[] = [], obstacleCheck: 'not_run' | 'passed' | 'failed' = 'not_run'): ArchitectureDoorCirculationVerification {
  return { schema: ARCHITECTURE_DOOR_CIRCULATION_VERIFIER_SCHEMA, status: failures.length ? 'failed' : 'passed', architectureRevision: architecture.revision, failures, crossings, obstacleCheck, method: 'sampled_document_bound_swing_and_route_v1' };
}

export function verifyArchitectureDoorCirculation(input: {
  architecture: ArchitectureDocument;
  architectureDocumentId?: string;
  routes: ArchitectureAccessibleRoute[];
  architectureRevision: number;
  rules?: ArchitectureDoorCirculationRules;
  interior?: InteriorDocument;
  obstacles?: ArchitectureCirculationObstacle[];
  obstacleBinding?: ArchitectureDoorCirculationObstacleBinding;
}): ArchitectureDoorCirculationVerification {
  const { architecture, architectureDocumentId, routes, architectureRevision, rules, interior, obstacles, obstacleBinding } = input;
  if (!rules) return { schema: ARCHITECTURE_DOOR_CIRCULATION_VERIFIER_SCHEMA, status: 'not_run', architectureRevision: architecture.revision, failures: [{ objectId: 'project', code: 'GOVERNING_DIMENSION_CRITERIA_MISSING' }], crossings: [], obstacleCheck: 'not_run', method: 'sampled_document_bound_swing_and_route_v1' };
  const failures: ArchitectureDoorCirculationFailure[] = [];
  if (architectureRevision !== architecture.revision) failures.push({ objectId: 'project', code: 'ARCHITECTURE_REVISION_MISMATCH', measured: architectureRevision, required: architecture.revision });
  if (!positive(rules.minimumDoorClearWidthMm) || !positive(rules.minimumAccessibleRouteWidthMm) || !positive(rules.minimumAccessibleRouteHeightMm) || (rules.sampleStepMm !== undefined && (!positive(rules.sampleStepMm) || rules.sampleStepMm < MIN_SAMPLE_STEP_MM || rules.sampleStepMm > MAX_SAMPLE_STEP_MM))) failures.push({ objectId: 'project', code: 'GOVERNING_DIMENSION_CRITERIA_INVALID' });
  const documentIssues = validateArchitectureDocument(architecture);
  if (documentIssues.length) failures.push({ objectId: 'architecture', code: 'ARCHITECTURE_DOCUMENT_INVALID' });
  if (!Array.isArray(routes)) failures.push({ objectId: 'routes', code: 'ROUTE_COLLECTION_INVALID' });
  if (failures.some(failure => ['GOVERNING_DIMENSION_CRITERIA_INVALID', 'ARCHITECTURE_DOCUMENT_INVALID', 'ROUTE_COLLECTION_INVALID'].includes(failure.code))) return failClosed(architecture, failures);
  if (routes.length === 0) return failClosed(architecture, [{ objectId: 'routes', code: 'ROUTE_COLLECTION_EMPTY' }]);
  if (routes.length > MAX_ROUTES) return failClosed(architecture, [{ objectId: 'routes', code: 'ROUTE_COLLECTION_BUDGET_EXCEEDED', measured: routes.length, required: MAX_ROUTES }]);

  const obstaclePreparation = prepareObstacles({ architecture, architectureDocumentId, architectureRevision, interior, obstacles, obstacleBinding });
  failures.push(...obstaclePreparation.failures);
  let obstacleCheck = obstaclePreparation.status;
  const obstacleReady = obstaclePreparation.status !== 'failed';

  const spaces = new Map(architecture.spaces.map(space => [space.id, space]));
  const doors = new Map(architecture.openings.filter(opening => opening.kind === 'door').map(door => [door.id, door]));
  const stepMm = rules.sampleStepMm ?? 100;
  const routeIds = new Set<string>();
  const routeCrossings: ArchitectureDoorRouteCrossing[] = [];
  for (const route of routes) {
    if (!route || typeof route !== 'object' || typeof route.id !== 'string' || typeof route.storeyId !== 'string' || !Array.isArray(route.spaceIds) || !Array.isArray(route.doorIds) || !Array.isArray(route.pathMm)) {
      failures.push({ objectId: 'route', code: 'ROUTE_RECORD_INVALID' });
      continue;
    }
    if (routeIds.has(route.id) || !route.id.trim()) failures.push({ objectId: route.id || 'route', code: 'ROUTE_STABLE_ID_INVALID' });
    routeIds.add(route.id);
    if (route.sourceArchitectureRevision !== architecture.revision) failures.push({ objectId: route.id, code: 'ROUTE_REVISION_MISMATCH', measured: route.sourceArchitectureRevision, required: architecture.revision });
    const routeSpaceList = routeSpaces(route, spaces);
    if (!routeSpaceList || route.spaceIds.length === 0 || new Set(route.spaceIds).size !== route.spaceIds.length || routeSpaceList.some(space => space.storeyId !== route.storeyId)) failures.push({ objectId: route.id, code: 'ROUTE_SPACE_BINDING_INVALID' });
    const pathValid = route.pathMm.length >= 2 && route.pathMm.length <= MAX_PATH_POINTS && route.pathMm.every(point => finitePoint(point));
    if (!pathValid) failures.push({ objectId: route.id, code: route.pathMm.length > MAX_PATH_POINTS ? 'ROUTE_PATH_BUDGET_EXCEEDED' : 'ROUTE_PATH_INVALID' });
    if (!positive(route.clearWidthMm) || route.clearWidthMm < rules.minimumAccessibleRouteWidthMm) failures.push({ objectId: route.id, code: 'ACCESSIBLE_ROUTE_TOO_NARROW', measured: route.clearWidthMm, required: rules.minimumAccessibleRouteWidthMm });
    if (!positive(route.clearHeightMm) || route.clearHeightMm < rules.minimumAccessibleRouteHeightMm) failures.push({ objectId: route.id, code: 'ACCESSIBLE_ROUTE_TOO_LOW', measured: route.clearHeightMm, required: rules.minimumAccessibleRouteHeightMm });
    if (route.doorIds.length !== Math.max(0, route.spaceIds.length - 1)) failures.push({ objectId: route.id, code: 'ROUTE_DOOR_SEQUENCE_INVALID' });
    const routeDoorHostIds = new Map<string, string>();
    const transitionCrossings: ArchitectureDoorRouteCrossing[] = [];
    for (let index = 0; index < route.doorIds.length; index += 1) {
      const door = doors.get(route.doorIds[index]!);
      if (!door || !route.spaceIds[index] || !route.spaceIds[index + 1] || !connectedDoor(door, route.spaceIds[index]!, route.spaceIds[index + 1]!)) failures.push({ objectId: route.doorIds[index] ?? route.id, code: 'ROUTE_DOOR_CONNECTION_INVALID' });
      else if (pathValid) {
        const hostWall = architecture.walls.find(wall => wall.id === door.hostWallId);
        if (!hostWall || hostWall.storeyId !== route.storeyId) failures.push({ objectId: door.id, code: 'ROUTE_DOOR_HOST_STOREY_INVALID' });
        const previousDoorId = routeDoorHostIds.get(door.hostWallId);
        if (previousDoorId) failures.push({ objectId: route.id, code: 'ROUTE_DOOR_HOST_DUPLICATE' });
        else routeDoorHostIds.set(door.hostWallId, door.id);
        const geometry = routeDoorGeometry(route, door, architecture);
        for (const code of geometry.issues) failures.push({ objectId: route.doorIds[index]!, code });
        const apertureCrossing = geometry.crossings.length === 1 && !geometry.issues.includes('ROUTE_DOOR_CROSSING_AWAY_FROM_APERTURE')
          ? geometry.crossings[0] : undefined;
        if (apertureCrossing) transitionCrossings.push({ routeId: route.id, doorId: door.id, hostWallId: door.hostWallId, ...apertureCrossing });
      }
    }
    for (let index = 1; index < transitionCrossings.length; index += 1) {
      const previous = transitionCrossings[index - 1]!;
      const current = transitionCrossings[index]!;
      if (!(current.pathDistanceMm > previous.pathDistanceMm + EPSILON)) failures.push({ objectId: route.id, code: 'ROUTE_DOOR_CROSSING_ORDER_INVALID', measured: current.pathDistanceMm, required: previous.pathDistanceMm });
    }
    if (pathValid) {
      const declaredDoorIds = new Set(route.doorIds);
      for (const door of doors.values()) {
        if (declaredDoorIds.has(door.id) || routeDoorHostIds.has(door.hostWallId)) continue;
        const geometry = routeDoorGeometry(route, door, architecture);
        if (geometry.issues.includes('ROUTE_DOOR_CROSSING_AMBIGUOUS')) failures.push({ objectId: door.id, code: 'ROUTE_DOOR_CROSSING_UNDECLARED_AMBIGUOUS' });
        else if (geometry.crossings.length > 0) failures.push({ objectId: door.id, code: 'ROUTE_DOOR_CROSSING_UNDECLARED', measured: geometry.crossings.length, required: 0 });
      }
    }
    routeCrossings.push(...transitionCrossings);
    if (routeSpaceList && pathValid) {
      const estimatedSamples = route.pathMm.slice(1).reduce((total, point, index) => total + Math.max(1, Math.ceil(distance(route.pathMm[index]!, point) / stepMm)) + 1, 0);
      if (estimatedSamples > MAX_SAMPLES_PER_ROUTE) {
        failures.push({ objectId: route.id, code: 'ROUTE_SAMPLE_BUDGET_EXCEEDED', measured: estimatedSamples, required: MAX_SAMPLES_PER_ROUTE });
        continue;
      }
      for (let index = 1; index < route.pathMm.length; index += 1) {
        const segmentStart = route.pathMm[index - 1]!, segmentEnd = route.pathMm[index]!;
        for (const point of sampleSegment(segmentStart, segmentEnd, stepMm)) {
          if (!routeSpaceList.some(space => spaceContains(space, point))) { failures.push({ objectId: route.id, code: 'ACCESSIBLE_ROUTE_LEAVES_DECLARED_SPACES' }); break; }
        }
        if (obstacleReady && positive(route.clearWidthMm)) {
          for (const obstacle of obstaclePreparation.obstacles) {
            if (route.spaceIds.includes(obstacle.spaceId)
              && obstacleVerticalOverlap(obstacle, 0, route.clearHeightMm)
              && segmentIntersectsObstacle(segmentStart, segmentEnd, obstacle, route.clearWidthMm / 2)) {
              failures.push({ objectId: obstacle.id, code: 'ROUTE_OBSTACLE_CLEARANCE_COLLISION' });
              obstacleCheck = 'failed';
            }
          }
        }
      }
    }
  }

  for (const door of doors.values()) {
    const operation = door.doorOperation;
    if (!operation) { failures.push({ objectId: door.id, code: 'DOOR_OPERATION_MISSING' }); continue; }
    if (!positive(door.widthMm) || door.widthMm < rules.minimumDoorClearWidthMm) failures.push({ objectId: door.id, code: 'DOOR_TOO_NARROW', measured: door.widthMm, required: rules.minimumDoorClearWidthMm });
    if (!finitePoint(operation.pivotMm) || ![operation.closedAngleDeg, operation.openAngleDeg, operation.leafThicknessMm].every(finite) || Math.abs(operation.openAngleDeg - operation.closedAngleDeg) > 360 || !positive(operation.leafThicknessMm) || (operation.requiredClearanceMm !== undefined && (!finite(operation.requiredClearanceMm) || operation.requiredClearanceMm < 0))) { failures.push({ objectId: door.id, code: 'DOOR_OPERATION_INVALID' }); continue; }
    const swingAngleCount = Math.max(2, Math.ceil(Math.abs(operation.openAngleDeg - operation.closedAngleDeg) / 10));
    const swingLeafCount = Math.max(1, Math.ceil(door.widthMm / stepMm));
    const estimatedSwingSamples = (swingAngleCount + 1) * (swingLeafCount + 1) * 3;
    if (!Number.isSafeInteger(estimatedSwingSamples) || estimatedSwingSamples > MAX_SAMPLES_PER_ROUTE) { failures.push({ objectId: door.id, code: 'DOOR_SWING_SAMPLE_BUDGET_EXCEEDED', measured: estimatedSwingSamples, required: MAX_SAMPLES_PER_ROUTE }); continue; }
    const connectedSpaces = (door.connectsSpaceIds ?? []).map(id => spaces.get(id));
    if (!door.connectsSpaceIds || door.connectsSpaceIds.length < 1 || door.connectsSpaceIds.length > 2 || connectedSpaces.some(space => !space) || connectedSpaces.some(space => space!.storeyId !== architecture.walls.find(wall => wall.id === door.hostWallId)?.storeyId)) { failures.push({ objectId: door.id, code: 'DOOR_SPACE_CONNECTION_INVALID' }); continue; }
    const allowed = connectedSpaces.filter((space): space is ArchitectureSpace => Boolean(space));
    if (!allowed.some(space => spaceContains(space, operation.pivotMm))) failures.push({ objectId: door.id, code: 'DOOR_PIVOT_OUTSIDE_CONNECTED_SPACES' });
    const samples = swingSamples(door, operation, stepMm);
    if (samples.some(point => !allowed.some(space => spaceContains(space, point)))) failures.push({ objectId: door.id, code: 'DOOR_SWING_LEAVES_CONNECTED_SPACES' });
    if (obstacleReady) {
      for (const obstacle of obstaclePreparation.obstacles) {
        if (allowed.some(space => space.id === obstacle.spaceId) && obstacleVerticalOverlap(obstacle, door.sillMm, door.sillMm + door.heightMm)
          && samples.some(point => pointIntersectsObstacle(point, obstacle, 0))) {
          failures.push({ objectId: obstacle.id, code: 'DOOR_SWING_OBSTACLE_COLLISION' });
          obstacleCheck = 'failed';
        }
      }
    }
  }
  return failClosed(architecture, [...new Map(failures.map(failure => [`${failure.objectId}:${failure.code}`, failure])).values()], routeCrossings, obstacleCheck);
}
