import type { ArchitectureInteriorWorkspaceV2 } from './architectureInteriorWorkspace';
import {
  hashArchitectureInteriorEvidenceV2,
  validateArchitectureInteriorWorkspaceV2,
} from './architectureInteriorWorkspace';
import type { ArchitectureWall } from './architectureInteriorDocuments';
import type {
  ArtifactDependencyEdge,
  ArtifactInputBinding,
  DesignArtifactNode,
} from './designArtifactGraph';

export const ARCHITECTURE_INTERIOR_ELEVATION_SCHEMA = 'nexyfab.architecture-interior-elevation.v1' as const;
const MAX_ITEMS = 10_000;
const MAX_COORDINATE_MM = 1_000_000_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
type Point2 = [number, number];
type Point3 = [number, number, number];

export type ArchitectureInteriorElevationBinding = {
  projectId: string;
  revision: number;
  workspaceContentHash: string;
  architectureDocumentId: string;
  interiorDocumentId: string;
  architectureDocumentHash: string;
  interiorDocumentHash: string;
};

type ElevationGeometry =
  | { kind: 'line'; startMm: Point2; endMm: Point2 }
  | { kind: 'arc'; centerMm: Point2; radiusMm: number; startAngleDeg: number; endAngleDeg: number };

export type ArchitectureInteriorElevationPayload = {
  schema: typeof ARCHITECTURE_INTERIOR_ELEVATION_SCHEMA;
  binding: ArchitectureInteriorElevationBinding;
  units: { length: 'mm'; area: 'mm2'; angle: 'deg' };
  view: {
    kind: 'orthographic_elevation';
    axis: 'x';
    projection: 'world_z';
    lookDirection: 'positive-y';
    storeys: Array<{
      id: string;
      baseElevationMm: number;
      topElevationMm: number;
      walls: Array<{
        id: string;
        storeyId: string;
        kind: ArchitectureWall['kind'];
        geometry: ElevationGeometry;
        extentMm: { minUMm: number; maxUMm: number; baseElevationMm: number; topElevationMm: number };
        thicknessMm: number;
        heightMm: number;
      }>;
      openings: Array<{
        id: string;
        kindCode: 'door' | 'window';
        hostWallId: string;
        positionMm: Point3;
        projectionMm: { uMm: number; minUMm: number; maxUMm: number; bottomElevationMm: number; topElevationMm: number };
        offsetMm: number;
        widthMm: number;
        heightMm: number;
        sillMm: number;
      }>;
      slabs: Array<{
        id: string;
        storeyId: string;
        spaceId: string;
        boundaryMm: Point2[];
        elevationMm: number;
        thicknessMm: number;
      }>;
      ceilings: Array<{
        id: string;
        storeyId: string;
        spaceId: string;
        boundaryMm: Point2[];
        elevationMm: number;
        thicknessMm: number | null;
      }>;
    }>;
  };
  rendering: { labels: 'stable_codes_only'; localizedTextEmbedded: false; source: 'workspace_documents' };
};

export type ArchitectureInteriorElevationArtifact = {
  payload: ArchitectureInteriorElevationPayload;
  contentHash: string;
  verification: { status: 'passed'; verifierId: 'architecture-interior-elevation-structural.v1'; evidenceHash: string; issues: [] };
  artifact: DesignArtifactNode;
  dependencies: ArtifactDependencyEdge[];
};

export type ArchitectureInteriorElevationResult =
  | { ok: true; result: ArchitectureInteriorElevationArtifact }
  | { ok: false; code: 'invalid_workspace' | 'geometry_bounds_exceeded' | 'unsafe_identifier' | 'output_too_large' | 'elevation_reconciliation_failed'; issues: string[] };

