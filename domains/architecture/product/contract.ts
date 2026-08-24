import { createHash } from 'node:crypto';

/**
 * A building contract is deliberately a data contract, not a code catalogue.
 * Jurisdictional values are supplied by an approved authority and are never
 * embedded here as copied regulations or design defaults.
 */
export const BUILDING_PRODUCT_CONTRACT_SCHEMA = 'nexyfab.building.two-storey-small-commercial-core.v1' as const;

export type BuildingRevision = { id: string; sha256: string };
export type BuildingUnits = { length: 'mm'; area: 'm2'; volume: 'm3'; angle: 'deg'; force: 'kN'; pressure: 'kPa' };
export type BuildingPoint = { x: number; y: number };
export type BuildingElementKind = 'level' | 'grid' | 'space' | 'wall' | 'slab' | 'roof' | 'envelope-layer' | 'door' | 'window' | 'stair' | 'egress-route' | 'service-opening';
export type BuildingElementProvenance = {
  sourceId: string; sourceRef: string; contentSha256: string; rightsReceiptSha256: string;
  origin: 'ORIGINAL' | 'LICENSED' | 'CLIENT_PROVIDED' | 'PUBLIC_STANDARD_FACT';
  rightsStatus: 'APPROVED'; authorityStatus: 'APPROVED';
};
export type BuildingElementBase = { id: string; sourceRevision: BuildingRevision; contentSha256: string; provenance: BuildingElementProvenance };

export interface BuildingSiteAuthority extends BuildingElementProvenance {
  sourceRevision: BuildingRevision;
  coordinateReferenceSystem: string;
  horizontalDatum: string;
  verticalDatum: string;
  epoch: string;
  projectNorthDeg: number;
  siteBoundary: BuildingPoint[];
}

export type BuildingRequirementAuthority = {
  sourceRevision: BuildingRevision; contentSha256: string; rightsReceiptSha256: string; authorityStatus: 'APPROVED';
};
export interface BuildingRequirements {
  program: BuildingRequirementAuthority & { spaces: Array<{ spaceId: string; occupancy: number; areaTargetM2: number; use: string }> };
  loads: BuildingRequirementAuthority & { floorLiveLoadKPa: Array<{ spaceId: string; valueKPa: number }>; roofLiveLoadKPa: number; environmentalLoadKPa: number };
  accessibility: BuildingRequirementAuthority & { minClearWidthMm: number; maxLevelChangeMm: number; minTurningDiameterMm: number };
  egress: BuildingRequirementAuthority & { maxTravelDistanceM: number; minClearWidthMm: number; maxDeadEndDistanceM: number; exitsByLevel: Array<{ levelId: string; requiredCount: number }> };
}
export interface BuildingCodeBasis extends BuildingRequirementAuthority { jurisdictionId: string; codeBasis: string }

export interface BuildingLevel extends BuildingElementBase { name: string; elevationMm: number; heightMm: number }
export interface BuildingGrid extends BuildingElementBase { axis: 'X' | 'Y'; label: string; start: BuildingPoint; end: BuildingPoint }
export interface BuildingSpace extends BuildingElementBase { levelId: string; name: string; use: string; boundary: BuildingPoint[]; areaM2: number; heightMm: number }
export interface BuildingWall extends BuildingElementBase { levelId: string; kind: 'EXTERIOR' | 'INTERIOR' | 'CORE' | 'SHAFT'; start: BuildingPoint; end: BuildingPoint; thicknessMm: number; heightMm: number }
export interface BuildingSlab extends BuildingElementBase { levelId: string; kind: 'GROUND' | 'FLOOR' | 'ROOF_DECK'; boundary: BuildingPoint[]; thicknessMm: number }
export interface BuildingRoof extends BuildingElementBase { levelId: string; boundary: BuildingPoint[]; elevationMm: number; thicknessMm: number }
export interface BuildingEnvelopeLayer extends BuildingElementBase { hostId: string; layerKind: 'STRUCTURAL' | 'INSULATION' | 'AIR_BARRIER' | 'CLADDING' | 'ROOFING' | 'FINISH'; thicknessMm: number; materialRef: string }
export interface BuildingDoor extends BuildingElementBase { levelId: string; hostWallId: string; center: BuildingPoint; widthMm: number; heightMm: number; sillMm: number; swing: 'INWARD_LEFT' | 'INWARD_RIGHT' | 'OUTWARD_LEFT' | 'OUTWARD_RIGHT' | 'NONE' }
export interface BuildingWindow extends BuildingElementBase { levelId: string; hostWallId: string; center: BuildingPoint; widthMm: number; heightMm: number; sillMm: number }
export interface BuildingStair extends BuildingElementBase { fromLevelId: string; toLevelId: string; widthMm: number; riserMm: number; treadMm: number; landingCount: number }
export interface BuildingEgressRoute extends BuildingElementBase { levelId: string; fromSpaceId: string; exitDoorId: string; path: BuildingPoint[] }
export interface BuildingServiceOpening extends BuildingElementBase { levelId: string; hostId: string; discipline: 'STRUCTURAL' | 'MEP' | 'MECHANICAL'; center: BuildingPoint; widthMm: number; heightMm: number }

