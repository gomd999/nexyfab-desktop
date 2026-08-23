import {
  hashArchitectureInteriorEvidenceV2,
  validateArchitectureInteriorWorkspaceV2,
  type ArchitectureInteriorWorkspaceV2,
} from './architectureInteriorWorkspace';
import type { ArchitectureWall } from './architectureInteriorDocuments';
import type { ArtifactDependencyEdge, ArtifactInputBinding, DesignArtifactNode } from './designArtifactGraph';

export const ARCHITECTURE_INTERIOR_IFC_SCHEMA = 'nexyfab.architecture-interior-ifc.v1' as const;
const MAX_ITEMS = 10_000;
const MAX_COORDINATE_MM = 1_000_000_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
type Point3 = [number, number, number];

export type ArchitectureInteriorIfcBinding = {
  projectId: string;
  revision: number;
  workspaceContentHash: string;
  architectureDocumentId: string;
  interiorDocumentId: string;
  architectureDocumentHash: string;
  interiorDocumentHash: string;
};

export type ArchitectureInteriorIfcObjectMapping = {
  globalId: string;
  ifcClass: 'IfcProject' | 'IfcBuildingStorey' | 'IfcSpace' | 'IfcWall' | 'IfcSlab' | 'IfcCovering' | 'IfcDoor' | 'IfcWindow' | 'IfcFurnishingElement' | 'IfcLightFixture';
  sourceId: string;
  storeyId?: string;
  hostId?: string;
  placementMm: Point3;
  dimensionsMm?: Point3;
  attributes: Record<string, string | number | boolean>;
};

export type ArchitectureInteriorIfcPayload = {
  schema: typeof ARCHITECTURE_INTERIOR_IFC_SCHEMA;
  format: 'structured_semantic_ifc';
  ifcSchema: 'IFC4';
  binding: ArchitectureInteriorIfcBinding;
  units: { length: 'mm'; area: 'mm2'; volume: 'mm3'; angle: 'deg' };
  coordinateFrames: Array<{ id: string; kindCode: string; parentId?: string; objectId?: string; documentId?: string; originMm: Point3; rotationDeg: Point3 }>;
  placementBasis: 'workspace_coordinate_frame_plus_document_coordinates';
  objectMappings: ArchitectureInteriorIfcObjectMapping[];
  interoperability: { status: 'not_run'; reasonCode: 'ifc_roundtrip_not_run'; scope: 'external_parser_and_roundtrip' };
};

export type ArchitectureInteriorIfcArtifact = {
  payload: ArchitectureInteriorIfcPayload;
  contentHash: string;
  verification: { status: 'passed'; verifierId: 'architecture-interior-ifc-schema-binding.v1'; evidenceHash: string; issues: [] };
  artifact: DesignArtifactNode;
  dependencies: ArtifactDependencyEdge[];
};

export type ArchitectureInteriorIfcResult =
  | { ok: true; result: ArchitectureInteriorIfcArtifact }
  | { ok: false; code: 'invalid_workspace' | 'geometry_bounds_exceeded' | 'unsafe_identifier' | 'output_too_large' | 'ifc_reconciliation_failed'; issues: string[] };

function finite(value: number): boolean { return Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE_MM; }
function bounded(value: unknown): boolean {
  if (typeof value === 'number') return finite(value);
  if (Array.isArray(value)) return value.length <= MAX_ITEMS && value.every(bounded);
  if (value && typeof value === 'object') { const values = Object.values(value); return values.length <= MAX_ITEMS && values.every(bounded); }
  return true;
}
function unsafe(value: string): boolean { return value.length > 128 || value.includes('://') || value.includes('/') || value.includes('\\') || /(?:bearer|password|secret|token)/i.test(value); }
function sorted<T extends { id: string }>(values: readonly T[]): T[] { return [...values].sort((a, b) => a.id.localeCompare(b.id)); }
function point(value: readonly number[]): Point3 { return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0]; }
function centerOf(points: readonly (readonly number[])[]): Point3 {
  if (!points.length) return [0, 0, 0];
  const totals = points.reduce((sum, item) => [sum[0] + (item[0] ?? 0), sum[1] + (item[1] ?? 0)] as [number, number], [0, 0]);
  return [totals[0] / points.length, totals[1] / points.length, 0];
}
function wallCenter(wall: ArchitectureWall): Point3 {
  if (wall.kind === 'line') return [((wall.startMm[0] + wall.endMm[0]) / 2), ((wall.startMm[1] + wall.endMm[1]) / 2), 0];
  const angle = (wall.startAngleDeg + wall.endAngleDeg) / 2 * Math.PI / 180;
  return [wall.centerMm[0] + Math.cos(angle) * wall.radiusMm, wall.centerMm[1] + Math.sin(angle) * wall.radiusMm, 0];
}
function shortGlobalId(sourceId: string, binding: ArchitectureInteriorIfcBinding): string {
  return hashArchitectureInteriorEvidenceV2({ schema: 'ifc-global-id.v1', projectId: binding.projectId, sourceId }).slice(0, 22).toUpperCase();
}
function stableCode(value: string, prefix: string): string {
  return /^[A-Za-z0-9._:-]+$/.test(value) ? value : `${prefix}-${hashArchitectureInteriorEvidenceV2({ value }).slice(0, 16)}`;
}
function modelInputs(workspace: ArchitectureInteriorWorkspaceV2): ArtifactInputBinding[] {
  return workspace.artifactGraph.artifacts.filter(item => item.kind === 'model' && item.state === 'current').sort((a, b) => a.id.localeCompare(b.id)).map(item => ({ artifactId: item.id, revision: item.revision, contentHash: item.contentHash }));
}
function dependencies(inputs: readonly ArtifactInputBinding[], targetId: string): ArtifactDependencyEdge[] {
  return inputs.map((input, index) => ({ id: `ifc-dependency-${index + 1}-${hashArchitectureInteriorEvidenceV2(`${input.artifactId}:${targetId}`).slice(0, 16)}`, sourceId: input.artifactId, targetId, policy: 'invalidate' as const }));
}

