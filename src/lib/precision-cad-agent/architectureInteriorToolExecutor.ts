import {
  ARCHITECTURE_INTERIOR_TOOL_CATALOG,
  validateArchitectureInteriorToolArguments,
  validateArchitectureInteriorToolCatalog,
  type ArchitectureInteriorToolScope,
} from './architectureInteriorToolCatalog';
import {
  validateArchitectureDocument,
  validateInteriorDocument,
  type ArchitectureDocument,
  type InteriorDocument,
  type ArchitectureEdit,
} from '@/lib/ai/architectureInteriorDocuments';
import {
  validateArchitectureInteriorWorkspaceV2,
  type ArchitectureInteriorWorkspaceV2,
} from '@/lib/ai/architectureInteriorWorkspace';
import { architectureDomainDocument, interiorDomainDocument } from '@/lib/ai/architectureInteriorProjectAdapter';
import { executeArchitectureInteriorConceptTransaction } from '@/lib/ai/architectureInteriorConceptTransaction';

export type ArchitectureInteriorExecutorCode =
  | 'invalid_request' | 'catalog_invalid' | 'tool_not_allowed' | 'tool_not_executable'
  | 'workspace_invalid' | 'project_binding_mismatch' | 'stale_revision' | 'content_hash_mismatch'
  | 'document_binding_mismatch' | 'object_binding_mismatch' | 'parameter_binding_mismatch'
  | 'invalid_arguments' | 'validation_failed' | 'approval_required' | 'locked_artifact_requires_approval' | 'edit_failed';

export type ArchitectureInteriorExecutorFailure = { ok: false; code: ArchitectureInteriorExecutorCode };
export type ArchitectureInteriorExecutorSuccess = {
  ok: true;
  tool: string;
  scope: ArchitectureInteriorToolScope;
  result: unknown;
  workspace?: ArchitectureInteriorWorkspaceV2;
};
export type ArchitectureInteriorExecutorResult = ArchitectureInteriorExecutorFailure | ArchitectureInteriorExecutorSuccess;

export type ArchitectureInteriorToolBinding = {
  projectId: string;
  revision: number;
  contentHash: string;
  documentId?: string;
  objectId?: string;
  parameterPaths?: readonly string[];
};

export type ArchitectureInteriorToolExecutorInput = {
  workspace: ArchitectureInteriorWorkspaceV2;
  binding: ArchitectureInteriorToolBinding;
  tool: string;
  arguments: unknown;
  approved?: boolean;
};

const fail = (code: ArchitectureInteriorExecutorCode): ArchitectureInteriorExecutorFailure => ({ ok: false, code });

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function sameStrings(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  return Boolean(left && right && left.length === right.length && left.every((item, index) => item === right[index]));
}

function objectIds(workspace: ArchitectureInteriorWorkspaceV2): Map<string, string> {
  const result = new Map<string, string>();
  const add = (documentId: string, items: readonly { id: string }[]) => items.forEach(item => result.set(item.id, documentId));
  const architecture = workspace.architecture.document;
  const interior = workspace.interior.document;
  add(workspace.architecture.documentId, [
    ...architecture.storeys, ...architecture.spaces, ...architecture.walls, ...architecture.slabs,
    ...architecture.ceilings, ...architecture.openings, ...(architecture.serviceOpenings ?? []),
    ...(architecture.grids ?? []), ...(architecture.roofs ?? []), ...(architecture.stairs ?? []), ...(architecture.shafts ?? []), ...(architecture.elevators ?? []), ...(architecture.zones ?? []),
  ]);
  add(workspace.interior.documentId, [
    ...interior.lights, ...interior.furniture, ...interior.finishes, ...(interior.millwork ?? []),
    ...(interior.ceilingSystems ?? []), ...(interior.acousticZones ?? []),
  ]);
  return result;
}

