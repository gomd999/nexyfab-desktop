import type { ArchitectureInteriorWorkspaceV2 } from './architectureInteriorWorkspace';
import {
  hashArchitectureInteriorEvidenceV2,
  validateArchitectureInteriorWorkspaceV2,
} from './architectureInteriorWorkspace';
import type {
  ArchitectureOpening,
  ArchitectureWall,
  InteriorCeilingSystem,
} from './architectureInteriorDocuments';
import type {
  ArtifactDependencyEdge,
  ArtifactInputBinding,
  DesignArtifactNode,
} from './designArtifactGraph';

export const ARCHITECTURE_INTERIOR_RCP_SCHEMA = 'nexyfab.architecture-interior-rcp.v1' as const;
const MAX_ITEMS = 10_000;
const MAX_COORDINATE_MM = 1_000_000_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
type Point2 = [number, number];
type Point3 = [number, number, number];

export type ArchitectureInteriorRcpBinding = {
  projectId: string;
  revision: number;
  workspaceContentHash: string;
  architectureDocumentId: string;
  interiorDocumentId: string;
  architectureDocumentHash: string;
  interiorDocumentHash: string;
};

export type ArchitectureInteriorRcpPayload = {
  schema: typeof ARCHITECTURE_INTERIOR_RCP_SCHEMA;
  binding: ArchitectureInteriorRcpBinding;
  units: { length: 'mm'; area: 'mm2'; angle: 'deg' };
  view: {
    kind: 'reflected_ceiling_plan';
    projection: 'ceiling_down';
    storeys: Array<{
      id: string;
      elevationMm: number;
      topElevationMm: number;
      spaces: Array<{ id: string; boundaryMm: Point2[]; ceilingId: string; wallIds: string[] }>;
      ceilings: Array<{
        id: string;
        spaceId: string;
        storeyId: string;
        boundaryMm: Point2[];
        elevationMm: number;
        thicknessMm: number | null;
      }>;
      openings: Array<{
        id: string;
        kindCode: 'door' | 'window';
        hostWallId: string;
        hostSpaceIds: string[];
        positionMm: Point3;
        offsetMm: number;
        widthMm: number;
        heightMm: number;
        sillMm: number;
      }>;
      ceilingSystems: Array<{
        id: string;
        spaceId: string;
        hostCeilingId: string;
        kind: InteriorCeilingSystem['kind'];
        elevationMm: number;
        moduleMm?: Point2;
      }>;
      lights: Array<{
        id: string;
        spaceId: string;
        hostCeilingId: string;
        positionMm: Point3;
        suspensionMm: number;
        lumens: number;
        cctK: number;
        iesProfileId?: string;
        yawDeg: number;
      }>;
    }>;
  };
  rendering: { labels: 'stable_codes_only'; localizedTextEmbedded: false; source: 'workspace_documents' };
};

export type ArchitectureInteriorRcpArtifact = {
  payload: ArchitectureInteriorRcpPayload;
  contentHash: string;
  verification: { status: 'passed'; verifierId: 'architecture-interior-rcp-structural.v1'; evidenceHash: string; issues: [] };
  artifact: DesignArtifactNode;
  dependencies: ArtifactDependencyEdge[];
};

export type ArchitectureInteriorRcpResult =
  | { ok: true; result: ArchitectureInteriorRcpArtifact }
  | { ok: false; code: 'invalid_workspace' | 'geometry_bounds_exceeded' | 'unsafe_identifier' | 'output_too_large' | 'rcp_reconciliation_failed'; issues: string[] };

export type ArchitectureInteriorRcpVerification = { status: 'passed'; verifierId: 'architecture-interior-rcp-structural.v1'; issues: [] } | { status: 'failed'; verifierId: 'architecture-interior-rcp-structural.v1'; issues: string[] };