export function buildArchitectureInteriorIfcArtifact(workspace: ArchitectureInteriorWorkspaceV2, modelInputsOverride?: readonly ArtifactInputBinding[]): ArchitectureInteriorIfcResult {
  let workspaceIssues: string[];
  try { workspaceIssues = validateArchitectureInteriorWorkspaceV2(workspace); } catch { return { ok: false, code: 'invalid_workspace', issues: ['workspace_validation_failed'] }; }
  if (workspaceIssues.length) return { ok: false, code: 'invalid_workspace', issues: workspaceIssues };
  const architecture = workspace.architecture.document;
  const interior = workspace.interior.document;
  if ((architecture.serviceOpenings?.length ?? 0) || (architecture.grids?.length ?? 0) || (architecture.roofs?.length ?? 0) || (architecture.stairs?.length ?? 0) || (architecture.shafts?.length ?? 0) || (architecture.zones?.length ?? 0) || (interior.ceilingSystems?.length ?? 0) || (interior.acousticZones?.length ?? 0)) {
    return { ok: false, code: 'ifc_reconciliation_failed', issues: ['unsupported_ifc_object_kind'] };
  }
  if (!bounded(architecture) || !bounded(interior)) return { ok: false, code: 'geometry_bounds_exceeded', issues: ['document_geometry_out_of_bounds'] };
  const allIds = [workspace.projectId, workspace.architecture.documentId, workspace.interior.documentId, ...architecture.storeys.map(item => item.id), ...architecture.spaces.map(item => item.id), ...architecture.walls.map(item => item.id), ...architecture.slabs.map(item => item.id), ...architecture.ceilings.map(item => item.id), ...architecture.openings.map(item => item.id), ...interior.furniture.map(item => item.id), ...interior.lights.map(item => item.id), ...interior.finishes.map(item => item.id)];
  if (allIds.some(unsafe)) return { ok: false, code: 'unsafe_identifier', issues: ['workspace_identifier_cannot_be_serialized_to_ifc_artifact'] };
  const architectureDocumentHash = hashArchitectureInteriorEvidenceV2(architecture);
  const interiorDocumentHash = hashArchitectureInteriorEvidenceV2(interior);
  const binding: ArchitectureInteriorIfcBinding = { projectId: workspace.projectId, revision: workspace.workspace.revision, workspaceContentHash: workspace.contentHash, architectureDocumentId: workspace.architecture.documentId, interiorDocumentId: workspace.interior.documentId, architectureDocumentHash, interiorDocumentHash };
  const spacesById = new Map(architecture.spaces.map(space => [space.id, space]));
  const storeysById = new Map(architecture.storeys.map(storey => [storey.id, storey]));
  const wallById = new Map(architecture.walls.map(wall => [wall.id, wall]));
  const ceilingsById = new Map(architecture.ceilings.map(ceiling => [ceiling.id, ceiling]));
  const slabsById = new Map(architecture.slabs.map(slab => [slab.id, slab]));
  const mappings: ArchitectureInteriorIfcObjectMapping[] = [];
  mappings.push({ globalId: shortGlobalId(workspace.projectId, binding), ifcClass: 'IfcProject', sourceId: workspace.projectId, placementMm: [0, 0, 0], attributes: { schemaCode: 'project' } });
  for (const storey of sorted(architecture.storeys)) mappings.push({ globalId: shortGlobalId(storey.id, binding), ifcClass: 'IfcBuildingStorey', sourceId: storey.id, placementMm: [0, 0, storey.elevationMm], attributes: { schemaCode: 'storey', heightMm: storey.heightMm } });
  for (const space of sorted(architecture.spaces)) {
    const center = centerOf(space.boundaryMm); const elevationMm = storeysById.get(space.storeyId)?.elevationMm;
    if (elevationMm === undefined) return { ok: false, code: 'ifc_reconciliation_failed', issues: [`space_storey_missing:${space.id}`] };
    mappings.push({ globalId: shortGlobalId(space.id, binding), ifcClass: 'IfcSpace', sourceId: space.id, storeyId: space.storeyId, placementMm: [center[0], center[1], elevationMm], attributes: { schemaCode: 'space', usageCode: stableCode(space.usage, 'usage') } });
  }
  for (const wall of sorted(architecture.walls)) {
    const storey = storeysById.get(wall.storeyId);
    if (!storey) return { ok: false, code: 'ifc_reconciliation_failed', issues: [`wall_storey_missing:${wall.id}`] };
    mappings.push({ globalId: shortGlobalId(wall.id, binding), ifcClass: 'IfcWall', sourceId: wall.id, storeyId: wall.storeyId, placementMm: [...wallCenter(wall).slice(0, 2), storey.elevationMm] as Point3, dimensionsMm: [wall.thicknessMm, wall.heightMm, wall.kind === 'line' ? Math.hypot(wall.endMm[0] - wall.startMm[0], wall.endMm[1] - wall.startMm[1]) : wall.radiusMm], attributes: { schemaCode: wall.kind === 'line' ? 'wall_line' : 'wall_arc' } });
  }
  for (const slab of sorted(architecture.slabs)) mappings.push({ globalId: shortGlobalId(slab.id, binding), ifcClass: 'IfcSlab', sourceId: slab.id, storeyId: slab.storeyId, placementMm: [...centerOf(slab.boundaryMm).slice(0, 2), storeysById.get(slab.storeyId)?.elevationMm ?? 0] as Point3, dimensionsMm: [0, 0, slab.thicknessMm], attributes: { schemaCode: 'slab', spaceId: slab.spaceId } });
  for (const ceiling of sorted(architecture.ceilings)) { const center = centerOf(ceiling.boundaryMm); mappings.push({ globalId: shortGlobalId(ceiling.id, binding), ifcClass: 'IfcCovering', sourceId: ceiling.id, storeyId: ceiling.storeyId, placementMm: [center[0], center[1], ceiling.elevationMm], attributes: { schemaCode: 'ceiling', spaceId: ceiling.spaceId, thicknessMm: ceiling.thicknessMm ?? 0 } }); }
  for (const opening of sorted(architecture.openings)) {
    const host = wallById.get(opening.hostWallId);
    if (!host) return { ok: false, code: 'ifc_reconciliation_failed', issues: [`opening_host_missing:${opening.id}`] };
    const openingPoint = point(opening.positionMm); const storeyElevation = storeysById.get(host.storeyId)?.elevationMm;
    if (storeyElevation === undefined) return { ok: false, code: 'ifc_reconciliation_failed', issues: [`opening_storey_missing:${opening.id}`] };
    mappings.push({ globalId: shortGlobalId(opening.id, binding), ifcClass: opening.kind === 'door' ? 'IfcDoor' : 'IfcWindow', sourceId: opening.id, storeyId: host.storeyId, hostId: opening.hostWallId, placementMm: [openingPoint[0], openingPoint[1], openingPoint[2] + storeyElevation], dimensionsMm: [opening.widthMm, opening.heightMm, host.thicknessMm], attributes: { schemaCode: opening.kind, sillMm: opening.sillMm } });
  }
  for (const item of sorted(interior.furniture)) {
    const space = spacesById.get(item.spaceId);
    if (!space) return { ok: false, code: 'ifc_reconciliation_failed', issues: [`furniture_space_missing:${item.id}`] };
    mappings.push({ globalId: shortGlobalId(item.id, binding), ifcClass: 'IfcFurnishingElement', sourceId: item.id, storeyId: space.storeyId, placementMm: point(item.positionMm), dimensionsMm: point(item.sizeMm), attributes: { schemaCode: 'furniture', spaceId: item.spaceId, clearanceMm: item.clearanceMm } });
  }
  for (const item of sorted(interior.millwork ?? [])) {
    const space = spacesById.get(item.spaceId);
    if (!space || (item.hostWallId !== undefined && !wallById.has(item.hostWallId))) return { ok: false, code: 'ifc_reconciliation_failed', issues: [`millwork_host_missing:${item.id}`] };
    mappings.push({ globalId: shortGlobalId(item.id, binding), ifcClass: 'IfcFurnishingElement', sourceId: item.id, storeyId: space.storeyId, hostId: item.hostWallId, placementMm: point(item.positionMm), dimensionsMm: point(item.sizeMm), attributes: { schemaCode: 'millwork', spaceId: item.spaceId, materialCode: stableCode(item.material, 'material'), clearanceMm: item.clearanceMm } });
  }
  for (const item of sorted(interior.lights)) {
    const space = spacesById.get(item.spaceId);
    if (!space || !ceilingsById.has(item.hostCeilingId)) return { ok: false, code: 'ifc_reconciliation_failed', issues: [`light_host_missing:${item.id}`] };
    mappings.push({ globalId: shortGlobalId(item.id, binding), ifcClass: 'IfcLightFixture', sourceId: item.id, storeyId: space.storeyId, hostId: item.hostCeilingId, placementMm: point(item.positionMm), attributes: { schemaCode: 'light', spaceId: item.spaceId, lumens: item.lumens, cctK: item.cctK } });
  }
  for (const item of interior.finishes) {
    const host = item.surface === 'wall' ? wallById.has(item.hostId) : item.surface === 'floor' ? slabsById.has(item.hostId) : ceilingsById.has(item.hostId);
    if (!host) return { ok: false, code: 'ifc_reconciliation_failed', issues: [`finish_host_missing:${item.id}`] };
    const space = spacesById.get(item.spaceId);
    if (!space) return { ok: false, code: 'ifc_reconciliation_failed', issues: [`finish_space_missing:${item.id}`] };
    const hostPoint = item.surface === 'wall' ? wallCenter(wallById.get(item.hostId)!) : item.surface === 'floor' ? centerOf(slabsById.get(item.hostId)!.boundaryMm) : [0, 0, ceilingsById.get(item.hostId)!.elevationMm] as Point3;
    mappings.push({ globalId: shortGlobalId(item.id, binding), ifcClass: 'IfcCovering', sourceId: item.id, storeyId: space.storeyId, hostId: item.hostId, placementMm: hostPoint, attributes: { schemaCode: 'finish', surfaceCode: item.surface, materialCode: stableCode(item.material, 'material'), spaceId: item.spaceId } });
  }
  mappings.sort((a, b) => a.globalId.localeCompare(b.globalId));
  if (mappings.length > MAX_ITEMS || mappings.some(item => !bounded(item))) return { ok: false, code: 'geometry_bounds_exceeded', issues: ['ifc_object_mapping_limit_exceeded'] };
  const coordinateFrames = [...workspace.coordinates].sort((a, b) => a.id.localeCompare(b.id)).map(frame => ({ id: frame.id, kindCode: frame.kind, ...(frame.parentId ? { parentId: frame.parentId } : {}), ...(frame.objectId ? { objectId: frame.objectId } : {}), ...(frame.documentId ? { documentId: frame.documentId } : {}), originMm: [...frame.originMm] as Point3, rotationDeg: [...frame.rotationDeg] as Point3 }));
  const payload: ArchitectureInteriorIfcPayload = { schema: ARCHITECTURE_INTERIOR_IFC_SCHEMA, format: 'structured_semantic_ifc', ifcSchema: 'IFC4', binding, units: { length: 'mm', area: 'mm2', volume: 'mm3', angle: 'deg' }, coordinateFrames, placementBasis: 'workspace_coordinate_frame_plus_document_coordinates', objectMappings: mappings, interoperability: { status: 'not_run', reasonCode: 'ifc_roundtrip_not_run', scope: 'external_parser_and_roundtrip' } };
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_OUTPUT_BYTES) return { ok: false, code: 'output_too_large', issues: ['ifc_payload_limit_exceeded'] };
  const contentHash = hashArchitectureInteriorEvidenceV2(payload);
  const inputs: ArtifactInputBinding[] = modelInputsOverride ? [...modelInputsOverride] : modelInputs(workspace);
  const artifactId = `ifc:architecture-interior:${workspace.workspace.revision}`;
  const evidenceHash = hashArchitectureInteriorEvidenceV2({ schema: 'nexyfab.architecture-interior-ifc-verification.v1', binding, contentHash, inputCount: inputs.length, interoperability: payload.interoperability });
  const verification = { status: 'passed' as const, verifierId: 'architecture-interior-ifc-schema-binding.v1' as const, evidenceHash, issues: [] as [] };
  const artifact: DesignArtifactNode = { id: artifactId, kind: 'ifc', revision: workspace.workspace.revision, contentHash, state: 'current', inputs, verification, staleBecause: [] };
  return { ok: true, result: { payload, contentHash, verification, artifact, dependencies: dependencies(inputs, artifactId) } };
}