export type ArchitectureInteriorElevationVerification =
  | { status: 'passed'; verifierId: 'architecture-interior-elevation-structural.v1'; issues: [] }
  | { status: 'failed'; verifierId: 'architecture-interior-elevation-structural.v1'; issues: string[] };

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE_MM; }
function positiveFinite(value: unknown): value is number { return finite(value) && value > 0; }
function finitePoint(value: unknown, size: 2 | 3): boolean { return Array.isArray(value) && value.length === size && value.every(finite); }
function bounded(value: unknown): boolean {
  if (typeof value === 'number') return finite(value);
  if (Array.isArray(value)) return value.length <= MAX_ITEMS && value.every(bounded);
  if (isRecord(value)) return Object.keys(value).length <= MAX_ITEMS && Object.values(value).every(bounded);
  return true;
}
function unsafeIdentifier(value: unknown): boolean {
  return typeof value !== 'string' || value.length > 128 || !value.trim() || value.includes('://') || value.includes('/') || value.includes('\\') || /(?:bearer|password|secret|token)/i.test(value);
}
function sorted<T extends { id: string }>(values: readonly T[]): T[] { return [...values].sort((a, b) => a.id.localeCompare(b.id)); }
function sameArray(left: readonly unknown[], right: readonly unknown[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function sameBoundary(left: readonly Point2[], right: readonly Point2[]): boolean { return sameArray(left.flat(), right.flat()); }
function sameObjectKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = [...keys].sort();
  return sameArray(Object.keys(value).sort(), expected);
}
function documentHash(value: unknown): string { return hashArchitectureInteriorEvidenceV2(value); }
function modelInputs(workspace: ArchitectureInteriorWorkspaceV2): ArtifactInputBinding[] {
  return workspace.artifactGraph.artifacts.filter(item => item.kind === 'model' && item.state === 'current').sort((a, b) => a.id.localeCompare(b.id)).map(item => ({ artifactId: item.id, revision: item.revision, contentHash: item.contentHash }));
}
function resolveModelInputs(workspace: ArchitectureInteriorWorkspaceV2, override?: readonly ArtifactInputBinding[]): { inputs: ArtifactInputBinding[]; issues: string[] } {
  const current = modelInputs(workspace);
  if (override === undefined) return { inputs: current, issues: [] };
  if (!Array.isArray(override)) return { inputs: [], issues: ['model_input_binding_invalid'] };
  const issues: string[] = [], raw = override as readonly unknown[];
  if (raw.some(item => !isRecord(item))) return { inputs: [], issues: ['model_input_binding_invalid'] };
  const supplied: ArtifactInputBinding[] = raw.map(item => item as ArtifactInputBinding).sort((a, b) => String(a.artifactId).localeCompare(String(b.artifactId)));
  if (supplied.some(item => unsafeIdentifier(item.artifactId) || !Number.isSafeInteger(item.revision) || item.revision < 0 || !SHA256.test(String(item.contentHash)) || supplied.filter(other => other.artifactId === item.artifactId).length !== 1)) issues.push('model_input_binding_invalid');
  if (supplied.length !== current.length) issues.push('model_input_set_stale');
  if (supplied.length === current.length && supplied.some((item, index) => item.artifactId !== current[index]?.artifactId || item.revision !== current[index]?.revision || item.contentHash !== current[index]?.contentHash)) issues.push('model_input_binding_stale');
  return { inputs: supplied, issues };
}
function dependencies(inputs: readonly ArtifactInputBinding[], targetId: string): ArtifactDependencyEdge[] {
  return inputs.map((input, index) => ({ id: `elevation-dependency-${index + 1}-${hashArchitectureInteriorEvidenceV2(`${input.artifactId}:${targetId}`).slice(0, 16)}`, sourceId: input.artifactId, targetId, policy: 'invalidate' as const }));
}
function wallGeometry(wall: ArchitectureWall): ElevationGeometry {
  return wall.kind === 'line'
    ? { kind: 'line', startMm: [...wall.startMm], endMm: [...wall.endMm] }
    : { kind: 'arc', centerMm: [...wall.centerMm], radiusMm: wall.radiusMm, startAngleDeg: wall.startAngleDeg, endAngleDeg: wall.endAngleDeg };
}
const GEOMETRY_TOLERANCE_MM = 1e-7;
function wallLengthMm(wall: ArchitectureWall): number {
  if (wall.kind === 'line') return Math.hypot(wall.endMm[0] - wall.startMm[0], wall.endMm[1] - wall.startMm[1]);
  return Math.abs(wall.endAngleDeg - wall.startAngleDeg) * Math.PI / 180 * wall.radiusMm;
}
function wallPointAtOffsetMm(wall: ArchitectureWall, offsetMm: number): Point2 {
  if (wall.kind === 'line') {
    const length = wallLengthMm(wall);
    return [wall.startMm[0] + (wall.endMm[0] - wall.startMm[0]) * offsetMm / length, wall.startMm[1] + (wall.endMm[1] - wall.startMm[1]) * offsetMm / length];
  }
  const sweep = wall.endAngleDeg - wall.startAngleDeg;
  const angle = (wall.startAngleDeg + Math.sign(sweep || 1) * offsetMm / wall.radiusMm * 180 / Math.PI) * Math.PI / 180;
  return [wall.centerMm[0] + Math.cos(angle) * wall.radiusMm, wall.centerMm[1] + Math.sin(angle) * wall.radiusMm];
}
function openingProjectionMm(wall: ArchitectureWall, opening: { offsetMm: number; widthMm: number }): { uMm: number; minUMm: number; maxUMm: number } {
  const center = wallPointAtOffsetMm(wall, opening.offsetMm);
  const start = wallPointAtOffsetMm(wall, opening.offsetMm - opening.widthMm / 2);
  const end = wallPointAtOffsetMm(wall, opening.offsetMm + opening.widthMm / 2);
  if (wall.kind === 'line') return { uMm: center[0], minUMm: Math.min(start[0], end[0]), maxUMm: Math.max(start[0], end[0]) };
  const direction = Math.sign(wall.endAngleDeg - wall.startAngleDeg) || 1;
  const startOffsetMm = opening.offsetMm - opening.widthMm / 2;
  const openingSweepDeg = opening.widthMm / wall.radiusMm * 180 / Math.PI;
  const startAngleDeg = wall.startAngleDeg + direction * startOffsetMm / wall.radiusMm * 180 / Math.PI;
  const extrema = [0, 180].filter(angle => {
    const delta = direction > 0 ? ((angle - startAngleDeg) % 360 + 360) % 360 : ((startAngleDeg - angle) % 360 + 360) % 360;
    return delta <= openingSweepDeg + 1e-9;
  }).map(angle => wall.centerMm[0] + Math.cos(angle * Math.PI / 180) * wall.radiusMm);
  const values = [start[0], end[0], ...extrema];
  return { uMm: center[0], minUMm: Math.min(...values), maxUMm: Math.max(...values) };
}
function openingGeometryIssues(workspace: ArchitectureInteriorWorkspaceV2): string[] {
  const architecture = workspace.architecture.document;
  const storeys = new Map(architecture.storeys.map(item => [item.id, item]));
  const walls = new Map(architecture.walls.map(item => [item.id, item]));
  const issues: string[] = [];
  for (const opening of architecture.openings) {
    const wall = walls.get(opening.hostWallId), storey = wall ? storeys.get(wall.storeyId) : undefined;
    if (!wall || !storey) { issues.push(`opening_host:${opening.id}`); continue; }
    const length = wallLengthMm(wall), startOffset = opening.offsetMm - opening.widthMm / 2, endOffset = opening.offsetMm + opening.widthMm / 2;
    if (startOffset < -GEOMETRY_TOLERANCE_MM || endOffset > length + GEOMETRY_TOLERANCE_MM) issues.push(`opening_interval:${opening.id}`);
    if (opening.sillMm + opening.heightMm > wall.heightMm + GEOMETRY_TOLERANCE_MM) issues.push(`opening_vertical_extent:${opening.id}`);
    const expected = wallPointAtOffsetMm(wall, opening.offsetMm);
    if (Math.hypot(opening.positionMm[0] - expected[0], opening.positionMm[1] - expected[1]) > GEOMETRY_TOLERANCE_MM) issues.push(`opening_position_xy:${opening.id}`);
    if (Math.abs(opening.positionMm[2] - opening.sillMm) > GEOMETRY_TOLERANCE_MM) issues.push(`opening_position_z:${opening.id}`);
  }
  return issues;
}
function wallUMinMax(wall: ArchitectureWall): [number, number] {
  if (wall.kind === 'line') return [Math.min(wall.startMm[0], wall.endMm[0]), Math.max(wall.startMm[0], wall.endMm[0])];
  const sweep = wall.endAngleDeg - wall.startAngleDeg, direction = Math.sign(sweep) || 1;
  const candidates = [wall.startAngleDeg, wall.endAngleDeg, 0, 180].filter(angle => {
    const delta = direction > 0 ? ((angle - wall.startAngleDeg) % 360 + 360) % 360 : ((wall.startAngleDeg - angle) % 360 + 360) % 360;
    return delta <= Math.abs(sweep) + 1e-9;
  });
  const points = candidates.map(angle => wall.centerMm[0] + Math.cos(angle * Math.PI / 180) * wall.radiusMm);
  return [Math.min(...points), Math.max(...points)];
}
function bindingFor(workspace: ArchitectureInteriorWorkspaceV2): ArchitectureInteriorElevationBinding {
  return { projectId: workspace.projectId, revision: workspace.workspace.revision, workspaceContentHash: workspace.contentHash, architectureDocumentId: workspace.architecture.documentId, interiorDocumentId: workspace.interior.documentId, architectureDocumentHash: documentHash(workspace.architecture.document), interiorDocumentHash: documentHash(workspace.interior.document) };
}
function makePayload(workspace: ArchitectureInteriorWorkspaceV2): ArchitectureInteriorElevationPayload {
  const architecture = workspace.architecture.document;
  return {
    schema: ARCHITECTURE_INTERIOR_ELEVATION_SCHEMA,
    binding: bindingFor(workspace),
    units: { length: 'mm', area: 'mm2', angle: 'deg' },
    view: {
      kind: 'orthographic_elevation', axis: 'x', projection: 'world_z', lookDirection: 'positive-y',
      storeys: sorted(architecture.storeys).map(storey => ({
        id: storey.id, baseElevationMm: storey.elevationMm, topElevationMm: storey.elevationMm + storey.heightMm,
        walls: sorted(architecture.walls.filter(wall => wall.storeyId === storey.id)).map(wall => { const [minU, maxU] = wallUMinMax(wall); return { id: wall.id, storeyId: wall.storeyId, kind: wall.kind, geometry: wallGeometry(wall), extentMm: { minUMm: minU, maxUMm: maxU, baseElevationMm: storey.elevationMm, topElevationMm: storey.elevationMm + wall.heightMm }, thicknessMm: wall.thicknessMm, heightMm: wall.heightMm }; }),
        openings: sorted(architecture.openings.filter(opening => architecture.walls.find(wall => wall.id === opening.hostWallId)?.storeyId === storey.id)).map(opening => {
          const wall = architecture.walls.find(candidate => candidate.id === opening.hostWallId)!;
          const projection = openingProjectionMm(wall, opening);
          return { id: opening.id, kindCode: opening.kind, hostWallId: opening.hostWallId, positionMm: [...opening.positionMm] as Point3, projectionMm: { ...projection, bottomElevationMm: storey.elevationMm + opening.sillMm, topElevationMm: storey.elevationMm + opening.sillMm + opening.heightMm }, offsetMm: opening.offsetMm, widthMm: opening.widthMm, heightMm: opening.heightMm, sillMm: opening.sillMm };
        }),
        slabs: sorted(architecture.slabs.filter(slab => slab.storeyId === storey.id)).map(slab => ({ id: slab.id, storeyId: slab.storeyId, spaceId: slab.spaceId, boundaryMm: slab.boundaryMm.map(point => [...point] as Point2), elevationMm: storey.elevationMm, thicknessMm: slab.thicknessMm })),
        ceilings: sorted(architecture.ceilings.filter(ceiling => ceiling.storeyId === storey.id)).map(ceiling => ({ id: ceiling.id, storeyId: ceiling.storeyId, spaceId: ceiling.spaceId, boundaryMm: ceiling.boundaryMm.map(point => [...point] as Point2), elevationMm: storey.elevationMm + ceiling.elevationMm, thicknessMm: ceiling.thicknessMm ?? null })),
      })),
    },
    rendering: { labels: 'stable_codes_only', localizedTextEmbedded: false, source: 'workspace_documents' },
  };
}

function shapeIssues(payload: unknown): string[] {
  if (!isRecord(payload)) return ['payload_not_object'];
  const issues: string[] = [];
  if (!sameObjectKeys(payload, ['schema', 'binding', 'units', 'view', 'rendering'])) issues.push('payload_keys_invalid');
  if (payload.schema !== ARCHITECTURE_INTERIOR_ELEVATION_SCHEMA) issues.push('payload_schema_invalid');
  const binding = payload.binding;
  if (!isRecord(binding) || !sameObjectKeys(binding, ['projectId', 'revision', 'workspaceContentHash', 'architectureDocumentId', 'interiorDocumentId', 'architectureDocumentHash', 'interiorDocumentHash']) || unsafeIdentifier(binding.projectId) || unsafeIdentifier(binding.architectureDocumentId) || unsafeIdentifier(binding.interiorDocumentId) || typeof binding.revision !== 'number' || !Number.isSafeInteger(binding.revision) || binding.revision < 0 || !SHA256.test(String(binding.workspaceContentHash)) || !SHA256.test(String(binding.architectureDocumentHash)) || !SHA256.test(String(binding.interiorDocumentHash))) issues.push('payload_binding_invalid');
  const units = payload.units;
  if (!isRecord(units) || !sameObjectKeys(units, ['length', 'area', 'angle']) || units.length !== 'mm' || units.area !== 'mm2' || units.angle !== 'deg') issues.push('payload_units_invalid');
  const view = payload.view;
  if (!isRecord(view) || !sameObjectKeys(view, ['kind', 'axis', 'projection', 'lookDirection', 'storeys']) || view.kind !== 'orthographic_elevation' || view.axis !== 'x' || view.projection !== 'world_z' || view.lookDirection !== 'positive-y' || !Array.isArray(view.storeys)) issues.push('payload_view_invalid');
  const rendering = payload.rendering;
  if (!isRecord(rendering) || !sameObjectKeys(rendering, ['labels', 'localizedTextEmbedded', 'source']) || rendering.labels !== 'stable_codes_only' || rendering.localizedTextEmbedded !== false || rendering.source !== 'workspace_documents') issues.push('payload_rendering_invalid');
  if (!bounded(payload)) issues.push('payload_bounds_invalid');
  const emittedIds: string[] = [];
  if (isRecord(view) && Array.isArray(view.storeys)) view.storeys.forEach((storey, storeyIndex) => {
    if (!isRecord(storey) || !sameObjectKeys(storey, ['id', 'baseElevationMm', 'topElevationMm', 'walls', 'openings', 'slabs', 'ceilings']) || unsafeIdentifier(storey.id) || !finite(storey.baseElevationMm) || !finite(storey.topElevationMm) || storey.topElevationMm < storey.baseElevationMm || !Array.isArray(storey.walls) || !Array.isArray(storey.openings) || !Array.isArray(storey.slabs) || !Array.isArray(storey.ceilings)) { issues.push(`storey_shape_invalid:${storeyIndex}`); return; }
    emittedIds.push(storey.id as string);
    const arrays: Array<[string, unknown[]]> = [['walls', storey.walls], ['openings', storey.openings], ['slabs', storey.slabs], ['ceilings', storey.ceilings]];
    for (const [kind, values] of arrays) values.forEach((item, index) => {
      if (!isRecord(item) || unsafeIdentifier(item.id)) { issues.push(`${kind}_shape_invalid:${storeyIndex}:${index}`); return; }
      emittedIds.push(item.id as string);
      if (kind === 'walls') {
        if (!sameObjectKeys(item, ['id', 'storeyId', 'kind', 'geometry', 'extentMm', 'thicknessMm', 'heightMm']) || unsafeIdentifier(item.storeyId) || !['line', 'arc'].includes(String(item.kind)) || !positiveFinite(item.thicknessMm) || !positiveFinite(item.heightMm) || !isRecord(item.extentMm)) { issues.push(`wall_shape_invalid:${storeyIndex}:${index}`); return; }
        const geometry = item.geometry;
        if (!isRecord(geometry) || geometry.kind !== item.kind || (item.kind === 'line' ? !sameObjectKeys(geometry, ['kind', 'startMm', 'endMm']) || !finitePoint(geometry.startMm, 2) || !finitePoint(geometry.endMm, 2) : !sameObjectKeys(geometry, ['kind', 'centerMm', 'radiusMm', 'startAngleDeg', 'endAngleDeg']) || !finitePoint(geometry.centerMm, 2) || !positiveFinite(geometry.radiusMm) || !finite(geometry.startAngleDeg) || !finite(geometry.endAngleDeg)) || !sameObjectKeys(item.extentMm, ['minUMm', 'maxUMm', 'baseElevationMm', 'topElevationMm']) || !finite(item.extentMm.minUMm) || !finite(item.extentMm.maxUMm) || item.extentMm.maxUMm < item.extentMm.minUMm || !finite(item.extentMm.baseElevationMm) || !finite(item.extentMm.topElevationMm) || item.extentMm.topElevationMm < item.extentMm.baseElevationMm) issues.push(`wall_geometry_invalid:${storeyIndex}:${index}`);
      } else if (kind === 'openings') {
        if (!sameObjectKeys(item, ['id', 'kindCode', 'hostWallId', 'positionMm', 'projectionMm', 'offsetMm', 'widthMm', 'heightMm', 'sillMm']) || !['door', 'window'].includes(String(item.kindCode)) || unsafeIdentifier(item.hostWallId) || !finitePoint(item.positionMm, 3) || !isRecord(item.projectionMm) || !sameObjectKeys(item.projectionMm, ['uMm', 'minUMm', 'maxUMm', 'bottomElevationMm', 'topElevationMm']) || !finite(item.projectionMm.uMm) || !finite(item.projectionMm.minUMm) || !finite(item.projectionMm.maxUMm) || item.projectionMm.maxUMm < item.projectionMm.minUMm || item.projectionMm.uMm < item.projectionMm.minUMm - GEOMETRY_TOLERANCE_MM || item.projectionMm.uMm > item.projectionMm.maxUMm + GEOMETRY_TOLERANCE_MM || !finite(item.projectionMm.bottomElevationMm) || !finite(item.projectionMm.topElevationMm) || item.projectionMm.topElevationMm < item.projectionMm.bottomElevationMm || !finite(item.offsetMm) || item.offsetMm < 0 || !positiveFinite(item.widthMm) || !positiveFinite(item.heightMm) || !finite(item.sillMm) || item.sillMm < 0) issues.push(`opening_shape_invalid:${storeyIndex}:${index}`);
      } else {
        if (!sameObjectKeys(item, ['id', 'storeyId', 'spaceId', 'boundaryMm', 'elevationMm', 'thicknessMm']) || unsafeIdentifier(item.storeyId) || unsafeIdentifier(item.spaceId) || !Array.isArray(item.boundaryMm) || item.boundaryMm.length < 3 || item.boundaryMm.some(point => !finitePoint(point, 2)) || !finite(item.elevationMm) || (kind === 'slabs' ? !positiveFinite(item.thicknessMm) : item.thicknessMm !== null && !positiveFinite(item.thicknessMm))) issues.push(`${kind}_shape_invalid:${storeyIndex}:${index}`);
      }
    });
  });
  const seen = new Set<string>();
  for (const id of emittedIds) { if (seen.has(id)) issues.push(`payload_stable_id_duplicate:${id}`); seen.add(id); }
  return [...new Set(issues)];
}

export function parseArchitectureInteriorElevationDrawing(input: string): { ok: true; payload: ArchitectureInteriorElevationPayload } | { ok: false; issues: string[] } {
  if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > MAX_OUTPUT_BYTES) return { ok: false, issues: ['payload_too_large'] };
  let parsed: unknown;
  try { parsed = JSON.parse(input) as unknown; } catch { return { ok: false, issues: ['payload_json_invalid'] }; }
  const issues = shapeIssues(parsed);
  return issues.length ? { ok: false, issues } : { ok: true, payload: parsed as ArchitectureInteriorElevationPayload };
}