export interface BuildingUpstreamBinding {
  discipline: 'STRUCTURAL' | 'MEP' | 'MECHANICAL'; artifactId: string; artifactRevision: BuildingRevision;
  artifactContentSha256: string; sourceRevision: BuildingRevision; rightsReceiptSha256: string; authorityStatus: 'APPROVED';
}
export interface BuildingRelationship { id: string; kind: 'HOSTS' | 'LOCATED_ON' | 'CONNECTS' | 'EGRESS_TO' | 'SERVES' | 'UPSTREAM'; fromId: string; toId: string; sourceRevision: BuildingRevision }

export interface BuildingProductContract {
  schema: typeof BUILDING_PRODUCT_CONTRACT_SCHEMA;
  identity: { projectId: string; revision: BuildingRevision; contentSha256: string };
  units: BuildingUnits;
  siteAuthority: BuildingSiteAuthority;
  codeBasis: BuildingCodeBasis;
  requirements: BuildingRequirements;
  levels: BuildingLevel[]; grids: BuildingGrid[]; spaces: BuildingSpace[]; walls: BuildingWall[]; slabs: BuildingSlab[]; roof: BuildingRoof;
  envelopeLayers: BuildingEnvelopeLayer[]; doors: BuildingDoor[]; windows: BuildingWindow[]; stairs: BuildingStair[]; egressRoutes: BuildingEgressRoute[]; serviceOpenings: BuildingServiceOpening[];
  upstreams: BuildingUpstreamBinding[]; relationships: BuildingRelationship[]; authoritative: true;
}

