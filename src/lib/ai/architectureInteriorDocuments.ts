type V2 = [number, number];
type V3 = [number, number, number];

export interface ArchitectureStorey { id: string; name: string; elevationMm: number; heightMm: number }
export type ArchitectureBoundaryEdge =
  | { kind: 'line'; startMm: V2; endMm: V2 }
  | { kind: 'arc'; centerMm: V2; radiusMm: number; startAngleDeg: number; endAngleDeg: number };
export interface ArchitectureSpace { id: string; storeyId: string; name: string; usage: string; boundaryMm: V2[]; boundaryEdges?: ArchitectureBoundaryEdge[]; wallIds: string[]; slabId: string; ceilingId: string }
export type ArchitectureWall =
  | { id: string; kind: 'line'; storeyId: string; startMm: V2; endMm: V2; thicknessMm: number; heightMm: number }
  | { id: string; kind: 'arc'; storeyId: string; centerMm: V2; radiusMm: number; startAngleDeg: number; endAngleDeg: number; thicknessMm: number; heightMm: number };
export interface ArchitectureSlab { id: string; storeyId: string; spaceId: string; boundaryMm: V2[]; thicknessMm: number }
export interface ArchitectureCeiling { id: string; storeyId: string; spaceId: string; boundaryMm: V2[]; elevationMm: number }
export interface ArchitectureOpening { id: string; kind: 'window' | 'door'; hostWallId: string; offsetMm: number; widthMm: number; heightMm: number; sillMm: number; positionMm: V3; connectsSpaceIds?: string[]; isExit?: boolean; doorOperation?: { pivotMm: V2; closedAngleDeg: number; openAngleDeg: number; leafThicknessMm: number; requiredClearanceMm?: number } }
export interface ArchitectureServiceOpening { id: string; hostId: string; sourceRouteId: string; sourceSleeveId: string; shape: 'round'; centerMm: V3; axis: V3; cutDiameterMm: number; depthMm: number; firestopAnnulusMm: number; structuralApprovalId?: string }
export interface ArchitectureDocument {
  schema: 'nexyfab.architecture.v1'; revision: number; storeys: ArchitectureStorey[]; spaces: ArchitectureSpace[]; walls: ArchitectureWall[]; slabs: ArchitectureSlab[]; ceilings: ArchitectureCeiling[]; openings: ArchitectureOpening[]; serviceOpenings?: ArchitectureServiceOpening[];
}

export interface InteriorLight { id: string; spaceId: string; hostCeilingId: string; positionMm: V3; suspensionMm: number; lumens: number; cctK: number; iesProfileId?: string; yawDeg?: number; worldToPhotometricQuaternion?: { x: number; y: number; z: number; w: number } }
export interface InteriorFurniture { id: string; spaceId: string; positionMm: V3; sizeMm: V3; clearanceMm: number; rotationDeg?: number }
export interface InteriorFinish { id: string; spaceId: string; hostId: string; surface: 'floor' | 'wall' | 'ceiling'; material: string }
export interface InteriorDocument { schema: 'nexyfab.interior.v1'; revision: number; architectureDocumentId: string; lights: InteriorLight[]; furniture: InteriorFurniture[]; finishes: InteriorFinish[] }

export type ArchitectureEdit =
  | { kind: 'set_space_boundary'; spaceId: string; boundaryMm: V2[] }
  | { kind: 'move_line_wall'; wallId: string; startMm: V2; endMm: V2 }
  | { kind: 'set_arc_wall'; wallId: string; centerMm: V2; radiusMm: number; startAngleDeg: number; endAngleDeg: number }
  | { kind: 'set_ceiling_elevation'; ceilingId: string; elevationMm: number };

export interface ArchitectureInteriorEditResult {
  architecture: ArchitectureDocument; interior: InteriorDocument; affectedObjectIds: string[]; invalidatedChecks: string[];
}

const finite2 = (point: V2) => point.length === 2 && point.every(Number.isFinite);
const finite3 = (point: V3) => point.length === 3 && point.every(Number.isFinite);
const positive = (value: number) => Number.isFinite(value) && value > 0;
const sameBoundary = (a: V2[], b: V2[]) => a.length === b.length && a.every((point, index) => point[0] === b[index]![0] && point[1] === b[index]![1]);

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
  document.ceilings.forEach(item => { register(item.id); if (!Number.isFinite(item.elevationMm) || item.boundaryMm.length < 3 || item.boundaryMm.some(point => !finite2(point))) issues.push(`${item.id}: invalid ceiling.`); });
  document.spaces.forEach(item => {
    register(item.id);
    if (item.boundaryMm.length < 3 || item.boundaryMm.some(point => !finite2(point)) || item.wallIds.length !== (item.boundaryEdges?.length ?? item.boundaryMm.length)) issues.push(`${item.id}: boundary and wall loop are inconsistent.`);
    if (item.boundaryEdges?.some(edge => edge.kind === 'line' ? !finite2(edge.startMm) || !finite2(edge.endMm) || Math.hypot(edge.endMm[0] - edge.startMm[0], edge.endMm[1] - edge.startMm[1]) === 0 : !finite2(edge.centerMm) || !positive(edge.radiusMm) || !Number.isFinite(edge.startAngleDeg) || !Number.isFinite(edge.endAngleDeg) || edge.startAngleDeg === edge.endAngleDeg)) issues.push(`${item.id}: invalid exact boundary edge geometry.`);
  });
  document.openings.forEach(item => { register(item.id); if (![item.offsetMm, item.widthMm, item.heightMm, item.sillMm].every(Number.isFinite) || item.offsetMm < 0 || item.sillMm < 0 || !positive(item.widthMm) || !positive(item.heightMm) || !finite3(item.positionMm)) issues.push(`${item.id}: invalid opening.`); });
  document.serviceOpenings?.forEach(item => { register(item.id); if (!item.hostId.trim() || !item.sourceRouteId.trim() || !item.sourceSleeveId.trim() || !finite3(item.centerMm) || !finite3(item.axis) || !positive(item.cutDiameterMm) || !positive(item.depthMm) || item.firestopAnnulusMm < 0 || Math.abs(Math.hypot(...item.axis) - 1) > 1e-6) issues.push(`${item.id}: invalid service opening.`); });
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
  return issues;
}