function verifyInternal(input: { payload: unknown; contentHash: unknown }, workspace: ArchitectureInteriorWorkspaceV2): ArchitectureInteriorElevationVerification {
  const issues = [...validateArchitectureInteriorWorkspaceV2(workspace), ...openingGeometryIssues(workspace), ...shapeIssues(input.payload)];
  if (typeof input.contentHash !== 'string' || !SHA256.test(input.contentHash) || hashArchitectureInteriorEvidenceV2(input.payload) !== input.contentHash) issues.push('payload_content_hash_mismatch');
  const payload = input.payload as Partial<ArchitectureInteriorElevationPayload>, expected = bindingFor(workspace);
  if (isRecord(payload.binding)) for (const key of Object.keys(expected) as Array<keyof ArchitectureInteriorElevationBinding>) if (payload.binding[key] !== expected[key]) issues.push(`binding_mismatch:${key}`);
  const architecture = workspace.architecture.document, storeys = payload.view?.storeys ?? [];
  const sourceStoreys = sorted(architecture.storeys), sourceStoreyIds = sourceStoreys.map(item => item.id);
  if (storeys.map(item => item.id).sort((a, b) => a.localeCompare(b)).join('|') !== sourceStoreyIds.join('|')) issues.push('storey_set_mismatch');
  const source = { walls: architecture.walls, openings: architecture.openings, slabs: architecture.slabs, ceilings: architecture.ceilings };
  const output = { walls: storeys.flatMap(item => item.walls), openings: storeys.flatMap(item => item.openings), slabs: storeys.flatMap(item => item.slabs), ceilings: storeys.flatMap(item => item.ceilings) };
  for (const kind of ['walls', 'openings', 'slabs', 'ceilings'] as const) {
    const expectedIds = new Set(source[kind].map(item => item.id)), outputIds = new Set(output[kind].map(item => item.id));
    if (expectedIds.size !== outputIds.size || [...expectedIds].some(id => !outputIds.has(id))) issues.push(`source_${kind}_set_mismatch`);
  }
  const walls = new Map(architecture.walls.map(item => [item.id, item])), sourceStoreyMap = new Map(architecture.storeys.map(item => [item.id, item]));
  for (const storey of storeys) {
    const sourceStorey = sourceStoreyMap.get(storey.id);
    if (!sourceStorey || sourceStorey.elevationMm !== storey.baseElevationMm || sourceStorey.elevationMm + sourceStorey.heightMm !== storey.topElevationMm) issues.push(`storey_mismatch:${storey.id}`);
    for (const wall of storey.walls) {
      const item = walls.get(wall.id), [minU, maxU] = item ? wallUMinMax(item) : [NaN, NaN];
      if (!item || item.storeyId !== storey.id || JSON.stringify(wall.geometry) !== JSON.stringify(wallGeometry(item)) || wall.thicknessMm !== item.thicknessMm || wall.heightMm !== item.heightMm || wall.extentMm.minUMm !== minU || wall.extentMm.maxUMm !== maxU || wall.extentMm.baseElevationMm !== sourceStorey?.elevationMm || wall.extentMm.topElevationMm !== (sourceStorey ? sourceStorey.elevationMm + item.heightMm : NaN)) issues.push(`wall_mismatch:${wall.id}`);
    }
    for (const opening of storey.openings) {
      const item = architecture.openings.find(candidate => candidate.id === opening.id), host = item ? walls.get(item.hostWallId) : undefined;
      const expectedProjection = item && host ? openingProjectionMm(host, item) : undefined;
      if (!item || !host || host.storeyId !== storey.id || item.kind !== opening.kindCode || item.hostWallId !== opening.hostWallId || !sameArray(item.positionMm, opening.positionMm) || item.offsetMm !== opening.offsetMm || item.widthMm !== opening.widthMm || item.heightMm !== opening.heightMm || item.sillMm !== opening.sillMm || !expectedProjection || opening.projectionMm.uMm !== expectedProjection.uMm || opening.projectionMm.minUMm !== expectedProjection.minUMm || opening.projectionMm.maxUMm !== expectedProjection.maxUMm || opening.projectionMm.bottomElevationMm !== storey.baseElevationMm + item.sillMm || opening.projectionMm.topElevationMm !== storey.baseElevationMm + item.sillMm + item.heightMm) issues.push(`opening_mismatch:${opening.id}`);
    }
    for (const slab of storey.slabs) {
      const item = architecture.slabs.find(candidate => candidate.id === slab.id), expectedElevation = sourceStorey?.elevationMm;
      if (!item || item.storeyId !== storey.id || item.spaceId !== slab.spaceId || !sameBoundary(item.boundaryMm, slab.boundaryMm) || slab.storeyId !== item.storeyId || slab.thicknessMm !== item.thicknessMm || slab.elevationMm !== expectedElevation) issues.push(`slab_mismatch:${slab.id}`);
    }
    for (const ceiling of storey.ceilings) {
      const item = architecture.ceilings.find(candidate => candidate.id === ceiling.id);
      if (!item || item.storeyId !== storey.id || item.spaceId !== ceiling.spaceId || !sameBoundary(item.boundaryMm, ceiling.boundaryMm) || ceiling.storeyId !== item.storeyId || ceiling.elevationMm !== storey.baseElevationMm + item.elevationMm || ceiling.thicknessMm !== (item.thicknessMm ?? null)) issues.push(`ceiling_mismatch:${ceiling.id}`);
    }
  }
  return issues.length ? { status: 'failed', verifierId: 'architecture-interior-elevation-structural.v1', issues: [...new Set(issues)] } : { status: 'passed', verifierId: 'architecture-interior-elevation-structural.v1', issues: [] };
}

