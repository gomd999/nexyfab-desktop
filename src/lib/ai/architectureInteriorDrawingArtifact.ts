import type {
  ArchitectureInteriorWorkspaceV2,
  WorkspaceCoordinateFrameV2,
} from './architectureInteriorWorkspace';
import {
  hashArchitectureInteriorEvidenceV2,
  validateArchitectureInteriorWorkspaceV2,
} from './architectureInteriorWorkspace';
import type {
  ArchitectureWall,
  ArchitectureBoundaryEdge,
} from './architectureInteriorDocuments';
import type {
  ArtifactDependencyEdge,
  ArtifactInputBinding,
  DesignArtifactNode,
} from './designArtifactGraph';

export const ARCHITECTURE_INTERIOR_DRAWING_SCHEMA = 'nexyfab.architecture-interior-drawing.v1' as const;
const MAX_ITEMS = 10_000;
const MAX_COORDINATE_MM = 1_000_000_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
type Point2 = [number, number];
type Point3 = [number, number, number];

export type ArchitectureInteriorDrawingBinding = {
  projectId: string;
  revision: number;
  workspaceContentHash: string;
  architectureDocumentId: string;
  interiorDocumentId: string;
  architectureDocumentHash: string;
  interiorDocumentHash: string;
};

export type ArchitectureInteriorDrawingPayload = {
  schema: typeof ARCHITECTURE_INTERIOR_DRAWING_SCHEMA;
  binding: ArchitectureInteriorDrawingBinding;
  units: { length: 'mm'; area: 'mm2'; angle: 'deg' };
  views: {
    plan: {
      storeys: Array<{
        id: string;
        elevationMm: number;
        topElevationMm: number;
        spaces: Array<{ id: string; usageCode: string; boundaryMm: Point2[]; wallIds: string[] }>;
        walls: Array<{ id: string; kind: ArchitectureWall['kind']; storeyId: string; geometry: Record<string, unknown>; thicknessMm: number; heightMm: number }>;
        openings: Array<{ id: string; kindCode: 'door' | 'window'; hostWallId: string; positionMm: Point3; offsetMm: number; widthMm: number; heightMm: number; sillMm: number }>;
        furniture: Array<{ id: string; spaceId: string; positionMm: Point3; sizeMm: Point3; rotationDeg: number; clearanceMm: number }>;
        lights: Array<{ id: string; spaceId: string; hostCeilingId: string; positionMm: Point3; suspensionMm: number }>;
        finishes: Array<{ id: string; spaceId: string; hostId: string; surfaceCode: 'floor' | 'wall' | 'ceiling'; materialCode: string }>;
        millwork: Array<{ id: string; spaceId: string; hostWallId?: string; positionMm: Point3; sizeMm: Point3; materialCode: string; clearanceMm: number }>;
      }>;
    };
    section: {
      axis: 'x';
      coordinateMm: number;
      method: 'orthographic_elevation_projection';
      cutGeometryVerification: { status: 'not_run'; reasonCode: 'section_cut_not_run' };
      storeys: Array<{ id: string; baseElevationMm: number; topElevationMm: number }>;
      walls: Array<{ id: string; storeyId: string; projectionMm: Point2; baseElevationMm: number; topElevationMm: number; thicknessMm: number }>;
      slabs: Array<{ id: string; storeyId: string; elevationMm: number; thicknessMm: number }>;
      ceilings: Array<{ id: string; storeyId: string; elevationMm: number; thicknessMm: number | null }>;
    };
  };
  rendering: { labels: 'stable_codes_only'; localizedTextEmbedded: false; source: 'workspace_documents' };
};

export type ArchitectureInteriorDrawingArtifact = {
  payload: ArchitectureInteriorDrawingPayload;
  contentHash: string;
  verification: { status: 'passed'; verifierId: 'architecture-interior-drawing-binding.v1'; evidenceHash: string; issues: [] };
  artifact: DesignArtifactNode;
  dependencies: ArtifactDependencyEdge[];
};

export type ArchitectureInteriorDrawingResult =
  | { ok: true; result: ArchitectureInteriorDrawingArtifact }
  | { ok: false; code: 'invalid_workspace' | 'geometry_bounds_exceeded' | 'unsafe_identifier' | 'output_too_large' | 'drawing_reconciliation_failed'; issues: string[] };