function finite(value: number): boolean { return Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE_MM; }
function bounded(value: unknown): boolean {
  if (typeof value === 'number') return finite(value);
  if (Array.isArray(value)) return value.length <= MAX_ITEMS && value.every(bounded);
  if (value && typeof value === 'object') return Object.values(value).length <= MAX_ITEMS && Object.values(value).every(bounded);
  return true;
}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function finitePoint(value: unknown, size: 2 | 3): boolean { return Array.isArray(value) && value.length === size && value.every(item => typeof item === 'number' && finite(item)); }
function unsafeIdentifier(value: string): boolean { return value.length > 128 || !value.trim() || value.includes('://') || value.includes('/') || value.includes('\\') || /(?:bearer|password|secret|token)/i.test(value); }
function sorted<T extends { id: string }>(values: readonly T[]): T[] { return [...values].sort((a, b) => a.id.localeCompare(b.id)); }
function sameArray(left: readonly unknown[], right: readonly unknown[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function documentHash(value: unknown): string { return hashArchitectureInteriorEvidenceV2(value); }
function modelInputs(workspace: ArchitectureInteriorWorkspaceV2): ArtifactInputBinding[] {
  return workspace.artifactGraph.artifacts.filter(item => item.kind === 'model' && item.state === 'current').sort((a, b) => a.id.localeCompare(b.id)).map(item => ({ artifactId: item.id, revision: item.revision, contentHash: item.contentHash }));
}
function resolveModelInputs(workspace: ArchitectureInteriorWorkspaceV2, override?: readonly ArtifactInputBinding[]): { inputs: ArtifactInputBinding[]; issues: string[] } {
  const current = modelInputs(workspace);
  if (!override) return { inputs: current, issues: [] };
  const issues: string[] = [];
  if (!Array.isArray(override)) return { inputs: [], issues: ['model_input_binding_invalid'] };
  const raw = override as readonly unknown[];
  if (raw.some(item => !isRecord(item) || typeof item.artifactId !== 'string' || !item.artifactId.trim())) return { inputs: [], issues: ['model_input_binding_invalid'] };
  const supplied = raw as readonly ArtifactInputBinding[];
  const sortedSupplied = [...supplied].sort((a, b) => a.artifactId.localeCompare(b.artifactId));
  if (sortedSupplied.length !== current.length) issues.push('model_input_set_stale');
  if (sortedSupplied.some((item, index) => !Number.isSafeInteger(item.revision) || item.revision < 0 || !SHA256.test(item.contentHash) || sortedSupplied.findIndex(other => other.artifactId === item.artifactId) !== index)) issues.push('model_input_binding_invalid');
  if (sortedSupplied.length === current.length && sortedSupplied.some((item, index) => item.artifactId !== current[index]?.artifactId || item.revision !== current[index]?.revision || item.contentHash !== current[index]?.contentHash)) issues.push('model_input_binding_stale');
  return { inputs: [...sortedSupplied], issues };
}
function dependencies(inputs: readonly ArtifactInputBinding[], targetId: string): ArtifactDependencyEdge[] {
  return inputs.map((input, index) => ({ id: `rcp-dependency-${index + 1}-${hashArchitectureInteriorEvidenceV2(`${input.artifactId}:${targetId}`).slice(0, 16)}`, sourceId: input.artifactId, targetId, policy: 'invalidate' as const }));
}
function copyBoundary(value: readonly Point2[]): Point2[] { return value.map(point => [...point] as Point2); }
function wallForOpening(opening: ArchitectureOpening, walls: Map<string, ArchitectureWall>): ArchitectureWall | undefined { return walls.get(opening.hostWallId); }
function hostSpaces(opening: ArchitectureOpening, architecture: ArchitectureInteriorWorkspaceV2['architecture']['document'], wall: ArchitectureWall): string[] {
  const explicit = opening.connectsSpaceIds?.filter(id => architecture.spaces.some(space => space.id === id && space.storeyId === wall.storeyId));
  if (explicit?.length) return [...new Set(explicit)].sort((a, b) => a.localeCompare(b));
  return architecture.spaces.filter(space => space.storeyId === wall.storeyId && space.wallIds.includes(wall.id)).map(space => space.id).sort((a, b) => a.localeCompare(b));
}

function stableIdIssues(workspace: ArchitectureInteriorWorkspaceV2): string[] {
  const ids = [workspace.projectId, workspace.architecture.documentId, workspace.interior.documentId,
    ...workspace.architecture.document.storeys, ...workspace.architecture.document.spaces, ...workspace.architecture.document.walls,
    ...workspace.architecture.document.slabs, ...workspace.architecture.document.ceilings, ...workspace.architecture.document.openings,
    ...(workspace.architecture.document.serviceOpenings ?? []), ...(workspace.architecture.document.grids ?? []), ...(workspace.architecture.document.roofs ?? []),
    ...(workspace.architecture.document.stairs ?? []), ...(workspace.architecture.document.zones ?? []), ...workspace.interior.document.lights,
    ...workspace.interior.document.furniture, ...workspace.interior.document.finishes, ...(workspace.interior.document.millwork ?? []),
    ...(workspace.interior.document.ceilingSystems ?? []), ...(workspace.interior.document.acousticZones ?? [])].map(item => typeof item === 'string' ? item : item.id);
  const seen = new Set<string>(), issues: string[] = [];
  for (const id of ids) { if (unsafeIdentifier(id)) issues.push(`unsafe_or_empty_id:${id || '(empty)'}`); if (seen.has(id)) issues.push(`duplicate_stable_id:${id}`); seen.add(id); }
  return issues;
}

function hostIssues(workspace: ArchitectureInteriorWorkspaceV2): string[] {
  const architecture = workspace.architecture.document, interior = workspace.interior.document;
  const storeys = new Map(architecture.storeys.map(item => [item.id, item])), spaces = new Map(architecture.spaces.map(item => [item.id, item]));
  const walls = new Map(architecture.walls.map(item => [item.id, item])), ceilings = new Map(architecture.ceilings.map(item => [item.id, item]));
  const issues: string[] = [];
  for (const space of architecture.spaces) {
    const ceiling = ceilings.get(space.ceilingId);
    if (!storeys.has(space.storeyId) || !ceiling || ceiling.spaceId !== space.id || ceiling.storeyId !== space.storeyId || space.wallIds.some(id => !walls.has(id) || walls.get(id)?.storeyId !== space.storeyId)) issues.push(`space_host:${space.id}`);
  }
  for (const opening of architecture.openings) {
    const wall = wallForOpening(opening, walls);
    if (!wall || !storeys.has(wall.storeyId) || hostSpaces(opening, architecture, wall).some(id => spaces.get(id)?.storeyId !== wall.storeyId)) issues.push(`opening_host:${opening.id}`);
  }
  for (const system of interior.ceilingSystems ?? []) {
    const space = spaces.get(system.spaceId), ceiling = ceilings.get(system.hostCeilingId), storey = space ? storeys.get(space.storeyId) : undefined;
    if (!space || !ceiling || !storey || space.ceilingId !== ceiling.id || ceiling.spaceId !== space.id || ceiling.storeyId !== space.storeyId || ceiling.elevationMm < storey.elevationMm || ceiling.elevationMm > storey.elevationMm + storey.heightMm || system.elevationMm < storey.elevationMm || system.elevationMm > ceiling.elevationMm) issues.push(`ceiling_system_host:${system.id}`);
  }
  for (const light of interior.lights) {
    const space = spaces.get(light.spaceId), ceiling = ceilings.get(light.hostCeilingId), storey = space ? storeys.get(space.storeyId) : undefined;
    if (!space || !ceiling || !storey || space.ceilingId !== ceiling.id || ceiling.spaceId !== space.id || ceiling.storeyId !== space.storeyId || light.positionMm[2] < storey.elevationMm || light.positionMm[2] > storey.elevationMm + storey.heightMm) issues.push(`light_host:${light.id}`);
  }
  return issues;
}

function bindingFor(workspace: ArchitectureInteriorWorkspaceV2): ArchitectureInteriorRcpBinding {
  return { projectId: workspace.projectId, revision: workspace.workspace.revision, workspaceContentHash: workspace.contentHash, architectureDocumentId: workspace.architecture.documentId, interiorDocumentId: workspace.interior.documentId, architectureDocumentHash: documentHash(workspace.architecture.document), interiorDocumentHash: documentHash(workspace.interior.document) };
}

function makePayload(workspace: ArchitectureInteriorWorkspaceV2): ArchitectureInteriorRcpPayload {
  const architecture = workspace.architecture.document, interior = workspace.interior.document;
  const walls = new Map(architecture.walls.map(item => [item.id, item]));
  const spaces = new Map(architecture.spaces.map(item => [item.id, item]));
  const systemByStorey = (storeyId: string) => sorted((interior.ceilingSystems ?? []).filter(system => spaces.get(system.spaceId)?.storeyId === storeyId)).map(system => ({ id: system.id, spaceId: system.spaceId, hostCeilingId: system.hostCeilingId, kind: system.kind, elevationMm: system.elevationMm, ...(system.moduleMm ? { moduleMm: [...system.moduleMm] as Point2 } : {}) }));
  const lightsByStorey = (storeyId: string) => sorted(interior.lights.filter(light => spaces.get(light.spaceId)?.storeyId === storeyId)).map(light => ({ id: light.id, spaceId: light.spaceId, hostCeilingId: light.hostCeilingId, positionMm: [...light.positionMm] as Point3, suspensionMm: light.suspensionMm, lumens: light.lumens, cctK: light.cctK, ...(light.iesProfileId ? { iesProfileId: light.iesProfileId } : {}), yawDeg: light.yawDeg ?? 0 }));
  const openingsByStorey = (storeyId: string) => sorted(architecture.openings.filter(opening => walls.get(opening.hostWallId)?.storeyId === storeyId)).map(opening => { const wall = walls.get(opening.hostWallId)!; return { id: opening.id, kindCode: opening.kind, hostWallId: opening.hostWallId, hostSpaceIds: hostSpaces(opening, architecture, wall), positionMm: [...opening.positionMm] as Point3, offsetMm: opening.offsetMm, widthMm: opening.widthMm, heightMm: opening.heightMm, sillMm: opening.sillMm }; });
  return {
    schema: ARCHITECTURE_INTERIOR_RCP_SCHEMA,
    binding: bindingFor(workspace),
    units: { length: 'mm', area: 'mm2', angle: 'deg' },
    view: { kind: 'reflected_ceiling_plan', projection: 'ceiling_down', storeys: sorted(architecture.storeys).map(storey => ({
      id: storey.id, elevationMm: storey.elevationMm, topElevationMm: storey.elevationMm + storey.heightMm,
      spaces: sorted(architecture.spaces.filter(space => space.storeyId === storey.id)).map(space => ({ id: space.id, boundaryMm: copyBoundary(space.boundaryMm), ceilingId: space.ceilingId, wallIds: [...space.wallIds] })),
      ceilings: sorted(architecture.ceilings.filter(ceiling => ceiling.storeyId === storey.id)).map(ceiling => ({ id: ceiling.id, spaceId: ceiling.spaceId, storeyId: ceiling.storeyId, boundaryMm: copyBoundary(ceiling.boundaryMm), elevationMm: ceiling.elevationMm, thicknessMm: ceiling.thicknessMm ?? null })),
      openings: openingsByStorey(storey.id), ceilingSystems: systemByStorey(storey.id), lights: lightsByStorey(storey.id),
    })) },
    rendering: { labels: 'stable_codes_only', localizedTextEmbedded: false, source: 'workspace_documents' },
  };
}

function shapeIssues(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return ['payload_not_object'];
  const value = payload as Partial<ArchitectureInteriorRcpPayload>;
  const issues: string[] = [];
  if (value.schema !== ARCHITECTURE_INTERIOR_RCP_SCHEMA) issues.push('payload_schema_invalid');
  if (!value.binding || typeof value.binding !== 'object' || !SHA256.test(value.binding.workspaceContentHash ?? '') || !SHA256.test(value.binding.architectureDocumentHash ?? '') || !SHA256.test(value.binding.interiorDocumentHash ?? '')) issues.push('payload_binding_invalid');
  if (value.units?.length !== 'mm' || value.units?.area !== 'mm2' || value.units?.angle !== 'deg') issues.push('payload_units_invalid');
  if (value.view?.kind !== 'reflected_ceiling_plan' || value.view?.projection !== 'ceiling_down' || !Array.isArray(value.view?.storeys)) issues.push('payload_view_invalid');
  if (value.rendering?.labels !== 'stable_codes_only' || value.rendering?.localizedTextEmbedded !== false || value.rendering?.source !== 'workspace_documents') issues.push('payload_rendering_invalid');
  if (!bounded(payload)) issues.push('payload_bounds_invalid');
  const storeys = value.view?.storeys;
  if (Array.isArray(storeys)) storeys.forEach((storey, storeyIndex) => {
    if (!isRecord(storey) || typeof storey.id !== 'string' || !storey.id.trim() || typeof storey.elevationMm !== 'number' || typeof storey.topElevationMm !== 'number' || !Array.isArray(storey.spaces) || !Array.isArray(storey.ceilings) || !Array.isArray(storey.openings) || !Array.isArray(storey.ceilingSystems) || !Array.isArray(storey.lights)) { issues.push(`storey_shape_invalid:${storeyIndex}`); return; }
    if (!finite(storey.elevationMm) || !finite(storey.topElevationMm)) issues.push(`storey_bounds_invalid:${storeyIndex}`);
    storey.spaces.forEach((space, index) => { if (!isRecord(space) || typeof space.id !== 'string' || typeof space.ceilingId !== 'string' || !Array.isArray(space.wallIds) || space.wallIds.some(id => typeof id !== 'string') || !Array.isArray(space.boundaryMm) || space.boundaryMm.some(point => !finitePoint(point, 2))) issues.push(`space_shape_invalid:${storeyIndex}:${index}`); });
    storey.ceilings.forEach((ceiling, index) => { if (!isRecord(ceiling) || typeof ceiling.id !== 'string' || typeof ceiling.spaceId !== 'string' || typeof ceiling.storeyId !== 'string' || typeof ceiling.elevationMm !== 'number' || (ceiling.thicknessMm !== null && typeof ceiling.thicknessMm !== 'number') || !Array.isArray(ceiling.boundaryMm) || ceiling.boundaryMm.some(point => !finitePoint(point, 2))) issues.push(`ceiling_shape_invalid:${storeyIndex}:${index}`); });
    storey.openings.forEach((opening, index) => { if (!isRecord(opening) || typeof opening.id !== 'string' || (opening.kindCode !== 'door' && opening.kindCode !== 'window') || typeof opening.hostWallId !== 'string' || !Array.isArray(opening.hostSpaceIds) || opening.hostSpaceIds.some(id => typeof id !== 'string') || !finitePoint(opening.positionMm, 3) || ![opening.offsetMm, opening.widthMm, opening.heightMm, opening.sillMm].every(item => typeof item === 'number' && finite(item))) issues.push(`opening_shape_invalid:${storeyIndex}:${index}`); });
    storey.ceilingSystems.forEach((system, index) => { if (!isRecord(system) || typeof system.id !== 'string' || typeof system.spaceId !== 'string' || typeof system.hostCeilingId !== 'string' || !['gypsum', 'grid', 'open', 'acoustic'].includes(String(system.kind)) || typeof system.elevationMm !== 'number' || (system.moduleMm !== undefined && !finitePoint(system.moduleMm, 2))) issues.push(`ceiling_system_shape_invalid:${storeyIndex}:${index}`); });
    storey.lights.forEach((light, index) => { if (!isRecord(light) || typeof light.id !== 'string' || typeof light.spaceId !== 'string' || typeof light.hostCeilingId !== 'string' || !finitePoint(light.positionMm, 3) || ![light.suspensionMm, light.lumens, light.cctK, light.yawDeg].every(item => typeof item === 'number' && finite(item))) issues.push(`light_shape_invalid:${storeyIndex}:${index}`); });
  });
  const emittedIds: string[] = [];
  if (Array.isArray(storeys)) for (const storey of storeys) if (isRecord(storey)) {
    if (typeof storey.id === 'string') emittedIds.push(storey.id);
    for (const key of ['spaces', 'ceilings', 'openings', 'ceilingSystems', 'lights'] as const) if (Array.isArray(storey[key])) for (const item of storey[key]) if (isRecord(item) && typeof item.id === 'string') emittedIds.push(item.id);
  }
  const seenIds = new Set<string>();
  for (const id of emittedIds) { if (unsafeIdentifier(id)) issues.push(`payload_stable_id_invalid:${id || '(empty)'}`); if (seenIds.has(id)) issues.push(`payload_stable_id_duplicate:${id}`); seenIds.add(id); }
  return issues;
}

/** Parses the JSON interchange payload without invoking the builder. */
export function parseArchitectureInteriorRcpDrawing(input: string): { ok: true; payload: ArchitectureInteriorRcpPayload } | { ok: false; issues: string[] } {
  let parsed: unknown;
  try { parsed = JSON.parse(input) as unknown; } catch { return { ok: false, issues: ['payload_json_invalid'] }; }
  const issues = shapeIssues(parsed);
  return issues.length ? { ok: false, issues } : { ok: true, payload: parsed as ArchitectureInteriorRcpPayload };
}

/** Independent structural check used for persisted/transported RCP artifacts. */
function verifyArchitectureInteriorRcpDrawingArtifactInternal(input: { payload: unknown; contentHash: unknown }, workspace: ArchitectureInteriorWorkspaceV2): ArchitectureInteriorRcpVerification {
  const issues = [...validateArchitectureInteriorWorkspaceV2(workspace), ...shapeIssues(input.payload)];
  if (typeof input.contentHash !== 'string' || hashArchitectureInteriorEvidenceV2(input.payload) !== input.contentHash) issues.push('payload_content_hash_mismatch');
  const payload = input.payload as Partial<ArchitectureInteriorRcpPayload>;
  const expected = bindingFor(workspace);
  if (payload.binding) for (const key of Object.keys(expected) as Array<keyof ArchitectureInteriorRcpBinding>) if (payload.binding[key] !== expected[key]) issues.push(`binding_mismatch:${key}`);
  const architecture = workspace.architecture.document, interior = workspace.interior.document;
  const storeys = payload.view?.storeys ?? [];
  const expectedStoreyIds = architecture.storeys.map(item => item.id).sort((a, b) => a.localeCompare(b));
  if (storeys.map(item => item.id).sort((a, b) => a.localeCompare(b)).join('|') !== expectedStoreyIds.join('|')) issues.push('storey_set_mismatch');
  const sourceIds = new Set([...architecture.ceilings.map(item => item.id), ...architecture.openings.map(item => item.id), ...(interior.ceilingSystems ?? []).map(item => item.id), ...interior.lights.map(item => item.id)]);
  const outputIds = new Set(storeys.flatMap(item => [...item.ceilings, ...item.openings, ...item.ceilingSystems, ...item.lights].map(value => value.id)));
  if (sourceIds.size !== outputIds.size || [...sourceIds].some(id => !outputIds.has(id))) issues.push('source_object_set_mismatch');
  const walls = new Map(architecture.walls.map(item => [item.id, item])), ceilings = new Map(architecture.ceilings.map(item => [item.id, item]));
  const sourceStoreys = new Map(architecture.storeys.map(item => [item.id, item]));
  for (const storey of storeys) {
    const sourceStorey = sourceStoreys.get(storey.id);
    if (!sourceStorey || sourceStorey.elevationMm !== storey.elevationMm || sourceStorey.elevationMm + sourceStorey.heightMm !== storey.topElevationMm) issues.push(`storey_mismatch:${storey.id}`);
    const sourceSpaces = architecture.spaces.filter(space => space.storeyId === storey.id).sort((a, b) => a.id.localeCompare(b.id));
    if (sourceSpaces.length !== storey.spaces.length || sourceSpaces.some((source, index) => {
      const output = storey.spaces[index];
      return !output || source.id !== output.id || source.ceilingId !== output.ceilingId || !sameArray(source.wallIds, output.wallIds) || !sameArray(source.boundaryMm.flat(), output.boundaryMm.flat());
    })) issues.push(`space_set_or_geometry_mismatch:${storey.id}`);
    for (const ceiling of storey.ceilings) {
      const source = ceilings.get(ceiling.id);
      if (!source || source.spaceId !== ceiling.spaceId || source.storeyId !== storey.id || source.elevationMm !== ceiling.elevationMm || source.thicknessMm !== (ceiling.thicknessMm ?? undefined) || !sameArray(source.boundaryMm.flat(), ceiling.boundaryMm.flat())) issues.push(`ceiling_mismatch:${ceiling.id}`);
    }
    for (const opening of storey.openings) {
      const source = architecture.openings.find(item => item.id === opening.id), wall = walls.get(opening.hostWallId);
      const expectedHostSpaces = source && wall ? hostSpaces(source, architecture, wall) : [];
      if (!source || source.hostWallId !== opening.hostWallId || !wall || wall.storeyId !== storey.id || !sameArray(expectedHostSpaces, opening.hostSpaceIds) || !sameArray(source.positionMm, opening.positionMm) || source.offsetMm !== opening.offsetMm || source.widthMm !== opening.widthMm || source.heightMm !== opening.heightMm || source.sillMm !== opening.sillMm) issues.push(`opening_mismatch:${opening.id}`);
    }
    for (const system of storey.ceilingSystems) {
      const source = interior.ceilingSystems?.find(item => item.id === system.id);
      if (!source || source.spaceId !== system.spaceId || source.hostCeilingId !== system.hostCeilingId || source.kind !== system.kind || source.elevationMm !== system.elevationMm || !ceilings.has(system.hostCeilingId) || !sameArray(source.moduleMm ?? [], system.moduleMm ?? [])) issues.push(`ceiling_system_mismatch:${system.id}`);
    }
    for (const light of storey.lights) {
      const source = interior.lights.find(item => item.id === light.id);
      if (!source || source.spaceId !== light.spaceId || source.hostCeilingId !== light.hostCeilingId || !sameArray(source.positionMm, light.positionMm) || source.suspensionMm !== light.suspensionMm || source.lumens !== light.lumens || source.cctK !== light.cctK || (source.iesProfileId ?? undefined) !== (light.iesProfileId ?? undefined) || (source.yawDeg ?? 0) !== light.yawDeg) issues.push(`light_mismatch:${light.id}`);
    }
  }
  return issues.length ? { status: 'failed', verifierId: 'architecture-interior-rcp-structural.v1', issues: [...new Set(issues)] } : { status: 'passed', verifierId: 'architecture-interior-rcp-structural.v1', issues: [] };
}

export function verifyArchitectureInteriorRcpDrawingArtifact(input: { payload: unknown; contentHash: unknown }, workspace: ArchitectureInteriorWorkspaceV2): ArchitectureInteriorRcpVerification {
  try { return verifyArchitectureInteriorRcpDrawingArtifactInternal(input, workspace); }
  catch { return { status: 'failed', verifierId: 'architecture-interior-rcp-structural.v1', issues: ['verifier_exception'] }; }
}

export function buildArchitectureInteriorRcpArtifact(workspace: ArchitectureInteriorWorkspaceV2, modelInputsOverride?: readonly ArtifactInputBinding[]): ArchitectureInteriorRcpResult {
  let workspaceIssues: string[];
  try { workspaceIssues = validateArchitectureInteriorWorkspaceV2(workspace); } catch { return { ok: false, code: 'invalid_workspace', issues: ['workspace_validation_failed'] }; }
  if (workspaceIssues.length) return { ok: false, code: 'invalid_workspace', issues: workspaceIssues };
  const ids = stableIdIssues(workspace); if (ids.length) return { ok: false, code: 'unsafe_identifier', issues: ids.slice(0, 32) };
  const hosts = hostIssues(workspace); if (hosts.length) return { ok: false, code: 'rcp_reconciliation_failed', issues: hosts.slice(0, 32) };
  let payload: ArchitectureInteriorRcpPayload;
  try { payload = makePayload(workspace); } catch { return { ok: false, code: 'rcp_reconciliation_failed', issues: ['rcp_payload_build_failed'] }; }
  if (!bounded(payload)) return { ok: false, code: 'geometry_bounds_exceeded', issues: ['rcp_geometry_out_of_bounds'] };
  const serialized = JSON.stringify(payload); if (Buffer.byteLength(serialized, 'utf8') > MAX_OUTPUT_BYTES) return { ok: false, code: 'output_too_large', issues: ['rcp_payload_limit_exceeded'] };
  const contentHash = hashArchitectureInteriorEvidenceV2(payload);
  const structural = verifyArchitectureInteriorRcpDrawingArtifact({ payload, contentHash }, workspace);
  if (structural.status !== 'passed') return { ok: false, code: 'rcp_reconciliation_failed', issues: structural.issues };
  const resolvedInputs = resolveModelInputs(workspace, modelInputsOverride);
  if (resolvedInputs.issues.length) return { ok: false, code: 'rcp_reconciliation_failed', issues: resolvedInputs.issues };
  const inputs = resolvedInputs.inputs, artifactId = `drawing:interior-rcp:${workspace.workspace.revision}`;
  const evidenceHash = hashArchitectureInteriorEvidenceV2({ schema: `${ARCHITECTURE_INTERIOR_RCP_SCHEMA}-verification`, binding: payload.binding, contentHash, sourceObjectCount: [...workspace.architecture.document.ceilings, ...workspace.architecture.document.openings, ...(workspace.interior.document.ceilingSystems ?? []), ...workspace.interior.document.lights].length });
  const verification = { status: 'passed' as const, verifierId: 'architecture-interior-rcp-structural.v1' as const, evidenceHash, issues: [] as [] };
  const artifact: DesignArtifactNode = { id: artifactId, kind: 'drawing', revision: workspace.workspace.revision, contentHash, state: 'current', inputs, verification, staleBecause: [] };
  return { ok: true, result: { payload, contentHash, verification, artifact, dependencies: dependencies(inputs, artifactId) } };
}