function boundWorkspace(input: ArchitectureInteriorToolExecutorInput): ArchitectureInteriorExecutorFailure | null {
  const { workspace, binding } = input;
  const issues = validateArchitectureInteriorWorkspaceV2(workspace);
  if (issues.length) return fail('workspace_invalid');
  if (binding.projectId !== workspace.projectId || binding.projectId !== workspace.workspace.projectId) return fail('project_binding_mismatch');
  if (binding.revision !== workspace.workspace.revision) return fail('stale_revision');
  if (binding.contentHash !== workspace.contentHash || workspace.workspace.contentHash !== workspace.contentHash) return fail('content_hash_mismatch');
  const args = record(input.arguments) ? input.arguments : {};
  if (typeof args.revision !== 'number' || args.revision !== binding.revision) return fail('stale_revision');
  if (typeof args.documentId !== 'string' || ![workspace.architecture.documentId, workspace.interior.documentId].includes(args.documentId)) return fail('document_binding_mismatch');
  if (binding.documentId !== undefined && binding.documentId !== args.documentId) return fail('document_binding_mismatch');
  const architectureCreateTools = new Set(['create_storey', 'create_wall', 'create_space', 'create_slab', 'create_opening', 'create_grid', 'create_stair', 'create_shaft', 'create_elevator', 'create_service_opening']);
  const architectureEditTools = new Set(['edit_storey', 'edit_wall', 'edit_space', 'edit_slab', 'edit_opening', 'edit_grid', 'edit_stair', 'edit_shaft', 'edit_elevator', 'edit_service_opening', 'edit_ceiling']);
  const interiorCreateTools = new Set(['create_furniture', 'create_light', 'create_finish', 'create_millwork', 'create_ceiling_system']);
  if (architectureCreateTools.has(input.tool) && args.documentId !== workspace.architecture.documentId) return fail('document_binding_mismatch');
  if (architectureEditTools.has(input.tool) && args.documentId !== workspace.architecture.documentId) return fail('document_binding_mismatch');
  if (interiorCreateTools.has(input.tool) && args.documentId !== workspace.interior.documentId) return fail('document_binding_mismatch');
  const creates = new Set(['create_storey', 'create_wall', 'create_space', 'create_opening', 'create_grid', 'create_stair', 'create_shaft', 'create_elevator', 'create_service_opening', ...interiorCreateTools]);
  if (args.objectId !== undefined) {
    const ids = objectIds(workspace);
    const objectIsNew = creates.has(input.tool) && !ids.has(args.objectId as string);
    if (typeof args.objectId !== 'string' || (!objectIsNew && ids.get(args.objectId) !== args.documentId) || (binding.objectId !== undefined && binding.objectId !== args.objectId)) return fail('object_binding_mismatch');
  } else if (binding.objectId !== undefined) return fail('object_binding_mismatch');
  if (binding.parameterPaths !== undefined && (!Array.isArray(args.parameterPaths) || !sameStrings(binding.parameterPaths, args.parameterPaths as string[]))) return fail('parameter_binding_mismatch');
  return null;
}

function documentFor(workspace: ArchitectureInteriorWorkspaceV2, documentId: string): ArchitectureDocument | InteriorDocument | null {
  if (documentId === workspace.architecture.documentId) return workspace.architecture.document;
  if (documentId === workspace.interior.documentId) return workspace.interior.document;
  return null;
}

function findObject(workspace: ArchitectureInteriorWorkspaceV2, documentId: string, objectId: string): unknown | null {
  const document = documentFor(workspace, documentId);
  if (!document) return null;
  const collections = documentId === workspace.architecture.documentId
    ? (() => { const architecture = workspace.architecture.document; return [architecture.storeys, architecture.spaces, architecture.walls, architecture.slabs, architecture.ceilings, architecture.openings, architecture.serviceOpenings ?? [], architecture.grids ?? [], architecture.roofs ?? [], architecture.stairs ?? [], architecture.shafts ?? [], architecture.elevators ?? [], architecture.zones ?? []]; })()
    : (() => { const interior = workspace.interior.document; return [interior.lights, interior.furniture, interior.finishes, interior.millwork ?? [], interior.ceilingSystems ?? [], interior.acousticZones ?? []]; })();
  return collections.flat().find(item => item.id === objectId) ?? null;
}