function finite(value: number): boolean { return Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE_MM; }
function point2(value: unknown): value is Point2 { return Array.isArray(value) && value.length === 2 && value.every(item => typeof item === 'number' && finite(item)); }
function bounded(value: unknown): boolean {
  if (typeof value === 'number') return finite(value);
  if (Array.isArray(value)) return value.length <= MAX_ITEMS && value.every(bounded);
  if (value && typeof value === 'object') return Object.values(value).length <= MAX_ITEMS && Object.values(value).every(bounded);
  return true;
}
function unsafe(value: string): boolean { return value.length > 128 || value.includes('://') || value.includes('/') || value.includes('\\') || /(?:bearer|password|secret|token)/i.test(value); }
function sorted<T extends { id: string }>(values: readonly T[]): T[] { return [...values].sort((a, b) => a.id.localeCompare(b.id)); }
function safeDocumentHash(value: unknown): string { return hashArchitectureInteriorEvidenceV2(value); }
function stableCode(value: string, prefix: string): string {
  return /^[A-Za-z0-9._:-]+$/.test(value) ? value : `${prefix}-${hashArchitectureInteriorEvidenceV2({ value }).slice(0, 16)}`;
}
function modelInputs(workspace: ArchitectureInteriorWorkspaceV2): ArtifactInputBinding[] {
  return workspace.artifactGraph.artifacts
    .filter(item => item.kind === 'model' && item.state === 'current')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(item => ({ artifactId: item.id, revision: item.revision, contentHash: item.contentHash }));
}
function dependencies(inputs: readonly ArtifactInputBinding[], targetId: string): ArtifactDependencyEdge[] {
  return inputs.map((input, index) => ({ id: `drawing-dependency-${index + 1}-${hashArchitectureInteriorEvidenceV2(`${input.artifactId}:${targetId}`).slice(0, 16)}`, sourceId: input.artifactId, targetId, policy: 'invalidate' as const }));
}
function wallGeometry(wall: ArchitectureWall): Record<string, unknown> {
  if (wall.kind === 'line') return { startMm: [...wall.startMm], endMm: [...wall.endMm] };
  return { centerMm: [...wall.centerMm], radiusMm: wall.radiusMm, startAngleDeg: wall.startAngleDeg, endAngleDeg: wall.endAngleDeg };
}
function midpoint(wall: ArchitectureWall): Point2 {
  if (wall.kind === 'line') return [(wall.startMm[0] + wall.endMm[0]) / 2, (wall.startMm[1] + wall.endMm[1]) / 2];
  const angle = (wall.startAngleDeg + wall.endAngleDeg) / 2 * Math.PI / 180;
  return [wall.centerMm[0] + Math.cos(angle) * wall.radiusMm, wall.centerMm[1] + Math.sin(angle) * wall.radiusMm];
}
function frameByObject(workspace: ArchitectureInteriorWorkspaceV2): Map<string, WorkspaceCoordinateFrameV2> {
  return new Map(workspace.coordinates.filter(frame => frame.kind === 'object' && frame.objectId).map(frame => [frame.objectId!, frame]));
}
function hasMatchingBoundary(edge: ArchitectureBoundaryEdge): boolean {
  if (edge.kind === 'line') return point2(edge.startMm) && point2(edge.endMm);
  return point2(edge.centerMm) && finite(edge.radiusMm);
}

