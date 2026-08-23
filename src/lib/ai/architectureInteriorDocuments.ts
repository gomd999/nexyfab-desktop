type V2 = [number, number];
type V3 = [number, number, number];

export interface ArchitectureStorey { id: string; name: string; elevationMm: number; heightMm: number }
export interface ArchitectureGridLine { id: string; name: string; axis: 'x' | 'y' | 'radial'; startMm: V2; endMm: V2 }
export interface ArchitectureRoof { id: string; storeyId: string; boundaryMm: V2[]; baseElevationMm: number; slopeDeg: number }
export interface ArchitectureStair { id: string; fromStoreyId: string; toStoreyId: string; widthMm: number; riserCount: number; treadDepthMm: number; pathMm: V3[] }
/** Concept-only vertical void/circulation reservation. This is semantic BIM data;
 * no native shaft solid or opening is claimed until an exact geometry adapter exists. */
export interface ArchitectureShaft { id: string; fromStoreyId: string; toStoreyId: string; boundaryMm: V2[]; hostSpaceIds: string[] }
/** Concept-only elevator semantic object. Served levels are ordered by elevation;
 * no cab, rail, sizing, or native solid is claimed by this schema. */
export interface ArchitectureElevator { id: string; shaftId: string; servedStoreyIds: string[] }
export interface ArchitectureZone { id: string; name: string; kind: 'fire' | 'occupancy' | 'thermal' | 'security'; spaceIds: string[] }
export type ArchitectureBoundaryEdge =
  | { kind: 'line'; startMm: V2; endMm: V2 }
  | { kind: 'arc'; centerMm: V2; radiusMm: number; startAngleDeg: number; endAngleDeg: number };
export interface ArchitectureSpace { id: string; storeyId: string; name: string; usage: string; boundaryMm: V2[]; boundaryEdges?: ArchitectureBoundaryEdge[]; wallIds: string[]; slabId: string; ceilingId: string }
export type ArchitectureWall =
  | { id: string; kind: 'line'; storeyId: string; startMm: V2; endMm: V2; thicknessMm: number; heightMm: number }
  | { id: string; kind: 'arc'; storeyId: string; centerMm: V2; radiusMm: number; startAngleDeg: number; endAngleDeg: number; thicknessMm: number; heightMm: number };
export interface ArchitectureSlab { id: string; storeyId: string; spaceId: string; boundaryMm: V2[]; thicknessMm: number }
export interface ArchitectureCeiling { id: string; storeyId: string; spaceId: string; boundaryMm: V2[]; elevationMm: number; /** Required for exact BREP; omitted legacy ceilings remain conceptual. */ thicknessMm?: number }
export interface ArchitectureOpening { id: string; kind: 'window' | 'door'; hostWallId: string; offsetMm: number; widthMm: number; heightMm: number; sillMm: number; positionMm: V3; connectsSpaceIds?: string[]; isExit?: boolean; doorOperation?: { pivotMm: V2; closedAngleDeg: number; openAngleDeg: number; leafThicknessMm: number; requiredClearanceMm?: number } }
export interface ArchitectureServiceOpening { id: string; hostId: string; sourceRouteId: string; sourceSleeveId: string; shape: 'round'; centerMm: V3; axis: V3; cutDiameterMm: number; depthMm: number; firestopAnnulusMm: number; structuralApprovalId?: string }
export interface ArchitectureDocument {
  schema: 'nexyfab.architecture.v1'; revision: number; storeys: ArchitectureStorey[]; spaces: ArchitectureSpace[]; walls: ArchitectureWall[]; slabs: ArchitectureSlab[]; ceilings: ArchitectureCeiling[]; openings: ArchitectureOpening[]; serviceOpenings?: ArchitectureServiceOpening[];
  projectNorthDeg?: number; siteCoordinateSystemId?: string; grids?: ArchitectureGridLine[]; roofs?: ArchitectureRoof[]; stairs?: ArchitectureStair[]; shafts?: ArchitectureShaft[]; elevators?: ArchitectureElevator[]; zones?: ArchitectureZone[];
}

export interface InteriorLight { id: string; spaceId: string; hostCeilingId: string; positionMm: V3; suspensionMm: number; lumens: number; cctK: number; iesProfileId?: string; yawDeg?: number; worldToPhotometricQuaternion?: { x: number; y: number; z: number; w: number } }
export interface InteriorFurniture { id: string; spaceId: string; positionMm: V3; sizeMm: V3; clearanceMm: number; rotationDeg?: number }
export interface InteriorFinish { id: string; spaceId: string; hostId: string; surface: 'floor' | 'wall' | 'ceiling'; material: string }
export interface InteriorMillwork { id: string; spaceId: string; hostWallId?: string; positionMm: V3; sizeMm: V3; material: string; clearanceMm: number }
export interface InteriorCeilingSystem { id: string; spaceId: string; hostCeilingId: string; kind: 'gypsum' | 'grid' | 'open' | 'acoustic'; elevationMm: number; moduleMm?: V2 }
export interface InteriorAcousticZone { id: string; spaceId: string; targetRt60Sec: number; absorptionClass?: string }
export interface InteriorFieldMeasurement { sourceRef: string; measuredAt: string; architectureRevision: number; toleranceMm: number }
export interface InteriorDocument {
  schema: 'nexyfab.interior.v1'; revision: number; architectureDocumentId: string; lights: InteriorLight[]; furniture: InteriorFurniture[]; finishes: InteriorFinish[];
  millwork?: InteriorMillwork[]; ceilingSystems?: InteriorCeilingSystem[]; acousticZones?: InteriorAcousticZone[]; fieldMeasurement?: InteriorFieldMeasurement;
}

export type ArchitectureEdit =
  | { kind: 'create_storey'; storey: ArchitectureStorey }
  | { kind: 'edit_storey'; storeyId: string; name?: string; elevationMm?: number; heightMm?: number }
  | { kind: 'create_wall'; wall: ArchitectureWall }
  | { kind: 'create_space'; space: ArchitectureSpace; slab: ArchitectureSlab; ceiling: ArchitectureCeiling }
  | { kind: 'edit_space'; spaceId: string; name?: string; usage?: string; storeyId?: string }
  | { kind: 'create_opening'; opening: ArchitectureOpening }
  | { kind: 'create_stair'; stair: ArchitectureStair }
  | { kind: 'create_shaft'; shaft: ArchitectureShaft }
  | { kind: 'create_elevator'; elevator: ArchitectureElevator }
  | { kind: 'create_service_opening'; serviceOpening: ArchitectureServiceOpening }
  | { kind: 'create_grid'; grid: ArchitectureGridLine }
  | { kind: 'edit_grid'; gridId: string; name?: string; axis?: ArchitectureGridLine['axis']; startMm?: V2; endMm?: V2 }
  | { kind: 'set_space_boundary'; spaceId: string; boundaryMm: V2[] }
  | { kind: 'move_line_wall'; wallId: string; startMm: V2; endMm: V2 }
  | { kind: 'resize_wall'; wallId: string; thicknessMm?: number; heightMm?: number }
  | { kind: 'set_arc_wall'; wallId: string; centerMm: V2; radiusMm: number; startAngleDeg: number; endAngleDeg: number }
  | { kind: 'edit_slab'; slabId: string; thicknessMm?: number; boundaryMm?: V2[] }
  | { kind: 'edit_opening'; openingId: string; offsetMm?: number; widthMm?: number; heightMm?: number; sillMm?: number }
  | { kind: 'edit_stair'; stairId: string; fromStoreyId?: string; toStoreyId?: string; widthMm?: number; riserCount?: number; treadDepthMm?: number; pathMm?: V3[] }
  | { kind: 'edit_shaft'; shaftId: string; fromStoreyId?: string; toStoreyId?: string; boundaryMm?: V2[]; hostSpaceIds?: string[] }
  | { kind: 'edit_elevator'; elevatorId: string; shaftId?: string; servedStoreyIds?: string[] }
  | { kind: 'edit_service_opening'; serviceOpeningId: string; hostId?: string; sourceRouteId?: string; sourceSleeveId?: string; centerMm?: V3; axis?: V3; cutDiameterMm?: number; depthMm?: number; firestopAnnulusMm?: number; structuralApprovalId?: string }
  | { kind: 'edit_ceiling'; ceilingId: string; elevationMm?: number; thicknessMm?: number }
  | { kind: 'edit_furniture'; furnitureId: string; positionMm?: V3; sizeMm?: V3; clearanceMm?: number; rotationDeg?: number }
  | { kind: 'create_furniture'; furniture: InteriorFurniture }
  | { kind: 'edit_light'; lightId: string; positionMm?: V3; suspensionMm?: number; lumens?: number; cctK?: number }
  | { kind: 'create_light'; light: InteriorLight }
  | { kind: 'edit_finish'; finishId: string; hostId?: string; surface?: 'floor' | 'wall' | 'ceiling'; material?: string }
  | { kind: 'create_finish'; finish: InteriorFinish }
  | { kind: 'edit_millwork'; millworkId: string; spaceId?: string; hostWallId?: string; positionMm?: V3; sizeMm?: V3; material?: string; clearanceMm?: number }
  | { kind: 'create_millwork'; millwork: InteriorMillwork }
  | { kind: 'edit_ceiling_system'; ceilingSystemId: string; kindCode?: InteriorCeilingSystem['kind']; elevationMm?: number; moduleMm?: V2 }
  | { kind: 'create_ceiling_system'; ceilingSystem: InteriorCeilingSystem }
  | { kind: 'set_ceiling_elevation'; ceilingId: string; elevationMm: number };

export interface ArchitectureInteriorEditResult {
  architecture: ArchitectureDocument; interior: InteriorDocument; affectedObjectIds: string[]; invalidatedChecks: string[];
}