function readTool(workspace: ArchitectureInteriorWorkspaceV2, tool: string, args: Record<string, unknown>): unknown | null {
  const architecture = workspace.architecture.document;
  const interior = workspace.interior.document;
  if (tool === 'get_project_context') return { architecture: architectureDomainDocument(architecture, workspace.architecture.documentId), interior: interiorDomainDocument(interior, workspace.interior.documentId), workspaceRevision: workspace.workspace.revision };
  if (tool === 'list_storeys_spaces' && args.documentId === workspace.architecture.documentId) return { storeys: architecture.storeys, spaces: args.storeyId ? architecture.spaces.filter(space => space.storeyId === args.storeyId) : architecture.spaces };
  if (tool === 'inspect_element') return { object: findObject(workspace, args.documentId as string, args.objectId as string) };
  if (tool === 'verify_architecture' && args.documentId === workspace.architecture.documentId) {
    const issues = validateArchitectureDocument(architecture);
    return { pass: issues.length === 0, issues };
  }
  if (tool === 'verify_interior' && args.documentId === workspace.interior.documentId) {
    const issues = validateInteriorDocument(interior, architecture);
    return { pass: issues.length === 0, issues };
  }
  if (tool === 'verify_space' && args.documentId === workspace.architecture.documentId) {
    const space = architecture.spaces.find(item => item.id === args.objectId);
    if (!space) return null;
    const slab = architecture.slabs.find(item => item.id === space.slabId);
    const ceiling = architecture.ceilings.find(item => item.id === space.ceilingId);
    const sameBoundary = (candidate: readonly [number, number][] | undefined) => Boolean(candidate && candidate.length === space.boundaryMm.length && candidate.every((point, index) => point[0] === space.boundaryMm[index]?.[0] && point[1] === space.boundaryMm[index]?.[1]));
    const boundaryMatch = sameBoundary(slab?.boundaryMm) && sameBoundary(ceiling?.boundaryMm);
    return { pass: boundaryMatch, boundaryMatch, issues: boundaryMatch ? [] : ['space_boundary_mismatch'] };
  }
  return null;
}