export function buildArchitectureInteriorDrawingArtifact(workspace: ArchitectureInteriorWorkspaceV2, modelInputsOverride?: readonly ArtifactInputBinding[]): ArchitectureInteriorDrawingResult {
  let workspaceIssues: string[];
  try { workspaceIssues = validateArchitectureInteriorWorkspaceV2(workspace); } catch { return { ok: false, code: 'invalid_workspace', issues: ['workspace_validation_failed'] }; }
  if (workspaceIssues.length) return { ok: false, code: 'invalid_workspace', issues: workspaceIssues };
  const architecture = workspace.architecture.document;
  const interior = workspace.interior.document;
  if ((architecture.serviceOpenings?.length ?? 0) || (architecture.grids?.length ?? 0) || (architecture.roofs?.length ?? 0) || (architecture.stairs?.length ?? 0) || (architecture.shafts?.length ?? 0) || (architecture.zones?.length ?? 0) || (interior.ceilingSystems?.length ?? 0) || (interior.acousticZones?.length ?? 0)) {
    return { ok: false, code: 'drawing_reconciliation_failed', issues: ['unsupported_drawing_object_kind'] };
  }
  const allIds = [workspace.projectId, workspace.architecture.documentId, workspace.interior.documentId, ...architecture.storeys.map(item => item.id), ...architecture.spaces.map(item => item.id), ...architecture.walls.map(item => item.id), ...architecture.slabs.map(item => item.id), ...architecture.ceilings.map(item => item.id), ...architecture.openings.map(item => item.id), ...interior.lights.map(item => item.id), ...interior.furniture.map(item => item.id), ...interior.finishes.map(item => item.id), ...(interior.millwork ?? []).map(item => item.id)];
  if (allIds.some(unsafe)) return { ok: false, code: 'unsafe_identifier', issues: ['workspace_identifier_cannot_be_serialized_to_browser_artifact'] };
  if (!bounded(architecture) || !bounded(interior)) return { ok: false, code: 'geometry_bounds_exceeded', issues: ['document_geometry_out_of_bounds'] };
  const frames = frameByObject(workspace);
  const architectureDocumentHash = safeDocumentHash(architecture);
  const interiorDocumentHash = safeDocumentHash(interior);
  const binding: ArchitectureInteriorDrawingBinding = { projectId: workspace.projectId, revision: workspace.workspace.revision, workspaceContentHash: workspace.contentHash, architectureDocumentId: workspace.architecture.documentId, interiorDocumentId: workspace.interior.documentId, architectureDocumentHash, interiorDocumentHash };
  const wallById = new Map(architecture.walls.map(wall => [wall.id, wall]));
  const slabById = new Map(architecture.slabs.map(slab => [slab.id, slab]));
  const ceilingById = new Map(architecture.ceilings.map(ceiling => [ceiling.id, ceiling]));
  const storeyById = new Map(architecture.storeys.map(storey => [storey.id, storey]));
  const badHosts: string[] = [];
  for (const space of architecture.spaces) {
    if (space.wallIds.length !== space.boundaryMm.length || space.boundaryEdges?.some(edge => !hasMatchingBoundary(edge))) badHosts.push(`space:${space.id}`);
    if (!slabById.has(space.slabId) || !ceilingById.has(space.ceilingId)) badHosts.push(`space_host:${space.id}`);
  }
  for (const opening of architecture.openings) if (!wallById.has(opening.hostWallId)) badHosts.push(`opening:${opening.id}`);
  for (const item of interior.lights) if (!ceilingById.has(item.hostCeilingId) || !storeyById.has(architecture.spaces.find(space => space.id === item.spaceId)?.storeyId ?? '')) badHosts.push(`light:${item.id}`);
  for (const item of interior.furniture) if (!storeyById.has(architecture.spaces.find(space => space.id === item.spaceId)?.storeyId ?? '')) badHosts.push(`furniture:${item.id}`);
  for (const item of interior.finishes) {
    const valid = item.surface === 'wall' ? wallById.has(item.hostId) : item.surface === 'floor' ? slabById.has(item.hostId) : ceilingById.has(item.hostId);
    if (!valid) badHosts.push(`finish:${item.id}`);
  }
  for (const item of interior.millwork ?? []) if (item.hostWallId !== undefined && !wallById.has(item.hostWallId)) badHosts.push(`millwork:${item.id}`);
  if (badHosts.length) return { ok: false, code: 'drawing_reconciliation_failed', issues: badHosts.slice(0, 32) };
  const planStoreys = sorted(architecture.storeys).map(storey => {
    const spaces = sorted(architecture.spaces.filter(space => space.storeyId === storey.id)).map(space => ({ id: space.id, usageCode: stableCode(space.usage, 'usage'), boundaryMm: space.boundaryMm.map(point => [...point] as Point2), wallIds: [...space.wallIds] }));
    const walls = sorted(architecture.walls.filter(wall => wall.storeyId === storey.id)).map(wall => ({ id: wall.id, kind: wall.kind, storeyId: wall.storeyId, geometry: wallGeometry(wall), thicknessMm: wall.thicknessMm, heightMm: wall.heightMm }));
    const openings = sorted(architecture.openings.filter(opening => wallById.get(opening.hostWallId)?.storeyId === storey.id)).map(opening => ({ id: opening.id, kindCode: opening.kind, hostWallId: opening.hostWallId, positionMm: [...opening.positionMm] as Point3, offsetMm: opening.offsetMm, widthMm: opening.widthMm, heightMm: opening.heightMm, sillMm: opening.sillMm }));
    const spaceIds = new Set(spaces.map(space => space.id));
    const furniture = sorted(interior.furniture.filter(item => spaceIds.has(item.spaceId))).map(item => ({ id: item.id, spaceId: item.spaceId, positionMm: [...item.positionMm] as Point3, sizeMm: [...item.sizeMm] as Point3, rotationDeg: item.rotationDeg ?? 0, clearanceMm: item.clearanceMm }));
    const lights = sorted(interior.lights.filter(item => spaceIds.has(item.spaceId))).map(item => ({ id: item.id, spaceId: item.spaceId, hostCeilingId: item.hostCeilingId, positionMm: [...item.positionMm] as Point3, suspensionMm: item.suspensionMm }));
    const finishes = sorted(interior.finishes.filter(item => spaceIds.has(item.spaceId))).map(item => ({ id: item.id, spaceId: item.spaceId, hostId: item.hostId, surfaceCode: item.surface, materialCode: stableCode(item.material, 'material') }));
    const millwork = sorted((interior.millwork ?? []).filter(item => spaceIds.has(item.spaceId))).map(item => ({ id: item.id, spaceId: item.spaceId, ...(item.hostWallId ? { hostWallId: item.hostWallId } : {}), positionMm: [...item.positionMm] as Point3, sizeMm: [...item.sizeMm] as Point3, materialCode: stableCode(item.material, 'material'), clearanceMm: item.clearanceMm }));
    return { id: storey.id, elevationMm: storey.elevationMm, topElevationMm: storey.elevationMm + storey.heightMm, spaces, walls, openings, furniture, lights, finishes, millwork };
  });
  const section = {
    axis: 'x' as const,
    coordinateMm: 0,
    method: 'orthographic_elevation_projection' as const,
    cutGeometryVerification: { status: 'not_run' as const, reasonCode: 'section_cut_not_run' as const },
    storeys: sorted(architecture.storeys).map(storey => ({ id: storey.id, baseElevationMm: storey.elevationMm, topElevationMm: storey.elevationMm + storey.heightMm })),
    walls: sorted(architecture.walls).map(wall => { const storey = storeyById.get(wall.storeyId)!; const center = midpoint(wall); return { id: wall.id, storeyId: wall.storeyId, projectionMm: [center[0], storey.elevationMm] as Point2, baseElevationMm: storey.elevationMm, topElevationMm: storey.elevationMm + wall.heightMm, thicknessMm: wall.thicknessMm }; }),
    slabs: sorted(architecture.slabs).map(slab => ({ id: slab.id, storeyId: slab.storeyId, elevationMm: storeyById.get(slab.storeyId)!.elevationMm, thicknessMm: slab.thicknessMm })),
    ceilings: sorted(architecture.ceilings).map(ceiling => ({ id: ceiling.id, storeyId: ceiling.storeyId, elevationMm: ceiling.elevationMm, thicknessMm: ceiling.thicknessMm ?? null })),
  };
  const payload: ArchitectureInteriorDrawingPayload = { schema: ARCHITECTURE_INTERIOR_DRAWING_SCHEMA, binding, units: { length: 'mm', area: 'mm2', angle: 'deg' }, views: { plan: { storeys: planStoreys }, section }, rendering: { labels: 'stable_codes_only', localizedTextEmbedded: false, source: 'workspace_documents' } };
  if (!bounded(payload) || frames.size > MAX_ITEMS) return { ok: false, code: 'geometry_bounds_exceeded', issues: ['drawing_geometry_out_of_bounds'] };
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_OUTPUT_BYTES) return { ok: false, code: 'output_too_large', issues: ['drawing_payload_limit_exceeded'] };
  const contentHash = hashArchitectureInteriorEvidenceV2(payload);
  const inputs: ArtifactInputBinding[] = modelInputsOverride ? [...modelInputsOverride] : modelInputs(workspace);
  const artifactId = `drawing:architecture-interior:${workspace.workspace.revision}`;
  const evidenceHash = hashArchitectureInteriorEvidenceV2({ schema: 'nexyfab.architecture-interior-drawing-verification.v1', binding, contentHash, inputCount: inputs.length, geometryIntegrity: 'deterministic-bounded' });
  const verification = { status: 'passed' as const, verifierId: 'architecture-interior-drawing-binding.v1' as const, evidenceHash, issues: [] as [] };
  const artifact: DesignArtifactNode = { id: artifactId, kind: 'drawing', revision: workspace.workspace.revision, contentHash, state: 'current', inputs, verification, staleBecause: [] };
  return { ok: true, result: { payload, contentHash, verification, artifact, dependencies: dependencies(inputs, artifactId) } };
}