export function validateInteriorDocument(interior: InteriorDocument, architecture: ArchitectureDocument): string[] {
  const issues: string[] = [], ids = new Set<string>(), spaces = new Set(architecture.spaces.map(item => item.id)), ceilings = new Set(architecture.ceilings.map(item => item.id)), hosts = new Set([...architecture.walls.map(item => item.id), ...architecture.slabs.map(item => item.id), ...architecture.ceilings.map(item => item.id)]);
  const register = (id: string) => { if (!id.trim() || ids.has(id)) issues.push(`Duplicate or empty interior id ${id || '(empty)'}.`); ids.add(id); };
  if (interior.schema !== 'nexyfab.interior.v1' || !Number.isSafeInteger(interior.revision) || interior.revision < 0 || !interior.architectureDocumentId.trim()) issues.push('Invalid interior header.');
  interior.lights.forEach(item => { register(item.id); const quaternion = item.worldToPhotometricQuaternion; if (!spaces.has(item.spaceId) || !ceilings.has(item.hostCeilingId) || !finite3(item.positionMm) || item.suspensionMm < 0 || !positive(item.lumens) || !positive(item.cctK) || !Number.isFinite(item.yawDeg ?? 0) || (quaternion && ![quaternion.x, quaternion.y, quaternion.z, quaternion.w].every(Number.isFinite))) issues.push(`${item.id}: invalid light or architecture host.`); });
  interior.furniture.forEach(item => { register(item.id); if (!spaces.has(item.spaceId) || !finite3(item.positionMm) || !finite3(item.sizeMm) || !item.sizeMm.every(positive) || item.clearanceMm < 0 || !Number.isFinite(item.rotationDeg ?? 0)) issues.push(`${item.id}: invalid furniture or space.`); });
  interior.finishes.forEach(item => { register(item.id); if (!spaces.has(item.spaceId) || !hosts.has(item.hostId) || !item.material.trim()) issues.push(`${item.id}: invalid finish host or material.`); });
  return issues;
}

/** Regenerate only deterministic dependants; no space-planning geometry is guessed. */
export function applyArchitectureInteriorEdit(architecture: ArchitectureDocument, interior: InteriorDocument, edit: ArchitectureEdit): ArchitectureInteriorEditResult {
  const nextArchitecture = structuredClone(architecture), nextInterior = structuredClone(interior), affected = new Set<string>(), invalidated = new Set<string>(['ifc_roundtrip', 'placement']);
  const updateOpenings = (wall: ArchitectureWall) => nextArchitecture.openings.filter(item => item.hostWallId === wall.id).forEach(opening => { const point = wallPoint(wall, opening.offsetMm); opening.positionMm = [point[0], point[1], opening.sillMm]; affected.add(opening.id); });
  if (edit.kind === 'set_space_boundary') {
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
  } else {
    const ceiling = nextArchitecture.ceilings.find(item => item.id === edit.ceilingId); if (!ceiling) throw new Error(`Unknown ceiling ${edit.ceilingId}.`);
    ceiling.elevationMm = edit.elevationMm; affected.add(ceiling.id);
    nextInterior.lights.filter(item => item.hostCeilingId === ceiling.id).forEach(light => { light.positionMm[2] = ceiling.elevationMm - light.suspensionMm; affected.add(light.id); });
    invalidated.add('lighting'); invalidated.add('mep_interference');
  }
  const architectureIds = new Set([...nextArchitecture.storeys, ...nextArchitecture.spaces, ...nextArchitecture.walls, ...nextArchitecture.slabs, ...nextArchitecture.ceilings, ...nextArchitecture.openings, ...(nextArchitecture.serviceOpenings ?? [])].map(item => item.id));
  const interiorIds = new Set([...nextInterior.lights, ...nextInterior.furniture, ...nextInterior.finishes].map(item => item.id));
  if ([...affected].some(id => architectureIds.has(id))) nextArchitecture.revision++;
  if ([...affected].some(id => interiorIds.has(id))) nextInterior.revision++;
  const issues = [...validateArchitectureDocument(nextArchitecture), ...validateInteriorDocument(nextInterior, nextArchitecture)];
  if (issues.length) throw new Error(issues.join(' '));
  return { architecture: nextArchitecture, interior: nextInterior, affectedObjectIds: [...affected], invalidatedChecks: [...invalidated] };
}

export function architectureInteriorBoundariesMatch(architecture: ArchitectureDocument): boolean {
  return architecture.spaces.every(space => sameBoundary(space.boundaryMm, architecture.slabs.find(item => item.id === space.slabId)?.boundaryMm ?? []) && sameBoundary(space.boundaryMm, architecture.ceilings.find(item => item.id === space.ceilingId)?.boundaryMm ?? []));
}