function conceptEditFromTool(tool: string, args: Record<string, unknown>) {
  const patch = record(args.patch) ? args.patch : {};
  const id = typeof args.objectId === 'string' ? args.objectId : '';
  if (tool === 'create_storey' && typeof patch.name === 'string' && typeof patch.elevationMm === 'number' && typeof patch.heightMm === 'number') return { kind: 'create_storey' as const, storey: { id, name: patch.name, elevationMm: patch.elevationMm, heightMm: patch.heightMm } } satisfies ArchitectureEdit;
  if (tool === 'create_wall' && typeof patch.storeyId === 'string' && (patch.kind === 'line' || patch.kind === 'arc') && typeof patch.thicknessMm === 'number' && typeof patch.heightMm === 'number') {
    if (patch.kind === 'line' && Array.isArray(patch.startMm) && Array.isArray(patch.endMm)) return { kind: 'create_wall' as const, wall: { id, kind: 'line' as const, storeyId: patch.storeyId, startMm: patch.startMm as [number, number], endMm: patch.endMm as [number, number], thicknessMm: patch.thicknessMm, heightMm: patch.heightMm } } satisfies ArchitectureEdit;
    if (patch.kind === 'arc' && Array.isArray(patch.centerMm) && typeof patch.radiusMm === 'number' && typeof patch.startAngleDeg === 'number' && typeof patch.endAngleDeg === 'number') return { kind: 'create_wall' as const, wall: { id, kind: 'arc' as const, storeyId: patch.storeyId, centerMm: patch.centerMm as [number, number], radiusMm: patch.radiusMm, startAngleDeg: patch.startAngleDeg, endAngleDeg: patch.endAngleDeg, thicknessMm: patch.thicknessMm, heightMm: patch.heightMm } } satisfies ArchitectureEdit;
  }
  if (tool === 'create_space' && typeof patch.storeyId === 'string' && typeof patch.name === 'string' && typeof patch.usageCode === 'string' && Array.isArray(patch.boundaryMm) && Array.isArray(patch.wallIds) && typeof patch.slabId === 'string' && typeof patch.ceilingId === 'string' && typeof patch.slabThicknessMm === 'number' && typeof patch.ceilingElevationMm === 'number' && typeof patch.ceilingThicknessMm === 'number') {
    const boundaryMm = patch.boundaryMm as [number, number][];
    return { kind: 'create_space' as const, space: { id, storeyId: patch.storeyId, name: patch.name, usage: patch.usageCode, boundaryMm, wallIds: patch.wallIds as string[], slabId: patch.slabId, ceilingId: patch.ceilingId }, slab: { id: patch.slabId, storeyId: patch.storeyId, spaceId: id, boundaryMm: structuredClone(boundaryMm), thicknessMm: patch.slabThicknessMm }, ceiling: { id: patch.ceilingId, storeyId: patch.storeyId, spaceId: id, boundaryMm: structuredClone(boundaryMm), elevationMm: patch.ceilingElevationMm, thicknessMm: patch.ceilingThicknessMm } } satisfies ArchitectureEdit;
  }
  if (tool === 'create_opening' && (patch.kind === 'window' || patch.kind === 'door') && typeof patch.hostWallId === 'string' && typeof patch.offsetMm === 'number' && typeof patch.widthMm === 'number' && typeof patch.heightMm === 'number' && typeof patch.sillMm === 'number') return { kind: 'create_opening' as const, opening: { id, kind: patch.kind, hostWallId: patch.hostWallId, offsetMm: patch.offsetMm, widthMm: patch.widthMm, heightMm: patch.heightMm, sillMm: patch.sillMm, positionMm: [0, 0, patch.sillMm] as [number, number, number], ...(Array.isArray(patch.connectsSpaceIds) ? { connectsSpaceIds: patch.connectsSpaceIds as string[] } : {}), ...(typeof patch.isExit === 'boolean' ? { isExit: patch.isExit } : {}) } } satisfies ArchitectureEdit;
  if (tool === 'create_grid' && typeof patch.name === 'string' && (patch.axis === 'x' || patch.axis === 'y' || patch.axis === 'radial') && Array.isArray(patch.startMm) && Array.isArray(patch.endMm)) return { kind: 'create_grid' as const, grid: { id, name: patch.name, axis: patch.axis, startMm: patch.startMm as [number, number], endMm: patch.endMm as [number, number] } } satisfies ArchitectureEdit;
  if (tool === 'create_stair' && typeof patch.fromStoreyId === 'string' && typeof patch.toStoreyId === 'string' && typeof patch.widthMm === 'number' && typeof patch.riserCount === 'number' && typeof patch.treadDepthMm === 'number' && Array.isArray(patch.pathMm)) return { kind: 'create_stair' as const, stair: { id, fromStoreyId: patch.fromStoreyId, toStoreyId: patch.toStoreyId, widthMm: patch.widthMm, riserCount: patch.riserCount, treadDepthMm: patch.treadDepthMm, pathMm: patch.pathMm as [number, number, number][] } } satisfies ArchitectureEdit;
  if (tool === 'create_shaft' && typeof patch.fromStoreyId === 'string' && typeof patch.toStoreyId === 'string' && Array.isArray(patch.boundaryMm) && Array.isArray(patch.hostSpaceIds)) return { kind: 'create_shaft' as const, shaft: { id, fromStoreyId: patch.fromStoreyId, toStoreyId: patch.toStoreyId, boundaryMm: patch.boundaryMm as [number, number][], hostSpaceIds: patch.hostSpaceIds as string[] } } satisfies ArchitectureEdit;
  if (tool === 'create_elevator' && typeof patch.shaftId === 'string' && Array.isArray(patch.servedStoreyIds)) return { kind: 'create_elevator' as const, elevator: { id, shaftId: patch.shaftId, servedStoreyIds: patch.servedStoreyIds as string[] } } satisfies ArchitectureEdit;
  if (tool === 'create_service_opening' && typeof patch.hostId === 'string' && typeof patch.sourceRouteId === 'string' && typeof patch.sourceSleeveId === 'string' && patch.shape === 'round' && Array.isArray(patch.centerMm) && Array.isArray(patch.axis) && typeof patch.cutDiameterMm === 'number' && typeof patch.depthMm === 'number' && typeof patch.firestopAnnulusMm === 'number') return { kind: 'create_service_opening' as const, serviceOpening: { id, hostId: patch.hostId, sourceRouteId: patch.sourceRouteId, sourceSleeveId: patch.sourceSleeveId, shape: 'round' as const, centerMm: patch.centerMm as [number, number, number], axis: patch.axis as [number, number, number], cutDiameterMm: patch.cutDiameterMm, depthMm: patch.depthMm, firestopAnnulusMm: patch.firestopAnnulusMm, ...(typeof patch.structuralApprovalId === 'string' ? { structuralApprovalId: patch.structuralApprovalId } : {}) } } satisfies ArchitectureEdit;
  if (tool === 'create_furniture' && typeof patch.spaceId === 'string' && Array.isArray(patch.positionMm) && Array.isArray(patch.sizeMm) && typeof patch.clearanceMm === 'number') return { kind: 'create_furniture' as const, furniture: { id, spaceId: patch.spaceId, positionMm: patch.positionMm as [number, number, number], sizeMm: patch.sizeMm as [number, number, number], clearanceMm: patch.clearanceMm, ...(typeof patch.rotationDeg === 'number' ? { rotationDeg: patch.rotationDeg } : {}) } } satisfies ArchitectureEdit;
  if (tool === 'create_light' && typeof patch.spaceId === 'string' && typeof patch.hostCeilingId === 'string' && Array.isArray(patch.positionMm) && typeof patch.suspensionMm === 'number' && typeof patch.lumens === 'number' && typeof patch.cctK === 'number') return { kind: 'create_light' as const, light: { id, spaceId: patch.spaceId, hostCeilingId: patch.hostCeilingId, positionMm: patch.positionMm as [number, number, number], suspensionMm: patch.suspensionMm, lumens: patch.lumens, cctK: patch.cctK } } satisfies ArchitectureEdit;
  if (tool === 'create_finish' && typeof patch.spaceId === 'string' && typeof patch.hostId === 'string' && (patch.surfaceCode === 'floor' || patch.surfaceCode === 'wall' || patch.surfaceCode === 'ceiling') && typeof patch.materialCode === 'string') return { kind: 'create_finish' as const, finish: { id, spaceId: patch.spaceId, hostId: patch.hostId, surface: patch.surfaceCode, material: patch.materialCode } } satisfies ArchitectureEdit;
  if (tool === 'create_millwork' && typeof patch.spaceId === 'string' && Array.isArray(patch.positionMm) && Array.isArray(patch.sizeMm) && typeof patch.materialCode === 'string' && typeof patch.clearanceMm === 'number') return { kind: 'create_millwork' as const, millwork: { id, spaceId: patch.spaceId, ...(typeof patch.hostWallId === 'string' ? { hostWallId: patch.hostWallId } : {}), positionMm: patch.positionMm as [number, number, number], sizeMm: patch.sizeMm as [number, number, number], material: patch.materialCode, clearanceMm: patch.clearanceMm } } satisfies ArchitectureEdit;
  if (tool === 'create_ceiling_system' && typeof patch.spaceId === 'string' && typeof patch.hostCeilingId === 'string' && (patch.kind === 'gypsum' || patch.kind === 'grid' || patch.kind === 'open' || patch.kind === 'acoustic') && typeof patch.elevationMm === 'number') return { kind: 'create_ceiling_system' as const, ceilingSystem: { id, spaceId: patch.spaceId, hostCeilingId: patch.hostCeilingId, kind: patch.kind, elevationMm: patch.elevationMm, ...(Array.isArray(patch.moduleMm) ? { moduleMm: patch.moduleMm as [number, number] } : {}) } } satisfies ArchitectureEdit;
  const allowed: Record<string, readonly string[]> = {
    edit_storey: ['name', 'elevationMm', 'heightMm'], edit_space: ['name', 'usageCode', 'storeyId', 'boundaryMm'],
    edit_slab: ['thicknessMm', 'boundaryMm'], edit_opening: ['offsetMm', 'widthMm', 'heightMm', 'sillMm'], edit_ceiling: ['elevationMm', 'thicknessMm'],
    edit_grid: ['name', 'axis', 'startMm', 'endMm'], edit_shaft: ['fromStoreyId', 'toStoreyId', 'boundaryMm', 'hostSpaceIds'], edit_elevator: ['shaftId', 'servedStoreyIds'], edit_service_opening: ['hostId', 'sourceRouteId', 'sourceSleeveId', 'centerMm', 'axis', 'cutDiameterMm', 'depthMm', 'firestopAnnulusMm', 'structuralApprovalId'],
    edit_furniture: ['positionMm', 'sizeMm', 'clearanceMm', 'rotationDeg'], edit_light: ['positionMm', 'suspensionMm', 'lumens', 'cctK'], edit_stair: ['fromStoreyId', 'toStoreyId', 'widthMm', 'riserCount', 'treadDepthMm', 'pathMm'],
    edit_finish: ['hostId', 'surfaceCode', 'materialCode'], edit_millwork: ['spaceId', 'hostWallId', 'positionMm', 'sizeMm', 'materialCode', 'clearanceMm'], edit_ceiling_system: ['kind', 'elevationMm', 'moduleMm'],
  };
  const wallGeometryKeys = ['kind', 'startMm', 'endMm', 'centerMm', 'radiusMm', 'startAngleDeg', 'endAngleDeg'];
  const wallResizeKeys = ['thicknessMm', 'heightMm'];
  if (tool === 'edit_wall' && Object.keys(patch).some(key => wallGeometryKeys.includes(key)) && Object.keys(patch).some(key => wallResizeKeys.includes(key))) return null;
  if (tool === 'edit_space' && Array.isArray(patch.boundaryMm) && (typeof patch.name === 'string' || typeof patch.usageCode === 'string' || typeof patch.storeyId === 'string')) return null;
  if (tool === 'edit_wall' && typeof patch.thicknessMm === 'number' || tool === 'edit_wall' && typeof patch.heightMm === 'number') {
    return { kind: 'resize_wall' as const, wallId: id, ...(typeof patch.thicknessMm === 'number' ? { thicknessMm: patch.thicknessMm } : {}), ...(typeof patch.heightMm === 'number' ? { heightMm: patch.heightMm } : {}) } satisfies ArchitectureEdit;
  }
  if (allowed[tool] && (Object.keys(patch).some(key => !allowed[tool]!.includes(key)) || Object.keys(patch).length === 0)) return null;
  if (tool === 'edit_storey') return { kind: 'edit_storey' as const, storeyId: id, ...(typeof patch.name === 'string' ? { name: patch.name } : {}), ...(typeof patch.elevationMm === 'number' ? { elevationMm: patch.elevationMm } : {}), ...(typeof patch.heightMm === 'number' ? { heightMm: patch.heightMm } : {}) } satisfies ArchitectureEdit;
  if (tool === 'edit_space' && (typeof patch.name === 'string' || typeof patch.usageCode === 'string' || typeof patch.storeyId === 'string')) return { kind: 'edit_space' as const, spaceId: id, ...(typeof patch.name === 'string' ? { name: patch.name } : {}), ...(typeof patch.usageCode === 'string' ? { usage: patch.usageCode } : {}), ...(typeof patch.storeyId === 'string' ? { storeyId: patch.storeyId } : {}) } satisfies ArchitectureEdit;
  if (tool === 'edit_space' && Array.isArray(patch.boundaryMm)) return { kind: 'set_space_boundary' as const, spaceId: args.objectId as string, boundaryMm: patch.boundaryMm as [number, number][] };
  if (tool === 'edit_wall' && patch.kind === 'line' && Array.isArray(patch.startMm) && Array.isArray(patch.endMm)) return { kind: 'move_line_wall' as const, wallId: args.objectId as string, startMm: patch.startMm as [number, number], endMm: patch.endMm as [number, number] };
  if (tool === 'edit_wall' && patch.kind === 'arc' && Array.isArray(patch.centerMm) && typeof patch.radiusMm === 'number' && typeof patch.startAngleDeg === 'number' && typeof patch.endAngleDeg === 'number') return { kind: 'set_arc_wall' as const, wallId: args.objectId as string, centerMm: patch.centerMm as [number, number], radiusMm: patch.radiusMm, startAngleDeg: patch.startAngleDeg, endAngleDeg: patch.endAngleDeg };
  if (tool === 'edit_slab') return { kind: 'edit_slab' as const, slabId: args.objectId as string, ...(Array.isArray(patch.boundaryMm) ? { boundaryMm: patch.boundaryMm as [number, number][] } : {}), ...(typeof patch.thicknessMm === 'number' ? { thicknessMm: patch.thicknessMm } : {}) };
  if (tool === 'edit_opening') return { kind: 'edit_opening' as const, openingId: args.objectId as string, ...(typeof patch.offsetMm === 'number' ? { offsetMm: patch.offsetMm } : {}), ...(typeof patch.widthMm === 'number' ? { widthMm: patch.widthMm } : {}), ...(typeof patch.heightMm === 'number' ? { heightMm: patch.heightMm } : {}), ...(typeof patch.sillMm === 'number' ? { sillMm: patch.sillMm } : {}) };
  if (tool === 'edit_grid') return { kind: 'edit_grid' as const, gridId: args.objectId as string, ...(typeof patch.name === 'string' ? { name: patch.name } : {}), ...(patch.axis === 'x' || patch.axis === 'y' || patch.axis === 'radial' ? { axis: patch.axis } : {}), ...(Array.isArray(patch.startMm) ? { startMm: patch.startMm as [number, number] } : {}), ...(Array.isArray(patch.endMm) ? { endMm: patch.endMm as [number, number] } : {}) } satisfies ArchitectureEdit;
  if (tool === 'edit_stair') return { kind: 'edit_stair' as const, stairId: args.objectId as string, ...(typeof patch.fromStoreyId === 'string' ? { fromStoreyId: patch.fromStoreyId } : {}), ...(typeof patch.toStoreyId === 'string' ? { toStoreyId: patch.toStoreyId } : {}), ...(typeof patch.widthMm === 'number' ? { widthMm: patch.widthMm } : {}), ...(typeof patch.riserCount === 'number' ? { riserCount: patch.riserCount } : {}), ...(typeof patch.treadDepthMm === 'number' ? { treadDepthMm: patch.treadDepthMm } : {}), ...(Array.isArray(patch.pathMm) ? { pathMm: patch.pathMm as [number, number, number][] } : {}) } satisfies ArchitectureEdit;
  if (tool === 'edit_shaft') return { kind: 'edit_shaft' as const, shaftId: args.objectId as string, ...(typeof patch.fromStoreyId === 'string' ? { fromStoreyId: patch.fromStoreyId } : {}), ...(typeof patch.toStoreyId === 'string' ? { toStoreyId: patch.toStoreyId } : {}), ...(Array.isArray(patch.boundaryMm) ? { boundaryMm: patch.boundaryMm as [number, number][] } : {}), ...(Array.isArray(patch.hostSpaceIds) ? { hostSpaceIds: patch.hostSpaceIds as string[] } : {}) } satisfies ArchitectureEdit;
  if (tool === 'edit_elevator') return { kind: 'edit_elevator' as const, elevatorId: args.objectId as string, ...(typeof patch.shaftId === 'string' ? { shaftId: patch.shaftId } : {}), ...(Array.isArray(patch.servedStoreyIds) ? { servedStoreyIds: patch.servedStoreyIds as string[] } : {}) } satisfies ArchitectureEdit;
  if (tool === 'edit_service_opening') return { kind: 'edit_service_opening' as const, serviceOpeningId: args.objectId as string, ...(typeof patch.hostId === 'string' ? { hostId: patch.hostId } : {}), ...(typeof patch.sourceRouteId === 'string' ? { sourceRouteId: patch.sourceRouteId } : {}), ...(typeof patch.sourceSleeveId === 'string' ? { sourceSleeveId: patch.sourceSleeveId } : {}), ...(Array.isArray(patch.centerMm) ? { centerMm: patch.centerMm as [number, number, number] } : {}), ...(Array.isArray(patch.axis) ? { axis: patch.axis as [number, number, number] } : {}), ...(typeof patch.cutDiameterMm === 'number' ? { cutDiameterMm: patch.cutDiameterMm } : {}), ...(typeof patch.depthMm === 'number' ? { depthMm: patch.depthMm } : {}), ...(typeof patch.firestopAnnulusMm === 'number' ? { firestopAnnulusMm: patch.firestopAnnulusMm } : {}), ...(typeof patch.structuralApprovalId === 'string' ? { structuralApprovalId: patch.structuralApprovalId } : {}) } satisfies ArchitectureEdit;
  if (tool === 'edit_ceiling') return { kind: 'edit_ceiling' as const, ceilingId: args.objectId as string, ...(typeof patch.elevationMm === 'number' ? { elevationMm: patch.elevationMm } : {}), ...(typeof patch.thicknessMm === 'number' ? { thicknessMm: patch.thicknessMm } : {}) };
  if (tool === 'edit_furniture') return { kind: 'edit_furniture' as const, furnitureId: args.objectId as string, ...(Array.isArray(patch.positionMm) ? { positionMm: patch.positionMm as [number, number, number] } : {}), ...(Array.isArray(patch.sizeMm) ? { sizeMm: patch.sizeMm as [number, number, number] } : {}), ...(typeof patch.clearanceMm === 'number' ? { clearanceMm: patch.clearanceMm } : {}), ...(typeof patch.rotationDeg === 'number' ? { rotationDeg: patch.rotationDeg } : {}) };
  if (tool === 'edit_light') return { kind: 'edit_light' as const, lightId: args.objectId as string, ...(Array.isArray(patch.positionMm) ? { positionMm: patch.positionMm as [number, number, number] } : {}), ...(typeof patch.suspensionMm === 'number' ? { suspensionMm: patch.suspensionMm } : {}), ...(typeof patch.lumens === 'number' ? { lumens: patch.lumens } : {}), ...(typeof patch.cctK === 'number' ? { cctK: patch.cctK } : {}) };
  if (tool === 'edit_finish') return { kind: 'edit_finish' as const, finishId: args.objectId as string, ...(typeof patch.hostId === 'string' ? { hostId: patch.hostId } : {}), ...(typeof patch.surfaceCode === 'string' ? { surface: patch.surfaceCode as 'floor' | 'wall' | 'ceiling' } : {}), ...(typeof patch.materialCode === 'string' ? { material: patch.materialCode } : {}) };
  if (tool === 'edit_millwork') return { kind: 'edit_millwork' as const, millworkId: args.objectId as string, ...(typeof patch.spaceId === 'string' ? { spaceId: patch.spaceId } : {}), ...(typeof patch.hostWallId === 'string' ? { hostWallId: patch.hostWallId } : {}), ...(Array.isArray(patch.positionMm) ? { positionMm: patch.positionMm as [number, number, number] } : {}), ...(Array.isArray(patch.sizeMm) ? { sizeMm: patch.sizeMm as [number, number, number] } : {}), ...(typeof patch.materialCode === 'string' ? { material: patch.materialCode } : {}), ...(typeof patch.clearanceMm === 'number' ? { clearanceMm: patch.clearanceMm } : {}) };
  if (tool === 'edit_ceiling_system') return { kind: 'edit_ceiling_system' as const, ceilingSystemId: args.objectId as string, ...(typeof patch.kind === 'string' ? { kindCode: patch.kind as 'gypsum' | 'grid' | 'open' | 'acoustic' } : {}), ...(typeof patch.elevationMm === 'number' ? { elevationMm: patch.elevationMm } : {}), ...(Array.isArray(patch.moduleMm) ? { moduleMm: patch.moduleMm as [number, number] } : {}) };
  return null;
}