const SHA = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REV = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const CONTRACT_KEYS = ['schema', 'identity', 'units', 'siteAuthority', 'codeBasis', 'requirements', 'levels', 'grids', 'spaces', 'walls', 'slabs', 'roof', 'envelopeLayers', 'doors', 'windows', 'stairs', 'egressRoutes', 'serviceOpenings', 'upstreams', 'relationships', 'authoritative'];
const BASE_KEYS = ['id', 'sourceRevision', 'contentSha256', 'provenance'];
const REV_KEYS = ['id', 'sha256'];
const PROV_KEYS = ['sourceId', 'sourceRef', 'contentSha256', 'rightsReceiptSha256', 'origin', 'rightsStatus', 'authorityStatus'];
const AUTH_KEYS = ['sourceRevision', 'contentSha256', 'rightsReceiptSha256', 'authorityStatus'];
const UPSTREAM_KEYS = ['discipline', 'artifactId', 'artifactRevision', 'artifactContentSha256', 'sourceRevision', 'rightsReceiptSha256', 'authorityStatus'];
const REL_KEYS = ['id', 'kind', 'fromId', 'toId', 'sourceRevision'];
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, expected: readonly string[]): boolean => record(v) && Object.keys(v).sort().join('|') === [...expected].sort().join('|');
const finite = (v: unknown, min = -1e9, max = 1e9): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const text = (v: unknown, re: RegExp = /./, max = 256): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && re.test(v);
const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : record(v) ? `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v) ?? 'null';
const sameRevision = (a: unknown, b: BuildingRevision | undefined): boolean => record(a) && Boolean(b) && a.id === b!.id && a.sha256 === b!.sha256;
const add = (issues: string[], ok: boolean, path: string) => { if (!ok) issues.push(path); };

export function canonicalBuildingProductContractJson(contract: BuildingProductContract, includeHash = true): string {
  return canonical(includeHash ? contract : { ...contract, identity: { ...contract.identity, contentSha256: undefined } });
}
export function hashBuildingProductContract(contract: BuildingProductContract): string {
  return createHash('sha256').update(canonicalBuildingProductContractJson(contract, false), 'utf8').digest('hex');
}

function revision(value: unknown, path: string, issues: string[]): value is BuildingRevision {
  if (!exact(value, REV_KEYS) || !record(value)) { issues.push(`${path}:keys`); return false; }
  add(issues, text(value.id, REV), `${path}.id`); add(issues, text(value.sha256, SHA), `${path}.sha256`); return true;
}
function provenance(value: unknown, path: string, issues: string[]): void {
  if (!exact(value, PROV_KEYS) || !record(value)) { issues.push(`${path}:keys`); return; }
  add(issues, text(value.sourceId, ID), `${path}.sourceId`);
  add(issues, text(value.sourceRef, /^(?!ai:|preview:|synthetic:|inferred:|catalog-unverified:).+$/i, 1024), `${path}.sourceRef`);
  add(issues, text(value.contentSha256, SHA), `${path}.contentSha256`); add(issues, text(value.rightsReceiptSha256, SHA), `${path}.rightsReceiptSha256`);
  add(issues, ['ORIGINAL', 'LICENSED', 'CLIENT_PROVIDED', 'PUBLIC_STANDARD_FACT'].includes(value.origin as string), `${path}.origin`);
  add(issues, value.rightsStatus === 'APPROVED' && value.authorityStatus === 'APPROVED', `${path}:not_authoritative`);
}
function point(value: unknown, path: string, issues: string[]): value is BuildingPoint {
  if (!exact(value, ['x', 'y']) || !record(value)) { issues.push(`${path}:point`); return false; }
  add(issues, finite(value.x, -1e8, 1e8), `${path}.x`); add(issues, finite(value.y, -1e8, 1e8), `${path}.y`); return true;
}
function polygon(value: unknown, path: string, issues: string[]): void {
  if (!Array.isArray(value) || value.length < 4 || value.length > 1000) { issues.push(`${path}:polygon_count`); return; }
  value.forEach((item, index) => point(item, `${path}[${index}]`, issues));
  const first = value[0] as Record<string, unknown>; const last = value[value.length - 1] as Record<string, unknown>;
  if (!record(first) || !record(last) || first.x !== last.x || first.y !== last.y) issues.push(`${path}:not_closed`);
  let area = 0;
  for (let index = 0; index < value.length - 1; index++) { const a = value[index] as BuildingPoint; const b = value[index + 1] as BuildingPoint; area += a.x * b.y - b.x * a.y; if (a.x === b.x && a.y === b.y) issues.push(`${path}:duplicate_adjacent_point`); }
  if (!Number.isFinite(area) || Math.abs(area) < 1e-6) issues.push(`${path}:zero_area`);
}
function element(value: unknown, path: string, expectedKeys: readonly string[], expectedRevision: BuildingRevision | undefined, issues: string[]): value is BuildingElementBase {
  if (!exact(value, [...BASE_KEYS, ...expectedKeys]) || !record(value)) { issues.push(`${path}:keys`); return false; }
  add(issues, text(value.id, ID), `${path}.id`); revision(value.sourceRevision, `${path}.sourceRevision`, issues);
  if (expectedRevision && !sameRevision(value.sourceRevision, expectedRevision)) issues.push(`${path}.sourceRevision:mismatch`);
  add(issues, text(value.contentSha256, SHA), `${path}.contentSha256`); provenance(value.provenance, `${path}.provenance`, issues); return true;
}
function authority(value: unknown, path: string, expectedRevision: BuildingRevision | undefined, extraKeys: readonly string[], issues: string[]): void {
  if (!exact(value, [...AUTH_KEYS, ...extraKeys]) || !record(value)) { issues.push(`${path}:keys`); return; }
  revision(value.sourceRevision, `${path}.sourceRevision`, issues); if (expectedRevision && !sameRevision(value.sourceRevision, expectedRevision)) issues.push(`${path}.sourceRevision:mismatch`);
  add(issues, text(value.contentSha256, SHA), `${path}.contentSha256`); add(issues, text(value.rightsReceiptSha256, SHA), `${path}.rightsReceiptSha256`); add(issues, value.authorityStatus === 'APPROVED', `${path}:not_authoritative`);
}
function positive(value: unknown, path: string, issues: string[], max = 1e8): void { add(issues, finite(value, Number.MIN_VALUE, max), path); }

export function validateBuildingProductContract(input: unknown): string[] {
  const issues: string[] = [];
  if (!exact(input, CONTRACT_KEYS) || !record(input)) return ['contract:keys'];
  if (input.schema !== BUILDING_PRODUCT_CONTRACT_SCHEMA || input.authoritative !== true) issues.push('contract:not_authoritative');
  if (!exact(input.identity, ['projectId', 'revision', 'contentSha256']) || !record(input.identity)) issues.push('identity:keys');
  const identity = record(input.identity) ? input.identity : undefined;
  const expectedRevision = identity && record(identity.revision) ? identity.revision as unknown as BuildingRevision : undefined;
  if (identity) { add(issues, text(identity.projectId, ID), 'identity.projectId'); revision(identity.revision, 'identity.revision', issues); add(issues, text(identity.contentSha256, SHA), 'identity.contentSha256'); if (text(identity.contentSha256, SHA) && identity.contentSha256 !== hashBuildingProductContract(input as unknown as BuildingProductContract)) issues.push('identity.contentSha256:mismatch'); }
  add(issues, exact(input.units, ['length', 'area', 'volume', 'angle', 'force', 'pressure']) && record(input.units) && input.units.length === 'mm' && input.units.area === 'm2' && input.units.volume === 'm3' && input.units.angle === 'deg' && input.units.force === 'kN' && input.units.pressure === 'kPa', 'units:invalid');

  if (record(input.siteAuthority)) {
    const site = input.siteAuthority;
    if (!exact(site, [...PROV_KEYS, 'sourceRevision', 'coordinateReferenceSystem', 'horizontalDatum', 'verticalDatum', 'epoch', 'projectNorthDeg', 'siteBoundary'])) issues.push('siteAuthority:keys');
    provenance({ sourceId: site.sourceId, sourceRef: site.sourceRef, contentSha256: site.contentSha256, rightsReceiptSha256: site.rightsReceiptSha256, origin: site.origin, rightsStatus: site.rightsStatus, authorityStatus: site.authorityStatus }, 'siteAuthority', issues); revision(site.sourceRevision, 'siteAuthority.sourceRevision', issues); if (expectedRevision && !sameRevision(site.sourceRevision, expectedRevision)) issues.push('siteAuthority.sourceRevision:mismatch');
    for (const key of ['coordinateReferenceSystem', 'horizontalDatum', 'verticalDatum']) add(issues, text(site[key], /^(?!ai:|preview:|synthetic:).+$/i, 256), `siteAuthority.${key}`);
    add(issues, text(site.epoch, /^\d{4}(?:-\d{2}-\d{2})?(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/, 32), 'siteAuthority.epoch');
    add(issues, finite(site.projectNorthDeg, -360, 360), 'siteAuthority.projectNorthDeg'); polygon(site.siteBoundary, 'siteAuthority.siteBoundary', issues);
  } else issues.push('siteAuthority:keys');
  if (record(input.codeBasis)) { const code = input.codeBasis; authority(code, 'codeBasis', expectedRevision, ['jurisdictionId', 'codeBasis'], issues); add(issues, text(code.jurisdictionId, ID), 'codeBasis.jurisdictionId'); add(issues, text(code.codeBasis, /^(?!ai:|preview:|synthetic:).+$/i, 1024), 'codeBasis.codeBasis'); } else issues.push('codeBasis:keys');

  if (!record(input.requirements) || !exact(input.requirements, ['program', 'loads', 'accessibility', 'egress'])) issues.push('requirements:keys'); else {
    const req = input.requirements;
    authority(req.program, 'requirements.program', expectedRevision, ['spaces'], issues); authority(req.loads, 'requirements.loads', expectedRevision, ['floorLiveLoadKPa', 'roofLiveLoadKPa', 'environmentalLoadKPa'], issues); authority(req.accessibility, 'requirements.accessibility', expectedRevision, ['minClearWidthMm', 'maxLevelChangeMm', 'minTurningDiameterMm'], issues); authority(req.egress, 'requirements.egress', expectedRevision, ['maxTravelDistanceM', 'minClearWidthMm', 'maxDeadEndDistanceM', 'exitsByLevel'], issues);
    if (record(req.program)) { if (!Array.isArray(req.program.spaces) || req.program.spaces.length === 0) issues.push('requirements.program.spaces:invalid'); else req.program.spaces.forEach((space, i) => { if (!exact(space, ['spaceId', 'occupancy', 'areaTargetM2', 'use']) || !record(space)) issues.push(`requirements.program.spaces[${i}]:keys`); else { add(issues, text(space.spaceId, ID), `requirements.program.spaces[${i}].spaceId`); add(issues, finite(space.occupancy, 0, 1e7), `requirements.program.spaces[${i}].occupancy`); positive(space.areaTargetM2, `requirements.program.spaces[${i}].areaTargetM2`, issues); add(issues, text(space.use, /./, 128), `requirements.program.spaces[${i}].use`); } }); }
    if (record(req.loads)) { if (!Array.isArray(req.loads.floorLiveLoadKPa) || req.loads.floorLiveLoadKPa.length === 0) issues.push('requirements.loads.floorLiveLoadKPa:invalid'); else req.loads.floorLiveLoadKPa.forEach((load, i) => { if (!exact(load, ['spaceId', 'valueKPa']) || !record(load)) issues.push(`requirements.loads.floorLiveLoadKPa[${i}]:keys`); else { add(issues, text(load.spaceId, ID), `requirements.loads.floorLiveLoadKPa[${i}].spaceId`); positive(load.valueKPa, `requirements.loads.floorLiveLoadKPa[${i}].valueKPa`, issues, 1e6); } }); positive(req.loads.roofLiveLoadKPa, 'requirements.loads.roofLiveLoadKPa', issues, 1e6); positive(req.loads.environmentalLoadKPa, 'requirements.loads.environmentalLoadKPa', issues, 1e6); }
    if (record(req.accessibility)) for (const key of ['minClearWidthMm', 'maxLevelChangeMm', 'minTurningDiameterMm']) positive(req.accessibility[key], `requirements.accessibility.${key}`, issues, 1e7);
    if (record(req.egress)) { positive(req.egress.maxTravelDistanceM, 'requirements.egress.maxTravelDistanceM', issues, 1e7); positive(req.egress.minClearWidthMm, 'requirements.egress.minClearWidthMm', issues, 1e7); positive(req.egress.maxDeadEndDistanceM, 'requirements.egress.maxDeadEndDistanceM', issues, 1e7); if (!Array.isArray(req.egress.exitsByLevel) || req.egress.exitsByLevel.length === 0) issues.push('requirements.egress.exitsByLevel:invalid'); else req.egress.exitsByLevel.forEach((exit, i) => { if (!exact(exit, ['levelId', 'requiredCount']) || !record(exit)) issues.push(`requirements.egress.exitsByLevel[${i}]:keys`); else { add(issues, text(exit.levelId, ID), `requirements.egress.exitsByLevel[${i}].levelId`); positive(exit.requiredCount, `requirements.egress.exitsByLevel[${i}].requiredCount`, issues, 1e5); } }); }
  }

  const levels = Array.isArray(input.levels) ? input.levels : []; if (levels.length !== 2) issues.push('levels:two_required');
  const allIds = new Set<string>(); const levelIds = new Set<string>(); const wallIds = new Set<string>(); const spaceIds = new Set<string>(); const hostIds = new Set<string>(); const doorIds = new Set<string>();
  const register = (value: unknown, path: string, local: Set<string> = allIds): void => { if (record(value) && text(value.id, ID)) { if (allIds.has(value.id)) issues.push(`${path}.id:duplicate`); allIds.add(value.id); local.add(value.id); } };
  levels.forEach((raw, i) => { const path = `levels[${i}]`; if (element(raw, path, ['name', 'elevationMm', 'heightMm'], expectedRevision, issues)) { const level = raw as unknown as BuildingLevel; register(level, path, levelIds); add(issues, text(level.name, /./, 128), `${path}.name`); positive(level.heightMm, `${path}.heightMm`, issues); add(issues, finite(level.elevationMm, -1e7, 1e8), `${path}.elevationMm`); } });
  const grids = Array.isArray(input.grids) ? input.grids : []; if (grids.length === 0) issues.push('grids:required'); grids.forEach((raw, i) => { const path = `grids[${i}]`; if (element(raw, path, ['axis', 'label', 'start', 'end'], expectedRevision, issues)) { const grid = raw as unknown as BuildingGrid; register(grid, path); add(issues, ['X', 'Y'].includes(grid.axis), `${path}.axis`); add(issues, text(grid.label, /./, 64), `${path}.label`); point(grid.start, `${path}.start`, issues); point(grid.end, `${path}.end`, issues); add(issues, Math.hypot(grid.end.x - grid.start.x, grid.end.y - grid.start.y) > 0, `${path}:zero_length`); } });
  const spaces = Array.isArray(input.spaces) ? input.spaces : []; if (spaces.length === 0) issues.push('spaces:required'); spaces.forEach((raw, i) => { const path = `spaces[${i}]`; if (element(raw, path, ['levelId', 'name', 'use', 'boundary', 'areaM2', 'heightMm'], expectedRevision, issues)) { const space = raw as unknown as BuildingSpace; register(space, path, spaceIds); add(issues, levelIds.has(space.levelId), `${path}.levelId:dangling`); add(issues, text(space.name, /./, 128), `${path}.name`); add(issues, text(space.use, /./, 128), `${path}.use`); polygon(space.boundary, `${path}.boundary`, issues); positive(space.areaM2, `${path}.areaM2`, issues); positive(space.heightMm, `${path}.heightMm`, issues); } });
  const walls = Array.isArray(input.walls) ? input.walls : []; if (walls.length === 0) issues.push('walls:required'); walls.forEach((raw, i) => { const path = `walls[${i}]`; if (element(raw, path, ['levelId', 'kind', 'start', 'end', 'thicknessMm', 'heightMm'], expectedRevision, issues)) { const wall = raw as unknown as BuildingWall; register(wall, path, wallIds); add(issues, levelIds.has(wall.levelId), `${path}.levelId:dangling`); add(issues, ['EXTERIOR', 'INTERIOR', 'CORE', 'SHAFT'].includes(wall.kind), `${path}.kind`); point(wall.start, `${path}.start`, issues); point(wall.end, `${path}.end`, issues); add(issues, Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) > 0, `${path}:zero_length`); positive(wall.thicknessMm, `${path}.thicknessMm`, issues, 1e5); positive(wall.heightMm, `${path}.heightMm`, issues, 1e6); } });
  const slabs = Array.isArray(input.slabs) ? input.slabs : []; if (slabs.length === 0) issues.push('slabs:required'); slabs.forEach((raw, i) => { const path = `slabs[${i}]`; if (element(raw, path, ['levelId', 'kind', 'boundary', 'thicknessMm'], expectedRevision, issues)) { const slab = raw as unknown as BuildingSlab; register(slab, path, hostIds); add(issues, levelIds.has(slab.levelId), `${path}.levelId:dangling`); add(issues, ['GROUND', 'FLOOR', 'ROOF_DECK'].includes(slab.kind), `${path}.kind`); polygon(slab.boundary, `${path}.boundary`, issues); positive(slab.thicknessMm, `${path}.thicknessMm`, issues, 1e6); } });
  if (element(input.roof, 'roof', ['levelId', 'boundary', 'elevationMm', 'thicknessMm'], expectedRevision, issues)) { const roof = input.roof as unknown as BuildingRoof; register(roof, 'roof', hostIds); add(issues, levelIds.has(roof.levelId), 'roof.levelId:dangling'); polygon(roof.boundary, 'roof.boundary', issues); add(issues, finite(roof.elevationMm, -1e7, 1e8), 'roof.elevationMm'); positive(roof.thicknessMm, 'roof.thicknessMm', issues, 1e6); }
  const envelope = Array.isArray(input.envelopeLayers) ? input.envelopeLayers : []; if (envelope.length === 0) issues.push('envelopeLayers:required'); envelope.forEach((raw, i) => { const path = `envelopeLayers[${i}]`; if (element(raw, path, ['hostId', 'layerKind', 'thicknessMm', 'materialRef'], expectedRevision, issues)) { const layer = raw as unknown as BuildingEnvelopeLayer; register(layer, path); add(issues, hostIds.has(layer.hostId) || wallIds.has(layer.hostId), `${path}.hostId:dangling`); add(issues, ['STRUCTURAL', 'INSULATION', 'AIR_BARRIER', 'CLADDING', 'ROOFING', 'FINISH'].includes(layer.layerKind), `${path}.layerKind`); positive(layer.thicknessMm, `${path}.thicknessMm`, issues, 1e6); add(issues, text(layer.materialRef, /^(?!catalog-unverified:|preview:).+$/i, 256), `${path}.materialRef`); } });
  const doors = Array.isArray(input.doors) ? input.doors : []; if (doors.length === 0) issues.push('doors:required'); doors.forEach((raw, i) => { const path = `doors[${i}]`; if (element(raw, path, ['levelId', 'hostWallId', 'center', 'widthMm', 'heightMm', 'sillMm', 'swing'], expectedRevision, issues)) { const door = raw as unknown as BuildingDoor; register(door, path, doorIds); add(issues, levelIds.has(door.levelId), `${path}.levelId:dangling`); add(issues, wallIds.has(door.hostWallId), `${path}.hostWallId:dangling`); point(door.center, `${path}.center`, issues); positive(door.widthMm, `${path}.widthMm`, issues, 1e6); positive(door.heightMm, `${path}.heightMm`, issues, 1e6); add(issues, finite(door.sillMm, 0, 1e6), `${path}.sillMm`); add(issues, ['INWARD_LEFT', 'INWARD_RIGHT', 'OUTWARD_LEFT', 'OUTWARD_RIGHT', 'NONE'].includes(door.swing), `${path}.swing`); } });
  const windows = Array.isArray(input.windows) ? input.windows : []; if (windows.length === 0) issues.push('windows:required'); windows.forEach((raw, i) => { const path = `windows[${i}]`; if (element(raw, path, ['levelId', 'hostWallId', 'center', 'widthMm', 'heightMm', 'sillMm'], expectedRevision, issues)) { const win = raw as unknown as BuildingWindow; register(win, path); add(issues, levelIds.has(win.levelId), `${path}.levelId:dangling`); add(issues, wallIds.has(win.hostWallId), `${path}.hostWallId:dangling`); point(win.center, `${path}.center`, issues); positive(win.widthMm, `${path}.widthMm`, issues, 1e6); positive(win.heightMm, `${path}.heightMm`, issues, 1e6); add(issues, finite(win.sillMm, 0, 1e6), `${path}.sillMm`); } });
  const stairs = Array.isArray(input.stairs) ? input.stairs : []; if (stairs.length === 0) issues.push('stairs:required'); stairs.forEach((raw, i) => { const path = `stairs[${i}]`; if (element(raw, path, ['fromLevelId', 'toLevelId', 'widthMm', 'riserMm', 'treadMm', 'landingCount'], expectedRevision, issues)) { const stair = raw as unknown as BuildingStair; register(stair, path); add(issues, levelIds.has(stair.fromLevelId), `${path}.fromLevelId:dangling`); add(issues, levelIds.has(stair.toLevelId), `${path}.toLevelId:dangling`); add(issues, stair.fromLevelId !== stair.toLevelId, `${path}:same_level`); positive(stair.widthMm, `${path}.widthMm`, issues, 1e6); positive(stair.riserMm, `${path}.riserMm`, issues, 1e5); positive(stair.treadMm, `${path}.treadMm`, issues, 1e5); add(issues, finite(stair.landingCount, 1, 1e5) && Number.isInteger(stair.landingCount), `${path}.landingCount`); } });
  const egress = Array.isArray(input.egressRoutes) ? input.egressRoutes : []; if (egress.length === 0) issues.push('egressRoutes:required'); egress.forEach((raw, i) => { const path = `egressRoutes[${i}]`; if (element(raw, path, ['levelId', 'fromSpaceId', 'exitDoorId', 'path'], expectedRevision, issues)) { const route = raw as unknown as BuildingEgressRoute; register(route, path); add(issues, levelIds.has(route.levelId), `${path}.levelId:dangling`); add(issues, spaceIds.has(route.fromSpaceId), `${path}.fromSpaceId:dangling`); add(issues, doorIds.has(route.exitDoorId), `${path}.exitDoorId:dangling`); if (!Array.isArray(route.path) || route.path.length < 2) issues.push(`${path}.path:invalid`); else route.path.forEach((item, index) => point(item, `${path}.path[${index}]`, issues)); } });
  const openings = Array.isArray(input.serviceOpenings) ? input.serviceOpenings : []; if (openings.length === 0) issues.push('serviceOpenings:required'); openings.forEach((raw, i) => { const path = `serviceOpenings[${i}]`; if (element(raw, path, ['levelId', 'hostId', 'discipline', 'center', 'widthMm', 'heightMm'], expectedRevision, issues)) { const opening = raw as unknown as BuildingServiceOpening; register(opening, path); add(issues, levelIds.has(opening.levelId), `${path}.levelId:dangling`); add(issues, hostIds.has(opening.hostId) || wallIds.has(opening.hostId), `${path}.hostId:dangling`); add(issues, ['STRUCTURAL', 'MEP', 'MECHANICAL'].includes(opening.discipline), `${path}.discipline`); point(opening.center, `${path}.center`, issues); positive(opening.widthMm, `${path}.widthMm`, issues, 1e6); positive(opening.heightMm, `${path}.heightMm`, issues, 1e6); } });

  const upstreams = Array.isArray(input.upstreams) ? input.upstreams : []; const disciplines = new Set<string>(); upstreams.forEach((raw, i) => { const path = `upstreams[${i}]`; if (!exact(raw, UPSTREAM_KEYS) || !record(raw)) { issues.push(`${path}:keys`); return; } const upstream = raw as unknown as BuildingUpstreamBinding; add(issues, ['STRUCTURAL', 'MEP', 'MECHANICAL'].includes(upstream.discipline), `${path}.discipline`); if (disciplines.has(upstream.discipline)) issues.push(`${path}.discipline:duplicate`); disciplines.add(upstream.discipline); add(issues, text(upstream.artifactId, ID), `${path}.artifactId`); revision(upstream.artifactRevision, `${path}.artifactRevision`, issues); add(issues, text(upstream.artifactContentSha256, SHA), `${path}.artifactContentSha256`); revision(upstream.sourceRevision, `${path}.sourceRevision`, issues); if (expectedRevision && !sameRevision(upstream.sourceRevision, expectedRevision)) issues.push(`${path}.sourceRevision:mismatch`); add(issues, text(upstream.rightsReceiptSha256, SHA), `${path}.rightsReceiptSha256`); add(issues, upstream.authorityStatus === 'APPROVED', `${path}:not_authoritative`); });
  for (const discipline of ['STRUCTURAL', 'MEP', 'MECHANICAL']) if (!disciplines.has(discipline)) issues.push(`upstreams:required:${discipline}`);
  const relationships = Array.isArray(input.relationships) ? input.relationships : []; if (relationships.length === 0) issues.push('relationships:required'); const relationIds = new Set<string>(); relationships.forEach((raw, i) => { const path = `relationships[${i}]`; if (!exact(raw, REL_KEYS) || !record(raw)) { issues.push(`${path}:keys`); return; } const relation = raw as unknown as BuildingRelationship; add(issues, text(relation.id, ID) && !relationIds.has(relation.id), `${path}.id`); relationIds.add(relation.id); add(issues, ['HOSTS', 'LOCATED_ON', 'CONNECTS', 'EGRESS_TO', 'SERVES', 'UPSTREAM'].includes(relation.kind), `${path}.kind`); add(issues, allIds.has(relation.fromId), `${path}.fromId:dangling`); add(issues, allIds.has(relation.toId), `${path}.toId:dangling`); revision(relation.sourceRevision, `${path}.sourceRevision`, issues); if (expectedRevision && !sameRevision(relation.sourceRevision, expectedRevision)) issues.push(`${path}.sourceRevision:mismatch`); });
  if (record(input.requirements)) { const req = input.requirements; if (record(req.program) && Array.isArray(req.program.spaces)) req.program.spaces.forEach((space, i) => { if (record(space) && typeof space.spaceId === 'string' && !spaceIds.has(space.spaceId)) issues.push(`requirements.program.spaces[${i}].spaceId:dangling`); }); if (record(req.loads) && Array.isArray(req.loads.floorLiveLoadKPa)) req.loads.floorLiveLoadKPa.forEach((load, i) => { if (record(load) && typeof load.spaceId === 'string' && !spaceIds.has(load.spaceId)) issues.push(`requirements.loads.floorLiveLoadKPa[${i}].spaceId:dangling`); }); if (record(req.egress) && Array.isArray(req.egress.exitsByLevel)) req.egress.exitsByLevel.forEach((exit, i) => { if (record(exit) && typeof exit.levelId === 'string' && !levelIds.has(exit.levelId)) issues.push(`requirements.egress.exitsByLevel[${i}].levelId:dangling`); }); }
  return [...new Set(issues)];
}

export function createBuildingProductContract(input: Omit<BuildingProductContract, 'identity'> & { identity: Omit<BuildingProductContract['identity'], 'contentSha256'> }): BuildingProductContract {
  const draft = { ...input, identity: { ...input.identity, contentSha256: '0'.repeat(64) } } as BuildingProductContract;
  const contract = { ...draft, identity: { ...draft.identity, contentSha256: hashBuildingProductContract(draft) } };
  const issues = validateBuildingProductContract(contract); if (issues.length) throw new Error(`invalid_building_product_contract:${issues.join(',')}`); return contract;
}