export function verifyArchitectureInteriorElevationDrawingArtifact(input: { payload: unknown; contentHash: unknown }, workspace: ArchitectureInteriorWorkspaceV2): ArchitectureInteriorElevationVerification {
  try { return verifyInternal(input, workspace); } catch { return { status: 'failed', verifierId: 'architecture-interior-elevation-structural.v1', issues: ['verifier_exception'] }; }
}

function stableIdIssues(workspace: ArchitectureInteriorWorkspaceV2): string[] {
  const ids = [workspace.projectId, workspace.architecture.documentId, workspace.interior.documentId, ...workspace.architecture.document.storeys, ...workspace.architecture.document.spaces, ...workspace.architecture.document.walls, ...workspace.architecture.document.slabs, ...workspace.architecture.document.ceilings, ...workspace.architecture.document.openings].map(item => typeof item === 'string' ? item : item.id);
  const seen = new Set<string>(), issues: string[] = [];
  for (const id of ids) { if (unsafeIdentifier(id)) issues.push(`unsafe_or_empty_id:${id || '(empty)'}`); if (seen.has(id)) issues.push(`duplicate_stable_id:${id}`); seen.add(id); }
  return issues;
}

export function buildArchitectureInteriorElevationArtifact(workspace: ArchitectureInteriorWorkspaceV2, modelInputsOverride?: readonly ArtifactInputBinding[]): ArchitectureInteriorElevationResult {
  let workspaceIssues: string[];
  try { workspaceIssues = validateArchitectureInteriorWorkspaceV2(workspace); } catch { return { ok: false, code: 'invalid_workspace', issues: ['workspace_validation_failed'] }; }
  if (workspaceIssues.length) return { ok: false, code: 'invalid_workspace', issues: workspaceIssues };
  const ids = stableIdIssues(workspace); if (ids.length) return { ok: false, code: 'unsafe_identifier', issues: ids.slice(0, 32) };
  let payload: ArchitectureInteriorElevationPayload;
  try { payload = makePayload(workspace); } catch { return { ok: false, code: 'elevation_reconciliation_failed', issues: ['elevation_payload_build_failed'] }; }
  if (!bounded(payload)) return { ok: false, code: 'geometry_bounds_exceeded', issues: ['elevation_geometry_out_of_bounds'] };
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_OUTPUT_BYTES) return { ok: false, code: 'output_too_large', issues: ['elevation_payload_limit_exceeded'] };
  const contentHash = hashArchitectureInteriorEvidenceV2(payload), structural = verifyArchitectureInteriorElevationDrawingArtifact({ payload, contentHash }, workspace);
  if (structural.status !== 'passed') return { ok: false, code: 'elevation_reconciliation_failed', issues: structural.issues };
  const resolvedInputs = resolveModelInputs(workspace, modelInputsOverride); if (resolvedInputs.issues.length) return { ok: false, code: 'elevation_reconciliation_failed', issues: resolvedInputs.issues };
  const inputs = resolvedInputs.inputs, artifactId = `drawing:architecture-elevation:${workspace.workspace.revision}`;
  const evidenceHash = hashArchitectureInteriorEvidenceV2({ schema: `${ARCHITECTURE_INTERIOR_ELEVATION_SCHEMA}-verification`, binding: payload.binding, contentHash, sourceObjectCount: workspace.architecture.document.storeys.length + workspace.architecture.document.walls.length + workspace.architecture.document.openings.length + workspace.architecture.document.slabs.length + workspace.architecture.document.ceilings.length });
  const verification = { status: 'passed' as const, verifierId: 'architecture-interior-elevation-structural.v1' as const, evidenceHash, issues: [] as [] };
  const artifact: DesignArtifactNode = { id: artifactId, kind: 'drawing', revision: workspace.workspace.revision, contentHash, state: 'current', inputs, verification, staleBecause: [] };
  return { ok: true, result: { payload, contentHash, verification, artifact, dependencies: dependencies(inputs, artifactId) } };
}