export function executeArchitectureInteriorTool(input: ArchitectureInteriorToolExecutorInput): ArchitectureInteriorExecutorResult {
  const catalogIssues = validateArchitectureInteriorToolCatalog();
  if (catalogIssues.length) return fail('catalog_invalid');
  const definition = ARCHITECTURE_INTERIOR_TOOL_CATALOG.find(tool => tool.name === input.tool);
  if (!definition) return fail('tool_not_allowed');
  const bindingFailure = boundWorkspace(input);
  if (bindingFailure) return bindingFailure;
  const argumentIssues = validateArchitectureInteriorToolArguments(input.tool, input.arguments);
  if (argumentIssues.length) return fail('invalid_arguments');
  const args = input.arguments as Record<string, unknown>;
  const readResult = readTool(input.workspace, input.tool, args);
  if (definition.scope === 'read') return readResult === null ? fail('tool_not_executable') : { ok: true, tool: input.tool, scope: definition.scope, result: readResult };
  const conceptEdit = definition.scope === 'apply' ? conceptEditFromTool(input.tool, args) : null;
  if (conceptEdit) {
    if (input.approved !== true) return fail('approval_required');
    const transaction = executeArchitectureInteriorConceptTransaction({ workspace: input.workspace, edit: conceptEdit, actorSource: 'ai' });
    if (!transaction.committed) {
      if (transaction.code === 'locked_artifact_requires_approval') return fail('locked_artifact_requires_approval');
      if (transaction.code === 'edit_failed') return fail('edit_failed');
      if (transaction.code === 'validation_failed' || transaction.code === 'identity_change_rejected') return fail('validation_failed');
      return fail('tool_not_executable');
    }
    return { ok: true, tool: input.tool, scope: definition.scope, result: { commandHash: transaction.commandHash, affectedObjectIds: transaction.affectedObjectIds, invalidatedChecks: transaction.invalidatedChecks }, workspace: transaction.workspace };
  }
  // Precision mutation and unsupported concept operations stay blocked until
  // exact geometry and release artifacts can regenerate in one atomic revision.
  return fail('tool_not_executable');
}