const finite2 = (point: V2) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
const finite3 = (point: V3) => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
const positive = (value: number) => Number.isFinite(value) && value > 0;
function validGridGeometry(grid: Pick<ArchitectureGridLine, 'name' | 'axis' | 'startMm' | 'endMm'>): boolean {
  if (typeof grid.name !== 'string' || !grid.name.trim() || !['x', 'y', 'radial'].includes(grid.axis) || !finite2(grid.startMm) || !finite2(grid.endMm)) return false;
  const dx = grid.endMm[0] - grid.startMm[0], dy = grid.endMm[1] - grid.startMm[1];
  if (Math.hypot(dx, dy) === 0) return false;
  return true;
}
function validShaftGeometry(shaft: Pick<ArchitectureShaft, 'boundaryMm' | 'hostSpaceIds'>): boolean {
  if (!Array.isArray(shaft.boundaryMm) || shaft.boundaryMm.length < 3 || shaft.boundaryMm.some(point => !finite2(point))) return false;
  if (!Array.isArray(shaft.hostSpaceIds) || shaft.hostSpaceIds.length < 1 || new Set(shaft.hostSpaceIds).size !== shaft.hostSpaceIds.length || shaft.hostSpaceIds.some(id => typeof id !== 'string' || !id.trim())) return false;
  if (new Set(shaft.boundaryMm.map(point => `${point[0]}\u0000${point[1]}`)).size !== shaft.boundaryMm.length) return false;
  const cross = (a: V2, b: V2, c: V2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const between = (value: number, a: number, b: number) => value >= Math.min(a, b) - 1e-7 && value <= Math.max(a, b) + 1e-7;
  const intersects = (a: V2, b: V2, c: V2, d: V2) => {
    const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
    if (((abC > 1e-7 && abD < -1e-7) || (abC < -1e-7 && abD > 1e-7)) && ((cdA > 1e-7 && cdB < -1e-7) || (cdA < -1e-7 && cdB > 1e-7))) return true;
    return (Math.abs(abC) <= 1e-7 && between(c[0], a[0], b[0]) && between(c[1], a[1], b[1]))
      || (Math.abs(abD) <= 1e-7 && between(d[0], a[0], b[0]) && between(d[1], a[1], b[1]))
      || (Math.abs(cdA) <= 1e-7 && between(a[0], c[0], d[0]) && between(a[1], c[1], d[1]))
      || (Math.abs(cdB) <= 1e-7 && between(b[0], c[0], d[0]) && between(b[1], c[1], d[1]));
  };
  for (let first = 0; first < shaft.boundaryMm.length; first++) {
    const firstNext = (first + 1) % shaft.boundaryMm.length;
    for (let second = first + 1; second < shaft.boundaryMm.length; second++) {
      const secondNext = (second + 1) % shaft.boundaryMm.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (intersects(shaft.boundaryMm[first]!, shaft.boundaryMm[firstNext]!, shaft.boundaryMm[second]!, shaft.boundaryMm[secondNext]!)) return false;
    }
  }
  let area = 0;
  for (let index = 0; index < shaft.boundaryMm.length; index++) {
    const a = shaft.boundaryMm[index]!, b = shaft.boundaryMm[(index + 1) % shaft.boundaryMm.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(area) > 1e-7;
}
function validElevatorBinding(document: ArchitectureDocument, elevator: ArchitectureElevator): boolean {
  const shaft = document.shafts?.find(item => item.id === elevator.shaftId);
  if (!shaft || !Array.isArray(elevator.servedStoreyIds) || elevator.servedStoreyIds.length < 2 || new Set(elevator.servedStoreyIds).size !== elevator.servedStoreyIds.length) return false;
  const shaftFrom = document.storeys.find(item => item.id === shaft.fromStoreyId);
  const shaftTo = document.storeys.find(item => item.id === shaft.toStoreyId);
  const served = elevator.servedStoreyIds.map(id => document.storeys.find(item => item.id === id));
  if (!shaftFrom || !shaftTo || shaftFrom.elevationMm >= shaftTo.elevationMm || served.some(item => !item)) return false;
  const elevations = served.map(item => item!.elevationMm);
  if (elevations.some((elevation, index) => index > 0 && elevation <= elevations[index - 1]!)) return false;
  return elevations.every(elevation => elevation >= shaftFrom.elevationMm && elevation <= shaftTo.elevationMm);
}
const sameBoundary = (a: V2[], b: V2[]) => a.length === b.length && a.every((point, index) => point[0] === b[index]![0] && point[1] === b[index]![1]);
function pointOnSegment(point: V2, start: V2, end: V2): boolean { const cross = (end[0] - start[0]) * (point[1] - start[1]) - (end[1] - start[1]) * (point[0] - start[0]); return Math.abs(cross) < 1e-7 && point[0] >= Math.min(start[0], end[0]) - 1e-7 && point[0] <= Math.max(start[0], end[0]) + 1e-7 && point[1] >= Math.min(start[1], end[1]) - 1e-7 && point[1] <= Math.max(start[1], end[1]) + 1e-7; }
function pointInPolygon(point: V2, polygon: readonly V2[]): boolean { let inside = false; for (let index = 0; index < polygon.length; index++) { const start = polygon[index]!; const end = polygon[(index + 1) % polygon.length]!; if (pointOnSegment(point, start, end)) return true; if ((start[1] > point[1]) !== (end[1] > point[1]) && point[0] < ((end[0] - start[0]) * (point[1] - start[1])) / (end[1] - start[1]) + start[0]) inside = !inside; } return inside; }
function furnitureEnvelopeInside(architecture: ArchitectureDocument, furniture: InteriorFurniture): boolean {
  const space = architecture.spaces.find(item => item.id === furniture.spaceId); const storey = space ? architecture.storeys.find(item => item.id === space.storeyId) : undefined;
  if (!space || !storey) return false;
  // The object body is authoritative geometry. clearanceMm is a requested
  // circulation value that is verified by the clearance artifact; treating it
  // as a symmetric collision box here would reject otherwise valid concepts.
  const halfX = furniture.sizeMm[0] / 2, halfY = furniture.sizeMm[1] / 2, angle = (furniture.rotationDeg ?? 0) * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
  const corners: V2[] = [[-halfX, -halfY], [halfX, -halfY], [halfX, halfY], [-halfX, halfY]].map(([x, y]) => [furniture.positionMm[0] + x * cosine - y * sine, furniture.positionMm[1] + x * sine + y * cosine]);
  // clearanceMm is a plan-access envelope. The documented Z coordinate is
  // the object's base, so applying horizontal clearance below the storey
  // floor would reject valid floor-standing furniture.
  return corners.every(corner => pointInPolygon(corner, space.boundaryMm))
    && furniture.positionMm[2] >= 0
    && furniture.positionMm[2] + furniture.sizeMm[2] <= storey.heightMm;
}

function finishHostMatchesSpace(architecture: ArchitectureDocument, finish: InteriorFinish): boolean {
  const space = architecture.spaces.find(item => item.id === finish.spaceId);
  if (!space) return false;
  if (finish.surface === 'wall') return space.wallIds.includes(finish.hostId);
  if (finish.surface === 'floor') return space.slabId === finish.hostId;
  return space.ceilingId === finish.hostId;
}

function lightHostMatchesSpace(architecture: ArchitectureDocument, light: InteriorLight): boolean {
  const space = architecture.spaces.find(item => item.id === light.spaceId);
  const ceiling = architecture.ceilings.find(item => item.id === light.hostCeilingId);
  const storey = space ? architecture.storeys.find(item => item.id === space.storeyId) : undefined;
  if (!space || !ceiling || !storey || space.ceilingId !== ceiling.id || ceiling.spaceId !== space.id) return false;
  return pointInPolygon([light.positionMm[0], light.positionMm[1]], space.boundaryMm)
    && light.positionMm[2] >= storey.elevationMm && light.positionMm[2] <= storey.elevationMm + storey.heightMm;
}

function lightElevationMatchesSuspension(architecture: ArchitectureDocument, light: InteriorLight): boolean {
  const ceiling = architecture.ceilings.find(item => item.id === light.hostCeilingId);
  return Boolean(ceiling && Math.abs(light.positionMm[2] - (ceiling.elevationMm - light.suspensionMm)) <= 1e-7);
}

function millworkEnvelopeInside(architecture: ArchitectureDocument, millwork: InteriorMillwork): boolean {
  const space = architecture.spaces.find(item => item.id === millwork.spaceId);
  const storey = space ? architecture.storeys.find(item => item.id === space.storeyId) : undefined;
  if (!space || !storey || (millwork.hostWallId !== undefined && !space.wallIds.includes(millwork.hostWallId))) return false;
  // Millwork uses a lower-corner insertion point. A wall-hosted item's
  // clearance is an access zone into the room, not a symmetric offset
  // through its host wall; enforce its exact body footprint here. Freestanding
  // millwork keeps a symmetric clearance envelope.
  const footprintInside = (() => {
    if (!millwork.hostWallId) {
      const minX = millwork.positionMm[0] - millwork.clearanceMm, minY = millwork.positionMm[1] - millwork.clearanceMm;
      const maxX = millwork.positionMm[0] + millwork.sizeMm[0] + millwork.clearanceMm;
      const maxY = millwork.positionMm[1] + millwork.sizeMm[1] + millwork.clearanceMm;
      return [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]].every(corner => pointInPolygon(corner as V2, space.boundaryMm));
    }
    // A hosted insertion point may be authored from either end/side of its
    // wall. Accept only an axis-aligned orientation whose complete body fits;
    // the precise inward orientation belongs to the wall-frame adapter.
    return [-1, 1].some(xDirection => [-1, 1].some(yDirection => {
      const x = millwork.positionMm[0], y = millwork.positionMm[1];
      const endX = x + xDirection * millwork.sizeMm[0], endY = y + yDirection * millwork.sizeMm[1];
      return ([[x, y], [endX, y], [endX, endY], [x, endY]] as V2[]).every(corner => pointInPolygon(corner, space.boundaryMm));
    }));
  })();
  return footprintInside
    && millwork.positionMm[2] >= 0
    && millwork.positionMm[2] + millwork.sizeMm[2] <= storey.heightMm;
}

function ceilingSystemHostMatchesSpace(architecture: ArchitectureDocument, system: InteriorCeilingSystem): boolean {
  const space = architecture.spaces.find(item => item.id === system.spaceId);
  const ceiling = architecture.ceilings.find(item => item.id === system.hostCeilingId);
  const storey = space ? architecture.storeys.find(item => item.id === space.storeyId) : undefined;
  return Boolean(space && ceiling && storey && space.ceilingId === ceiling.id && ceiling.spaceId === space.id
    && system.elevationMm >= storey.elevationMm && system.elevationMm <= ceiling.elevationMm
    && ((system.kind !== 'grid' && system.kind !== 'acoustic') || system.moduleMm !== undefined));
}

function wallPoint(wall: ArchitectureWall, offsetMm: number): V2 {
  if (wall.kind === 'line') {
    const dx = wall.endMm[0] - wall.startMm[0], dy = wall.endMm[1] - wall.startMm[1], length = Math.hypot(dx, dy);
    if (offsetMm < 0 || offsetMm > length) throw new Error(`${wall.id}: opening offset exceeds host wall length.`);
    return [wall.startMm[0] + dx * offsetMm / length, wall.startMm[1] + dy * offsetMm / length];
  }
  const sweepDeg = wall.endAngleDeg - wall.startAngleDeg, length = Math.abs(sweepDeg) * Math.PI / 180 * wall.radiusMm;
  if (offsetMm < 0 || offsetMm > length) throw new Error(`${wall.id}: opening offset exceeds host arc length.`);
  const angle = (wall.startAngleDeg + Math.sign(sweepDeg || 1) * offsetMm / wall.radiusMm * 180 / Math.PI) * Math.PI / 180;
  return [wall.centerMm[0] + Math.cos(angle) * wall.radiusMm, wall.centerMm[1] + Math.sin(angle) * wall.radiusMm];
}

export function validateArchitectureDocument(document: ArchitectureDocument): string[] {
  const issues: string[] = [], ids = new Set<string>();
  const register = (id: string) => { if (!id.trim() || ids.has(id)) issues.push(`Duplicate or empty architecture id ${id || '(empty)'}.`); ids.add(id); };
  if (document.schema !== 'nexyfab.architecture.v1' || !Number.isSafeInteger(document.revision) || document.revision < 0) issues.push('Invalid architecture header.');
  document.storeys.forEach(item => { register(item.id); if (!Number.isFinite(item.elevationMm) || !positive(item.heightMm)) issues.push(`${item.id}: invalid storey elevation or height.`); });
  document.walls.forEach(item => { register(item.id); if (!positive(item.thicknessMm) || !positive(item.heightMm) || (item.kind === 'line' ? !finite2(item.startMm) || !finite2(item.endMm) || Math.hypot(item.endMm[0] - item.startMm[0], item.endMm[1] - item.startMm[1]) === 0 : !finite2(item.centerMm) || !positive(item.radiusMm) || !Number.isFinite(item.startAngleDeg) || !Number.isFinite(item.endAngleDeg) || item.startAngleDeg === item.endAngleDeg)) issues.push(`${item.id}: invalid wall geometry.`); });
  document.slabs.forEach(item => { register(item.id); if (!positive(item.thicknessMm) || item.boundaryMm.length < 3 || item.boundaryMm.some(point => !finite2(point))) issues.push(`${item.id}: invalid slab.`); });
  document.ceilings.forEach(item => { register(item.id); if (!Number.isFinite(item.elevationMm) || item.boundaryMm.length < 3 || item.boundaryMm.some(point => !finite2(point)) || (item.thicknessMm !== undefined && !positive(item.thicknessMm))) issues.push(`${item.id}: invalid ceiling.`); });
  document.spaces.forEach(item => {
    register(item.id);
    if (item.boundaryMm.length < 3 || item.boundaryMm.some(point => !finite2(point)) || item.wallIds.length !== (item.boundaryEdges?.length ?? item.boundaryMm.length)) issues.push(`${item.id}: boundary and wall loop are inconsistent.`);
    if (item.boundaryEdges?.some(edge => edge.kind === 'line' ? !finite2(edge.startMm) || !finite2(edge.endMm) || Math.hypot(edge.endMm[0] - edge.startMm[0], edge.endMm[1] - edge.startMm[1]) === 0 : !finite2(edge.centerMm) || !positive(edge.radiusMm) || !Number.isFinite(edge.startAngleDeg) || !Number.isFinite(edge.endAngleDeg) || edge.startAngleDeg === edge.endAngleDeg)) issues.push(`${item.id}: invalid exact boundary edge geometry.`);
  });
  document.openings.forEach(item => { register(item.id); if (![item.offsetMm, item.widthMm, item.heightMm, item.sillMm].every(Number.isFinite) || item.offsetMm < 0 || item.sillMm < 0 || !positive(item.widthMm) || !positive(item.heightMm) || !finite3(item.positionMm)) issues.push(`${item.id}: invalid opening.`); });
  document.serviceOpenings?.forEach(item => { register(item.id); if (item.shape !== 'round' || !item.hostId.trim() || !item.sourceRouteId.trim() || !item.sourceSleeveId.trim() || (item.structuralApprovalId !== undefined && !item.structuralApprovalId.trim()) || !finite3(item.centerMm) || !finite3(item.axis) || !positive(item.cutDiameterMm) || !positive(item.depthMm) || !Number.isFinite(item.firestopAnnulusMm) || item.firestopAnnulusMm < 0 || Math.abs(Math.hypot(...item.axis) - 1) > 1e-6) issues.push(`${item.id}: invalid service opening.`); });
  document.grids?.forEach(item => { register(item.id); if (!validGridGeometry(item)) issues.push(`${item.id}: invalid grid line.`); });
  document.roofs?.forEach(item => { register(item.id); if (item.boundaryMm.length < 3 || item.boundaryMm.some(point => !finite2(point)) || !Number.isFinite(item.baseElevationMm) || !Number.isFinite(item.slopeDeg) || Math.abs(item.slopeDeg) >= 90) issues.push(`${item.id}: invalid roof.`); });
  document.stairs?.forEach(item => {
    register(item.id);
    const fromStorey = document.storeys.find(storey => storey.id === item.fromStoreyId);
    const toStorey = document.storeys.find(storey => storey.id === item.toStoreyId);
    const path = Array.isArray(item.pathMm) ? item.pathMm : [];
    const validShape = positive(item.widthMm) && Number.isSafeInteger(item.riserCount) && item.riserCount >= 1
      && positive(item.treadDepthMm) && path.length >= 2 && path.every(point => finite3(point));
    const boundEndpoints = Boolean(fromStorey && toStorey && path.length >= 2
      && finite3(path[0]!) && finite3(path[path.length - 1]!)
      && path[0]![2] === fromStorey.elevationMm
      && path[path.length - 1]![2] === toStorey.elevationMm);
    if (!validShape || !boundEndpoints) issues.push(`${item.id}: invalid stair.`);
  });
  document.shafts?.forEach(item => {
    register(item.id);
    const fromStorey = document.storeys.find(storey => storey.id === item.fromStoreyId);
    const toStorey = document.storeys.find(storey => storey.id === item.toStoreyId);
    if (!fromStorey || !toStorey || toStorey.elevationMm <= fromStorey.elevationMm || !validShaftGeometry(item)) issues.push(`${item.id}: invalid shaft geometry or storey binding.`);
  });
  document.elevators?.forEach(item => {
    register(item.id);
    if (!validElevatorBinding(document, item)) issues.push(`${item.id}: invalid elevator shaft or served-storey binding.`);
  });
  document.zones?.forEach(item => { register(item.id); if (!item.name.trim() || !item.spaceIds.length) issues.push(`${item.id}: invalid building zone.`); });
  if (!Number.isFinite(document.projectNorthDeg ?? 0) || (document.siteCoordinateSystemId !== undefined && !document.siteCoordinateSystemId.trim())) issues.push('Invalid building coordinate metadata.');
  const storeys = new Set(document.storeys.map(item => item.id)), walls = new Map(document.walls.map(item => [item.id, item])), spaces = new Map(document.spaces.map(item => [item.id, item])), slabs = new Map(document.slabs.map(item => [item.id, item])), ceilings = new Map(document.ceilings.map(item => [item.id, item]));
  for (const wall of document.walls) if (!storeys.has(wall.storeyId)) issues.push(`${wall.id}: unknown storey.`);
  for (const space of document.spaces) {
    if (!storeys.has(space.storeyId) || space.wallIds.some(id => !walls.has(id)) || !slabs.has(space.slabId) || !ceilings.has(space.ceilingId)) issues.push(`${space.id}: missing storey, wall, slab, or ceiling reference.`);
    if (slabs.get(space.slabId)?.spaceId !== space.id || ceilings.get(space.ceilingId)?.spaceId !== space.id) issues.push(`${space.id}: slab or ceiling ownership mismatch.`);
  }
  for (const opening of document.openings) {
    const wall = walls.get(opening.hostWallId); if (!wall) issues.push(`${opening.id}: unknown host wall.`);
    else { try { wallPoint(wall, opening.offsetMm); } catch (error) { issues.push(error instanceof Error ? error.message : `${opening.id}: invalid host offset.`); } }
    if (opening.connectsSpaceIds && (opening.kind !== 'door' || opening.connectsSpaceIds.length < 1 || opening.connectsSpaceIds.length > 2 || opening.connectsSpaceIds.some(id => !spaces.has(id)))) issues.push(`${opening.id}: invalid explicit door-space connection.`);
    if (opening.isExit && opening.kind !== 'door') issues.push(`${opening.id}: only a door can be an exit.`);
    if (opening.doorOperation && (opening.kind !== 'door' || !finite2(opening.doorOperation.pivotMm) || ![opening.doorOperation.closedAngleDeg, opening.doorOperation.openAngleDeg, opening.doorOperation.leafThicknessMm].every(Number.isFinite) || !positive(opening.doorOperation.leafThicknessMm) || (opening.doorOperation.requiredClearanceMm ?? 0) < 0)) issues.push(`${opening.id}: invalid explicit door operation.`);
  }
  for (const slab of document.slabs) if (!spaces.has(slab.spaceId)) issues.push(`${slab.id}: unknown space.`);
  for (const ceiling of document.ceilings) if (!spaces.has(ceiling.spaceId)) issues.push(`${ceiling.id}: unknown space.`);
  const serviceHosts = new Set([...document.walls.map(item => item.id), ...document.slabs.map(item => item.id)]);
  for (const opening of document.serviceOpenings ?? []) if (!serviceHosts.has(opening.hostId)) issues.push(`${opening.id}: unknown wall or slab host.`);
  for (const roof of document.roofs ?? []) if (!storeys.has(roof.storeyId)) issues.push(`${roof.id}: unknown storey.`);
  for (const stair of document.stairs ?? []) if (!storeys.has(stair.fromStoreyId) || !storeys.has(stair.toStoreyId) || stair.fromStoreyId === stair.toStoreyId) issues.push(`${stair.id}: invalid storey connection.`);
  for (const shaft of document.shafts ?? []) {
    const hostSpaceIds = Array.isArray(shaft.hostSpaceIds) ? shaft.hostSpaceIds : [];
    if (!storeys.has(shaft.fromStoreyId) || !storeys.has(shaft.toStoreyId) || shaft.fromStoreyId === shaft.toStoreyId) issues.push(`${shaft.id}: invalid storey connection.`);
    if (hostSpaceIds.some(spaceId => !spaces.has(spaceId))) issues.push(`${shaft.id}: unknown host space.`);
    if (hostSpaceIds.some(spaceId => {
      const storeyId = spaces.get(spaceId)?.storeyId;
      return storeyId !== shaft.fromStoreyId && storeyId !== shaft.toStoreyId;
    })) issues.push(`${shaft.id}: host spaces must belong to from/to storeys.`);
  }
  for (const elevator of document.elevators ?? []) {
    if (!document.shafts?.some(shaft => shaft.id === elevator.shaftId)) issues.push(`${elevator.id}: unknown shaft.`);
    if (!Array.isArray(elevator.servedStoreyIds) || elevator.servedStoreyIds.some(storeyId => !storeys.has(storeyId))) issues.push(`${elevator.id}: unknown served storey.`);
  }
  for (const zone of document.zones ?? []) if (zone.spaceIds.some(id => !spaces.has(id))) issues.push(`${zone.id}: unknown space in zone.`);
  return issues;
}

export function validateInteriorDocument(interior: InteriorDocument, architecture: ArchitectureDocument): string[] {
  const issues: string[] = [], ids = new Set<string>(), spaces = new Set(architecture.spaces.map(item => item.id)), ceilings = new Set(architecture.ceilings.map(item => item.id)), hosts = new Set([...architecture.walls.map(item => item.id), ...architecture.slabs.map(item => item.id), ...architecture.ceilings.map(item => item.id)]);
  const register = (id: string) => { if (!id.trim() || ids.has(id)) issues.push(`Duplicate or empty interior id ${id || '(empty)'}.`); ids.add(id); };
  if (interior.schema !== 'nexyfab.interior.v1' || !Number.isSafeInteger(interior.revision) || interior.revision < 0 || !interior.architectureDocumentId.trim()) issues.push('Invalid interior header.');
  interior.lights.forEach(item => { register(item.id); const quaternion = item.worldToPhotometricQuaternion; if (!spaces.has(item.spaceId) || !ceilings.has(item.hostCeilingId) || !finite3(item.positionMm) || item.suspensionMm < 0 || !positive(item.lumens) || !positive(item.cctK) || !Number.isFinite(item.yawDeg ?? 0) || !lightHostMatchesSpace(architecture, item) || (quaternion && ![quaternion.x, quaternion.y, quaternion.z, quaternion.w].every(Number.isFinite))) issues.push(`${item.id}: invalid light or architecture host.`); });
  interior.furniture.forEach(item => { register(item.id); if (!spaces.has(item.spaceId) || !finite3(item.positionMm) || !finite3(item.sizeMm) || !item.sizeMm.every(positive) || item.clearanceMm < 0 || !Number.isFinite(item.rotationDeg ?? 0) || !furnitureEnvelopeInside(architecture, item)) issues.push(`${item.id}: invalid furniture or space.`); });
  // Structural validation confirms the referenced host exists. Surface-kind
  // reconciliation remains an artifact-specific check so drawing/quantity
  // builders can return their precise fail-closed reason code.
  interior.finishes.forEach(item => { register(item.id); if (!spaces.has(item.spaceId) || !hosts.has(item.hostId) || !item.material.trim()) issues.push(`${item.id}: invalid finish host or material.`); });
  interior.millwork?.forEach(item => { register(item.id); if (!spaces.has(item.spaceId) || (item.hostWallId !== undefined && !architecture.walls.some(wall => wall.id === item.hostWallId)) || !finite3(item.positionMm) || !finite3(item.sizeMm) || !item.sizeMm.every(positive) || !item.material.trim() || item.clearanceMm < 0 || !millworkEnvelopeInside(architecture, item)) issues.push(`${item.id}: invalid millwork or architecture host.`); });
  interior.ceilingSystems?.forEach(item => { register(item.id); if (!spaces.has(item.spaceId) || !ceilings.has(item.hostCeilingId) || !Number.isFinite(item.elevationMm) || (item.moduleMm && (!finite2(item.moduleMm) || !item.moduleMm.every(positive))) || !ceilingSystemHostMatchesSpace(architecture, item)) issues.push(`${item.id}: invalid ceiling system or host.`); });
  interior.acousticZones?.forEach(item => { register(item.id); if (!spaces.has(item.spaceId) || !positive(item.targetRt60Sec) || (item.absorptionClass !== undefined && !item.absorptionClass.trim())) issues.push(`${item.id}: invalid acoustic zone.`); });
  const field = interior.fieldMeasurement;
  if (field && (!field.sourceRef.trim() || !Number.isSafeInteger(field.architectureRevision) || field.architectureRevision < 0 || !positive(field.toleranceMm) || Number.isNaN(Date.parse(field.measuredAt)))) issues.push('Invalid interior field measurement evidence.');
  return issues;
}

/** Regenerate only deterministic dependants; no space-planning geometry is guessed. */
export function applyArchitectureInteriorEdit(architecture: ArchitectureDocument, interior: InteriorDocument, edit: ArchitectureEdit): ArchitectureInteriorEditResult {
  const nextArchitecture = structuredClone(architecture), nextInterior = structuredClone(interior), affected = new Set<string>(), invalidated = new Set<string>(['ifc_roundtrip', 'placement']);
  const updateOpenings = (wall: ArchitectureWall) => nextArchitecture.openings.filter(item => item.hostWallId === wall.id).forEach(opening => { const point = wallPoint(wall, opening.offsetMm); opening.positionMm = [point[0], point[1], opening.sillMm]; affected.add(opening.id); });
  if (edit.kind === 'create_storey') {
    if (nextArchitecture.storeys.some(item => item.id === edit.storey.id)) throw new Error(`Duplicate storey ${edit.storey.id}.`);
    nextArchitecture.storeys.push(structuredClone(edit.storey)); affected.add(edit.storey.id); invalidated.add('level_relationships');
  } else if (edit.kind === 'edit_storey') {
    const storey = nextArchitecture.storeys.find(item => item.id === edit.storeyId);
    if (!storey) throw new Error(`Unknown storey ${edit.storeyId}.`);
    if (edit.name === undefined && edit.elevationMm === undefined && edit.heightMm === undefined) throw new Error('Storey edit requires a supported field.');
    const nextStorey: ArchitectureStorey = {
      ...storey,
      ...(edit.name !== undefined ? { name: edit.name } : {}),
      ...(edit.elevationMm !== undefined ? { elevationMm: edit.elevationMm } : {}),
      ...(edit.heightMm !== undefined ? { heightMm: edit.heightMm } : {}),
    };
    if (JSON.stringify(nextStorey) === JSON.stringify(storey)) throw new Error('Storey edit is a no-op.');
    if (typeof nextStorey.name !== 'string' || !nextStorey.name.trim()) throw new Error('Storey name must not be empty.');
    if (!Number.isFinite(nextStorey.elevationMm) || !positive(nextStorey.heightMm)) throw new Error('Storey elevation must be finite and height must be positive.');
    const elevationChanged = nextStorey.elevationMm !== storey.elevationMm;
    const heightChanged = nextStorey.heightMm !== storey.heightMm;
    const elevationDelta = nextStorey.elevationMm - storey.elevationMm;

    // A level edit cannot silently reorder or overlap an existing level. This
    // keeps stair/elevator/shaft bindings deterministic and gives callers a
    // safe failure mode when a move would invalidate an adjacent level.
    if (elevationChanged || heightChanged) {
      for (const other of nextArchitecture.storeys) {
        if (other.id === storey.id) continue;
        const wasBelow = storey.elevationMm < other.elevationMm;
        if ((wasBelow && nextStorey.elevationMm >= other.elevationMm) || (!wasBelow && nextStorey.elevationMm <= other.elevationMm)) throw new Error('Storey edit would reorder levels.');
        const candidateTop = wasBelow ? nextStorey.elevationMm + nextStorey.heightMm : other.elevationMm + other.heightMm;
        const otherBottom = wasBelow ? other.elevationMm : nextStorey.elevationMm;
        if (candidateTop > otherBottom) throw new Error('Storey edit would overlap another level.');
      }
    }

    const hostedSpaces = nextArchitecture.spaces.filter(space => space.storeyId === storey.id);
    const hostedWalls = nextArchitecture.walls.filter(wall => wall.storeyId === storey.id);
    const hostedSlabs = nextArchitecture.slabs.filter(slab => slab.storeyId === storey.id);
    const hostedCeilings = nextArchitecture.ceilings.filter(ceiling => ceiling.storeyId === storey.id);
    if (heightChanged) {
      if (hostedWalls.some(wall => wall.heightMm > nextStorey.heightMm)) throw new Error('Storey height is below a hosted wall height.');
      if (hostedCeilings.some(ceiling => {
        const candidateElevation = ceiling.elevationMm + (elevationChanged ? elevationDelta : 0);
        return candidateElevation < nextStorey.elevationMm || candidateElevation > nextStorey.elevationMm + nextStorey.heightMm;
      })) throw new Error('Storey height does not contain a hosted ceiling elevation.');
      if (nextInterior.furniture.some(item => hostedSpaces.some(space => space.id === item.spaceId) && (item.positionMm[2] < 0 || item.positionMm[2] + item.sizeMm[2] > nextStorey.heightMm))) throw new Error('Storey height is below hosted furniture.');
      if (nextInterior.millwork?.some(item => hostedSpaces.some(space => space.id === item.spaceId) && (item.positionMm[2] < 0 || item.positionMm[2] + item.sizeMm[2] > nextStorey.heightMm))) throw new Error('Storey height is below hosted millwork.');
    }
    Object.assign(storey, nextStorey);
    affected.add(storey.id);
    if (elevationChanged) {
      hostedCeilings.forEach(ceiling => { ceiling.elevationMm += elevationDelta; affected.add(ceiling.id); });
      nextInterior.lights.filter(light => hostedSpaces.some(space => space.id === light.spaceId)).forEach(light => { light.positionMm[2] += elevationDelta; affected.add(light.id); });
      nextInterior.ceilingSystems?.filter(system => hostedSpaces.some(space => space.id === system.spaceId)).forEach(system => { system.elevationMm += elevationDelta; affected.add(system.id); });
      nextArchitecture.roofs?.filter(roof => roof.storeyId === storey.id).forEach(roof => { roof.baseElevationMm += elevationDelta; affected.add(roof.id); });
      nextArchitecture.serviceOpenings?.filter(opening => {
        const host = nextArchitecture.walls.find(wall => wall.id === opening.hostId) ?? nextArchitecture.slabs.find(slab => slab.id === opening.hostId);
        return host?.storeyId === storey.id;
      }).forEach(opening => { opening.centerMm = [opening.centerMm[0], opening.centerMm[1], opening.centerMm[2] + elevationDelta]; affected.add(opening.id); });
      nextArchitecture.stairs?.filter(stair => stair.fromStoreyId === storey.id || stair.toStoreyId === storey.id).forEach(stair => {
        const path = structuredClone(stair.pathMm);
        if (stair.fromStoreyId === storey.id) path[0]![2] = storey.elevationMm;
        if (stair.toStoreyId === storey.id) path[path.length - 1]![2] = storey.elevationMm;
        stair.pathMm = path;
        affected.add(stair.id);
      });
    }
    if (elevationChanged || heightChanged) {
      hostedWalls.forEach(wall => affected.add(wall.id));
      hostedSpaces.forEach(space => {
        affected.add(space.id);
        affected.add(space.slabId);
        affected.add(space.ceilingId);
        space.wallIds.forEach(wallId => affected.add(wallId));
        nextArchitecture.openings.filter(opening => space.wallIds.includes(opening.hostWallId)).forEach(opening => affected.add(opening.id));
      });
      hostedSlabs.forEach(slab => affected.add(slab.id));
      hostedCeilings.forEach(ceiling => affected.add(ceiling.id));
      nextInterior.furniture.filter(item => hostedSpaces.some(space => space.id === item.spaceId)).forEach(item => affected.add(item.id));
      nextInterior.finishes.filter(item => hostedSpaces.some(space => space.id === item.spaceId)).forEach(item => affected.add(item.id));
      nextInterior.millwork?.filter(item => hostedSpaces.some(space => space.id === item.spaceId)).forEach(item => affected.add(item.id));
      nextInterior.acousticZones?.filter(item => hostedSpaces.some(space => space.id === item.spaceId)).forEach(item => affected.add(item.id));
      nextArchitecture.shafts?.filter(shaft => shaft.fromStoreyId === storey.id || shaft.toStoreyId === storey.id || shaft.hostSpaceIds.some(spaceId => hostedSpaces.some(space => space.id === spaceId))).forEach(shaft => affected.add(shaft.id));
      nextArchitecture.elevators?.filter(elevator => elevator.servedStoreyIds.includes(storey.id) || nextArchitecture.shafts?.some(shaft => shaft.id === elevator.shaftId && (shaft.fromStoreyId === storey.id || shaft.toStoreyId === storey.id))).forEach(elevator => affected.add(elevator.id));
      invalidated.add('level_relationships'); invalidated.add('space_boundary'); invalidated.add('egress'); invalidated.add('door_swing'); invalidated.add('furniture_clearance'); invalidated.add('lighting'); invalidated.add('mep_interference'); invalidated.add('quantity_schedule');
    }
  } else if (edit.kind === 'create_wall') {
    if (nextArchitecture.walls.some(item => item.id === edit.wall.id)) throw new Error(`Duplicate wall ${edit.wall.id}.`);
    if (!nextArchitecture.storeys.some(item => item.id === edit.wall.storeyId)) throw new Error('Wall host storey is missing.');
    nextArchitecture.walls.push(structuredClone(edit.wall)); affected.add(edit.wall.id); invalidated.add('space_boundary'); invalidated.add('egress');
  } else if (edit.kind === 'create_space') {
    if (nextArchitecture.spaces.some(item => item.id === edit.space.id)) throw new Error(`Duplicate space ${edit.space.id}.`);
    const space = edit.space;
    if (!nextArchitecture.storeys.some(item => item.id === space.storeyId)) throw new Error('Space host storey is missing.');
    const slab = edit.slab, ceiling = edit.ceiling;
    if ([...nextArchitecture.slabs, ...nextArchitecture.ceilings].some(item => item.id === slab.id || item.id === ceiling.id)) throw new Error('Space slab or ceiling identity already exists.');
    if (slab.id === space.id || ceiling.id === space.id || slab.id === ceiling.id) throw new Error('Space bundle identities must be distinct.');
    const wallIds = new Set(nextArchitecture.walls.map(item => item.id));
    if (space.wallIds.length < 3 || new Set(space.wallIds).size !== space.wallIds.length || space.wallIds.length !== space.boundaryMm.length || space.wallIds.some(id => !wallIds.has(id))) throw new Error('Space boundary requires unique existing wall references with matching edge count.');
    if (slab.spaceId !== space.id || ceiling.spaceId !== space.id || slab.storeyId !== space.storeyId || ceiling.storeyId !== space.storeyId) throw new Error('Space bundle hosts must share the new space storey and identity.');
    if (slab.boundaryMm.length !== space.boundaryMm.length || slab.boundaryMm.some((point, index) => point[0] !== space.boundaryMm[index]?.[0] || point[1] !== space.boundaryMm[index]?.[1]) || ceiling.boundaryMm.length !== space.boundaryMm.length || ceiling.boundaryMm.some((point, index) => point[0] !== space.boundaryMm[index]?.[0] || point[1] !== space.boundaryMm[index]?.[1])) throw new Error('Space bundle slab and ceiling boundaries must exactly match the space.');
    const referencedWalls = space.wallIds.map(id => nextArchitecture.walls.find(wall => wall.id === id)!);
    const samePoint = (left: V2, right: V2) => left[0] === right[0] && left[1] === right[1];
    const edgeMatches = (wall: ArchitectureWall, start: V2, end: V2) => wall.kind === 'line' && ((samePoint(wall.startMm, start) && samePoint(wall.endMm, end)) || (samePoint(wall.startMm, end) && samePoint(wall.endMm, start)));
    if (referencedWalls.some(wall => wall.storeyId !== space.storeyId)) throw new Error('Space boundary walls must share the space storey.');
    if (referencedWalls.some(wall => wall.kind !== 'line')) throw new Error('Space creation rejects arc walls until explicit boundaryEdges are supplied.');
    if (referencedWalls.some((wall, index) => !edgeMatches(wall, space.boundaryMm[index]!, space.boundaryMm[(index + 1) % space.boundaryMm.length]!))) throw new Error('Space wall loop must be an ordered closed line loop matching boundary edges.');
    if (slab.storeyId !== space.storeyId || ceiling.storeyId !== space.storeyId) throw new Error('Space, slab, and ceiling must share a storey.');
    nextArchitecture.slabs.push(structuredClone(slab)); nextArchitecture.ceilings.push(structuredClone(ceiling)); nextArchitecture.spaces.push(structuredClone(space)); affected.add(space.id); affected.add(slab.id); affected.add(ceiling.id); invalidated.add('space_boundary'); invalidated.add('egress'); invalidated.add('furniture_clearance');
  } else if (edit.kind === 'edit_space') {
    const space = nextArchitecture.spaces.find(item => item.id === edit.spaceId);
    if (!space) throw new Error(`Unknown space ${edit.spaceId}.`);
    if (edit.name === undefined && edit.usage === undefined && edit.storeyId === undefined) throw new Error('Space edit requires a supported field.');
    const nextSpace: ArchitectureSpace = {
      ...space,
      ...(edit.name !== undefined ? { name: edit.name } : {}),
      ...(edit.usage !== undefined ? { usage: edit.usage } : {}),
      ...(edit.storeyId !== undefined ? { storeyId: edit.storeyId } : {}),
    };
    if (JSON.stringify(nextSpace) === JSON.stringify(space)) throw new Error('Space edit is a no-op.');
    if (edit.name !== undefined && (typeof edit.name !== 'string' || !edit.name.trim())) throw new Error('Space name must not be empty.');
    if (edit.usage !== undefined && (typeof edit.usage !== 'string' || !edit.usage.trim())) throw new Error('Space usage must not be empty.');
    const oldStorey = nextArchitecture.storeys.find(item => item.id === space.storeyId);
    const targetStorey = nextArchitecture.storeys.find(item => item.id === nextSpace.storeyId);
    if (!oldStorey || !targetStorey) throw new Error('Space storey binding is missing.');
    const storeyChanged = oldStorey.id !== targetStorey.id;
    const movedWallIds = new Set(space.wallIds);
    const movedWallList = space.wallIds.map(wallId => nextArchitecture.walls.find(wall => wall.id === wallId));
    const slab = nextArchitecture.slabs.find(item => item.id === space.slabId);
    const ceiling = nextArchitecture.ceilings.find(item => item.id === space.ceilingId);
    if (!slab || !ceiling || slab.spaceId !== space.id || ceiling.spaceId !== space.id) throw new Error('Space slab or ceiling dependency is missing.');
    if (slab.storeyId !== oldStorey.id && slab.storeyId !== targetStorey.id) throw new Error('Space slab is bound to a foreign storey.');
    if (ceiling.storeyId !== oldStorey.id && ceiling.storeyId !== targetStorey.id) throw new Error('Space ceiling is bound to a foreign storey.');
    if (movedWallList.some(wall => !wall || (wall.storeyId !== oldStorey.id && wall.storeyId !== targetStorey.id))) throw new Error('Space boundary wall is bound to a foreign storey.');
    if (storeyChanged) {
      const referencingSpaces = nextArchitecture.spaces.filter(candidate => candidate.id !== space.id && candidate.wallIds.some(wallId => movedWallIds.has(wallId)));
      if (referencingSpaces.some(candidate => candidate.storeyId !== targetStorey.id)) throw new Error('Space storey move would split a shared wall dependency.');
      if (movedWallList.some(wall => wall!.heightMm > targetStorey.heightMm)) throw new Error('Target storey is below a space boundary wall height.');
      const candidateCeilingElevation = ceiling.elevationMm + (targetStorey.elevationMm - oldStorey.elevationMm);
      if (candidateCeilingElevation < targetStorey.elevationMm || candidateCeilingElevation > targetStorey.elevationMm + targetStorey.heightMm) throw new Error('Target storey does not contain the moved ceiling elevation.');
      const movingOpenings = nextArchitecture.openings.filter(opening => movedWallIds.has(opening.hostWallId));
      if (movingOpenings.some(opening => opening.connectsSpaceIds?.some(spaceId => {
        if (spaceId === space.id) return false;
        const connected = nextArchitecture.spaces.find(candidate => candidate.id === spaceId);
        return !connected || connected.storeyId !== targetStorey.id;
      }))) throw new Error('Space storey move would split an opening connection.');
      if (nextArchitecture.shafts?.some(shaft => shaft.hostSpaceIds.includes(space.id) && shaft.fromStoreyId !== targetStorey.id && shaft.toStoreyId !== targetStorey.id)) throw new Error('Space storey move would detach a shaft host dependency.');
    }
    const elevationDelta = targetStorey.elevationMm - oldStorey.elevationMm;
    Object.assign(space, nextSpace);
    affected.add(space.id);
    if (storeyChanged) {
      movedWallList.forEach(wall => { if (wall) { wall.storeyId = targetStorey.id; affected.add(wall.id); } });
      slab.storeyId = targetStorey.id;
      ceiling.storeyId = targetStorey.id;
      affected.add(slab.id); affected.add(ceiling.id);
      if (elevationDelta !== 0) {
        ceiling.elevationMm += elevationDelta;
        nextInterior.lights.filter(light => light.spaceId === space.id).forEach(light => { light.positionMm[2] += elevationDelta; affected.add(light.id); });
        nextInterior.ceilingSystems?.filter(system => system.spaceId === space.id).forEach(system => { system.elevationMm += elevationDelta; affected.add(system.id); });
        nextArchitecture.serviceOpenings?.filter(opening => {
          const hostWall = movedWallIds.has(opening.hostId);
          const hostSlab = opening.hostId === slab.id;
          return hostWall || hostSlab;
        }).forEach(opening => { opening.centerMm = [opening.centerMm[0], opening.centerMm[1], opening.centerMm[2] + elevationDelta]; affected.add(opening.id); });
      }
      nextArchitecture.openings.filter(opening => movedWallIds.has(opening.hostWallId)).forEach(opening => affected.add(opening.id));
      nextInterior.furniture.filter(item => item.spaceId === space.id).forEach(item => affected.add(item.id));
      nextInterior.finishes.filter(item => item.spaceId === space.id).forEach(item => affected.add(item.id));
      nextInterior.millwork?.filter(item => item.spaceId === space.id).forEach(item => affected.add(item.id));
      nextInterior.acousticZones?.filter(item => item.spaceId === space.id).forEach(item => affected.add(item.id));
      nextArchitecture.shafts?.filter(shaft => shaft.hostSpaceIds.includes(space.id)).forEach(shaft => affected.add(shaft.id));
      nextArchitecture.zones?.filter(zone => zone.spaceIds.includes(space.id)).forEach(zone => affected.add(zone.id));
      invalidated.add('level_relationships');
    }
    invalidated.add('space_boundary'); invalidated.add('egress'); invalidated.add('door_swing'); invalidated.add('furniture_clearance'); invalidated.add('lighting'); invalidated.add('mep_interference'); invalidated.add('quantity_schedule');
  } else if (edit.kind === 'create_opening') {
    if (nextArchitecture.openings.some(item => item.id === edit.opening.id)) throw new Error(`Duplicate opening ${edit.opening.id}.`);
    const wall = nextArchitecture.walls.find(item => item.id === edit.opening.hostWallId); if (!wall) throw new Error('Opening host wall is missing.');
    const point = wallPoint(wall, edit.opening.offsetMm);
    nextArchitecture.openings.push({ ...structuredClone(edit.opening), positionMm: [point[0], point[1], edit.opening.sillMm] }); affected.add(edit.opening.id); invalidated.add('door_swing'); invalidated.add('space_boundary'); invalidated.add('furniture_clearance');
  } else if (edit.kind === 'create_grid') {
    if (nextArchitecture.grids?.some(item => item.id === edit.grid.id)) throw new Error(`Duplicate grid ${edit.grid.id}.`);
    if (!nextArchitecture.storeys.length) throw new Error('Grid requires a document with at least one storey.');
    if (!validGridGeometry(edit.grid)) throw new Error('Invalid grid name, axis, or line geometry.');
    nextArchitecture.grids = [...(nextArchitecture.grids ?? []), structuredClone(edit.grid)]; affected.add(edit.grid.id); invalidated.add('grid_relationships');
  } else if (edit.kind === 'edit_grid') {
    const grid = nextArchitecture.grids?.find(item => item.id === edit.gridId);
    if (!grid) throw new Error(`Unknown grid ${edit.gridId}.`);
    const hasPatch = edit.name !== undefined || edit.axis !== undefined || edit.startMm !== undefined || edit.endMm !== undefined;
    if (!hasPatch) throw new Error('Grid edit requires a supported field.');
    const nextGrid: ArchitectureGridLine = {
      ...grid,
      ...(edit.name !== undefined ? { name: edit.name } : {}),
      ...(edit.axis !== undefined ? { axis: edit.axis } : {}),
      ...(edit.startMm !== undefined ? { startMm: structuredClone(edit.startMm) } : {}),
      ...(edit.endMm !== undefined ? { endMm: structuredClone(edit.endMm) } : {}),
    };
    if (JSON.stringify(nextGrid) === JSON.stringify(grid)) throw new Error('Grid edit is a no-op.');
    if (!validGridGeometry(nextGrid)) throw new Error('Invalid grid name, axis, or line geometry.');
    Object.assign(grid, nextGrid); affected.add(grid.id); invalidated.add('grid_relationships');
  } else if (edit.kind === 'create_stair') {
    if (nextArchitecture.stairs?.some(item => item.id === edit.stair.id)) throw new Error(`Duplicate stair ${edit.stair.id}.`);
    const fromStorey = nextArchitecture.storeys.find(item => item.id === edit.stair.fromStoreyId);
    const toStorey = nextArchitecture.storeys.find(item => item.id === edit.stair.toStoreyId);
    if (!fromStorey || !toStorey) throw new Error('Stair from/to storey is missing.');
    if (fromStorey.id === toStorey.id) throw new Error('Stair from/to storeys must differ.');
    if (!positive(edit.stair.widthMm) || !Number.isSafeInteger(edit.stair.riserCount) || edit.stair.riserCount < 1 || !positive(edit.stair.treadDepthMm) || !Array.isArray(edit.stair.pathMm) || edit.stair.pathMm.length < 2 || edit.stair.pathMm.some(point => !finite3(point))) throw new Error('Invalid stair geometry or parameters.');
    if (edit.stair.pathMm[0]![2] !== fromStorey.elevationMm || edit.stair.pathMm[edit.stair.pathMm.length - 1]![2] !== toStorey.elevationMm) throw new Error('Stair path endpoints must bind to the from/to storey elevations.');
    nextArchitecture.stairs = [...(nextArchitecture.stairs ?? []), structuredClone(edit.stair)]; affected.add(edit.stair.id); invalidated.add('level_relationships'); invalidated.add('egress');
  } else if (edit.kind === 'create_shaft') {
    if (nextArchitecture.shafts?.some(item => item.id === edit.shaft.id)) throw new Error(`Duplicate shaft ${edit.shaft.id}.`);
    const fromStorey = nextArchitecture.storeys.find(item => item.id === edit.shaft.fromStoreyId);
    const toStorey = nextArchitecture.storeys.find(item => item.id === edit.shaft.toStoreyId);
    if (!fromStorey || !toStorey || toStorey.elevationMm <= fromStorey.elevationMm) throw new Error('Shaft must connect existing storeys in ascending elevation order.');
    if (!validShaftGeometry(edit.shaft)) throw new Error('Invalid shaft footprint or host-space binding.');
    if (edit.shaft.hostSpaceIds.some(spaceId => { const space = nextArchitecture.spaces.find(item => item.id === spaceId); return !space || (space.storeyId !== fromStorey.id && space.storeyId !== toStorey.id); })) throw new Error('Shaft host spaces must belong to its from/to storeys.');
    nextArchitecture.shafts = [...(nextArchitecture.shafts ?? []), structuredClone(edit.shaft)]; affected.add(edit.shaft.id); invalidated.add('level_relationships'); invalidated.add('egress'); invalidated.add('space_boundary');
  } else if (edit.kind === 'create_elevator') {
    if (nextArchitecture.elevators?.some(item => item.id === edit.elevator.id)) throw new Error(`Duplicate elevator ${edit.elevator.id}.`);
    if (!validElevatorBinding(nextArchitecture, edit.elevator)) throw new Error('Elevator shaft and served storeys must be valid and strictly ascending.');
    nextArchitecture.elevators = [...(nextArchitecture.elevators ?? []), structuredClone(edit.elevator)]; affected.add(edit.elevator.id); invalidated.add('level_relationships'); invalidated.add('egress');
  } else if (edit.kind === 'create_service_opening') {
    if (nextArchitecture.serviceOpenings?.some(item => item.id === edit.serviceOpening.id)) throw new Error(`Duplicate service opening ${edit.serviceOpening.id}.`);
    const host = nextArchitecture.walls.find(item => item.id === edit.serviceOpening.hostId) ?? nextArchitecture.slabs.find(item => item.id === edit.serviceOpening.hostId);
    if (!host) throw new Error('Service opening wall or slab host is missing.');
    if (edit.serviceOpening.shape !== 'round' || !finite3(edit.serviceOpening.centerMm) || !finite3(edit.serviceOpening.axis) || Math.abs(Math.hypot(...edit.serviceOpening.axis) - 1) > 1e-6 || !positive(edit.serviceOpening.cutDiameterMm) || !positive(edit.serviceOpening.depthMm) || !Number.isFinite(edit.serviceOpening.firestopAnnulusMm) || edit.serviceOpening.firestopAnnulusMm < 0 || !edit.serviceOpening.sourceRouteId.trim() || !edit.serviceOpening.sourceSleeveId.trim() || (edit.serviceOpening.structuralApprovalId !== undefined && !edit.serviceOpening.structuralApprovalId.trim())) throw new Error('Invalid service opening semantic reference or round geometry.');
    nextArchitecture.serviceOpenings = [...(nextArchitecture.serviceOpenings ?? []), structuredClone(edit.serviceOpening)]; affected.add(edit.serviceOpening.id); invalidated.add('mep_interference'); invalidated.add('ifc_roundtrip'); invalidated.add('quantity_schedule');
  } else if (edit.kind === 'create_furniture') {
    if (nextInterior.furniture.some(item => item.id === edit.furniture.id)) throw new Error(`Duplicate furniture ${edit.furniture.id}.`);
    const space = nextArchitecture.spaces.find(item => item.id === edit.furniture.spaceId);
    if (!space) throw new Error('Furniture host space is missing.');
    if (!furnitureEnvelopeInside(nextArchitecture, edit.furniture)) throw new Error('Furniture clearance envelope exceeds its space or storey.');
    nextInterior.furniture.push(structuredClone(edit.furniture)); affected.add(edit.furniture.id); invalidated.add('furniture_clearance'); invalidated.add('quantity_schedule');
  } else if (edit.kind === 'create_light') {
    if (nextInterior.lights.some(item => item.id === edit.light.id)) throw new Error(`Duplicate light ${edit.light.id}.`);
    const space = nextArchitecture.spaces.find(item => item.id === edit.light.spaceId);
    const ceiling = nextArchitecture.ceilings.find(item => item.id === edit.light.hostCeilingId);
    if (!space || !ceiling || space.ceilingId !== ceiling.id || ceiling.spaceId !== space.id) throw new Error('Light host ceiling and space must match.');
    if (!finite3(edit.light.positionMm) || edit.light.suspensionMm < 0 || !positive(edit.light.lumens) || !positive(edit.light.cctK) || !lightHostMatchesSpace(nextArchitecture, edit.light) || !lightElevationMatchesSuspension(nextArchitecture, edit.light)) throw new Error('Invalid light placement or photometric parameters.');
    nextInterior.lights.push(structuredClone(edit.light)); affected.add(edit.light.id); invalidated.add('lighting'); invalidated.add('mep_interference'); invalidated.add('quantity_schedule');
  } else if (edit.kind === 'create_finish') {
    if (nextInterior.finishes.some(item => item.id === edit.finish.id)) throw new Error(`Duplicate finish ${edit.finish.id}.`);
    const space = nextArchitecture.spaces.find(item => item.id === edit.finish.spaceId);
    if (!space || !finishHostMatchesSpace(nextArchitecture, edit.finish) || !edit.finish.material.trim()) throw new Error('Finish host, space, or material is invalid.');
    nextInterior.finishes.push(structuredClone(edit.finish)); affected.add(edit.finish.id); invalidated.add('quantity_schedule'); invalidated.add('material_schedule');
  } else if (edit.kind === 'create_millwork') {
    if (nextInterior.millwork?.some(item => item.id === edit.millwork.id)) throw new Error(`Duplicate millwork ${edit.millwork.id}.`);
    const space = nextArchitecture.spaces.find(item => item.id === edit.millwork.spaceId);
    const wall = edit.millwork.hostWallId ? nextArchitecture.walls.find(item => item.id === edit.millwork.hostWallId) : undefined;
    if (!space || (edit.millwork.hostWallId !== undefined && (!wall || wall.storeyId !== space.storeyId)) || !finite3(edit.millwork.positionMm) || !finite3(edit.millwork.sizeMm) || !edit.millwork.sizeMm.every(positive) || !edit.millwork.material.trim() || edit.millwork.clearanceMm < 0 || !millworkEnvelopeInside(nextArchitecture, edit.millwork)) throw new Error('Invalid millwork placement or host.');
    nextInterior.millwork = [...(nextInterior.millwork ?? []), structuredClone(edit.millwork)]; affected.add(edit.millwork.id); invalidated.add('furniture_clearance'); invalidated.add('quantity_schedule');
  } else if (edit.kind === 'create_ceiling_system') {
    if (nextInterior.ceilingSystems?.some(item => item.id === edit.ceilingSystem.id)) throw new Error(`Duplicate ceiling system ${edit.ceilingSystem.id}.`);
    const space = nextArchitecture.spaces.find(item => item.id === edit.ceilingSystem.spaceId);
    const ceiling = nextArchitecture.ceilings.find(item => item.id === edit.ceilingSystem.hostCeilingId);
    if (!space || !ceiling || !Number.isFinite(edit.ceilingSystem.elevationMm) || (edit.ceilingSystem.moduleMm !== undefined && (!finite2(edit.ceilingSystem.moduleMm) || !edit.ceilingSystem.moduleMm.every(positive))) || !ceilingSystemHostMatchesSpace(nextArchitecture, edit.ceilingSystem)) throw new Error('Invalid ceiling/RCP system host or module.');
    nextInterior.ceilingSystems = [...(nextInterior.ceilingSystems ?? []), structuredClone(edit.ceilingSystem)]; affected.add(edit.ceilingSystem.id); invalidated.add('lighting'); invalidated.add('mep_interference'); invalidated.add('quantity_schedule');
  } else if (edit.kind === 'set_space_boundary') {
    if (edit.boundaryMm.length < 3 || edit.boundaryMm.some(point => !finite2(point))) throw new Error('Space boundary requires at least three finite points.');
    const space = nextArchitecture.spaces.find(item => item.id === edit.spaceId); if (!space) throw new Error(`Unknown space ${edit.spaceId}.`);
    if (space.wallIds.length !== edit.boundaryMm.length) throw new Error('Changing boundary edge count requires an explicit wall topology edit.');
    space.boundaryMm = structuredClone(edit.boundaryMm); delete space.boundaryEdges; affected.add(space.id);
    space.wallIds.forEach((wallId, index) => { const wall = nextArchitecture.walls.find(item => item.id === wallId); if (!wall || wall.kind !== 'line') throw new Error('Automatic boundary regeneration supports line-wall loops only.'); wall.startMm = [...edit.boundaryMm[index]!] as V2; wall.endMm = [...edit.boundaryMm[(index + 1) % edit.boundaryMm.length]!] as V2; affected.add(wall.id); updateOpenings(wall); });
    const slab = nextArchitecture.slabs.find(item => item.id === space.slabId), ceiling = nextArchitecture.ceilings.find(item => item.id === space.ceilingId);
    if (!slab || !ceiling) throw new Error('Space slab or ceiling is missing.');
    slab.boundaryMm = structuredClone(edit.boundaryMm); ceiling.boundaryMm = structuredClone(edit.boundaryMm); affected.add(slab.id); affected.add(ceiling.id);
    invalidated.add('space_boundary'); invalidated.add('egress'); invalidated.add('door_swing'); invalidated.add('furniture_clearance');
  } else if (edit.kind === 'move_line_wall') {
    const wall = nextArchitecture.walls.find(item => item.id === edit.wallId); if (!wall || wall.kind !== 'line') throw new Error(`Unknown line wall ${edit.wallId}.`);
    wall.startMm = [...edit.startMm]; wall.endMm = [...edit.endMm]; affected.add(wall.id); updateOpenings(wall); invalidated.add('space_boundary'); invalidated.add('egress');
  } else if (edit.kind === 'set_arc_wall') {
    const wall = nextArchitecture.walls.find(item => item.id === edit.wallId); if (!wall || wall.kind !== 'arc') throw new Error(`Unknown arc wall ${edit.wallId}.`);
    wall.centerMm = [...edit.centerMm]; wall.radiusMm = edit.radiusMm; wall.startAngleDeg = edit.startAngleDeg; wall.endAngleDeg = edit.endAngleDeg; affected.add(wall.id); updateOpenings(wall); invalidated.add('facade_panelization'); invalidated.add('space_boundary');
  } else if (edit.kind === 'resize_wall') {
    const wall = nextArchitecture.walls.find(item => item.id === edit.wallId); if (!wall) throw new Error(`Unknown wall ${edit.wallId}.`);
    if (edit.thicknessMm === undefined && edit.heightMm === undefined) throw new Error('Wall resize requires thicknessMm or heightMm.');
    if (edit.thicknessMm !== undefined) { if (!positive(edit.thicknessMm)) throw new Error('Wall thickness must be positive.'); wall.thicknessMm = edit.thicknessMm; }
    if (edit.heightMm !== undefined) { if (!positive(edit.heightMm)) throw new Error('Wall height must be positive.'); wall.heightMm = edit.heightMm; }
    affected.add(wall.id); invalidated.add('space_boundary'); invalidated.add('quantity_schedule');
  } else if (edit.kind === 'edit_slab') {
    if (edit.thicknessMm === undefined && edit.boundaryMm === undefined) throw new Error('Slab edit requires thicknessMm or boundaryMm.');
    const slab = nextArchitecture.slabs.find(item => item.id === edit.slabId); if (!slab) throw new Error(`Unknown slab ${edit.slabId}.`);
    const space = nextArchitecture.spaces.find(item => item.id === slab.spaceId); if (!space) throw new Error(`Slab ${edit.slabId} has no owning space.`);
    if (edit.thicknessMm !== undefined) { if (!positive(edit.thicknessMm)) throw new Error('Slab thickness must be positive.'); slab.thicknessMm = edit.thicknessMm; }
    if (edit.boundaryMm !== undefined) {
      if (edit.boundaryMm.length < 3 || edit.boundaryMm.some(point => !finite2(point)) || edit.boundaryMm.length !== space.wallIds.length) throw new Error('Slab boundary must match the owning space wall loop.');
      space.boundaryMm = structuredClone(edit.boundaryMm); delete space.boundaryEdges; slab.boundaryMm = structuredClone(edit.boundaryMm);
      const ceiling = nextArchitecture.ceilings.find(item => item.id === space.ceilingId); if (!ceiling) throw new Error('Space ceiling is missing.'); ceiling.boundaryMm = structuredClone(edit.boundaryMm);
      space.wallIds.forEach((wallId, index) => { const wall = nextArchitecture.walls.find(item => item.id === wallId); if (!wall || wall.kind !== 'line') throw new Error('Slab boundary regeneration supports line-wall loops only.'); wall.startMm = [...edit.boundaryMm![index]!] as V2; wall.endMm = [...edit.boundaryMm![(index + 1) % edit.boundaryMm!.length]!] as V2; affected.add(wall.id); updateOpenings(wall); }); affected.add(space.id); affected.add(ceiling.id);
      invalidated.add('space_boundary'); invalidated.add('egress'); invalidated.add('furniture_clearance');
    }
    affected.add(slab.id); invalidated.add('quantity_schedule');
  } else if (edit.kind === 'edit_opening') {
    if ([edit.offsetMm, edit.widthMm, edit.heightMm, edit.sillMm].every(value => value === undefined)) throw new Error('Opening edit requires bound geometry.');
    const opening = nextArchitecture.openings.find(item => item.id === edit.openingId); if (!opening) throw new Error(`Unknown opening ${edit.openingId}.`);
    if (edit.offsetMm !== undefined) opening.offsetMm = edit.offsetMm; if (edit.widthMm !== undefined) opening.widthMm = edit.widthMm; if (edit.heightMm !== undefined) opening.heightMm = edit.heightMm; if (edit.sillMm !== undefined) opening.sillMm = edit.sillMm;
    const wall = nextArchitecture.walls.find(item => item.id === opening.hostWallId); if (!wall) throw new Error('Opening host wall is missing.'); const point = wallPoint(wall, opening.offsetMm); opening.positionMm = [point[0], point[1], opening.sillMm];
    affected.add(opening.id); invalidated.add('door_swing'); invalidated.add('space_boundary'); invalidated.add('furniture_clearance'); invalidated.add('quantity_schedule');
  } else if (edit.kind === 'edit_stair') {
    const stair = nextArchitecture.stairs?.find(item => item.id === edit.stairId);
    if (!stair) throw new Error(`Unknown stair ${edit.stairId}.`);
    const hasPatch = edit.fromStoreyId !== undefined || edit.toStoreyId !== undefined || edit.widthMm !== undefined || edit.riserCount !== undefined || edit.treadDepthMm !== undefined || edit.pathMm !== undefined;
    if (!hasPatch) throw new Error('Stair edit requires a supported field.');
    const nextStair = { ...stair,
      ...(edit.fromStoreyId !== undefined ? { fromStoreyId: edit.fromStoreyId } : {}),
      ...(edit.toStoreyId !== undefined ? { toStoreyId: edit.toStoreyId } : {}),
      ...(edit.widthMm !== undefined ? { widthMm: edit.widthMm } : {}),
      ...(edit.riserCount !== undefined ? { riserCount: edit.riserCount } : {}),
      ...(edit.treadDepthMm !== undefined ? { treadDepthMm: edit.treadDepthMm } : {}),
      ...(edit.pathMm !== undefined ? { pathMm: structuredClone(edit.pathMm) } : {}),
    };
    if (JSON.stringify(nextStair) === JSON.stringify(stair)) throw new Error('Stair edit is a no-op.');
    const fromStorey = nextArchitecture.storeys.find(item => item.id === nextStair.fromStoreyId);
    const toStorey = nextArchitecture.storeys.find(item => item.id === nextStair.toStoreyId);
    if (!fromStorey || !toStorey) throw new Error('Stair from/to storey is missing.');
    if (fromStorey.id === toStorey.id) throw new Error('Stair from/to storeys must differ.');
    if (!positive(nextStair.widthMm) || !Number.isSafeInteger(nextStair.riserCount) || nextStair.riserCount < 1 || !positive(nextStair.treadDepthMm) || !Array.isArray(nextStair.pathMm) || nextStair.pathMm.length < 2 || nextStair.pathMm.some(point => !finite3(point))) throw new Error('Invalid stair geometry or parameters.');
    if (nextStair.pathMm[0]![2] !== fromStorey.elevationMm || nextStair.pathMm[nextStair.pathMm.length - 1]![2] !== toStorey.elevationMm) throw new Error('Stair path endpoints must bind to the from/to storey elevations.');
    Object.assign(stair, nextStair); affected.add(stair.id); invalidated.add('level_relationships'); invalidated.add('egress');
  } else if (edit.kind === 'edit_shaft') {
    const shaft = nextArchitecture.shafts?.find(item => item.id === edit.shaftId);
    if (!shaft) throw new Error(`Unknown shaft ${edit.shaftId}.`);
    const hasPatch = edit.fromStoreyId !== undefined || edit.toStoreyId !== undefined || edit.boundaryMm !== undefined || edit.hostSpaceIds !== undefined;
    if (!hasPatch) throw new Error('Shaft edit requires a supported field.');
    const nextShaft: ArchitectureShaft = { ...shaft,
      ...(edit.fromStoreyId !== undefined ? { fromStoreyId: edit.fromStoreyId } : {}),
      ...(edit.toStoreyId !== undefined ? { toStoreyId: edit.toStoreyId } : {}),
      ...(edit.boundaryMm !== undefined ? { boundaryMm: structuredClone(edit.boundaryMm) } : {}),
      ...(edit.hostSpaceIds !== undefined ? { hostSpaceIds: structuredClone(edit.hostSpaceIds) } : {}),
    };
    if (JSON.stringify(nextShaft) === JSON.stringify(shaft)) throw new Error('Shaft edit is a no-op.');
    const fromStorey = nextArchitecture.storeys.find(item => item.id === nextShaft.fromStoreyId);
    const toStorey = nextArchitecture.storeys.find(item => item.id === nextShaft.toStoreyId);
    if (!fromStorey || !toStorey || toStorey.elevationMm <= fromStorey.elevationMm || !validShaftGeometry(nextShaft)) throw new Error('Invalid shaft footprint or ascending storey binding.');
    if (nextShaft.hostSpaceIds.some(spaceId => { const space = nextArchitecture.spaces.find(item => item.id === spaceId); return !space || (space.storeyId !== fromStorey.id && space.storeyId !== toStorey.id); })) throw new Error('Shaft host spaces must belong to its from/to storeys.');
    Object.assign(shaft, nextShaft); affected.add(shaft.id); invalidated.add('level_relationships'); invalidated.add('egress'); invalidated.add('space_boundary');
  } else if (edit.kind === 'edit_elevator') {
    const elevator = nextArchitecture.elevators?.find(item => item.id === edit.elevatorId);
    if (!elevator) throw new Error(`Unknown elevator ${edit.elevatorId}.`);
    const hasPatch = edit.shaftId !== undefined || edit.servedStoreyIds !== undefined;
    if (!hasPatch) throw new Error('Elevator edit requires a supported field.');
    const nextElevator: ArchitectureElevator = { ...elevator,
      ...(edit.shaftId !== undefined ? { shaftId: edit.shaftId } : {}),
      ...(edit.servedStoreyIds !== undefined ? { servedStoreyIds: structuredClone(edit.servedStoreyIds) } : {}),
    };
    if (JSON.stringify(nextElevator) === JSON.stringify(elevator)) throw new Error('Elevator edit is a no-op.');
    if (!validElevatorBinding(nextArchitecture, nextElevator)) throw new Error('Elevator shaft and served storeys must be valid and strictly ascending.');
    Object.assign(elevator, nextElevator); affected.add(elevator.id); invalidated.add('level_relationships'); invalidated.add('egress');
  } else if (edit.kind === 'edit_service_opening') {
    const serviceOpening = nextArchitecture.serviceOpenings?.find(item => item.id === edit.serviceOpeningId);
    if (!serviceOpening) throw new Error(`Unknown service opening ${edit.serviceOpeningId}.`);
    const hasPatch = edit.hostId !== undefined || edit.sourceRouteId !== undefined || edit.sourceSleeveId !== undefined || edit.centerMm !== undefined || edit.axis !== undefined || edit.cutDiameterMm !== undefined || edit.depthMm !== undefined || edit.firestopAnnulusMm !== undefined || edit.structuralApprovalId !== undefined;
    if (!hasPatch) throw new Error('Service opening edit requires a supported field.');
    const nextServiceOpening: ArchitectureServiceOpening = { ...serviceOpening,
      ...(edit.hostId !== undefined ? { hostId: edit.hostId } : {}),
      ...(edit.sourceRouteId !== undefined ? { sourceRouteId: edit.sourceRouteId } : {}),
      ...(edit.sourceSleeveId !== undefined ? { sourceSleeveId: edit.sourceSleeveId } : {}),
      ...(edit.centerMm !== undefined ? { centerMm: structuredClone(edit.centerMm) } : {}),
      ...(edit.axis !== undefined ? { axis: structuredClone(edit.axis) } : {}),
      ...(edit.cutDiameterMm !== undefined ? { cutDiameterMm: edit.cutDiameterMm } : {}),
      ...(edit.depthMm !== undefined ? { depthMm: edit.depthMm } : {}),
      ...(edit.firestopAnnulusMm !== undefined ? { firestopAnnulusMm: edit.firestopAnnulusMm } : {}),
      ...(edit.structuralApprovalId !== undefined ? { structuralApprovalId: edit.structuralApprovalId } : {}),
    };
    if (JSON.stringify(nextServiceOpening) === JSON.stringify(serviceOpening)) throw new Error('Service opening edit is a no-op.');
    const host = nextArchitecture.walls.find(item => item.id === nextServiceOpening.hostId) ?? nextArchitecture.slabs.find(item => item.id === nextServiceOpening.hostId);
    if (!host || nextServiceOpening.shape !== 'round' || !finite3(nextServiceOpening.centerMm) || !finite3(nextServiceOpening.axis) || Math.abs(Math.hypot(...nextServiceOpening.axis) - 1) > 1e-6 || !positive(nextServiceOpening.cutDiameterMm) || !positive(nextServiceOpening.depthMm) || !Number.isFinite(nextServiceOpening.firestopAnnulusMm) || nextServiceOpening.firestopAnnulusMm < 0 || !nextServiceOpening.sourceRouteId.trim() || !nextServiceOpening.sourceSleeveId.trim() || (nextServiceOpening.structuralApprovalId !== undefined && !nextServiceOpening.structuralApprovalId.trim())) throw new Error('Invalid service opening semantic reference or round geometry.');
    Object.assign(serviceOpening, nextServiceOpening); affected.add(serviceOpening.id); invalidated.add('mep_interference'); invalidated.add('ifc_roundtrip'); invalidated.add('quantity_schedule');
  } else if (edit.kind === 'edit_ceiling') {
    if (edit.elevationMm === undefined && edit.thicknessMm === undefined) throw new Error('Ceiling edit requires elevationMm or thicknessMm.');
    const ceiling = nextArchitecture.ceilings.find(item => item.id === edit.ceilingId); if (!ceiling) throw new Error(`Unknown ceiling ${edit.ceilingId}.`);
    if (edit.elevationMm !== undefined) { if (!Number.isFinite(edit.elevationMm)) throw new Error('Ceiling elevation must be finite.'); ceiling.elevationMm = edit.elevationMm; nextInterior.lights.filter(item => item.hostCeilingId === ceiling.id).forEach(light => { light.positionMm[2] = ceiling.elevationMm - light.suspensionMm; affected.add(light.id); }); }
    if (edit.thicknessMm !== undefined) { if (!positive(edit.thicknessMm)) throw new Error('Ceiling thickness must be positive.'); ceiling.thicknessMm = edit.thicknessMm; }
    affected.add(ceiling.id); invalidated.add('lighting'); invalidated.add('mep_interference'); invalidated.add('quantity_schedule');
  } else if (edit.kind === 'edit_furniture') {
    if ([edit.positionMm, edit.sizeMm, edit.clearanceMm, edit.rotationDeg].every(value => value === undefined)) throw new Error('Furniture edit requires a supported field.');
    const furniture = nextInterior.furniture.find(item => item.id === edit.furnitureId); if (!furniture) throw new Error(`Unknown furniture ${edit.furnitureId}.`);
    if (edit.positionMm !== undefined) { if (!finite3(edit.positionMm)) throw new Error('Furniture position must be finite.'); furniture.positionMm = [...edit.positionMm]; }
    if (edit.sizeMm !== undefined) { if (!finite3(edit.sizeMm) || !edit.sizeMm.every(positive)) throw new Error('Furniture size must be positive.'); furniture.sizeMm = [...edit.sizeMm]; }
    if (edit.clearanceMm !== undefined) { if (!Number.isFinite(edit.clearanceMm) || edit.clearanceMm < 0) throw new Error('Furniture clearance must be non-negative.'); furniture.clearanceMm = edit.clearanceMm; }
    if (edit.rotationDeg !== undefined) { if (!Number.isFinite(edit.rotationDeg)) throw new Error('Furniture rotation must be finite.'); furniture.rotationDeg = edit.rotationDeg; }
    if (!furnitureEnvelopeInside(nextArchitecture, furniture)) throw new Error('Furniture clearance envelope exceeds its space or storey.');
    affected.add(furniture.id); invalidated.add('furniture_clearance'); invalidated.add('quantity_schedule');
  } else if (edit.kind === 'edit_light') {
    if ([edit.positionMm, edit.suspensionMm, edit.lumens, edit.cctK].every(value => value === undefined)) throw new Error('Light edit requires a supported field.');
    const light = nextInterior.lights.find(item => item.id === edit.lightId); if (!light) throw new Error(`Unknown light ${edit.lightId}.`);
    if (edit.positionMm !== undefined) { if (!finite3(edit.positionMm)) throw new Error('Light position must be finite.'); light.positionMm = [...edit.positionMm]; }
    if (edit.suspensionMm !== undefined) { if (!Number.isFinite(edit.suspensionMm) || edit.suspensionMm < 0) throw new Error('Light suspension must be non-negative.'); light.suspensionMm = edit.suspensionMm; }
    if (edit.suspensionMm !== undefined && edit.positionMm === undefined) { const ceiling = nextArchitecture.ceilings.find(item => item.id === light.hostCeilingId); if (!ceiling) throw new Error('Light host ceiling is missing.'); light.positionMm[2] = ceiling.elevationMm - light.suspensionMm; }
    if (edit.lumens !== undefined) { if (!positive(edit.lumens)) throw new Error('Light lumens must be positive.'); light.lumens = edit.lumens; }
    if (edit.cctK !== undefined) { if (!positive(edit.cctK)) throw new Error('Light CCT must be positive.'); light.cctK = edit.cctK; }
    if (!lightHostMatchesSpace(nextArchitecture, light) || !lightElevationMatchesSuspension(nextArchitecture, light)) throw new Error('Light position and suspension must remain bound to its host ceiling and space.');
    affected.add(light.id); invalidated.add('lighting'); invalidated.add('mep_interference'); invalidated.add('quantity_schedule');
  } else if (edit.kind === 'edit_finish') {
    if ([edit.hostId, edit.surface, edit.material].every(value => value === undefined)) throw new Error('Finish edit requires a supported field.');
    const finish = nextInterior.finishes.find(item => item.id === edit.finishId); if (!finish) throw new Error(`Unknown finish ${edit.finishId}.`);
    const nextSurface = edit.surface ?? finish.surface; const nextHost = edit.hostId ?? finish.hostId;
    const candidateFinish = { ...finish, hostId: nextHost, surface: nextSurface, ...(edit.material !== undefined ? { material: edit.material } : {}) };
    if (JSON.stringify(candidateFinish) === JSON.stringify(finish)) throw new Error('Finish edit is a no-op.');
    if (!finishHostMatchesSpace(nextArchitecture, candidateFinish)) throw new Error('Finish host does not belong to its declared space and surface kind.');
    if (!candidateFinish.material.trim()) throw new Error('Finish material must not be empty.');
    Object.assign(finish, candidateFinish);
    affected.add(finish.id); invalidated.add('quantity_schedule'); invalidated.add('material_schedule');
  } else if (edit.kind === 'edit_millwork') {
    if ([edit.spaceId, edit.hostWallId, edit.positionMm, edit.sizeMm, edit.material, edit.clearanceMm].every(value => value === undefined)) throw new Error('Millwork edit requires a supported field.');
    const millwork = nextInterior.millwork?.find(item => item.id === edit.millworkId); if (!millwork) throw new Error(`Unknown millwork ${edit.millworkId}.`);
    const candidateMillwork = {
      ...millwork,
      ...(edit.spaceId !== undefined ? { spaceId: edit.spaceId } : {}),
      ...(edit.hostWallId !== undefined ? { hostWallId: edit.hostWallId } : {}),
      ...(edit.positionMm !== undefined ? { positionMm: [...edit.positionMm] as V3 } : {}),
      ...(edit.sizeMm !== undefined ? { sizeMm: [...edit.sizeMm] as V3 } : {}),
      ...(edit.material !== undefined ? { material: edit.material } : {}),
      ...(edit.clearanceMm !== undefined ? { clearanceMm: edit.clearanceMm } : {}),
    };
    if (JSON.stringify(candidateMillwork) === JSON.stringify(millwork)) throw new Error('Millwork edit is a no-op.');
    const millworkSpace = nextArchitecture.spaces.find(item => item.id === candidateMillwork.spaceId); const millworkWall = candidateMillwork.hostWallId ? nextArchitecture.walls.find(item => item.id === candidateMillwork.hostWallId) : undefined;
    if (!millworkSpace || (candidateMillwork.hostWallId !== undefined && (!millworkWall || millworkWall.storeyId !== millworkSpace.storeyId || !millworkSpace.wallIds.includes(candidateMillwork.hostWallId)))) throw new Error('Millwork space and host wall must share an exact space boundary and storey.');
    if (!finite3(candidateMillwork.positionMm)) throw new Error('Millwork position must be finite.');
    if (!finite3(candidateMillwork.sizeMm) || !candidateMillwork.sizeMm.every(positive)) throw new Error('Millwork size must be positive.');
    if (!candidateMillwork.material.trim()) throw new Error('Millwork material must not be empty.');
    if (!Number.isFinite(candidateMillwork.clearanceMm) || candidateMillwork.clearanceMm < 0) throw new Error('Millwork clearance must be non-negative.');
    if (!millworkEnvelopeInside(nextArchitecture, candidateMillwork)) throw new Error('Millwork clearance envelope exceeds its declared space.');
    Object.assign(millwork, candidateMillwork);
    affected.add(millwork.id); invalidated.add('furniture_clearance'); invalidated.add('quantity_schedule');
  } else if (edit.kind === 'edit_ceiling_system') {
    if ([edit.kindCode, edit.elevationMm, edit.moduleMm].every(value => value === undefined)) throw new Error('Ceiling system edit requires a supported field.');
    const system = nextInterior.ceilingSystems?.find(item => item.id === edit.ceilingSystemId); if (!system) throw new Error(`Unknown ceiling system ${edit.ceilingSystemId}.`);
    if (edit.kindCode !== undefined) system.kind = edit.kindCode;
    if (edit.elevationMm !== undefined) { if (!Number.isFinite(edit.elevationMm)) throw new Error('Ceiling system elevation must be finite.'); system.elevationMm = edit.elevationMm; }
    if (edit.moduleMm !== undefined) { if (!finite2(edit.moduleMm) || !edit.moduleMm.every(positive)) throw new Error('Ceiling system module must be positive.'); system.moduleMm = [...edit.moduleMm]; }
    if (!ceilingSystemHostMatchesSpace(nextArchitecture, system)) throw new Error('Ceiling system must remain below its exact host ceiling and use a required module.');
    affected.add(system.id); invalidated.add('lighting'); invalidated.add('mep_interference'); invalidated.add('quantity_schedule');
  } else {
    const ceiling = nextArchitecture.ceilings.find(item => item.id === edit.ceilingId); if (!ceiling) throw new Error(`Unknown ceiling ${edit.ceilingId}.`);
    ceiling.elevationMm = edit.elevationMm; affected.add(ceiling.id);
    nextInterior.lights.filter(item => item.hostCeilingId === ceiling.id).forEach(light => { light.positionMm[2] = ceiling.elevationMm - light.suspensionMm; affected.add(light.id); });
    invalidated.add('lighting'); invalidated.add('mep_interference');
  }
  const architectureIds = new Set([...nextArchitecture.storeys, ...nextArchitecture.spaces, ...nextArchitecture.walls, ...nextArchitecture.slabs, ...nextArchitecture.ceilings, ...nextArchitecture.openings, ...(nextArchitecture.serviceOpenings ?? []), ...(nextArchitecture.grids ?? []), ...(nextArchitecture.roofs ?? []), ...(nextArchitecture.stairs ?? []), ...(nextArchitecture.shafts ?? []), ...(nextArchitecture.elevators ?? []), ...(nextArchitecture.zones ?? [])].map(item => item.id));
  const interiorIds = new Set([...nextInterior.lights, ...nextInterior.furniture, ...nextInterior.finishes, ...(nextInterior.millwork ?? []), ...(nextInterior.ceilingSystems ?? []), ...(nextInterior.acousticZones ?? [])].map(item => item.id));
  if ([...affected].some(id => architectureIds.has(id))) nextArchitecture.revision++;
  if ([...affected].some(id => interiorIds.has(id))) nextInterior.revision++;
  const issues = [...validateArchitectureDocument(nextArchitecture), ...validateInteriorDocument(nextInterior, nextArchitecture)];
  if (issues.length) throw new Error(issues.join(' '));
  return { architecture: nextArchitecture, interior: nextInterior, affectedObjectIds: [...affected], invalidatedChecks: [...invalidated] };
}

export function architectureInteriorBoundariesMatch(architecture: ArchitectureDocument): boolean {
  return architecture.spaces.every(space => sameBoundary(space.boundaryMm, architecture.slabs.find(item => item.id === space.slabId)?.boundaryMm ?? []) && sameBoundary(space.boundaryMm, architecture.ceilings.find(item => item.id === space.ceilingId)?.boundaryMm ?? []));
}
