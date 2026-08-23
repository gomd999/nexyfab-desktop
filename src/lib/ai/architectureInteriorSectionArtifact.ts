import type { ArchitectureInteriorWorkspaceV2 } from './architectureInteriorWorkspace';
import { hashArchitectureInteriorEvidenceV2, validateArchitectureInteriorWorkspaceV2 } from './architectureInteriorWorkspace';
import type { ArchitectureWall } from './architectureInteriorDocuments';
import type { ArtifactDependencyEdge, ArtifactInputBinding, DesignArtifactNode } from './designArtifactGraph';

export const ARCHITECTURE_INTERIOR_SECTION_SCHEMA = 'nexyfab.architecture-interior-section.v1' as const;
const MAX_ITEMS = 10_000;
const MAX_COORDINATE_MM = 1_000_000_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const TOLERANCE_MM = 1e-7;
const SHA256 = /^[a-f0-9]{64}$/;
type Point2 = [number, number];

export type ArchitectureInteriorSectionCut = { axis: 'x'; coordinateMm: number; thicknessMm: number };
export type ArchitectureInteriorSectionBinding = {
  projectId: string;
  revision: number;
  workspaceContentHash: string;
  architectureDocumentId: string;
  interiorDocumentId: string;
  architectureDocumentHash: string;
  interiorDocumentHash: string;
};
type WallCutGeometry =
  | { kind: 'point'; pointMm: Point2 }
  | { kind: 'interval'; startMm: Point2; endMm: Point2 }
  | { kind: 'points'; pointsMm: Point2[] };
type CutInterval = [number, number];

export type ArchitectureInteriorSectionPayload = {
  schema: typeof ARCHITECTURE_INTERIOR_SECTION_SCHEMA;
  binding: ArchitectureInteriorSectionBinding;
  units: { length: 'mm'; area: 'mm2'; angle: 'deg' };
  cut: ArchitectureInteriorSectionCut;
  view: {
    kind: 'vertical_section';
    projection: 'y_z';
    storeys: Array<{
      id: string;
      baseElevationMm: number;
      topElevationMm: number;
      walls: Array<{ id: string; storeyId: string; kind: ArchitectureWall['kind']; cutGeometry: WallCutGeometry; baseElevationMm: number; topElevationMm: number; thicknessMm: number; heightMm: number }>;
      openings: Array<{ id: string; kindCode: 'door' | 'window'; hostWallId: string; cutPointsMm: Point2[]; widthMm: number; heightMm: number; sillMm: number; bottomElevationMm: number; topElevationMm: number }>;
      slabs: Array<{ id: string; storeyId: string; spaceId: string; cutIntervalsMm: CutInterval[]; elevationMm: number; thicknessMm: number }>;
      ceilings: Array<{ id: string; storeyId: string; spaceId: string; cutIntervalsMm: CutInterval[]; elevationMm: number; thicknessMm: number | null }>;
    }>;
  };
  rendering: { labels: 'stable_codes_only'; localizedTextEmbedded: false; source: 'workspace_documents' };
};

export type ArchitectureInteriorSectionArtifact = {
  payload: ArchitectureInteriorSectionPayload;
  contentHash: string;
  verification: { status: 'passed'; verifierId: 'architecture-interior-section-structural.v1'; evidenceHash: string; issues: [] };
  artifact: DesignArtifactNode;
  dependencies: ArtifactDependencyEdge[];
};
export type ArchitectureInteriorSectionResult =
  | { ok: true; result: ArchitectureInteriorSectionArtifact }
  | { ok: false; code: 'invalid_workspace' | 'invalid_cut' | 'geometry_bounds_exceeded' | 'unsafe_identifier' | 'output_too_large' | 'section_reconciliation_failed'; issues: string[] };
export type ArchitectureInteriorSectionVerification =
  | { status: 'passed'; verifierId: 'architecture-interior-section-structural.v1'; issues: [] }
  | { status: 'failed'; verifierId: 'architecture-interior-section-structural.v1'; issues: string[] };

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE_MM; }
function positiveFinite(value: unknown): value is number { return finite(value) && value > 0; }
function bounded(value: unknown): boolean {
  if (typeof value === 'number') return finite(value);
  if (Array.isArray(value)) return value.length <= MAX_ITEMS && value.every(bounded);
  if (isRecord(value)) return Object.keys(value).length <= MAX_ITEMS && Object.values(value).every(bounded);
  return true;
}
function unsafeIdentifier(value: unknown): boolean { return typeof value !== 'string' || value.length > 128 || !value.trim() || value.includes('://') || value.includes('/') || value.includes('\\') || /(?:bearer|password|secret|token)/i.test(value); }
function sameArray(left: readonly unknown[], right: readonly unknown[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function sameObjectKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return sameArray(Object.keys(value).sort(), [...keys].sort()); }
function samePoint(left: readonly number[], right: readonly number[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function documentHash(value: unknown): string { return hashArchitectureInteriorEvidenceV2(value); }
function sorted<T extends { id: string }>(values: readonly T[]): T[] { return [...values].sort((a, b) => a.id.localeCompare(b.id)); }
function defaultCut(): ArchitectureInteriorSectionCut { return { axis: 'x', coordinateMm: 0, thicknessMm: 0 }; }
function cutIssues(cut: unknown): string[] {
  if (!isRecord(cut) || !sameObjectKeys(cut, ['axis', 'coordinateMm', 'thicknessMm']) || cut.axis !== 'x' || !finite(cut.coordinateMm) || !finite(cut.thicknessMm) || cut.thicknessMm !== 0) return ['cut_definition_invalid'];
  return [];
}
function normalizeCut(value: unknown): ArchitectureInteriorSectionCut {
  const cut = value === undefined ? defaultCut() : value;
  if (cutIssues(cut).length) throw new Error('invalid_cut');
  return { axis: 'x', coordinateMm: (cut as ArchitectureInteriorSectionCut).coordinateMm, thicknessMm: (cut as ArchitectureInteriorSectionCut).thicknessMm };
}
type WallCutHit = { offsetMm: number; pointMm: Point2 };
function wallPointAtOffsetMm(wall: ArchitectureWall, offsetMm: number): Point2 {
  if (wall.kind === 'line') { const length = Math.hypot(wall.endMm[0] - wall.startMm[0], wall.endMm[1] - wall.startMm[1]); return [wall.startMm[0] + (wall.endMm[0] - wall.startMm[0]) * offsetMm / length, wall.startMm[1] + (wall.endMm[1] - wall.startMm[1]) * offsetMm / length]; }
  const sweep = wall.endAngleDeg - wall.startAngleDeg, angle = (wall.startAngleDeg + Math.sign(sweep || 1) * offsetMm / wall.radiusMm * 180 / Math.PI) * Math.PI / 180;
  return [wall.centerMm[0] + Math.cos(angle) * wall.radiusMm, wall.centerMm[1] + Math.sin(angle) * wall.radiusMm];
}
function wallLengthMm(wall: ArchitectureWall): number { return wall.kind === 'line' ? Math.hypot(wall.endMm[0] - wall.startMm[0], wall.endMm[1] - wall.startMm[1]) : Math.abs(wall.endAngleDeg - wall.startAngleDeg) * Math.PI / 180 * wall.radiusMm; }
function directedAngleDistance(startDeg: number, angleDeg: number, direction: number): number { return direction > 0 ? ((angleDeg - startDeg) % 360 + 360) % 360 : ((startDeg - angleDeg) % 360 + 360) % 360; }
function wallCutHits(wall: ArchitectureWall, coordinateMm: number): WallCutHit[] {
  if (wall.kind === 'line') {
    const length = Math.hypot(wall.endMm[0] - wall.startMm[0], wall.endMm[1] - wall.startMm[1]);
    if (Math.abs(wall.startMm[0] - coordinateMm) <= TOLERANCE_MM && Math.abs(wall.endMm[0] - coordinateMm) <= TOLERANCE_MM) return [];
    if (coordinateMm < Math.min(wall.startMm[0], wall.endMm[0]) - TOLERANCE_MM || coordinateMm > Math.max(wall.startMm[0], wall.endMm[0]) + TOLERANCE_MM || Math.abs(wall.endMm[0] - wall.startMm[0]) <= TOLERANCE_MM) return [];
    const ratio = (coordinateMm - wall.startMm[0]) / (wall.endMm[0] - wall.startMm[0]);
    return [{ offsetMm: ratio * length, pointMm: [coordinateMm, wall.startMm[1] + ratio * (wall.endMm[1] - wall.startMm[1])] }];
  }
  const ratio = (coordinateMm - wall.centerMm[0]) / wall.radiusMm;
  if (ratio < -1 - TOLERANCE_MM || ratio > 1 + TOLERANCE_MM) return [];
  const clamped = Math.max(-1, Math.min(1, ratio)), baseDeg = Math.acos(clamped) * 180 / Math.PI;
  const candidates = Math.abs(Math.abs(ratio) - 1) <= TOLERANCE_MM ? [baseDeg] : [baseDeg, -baseDeg];
  const sweep = Math.abs(wall.endAngleDeg - wall.startAngleDeg), direction = Math.sign(wall.endAngleDeg - wall.startAngleDeg) || 1;
  return candidates.filter(angle => directedAngleDistance(wall.startAngleDeg, angle, direction) <= sweep + TOLERANCE_MM).map(angle => ({ offsetMm: directedAngleDistance(wall.startAngleDeg, angle, direction) * Math.PI / 180 * wall.radiusMm, pointMm: [coordinateMm, wall.centerMm[1] + Math.sin(angle * Math.PI / 180) * wall.radiusMm] as Point2 })).filter((hit, index, hits) => hits.findIndex(other => Math.abs(other.offsetMm - hit.offsetMm) <= TOLERANCE_MM) === index).sort((a, b) => a.pointMm[1] - b.pointMm[1]);
}
function lineCutPoints(wall: Extract<ArchitectureWall, { kind: 'line' }>, coordinateMm: number): WallCutGeometry | null {
  const [x1, x2] = [wall.startMm[0], wall.endMm[0]], [y1, y2] = [wall.startMm[1], wall.endMm[1]];
  if (Math.abs(x1 - coordinateMm) <= TOLERANCE_MM && Math.abs(x2 - coordinateMm) <= TOLERANCE_MM) return { kind: 'interval', startMm: [coordinateMm, y1], endMm: [coordinateMm, y2] };
  if ((coordinateMm < Math.min(x1, x2) - TOLERANCE_MM) || (coordinateMm > Math.max(x1, x2) + TOLERANCE_MM) || Math.abs(x2 - x1) <= TOLERANCE_MM) return null;
  const ratio = (coordinateMm - x1) / (x2 - x1);
  return { kind: 'point', pointMm: [coordinateMm, y1 + ratio * (y2 - y1)] };
}
function arcCutPoints(wall: Extract<ArchitectureWall, { kind: 'arc' }>, coordinateMm: number): WallCutGeometry | null {
  const ratio = (coordinateMm - wall.centerMm[0]) / wall.radiusMm;
  if (ratio < -1 - TOLERANCE_MM || ratio > 1 + TOLERANCE_MM) return null;
  const clamped = Math.max(-1, Math.min(1, ratio)), baseDeg = Math.acos(clamped) * 180 / Math.PI;
  const candidates = Math.abs(Math.abs(ratio) - 1) <= TOLERANCE_MM ? [baseDeg] : [baseDeg, -baseDeg];
  const sweep = Math.abs(wall.endAngleDeg - wall.startAngleDeg), direction = Math.sign(wall.endAngleDeg - wall.startAngleDeg) || 1;
  const points = candidates.filter(angle => directedAngleDistance(wall.startAngleDeg, angle, direction) <= sweep + TOLERANCE_MM).map(angle => [coordinateMm, wall.centerMm[1] + Math.sin(angle * Math.PI / 180) * wall.radiusMm] as Point2);
  const unique = points.filter((point, index) => points.findIndex(other => samePoint(other, point)) === index).sort((a, b) => a[1] - b[1]);
  return unique.length === 0 ? null : unique.length === 1 ? { kind: 'point', pointMm: unique[0]! } : { kind: 'points', pointsMm: unique };
}
function wallCutGeometry(wall: ArchitectureWall, cut: ArchitectureInteriorSectionCut): WallCutGeometry | null { return wall.kind === 'line' ? lineCutPoints(wall, cut.coordinateMm) : arcCutPoints(wall, cut.coordinateMm); }
function polygonCutIntervals(boundary: readonly Point2[], coordinateMm: number): CutInterval[] {
  const values: number[] = [];
  for (let index = 0; index < boundary.length; index += 1) {
    const start = boundary[index]!, end = boundary[(index + 1) % boundary.length]!;
    if (Math.abs(start[0] - coordinateMm) <= TOLERANCE_MM && Math.abs(end[0] - coordinateMm) <= TOLERANCE_MM) values.push(start[1], end[1]);
    else if ((coordinateMm >= Math.min(start[0], end[0]) - TOLERANCE_MM) && (coordinateMm <= Math.max(start[0], end[0]) + TOLERANCE_MM) && Math.abs(end[0] - start[0]) > TOLERANCE_MM) values.push(start[1] + (coordinateMm - start[0]) * (end[1] - start[1]) / (end[0] - start[0]));
  }
  const unique = [...new Set(values.map(value => Number(value.toFixed(9))))].sort((a, b) => a - b), intervals: CutInterval[] = [];
  for (let index = 0; index + 1 < unique.length; index += 2) if (unique[index + 1]! - unique[index]! > TOLERANCE_MM) intervals.push([unique[index]!, unique[index + 1]!]);
  return intervals;
}
function openingCutPoints(wall: ArchitectureWall, opening: { offsetMm: number; widthMm: number }, cut: ArchitectureInteriorSectionCut): Point2[] {
  const startOffset = opening.offsetMm - opening.widthMm / 2, endOffset = opening.offsetMm + opening.widthMm / 2;
  if (wall.kind === 'line' && Math.abs(wall.startMm[0] - cut.coordinateMm) <= TOLERANCE_MM && Math.abs(wall.endMm[0] - cut.coordinateMm) <= TOLERANCE_MM) return [wallPointAtOffsetMm(wall, startOffset), wallPointAtOffsetMm(wall, endOffset)];
  return wallCutHits(wall, cut.coordinateMm).filter(hit => hit.offsetMm >= startOffset - TOLERANCE_MM && hit.offsetMm <= endOffset + TOLERANCE_MM).map(hit => hit.pointMm);
}
function openingSourceIssues(workspace: ArchitectureInteriorWorkspaceV2): string[] {
  const architecture = workspace.architecture.document, walls = new Map(architecture.walls.map(item => [item.id, item])), issues: string[] = [];
  for (const opening of architecture.openings) {
    const wall = walls.get(opening.hostWallId); if (!wall) continue;
    const length = wallLengthMm(wall), startOffset = opening.offsetMm - opening.widthMm / 2, endOffset = opening.offsetMm + opening.widthMm / 2;
    if (startOffset < -TOLERANCE_MM || endOffset > length + TOLERANCE_MM) issues.push(`opening_interval:${opening.id}`);
    if (opening.sillMm + opening.heightMm > wall.heightMm + TOLERANCE_MM) issues.push(`opening_vertical_extent:${opening.id}`);
    const expected = wallPointAtOffsetMm(wall, opening.offsetMm);
    if (Math.hypot(opening.positionMm[0] - expected[0], opening.positionMm[1] - expected[1]) > TOLERANCE_MM) issues.push(`opening_position_xy:${opening.id}`);
    if (Math.abs(opening.positionMm[2] - opening.sillMm) > TOLERANCE_MM) issues.push(`opening_position_z:${opening.id}`);
  }
  return issues;
}
function bindingFor(workspace: ArchitectureInteriorWorkspaceV2): ArchitectureInteriorSectionBinding { return { projectId: workspace.projectId, revision: workspace.workspace.revision, workspaceContentHash: workspace.contentHash, architectureDocumentId: workspace.architecture.documentId, interiorDocumentId: workspace.interior.documentId, architectureDocumentHash: documentHash(workspace.architecture.document), interiorDocumentHash: documentHash(workspace.interior.document) }; }
function modelInputs(workspace: ArchitectureInteriorWorkspaceV2): ArtifactInputBinding[] { return workspace.artifactGraph.artifacts.filter(item => item.kind === 'model' && item.state === 'current').sort((a, b) => a.id.localeCompare(b.id)).map(item => ({ artifactId: item.id, revision: item.revision, contentHash: item.contentHash })); }
function resolveModelInputs(workspace: ArchitectureInteriorWorkspaceV2, override?: readonly ArtifactInputBinding[]): { inputs: ArtifactInputBinding[]; issues: string[] } {
  const current = modelInputs(workspace); if (override === undefined) return { inputs: current, issues: [] }; if (!Array.isArray(override)) return { inputs: [], issues: ['model_input_binding_invalid'] };
  const raw = override as readonly unknown[]; if (raw.some(item => !isRecord(item))) return { inputs: [], issues: ['model_input_binding_invalid'] };
  const supplied: ArtifactInputBinding[] = raw.map(item => item as ArtifactInputBinding).sort((a, b) => String(a.artifactId).localeCompare(String(b.artifactId))), issues: string[] = [];
  if (supplied.some(item => unsafeIdentifier(item.artifactId) || !Number.isSafeInteger(item.revision) || item.revision < 0 || !SHA256.test(String(item.contentHash)) || supplied.filter(other => other.artifactId === item.artifactId).length !== 1)) issues.push('model_input_binding_invalid');
  if (supplied.length !== current.length) issues.push('model_input_set_stale');
  if (supplied.length === current.length && supplied.some((item, index) => item.artifactId !== current[index]?.artifactId || item.revision !== current[index]?.revision || item.contentHash !== current[index]?.contentHash)) issues.push('model_input_binding_stale');
  return { inputs: supplied, issues };
}
function dependencies(inputs: readonly ArtifactInputBinding[], targetId: string): ArtifactDependencyEdge[] { return inputs.map((input, index) => ({ id: `section-dependency-${index + 1}-${hashArchitectureInteriorEvidenceV2(`${input.artifactId}:${targetId}`).slice(0, 16)}`, sourceId: input.artifactId, targetId, policy: 'invalidate' as const })); }
function expectedCutSets(workspace: ArchitectureInteriorWorkspaceV2, cut: ArchitectureInteriorSectionCut) {
  const architecture = workspace.architecture.document, walls = new Map(architecture.walls.map(item => [item.id, item])), storeys = new Map(architecture.storeys.map(item => [item.id, item]));
  const wallHits = new Map(architecture.walls.map(wall => [wall.id, wallCutGeometry(wall, cut)]));
  const openingHits = new Map(architecture.openings.map(opening => [opening.id, walls.get(opening.hostWallId) && wallHits.get(opening.hostWallId) ? openingCutPoints(walls.get(opening.hostWallId)!, opening, cut) : []]));
  return { architecture, walls, storeys, wallHits, openingHits };
}
function makePayload(workspace: ArchitectureInteriorWorkspaceV2, cut: ArchitectureInteriorSectionCut): ArchitectureInteriorSectionPayload {
  const { architecture, walls, wallHits, openingHits } = expectedCutSets(workspace, cut);
  return {
    schema: ARCHITECTURE_INTERIOR_SECTION_SCHEMA, binding: bindingFor(workspace), units: { length: 'mm', area: 'mm2', angle: 'deg' }, cut,
    view: { kind: 'vertical_section', projection: 'y_z', storeys: sorted(architecture.storeys).map(storey => ({
      id: storey.id, baseElevationMm: storey.elevationMm, topElevationMm: storey.elevationMm + storey.heightMm,
      walls: sorted(architecture.walls.filter(wall => wall.storeyId === storey.id).filter(wall => wallHits.get(wall.id))).map(wall => { const hit = wallHits.get(wall.id)!; return { id: wall.id, storeyId: wall.storeyId, kind: wall.kind, cutGeometry: hit, baseElevationMm: storey.elevationMm, topElevationMm: storey.elevationMm + wall.heightMm, thicknessMm: wall.thicknessMm, heightMm: wall.heightMm }; }),
      openings: sorted(architecture.openings.filter(opening => walls.get(opening.hostWallId)?.storeyId === storey.id).filter(opening => (openingHits.get(opening.id)?.length ?? 0) > 0)).map(opening => { const points = openingHits.get(opening.id)!; return { id: opening.id, kindCode: opening.kind, hostWallId: opening.hostWallId, cutPointsMm: points, widthMm: opening.widthMm, heightMm: opening.heightMm, sillMm: opening.sillMm, bottomElevationMm: storey.elevationMm + opening.sillMm, topElevationMm: storey.elevationMm + opening.sillMm + opening.heightMm }; }),
      slabs: sorted(architecture.slabs.filter(slab => slab.storeyId === storey.id).map(slab => ({ slab, intervals: polygonCutIntervals(slab.boundaryMm, cut.coordinateMm) })).filter(value => value.intervals.length > 0).map(value => ({ id: value.slab.id, storeyId: value.slab.storeyId, spaceId: value.slab.spaceId, cutIntervalsMm: value.intervals, elevationMm: storey.elevationMm, thicknessMm: value.slab.thicknessMm }))),
      ceilings: sorted(architecture.ceilings.filter(ceiling => ceiling.storeyId === storey.id).map(ceiling => ({ ceiling, intervals: polygonCutIntervals(ceiling.boundaryMm, cut.coordinateMm) })).filter(value => value.intervals.length > 0).map(value => ({ id: value.ceiling.id, storeyId: value.ceiling.storeyId, spaceId: value.ceiling.spaceId, cutIntervalsMm: value.intervals, elevationMm: storey.elevationMm + value.ceiling.elevationMm, thicknessMm: value.ceiling.thicknessMm ?? null }))),
    })) },
    rendering: { labels: 'stable_codes_only', localizedTextEmbedded: false, source: 'workspace_documents' },
  };
}

function shapeIssues(payload: unknown): string[] {
  if (!isRecord(payload)) return ['payload_not_object'];
  const issues: string[] = [];
  if (!sameObjectKeys(payload, ['schema', 'binding', 'units', 'cut', 'view', 'rendering']) || payload.schema !== ARCHITECTURE_INTERIOR_SECTION_SCHEMA) issues.push('payload_header_invalid');
  const binding = payload.binding;
  if (!isRecord(binding) || !sameObjectKeys(binding, ['projectId', 'revision', 'workspaceContentHash', 'architectureDocumentId', 'interiorDocumentId', 'architectureDocumentHash', 'interiorDocumentHash']) || unsafeIdentifier(binding.projectId) || unsafeIdentifier(binding.architectureDocumentId) || unsafeIdentifier(binding.interiorDocumentId) || typeof binding.revision !== 'number' || !Number.isSafeInteger(binding.revision) || binding.revision < 0 || !SHA256.test(String(binding.workspaceContentHash)) || !SHA256.test(String(binding.architectureDocumentHash)) || !SHA256.test(String(binding.interiorDocumentHash))) issues.push('payload_binding_invalid');
  const units = payload.units;
  if (!isRecord(units) || !sameObjectKeys(units, ['length', 'area', 'angle']) || units.length !== 'mm' || units.area !== 'mm2' || units.angle !== 'deg') issues.push('payload_units_invalid');
  issues.push(...cutIssues(payload.cut));
  const view = payload.view;
  if (!isRecord(view) || !sameObjectKeys(view, ['kind', 'projection', 'storeys']) || view.kind !== 'vertical_section' || view.projection !== 'y_z' || !Array.isArray(view.storeys)) issues.push('payload_view_invalid');
  const rendering = payload.rendering;
  if (!isRecord(rendering) || !sameObjectKeys(rendering, ['labels', 'localizedTextEmbedded', 'source']) || rendering.labels !== 'stable_codes_only' || rendering.localizedTextEmbedded !== false || rendering.source !== 'workspace_documents') issues.push('payload_rendering_invalid');
  if (!bounded(payload)) issues.push('payload_bounds_invalid');
  const emitted: string[] = [];
  if (isRecord(view) && Array.isArray(view.storeys)) view.storeys.forEach((storey, storeyIndex) => {
    if (!isRecord(storey) || !sameObjectKeys(storey, ['id', 'baseElevationMm', 'topElevationMm', 'walls', 'openings', 'slabs', 'ceilings']) || unsafeIdentifier(storey.id) || !finite(storey.baseElevationMm) || !finite(storey.topElevationMm) || storey.topElevationMm < storey.baseElevationMm || !Array.isArray(storey.walls) || !Array.isArray(storey.openings) || !Array.isArray(storey.slabs) || !Array.isArray(storey.ceilings)) { issues.push(`storey_shape_invalid:${storeyIndex}`); return; }
    emitted.push(storey.id as string);
    for (const [kind, values] of [['walls', storey.walls], ['openings', storey.openings], ['slabs', storey.slabs], ['ceilings', storey.ceilings]] as Array<[string, unknown[]]>) values.forEach((item, index) => {
      if (!isRecord(item) || unsafeIdentifier(item.id)) { issues.push(`${kind}_shape_invalid:${storeyIndex}:${index}`); return; }
      emitted.push(item.id as string);
      if (kind === 'walls') {
        if (!sameObjectKeys(item, ['id', 'storeyId', 'kind', 'cutGeometry', 'baseElevationMm', 'topElevationMm', 'thicknessMm', 'heightMm']) || unsafeIdentifier(item.storeyId) || !['line', 'arc'].includes(String(item.kind)) || !finite(item.baseElevationMm) || !finite(item.topElevationMm) || item.topElevationMm < item.baseElevationMm || !positiveFinite(item.thicknessMm) || !positiveFinite(item.heightMm) || !isRecord(item.cutGeometry)) { issues.push(`wall_shape_invalid:${storeyIndex}:${index}`); return; }
        const geometry = item.cutGeometry;
        if (geometry.kind === 'point' && (!sameObjectKeys(geometry, ['kind', 'pointMm']) || !Array.isArray(geometry.pointMm) || geometry.pointMm.length !== 2 || geometry.pointMm.some(point => !finite(point)))) issues.push(`wall_cut_geometry_invalid:${storeyIndex}:${index}`);
        else if (geometry.kind === 'interval' && (!sameObjectKeys(geometry, ['kind', 'startMm', 'endMm']) || !Array.isArray(geometry.startMm) || !Array.isArray(geometry.endMm) || geometry.startMm.length !== 2 || geometry.endMm.length !== 2 || geometry.startMm.some(point => !finite(point)) || geometry.endMm.some(point => !finite(point)))) issues.push(`wall_cut_geometry_invalid:${storeyIndex}:${index}`);
        else if (geometry.kind === 'points' && (!sameObjectKeys(geometry, ['kind', 'pointsMm']) || !Array.isArray(geometry.pointsMm) || geometry.pointsMm.length < 1 || geometry.pointsMm.some(point => !Array.isArray(point) || point.length !== 2 || point.some(value => !finite(value))))) issues.push(`wall_cut_geometry_invalid:${storeyIndex}:${index}`);
        else if (!['point', 'interval', 'points'].includes(String(geometry.kind))) issues.push(`wall_cut_geometry_invalid:${storeyIndex}:${index}`);
      } else if (kind === 'openings') {
        if (!sameObjectKeys(item, ['id', 'kindCode', 'hostWallId', 'cutPointsMm', 'widthMm', 'heightMm', 'sillMm', 'bottomElevationMm', 'topElevationMm']) || !['door', 'window'].includes(String(item.kindCode)) || unsafeIdentifier(item.hostWallId) || !Array.isArray(item.cutPointsMm) || item.cutPointsMm.length < 1 || item.cutPointsMm.length > 2 || item.cutPointsMm.some(point => !Array.isArray(point) || point.length !== 2 || point.some(value => !finite(value))) || !positiveFinite(item.widthMm) || !positiveFinite(item.heightMm) || !finite(item.sillMm) || item.sillMm < 0 || !finite(item.bottomElevationMm) || !finite(item.topElevationMm) || item.topElevationMm < item.bottomElevationMm) issues.push(`opening_shape_invalid:${storeyIndex}:${index}`);
      } else if (!sameObjectKeys(item, ['id', 'storeyId', 'spaceId', 'cutIntervalsMm', 'elevationMm', 'thicknessMm']) || unsafeIdentifier(item.storeyId) || unsafeIdentifier(item.spaceId) || !Array.isArray(item.cutIntervalsMm) || item.cutIntervalsMm.length < 1 || item.cutIntervalsMm.some(interval => !Array.isArray(interval) || interval.length !== 2 || !finite(interval[0]) || !finite(interval[1]) || interval[1] <= interval[0]) || !finite(item.elevationMm) || (kind === 'slabs' ? !positiveFinite(item.thicknessMm) : item.thicknessMm !== null && !positiveFinite(item.thicknessMm))) issues.push(`${kind}_shape_invalid:${storeyIndex}:${index}`);
    });
  });
  const seen = new Set<string>(); for (const id of emitted) { if (seen.has(id)) issues.push(`payload_stable_id_duplicate:${id}`); seen.add(id); }
  return [...new Set(issues)];
}
export function parseArchitectureInteriorSectionDrawing(input: string): { ok: true; payload: ArchitectureInteriorSectionPayload } | { ok: false; issues: string[] } {
  if (typeof input !== 'string' || input.length > MAX_OUTPUT_BYTES * 2) return { ok: false, issues: ['payload_too_large'] };
  let parsed: unknown; try { parsed = JSON.parse(input) as unknown; } catch { return { ok: false, issues: ['payload_json_invalid'] }; }
  const issues = shapeIssues(parsed); return issues.length ? { ok: false, issues } : { ok: true, payload: parsed as ArchitectureInteriorSectionPayload };
}

function verifyInternal(input: { payload: unknown; contentHash: unknown }, workspace: ArchitectureInteriorWorkspaceV2): ArchitectureInteriorSectionVerification {
  const payload = input.payload as Partial<ArchitectureInteriorSectionPayload>, cut = payload.cut;
  const issues = [...validateArchitectureInteriorWorkspaceV2(workspace), ...openingSourceIssues(workspace), ...cutIssues(cut), ...shapeIssues(input.payload)];
  if (typeof input.contentHash !== 'string' || !SHA256.test(input.contentHash) || hashArchitectureInteriorEvidenceV2(input.payload) !== input.contentHash) issues.push('payload_content_hash_mismatch');
  const expectedBinding = bindingFor(workspace); if (isRecord(payload.binding)) for (const key of Object.keys(expectedBinding) as Array<keyof ArchitectureInteriorSectionBinding>) if (payload.binding[key] !== expectedBinding[key]) issues.push(`binding_mismatch:${key}`);
  if (cutIssues(cut).length) return { status: 'failed', verifierId: 'architecture-interior-section-structural.v1', issues: [...new Set(issues)] };
  const normalizedCut = normalizeCut(cut), expected = expectedCutSets(workspace, normalizedCut), storeys = payload.view?.storeys ?? [];
  const expectedStoreyIds = expected.architecture.storeys.map(item => item.id).sort((a, b) => a.localeCompare(b));
  if (storeys.map(item => item.id).sort((a, b) => a.localeCompare(b)).join('|') !== expectedStoreyIds.join('|')) issues.push('storey_set_mismatch');
  for (const storey of storeys) {
    const sourceStorey = expected.storeys.get(storey.id); if (!sourceStorey || sourceStorey.elevationMm !== storey.baseElevationMm || sourceStorey.elevationMm + sourceStorey.heightMm !== storey.topElevationMm) issues.push(`storey_mismatch:${storey.id}`);
    const sourceWalls = expected.architecture.walls.filter(wall => wall.storeyId === storey.id && expected.wallHits.get(wall.id));
    const sourceOpenings = expected.architecture.openings.filter(opening => expected.architecture.walls.find(wall => wall.id === opening.hostWallId)?.storeyId === storey.id && (expected.openingHits.get(opening.id)?.length ?? 0) > 0);
    const sourceSlabs = expected.architecture.slabs.filter(slab => slab.storeyId === storey.id && polygonCutIntervals(slab.boundaryMm, normalizedCut.coordinateMm).length > 0);
    const sourceCeilings = expected.architecture.ceilings.filter(ceiling => ceiling.storeyId === storey.id && polygonCutIntervals(ceiling.boundaryMm, normalizedCut.coordinateMm).length > 0);
    const cutSets: Array<[string, readonly { id: string }[], readonly { id: string }[]]> = [['walls', sourceWalls, storey.walls], ['openings', sourceOpenings, storey.openings], ['slabs', sourceSlabs, storey.slabs], ['ceilings', sourceCeilings, storey.ceilings]];
    for (const [kind, source, output] of cutSets) {
      const sourceIds = new Set(source.map(item => item.id)), outputIds = new Set(output.map(item => item.id)); if (sourceIds.size !== outputIds.size || [...sourceIds].some(id => !outputIds.has(id))) issues.push(`${kind}_cut_set_mismatch:${storey.id}`);
    }
    for (const wall of storey.walls) { const source = expected.walls.get(wall.id), hit = source ? expected.wallHits.get(source.id) : null; if (!source || !hit || JSON.stringify(hit) !== JSON.stringify(wall.cutGeometry) || wall.storeyId !== source.storeyId || wall.kind !== source.kind || wall.baseElevationMm !== sourceStorey?.elevationMm || wall.topElevationMm !== (sourceStorey ? sourceStorey.elevationMm + source.heightMm : NaN) || wall.thicknessMm !== source.thicknessMm || wall.heightMm !== source.heightMm) issues.push(`wall_mismatch:${wall.id}`); }
    for (const opening of storey.openings) { const source = expected.architecture.openings.find(item => item.id === opening.id), host = source ? expected.walls.get(source.hostWallId) : undefined, points = source && host ? openingCutPoints(host, source, normalizedCut) : []; if (!source || !host || points.length !== opening.cutPointsMm.length || points.some((point, index) => !samePoint(point, opening.cutPointsMm[index]!)) || source.kind !== opening.kindCode || source.hostWallId !== opening.hostWallId || source.widthMm !== opening.widthMm || source.heightMm !== opening.heightMm || source.sillMm !== opening.sillMm || opening.bottomElevationMm !== storey.baseElevationMm + source.sillMm || opening.topElevationMm !== storey.baseElevationMm + source.sillMm + source.heightMm) issues.push(`opening_mismatch:${opening.id}`); }
    for (const slab of storey.slabs) { const source = expected.architecture.slabs.find(item => item.id === slab.id), intervals = source ? polygonCutIntervals(source.boundaryMm, normalizedCut.coordinateMm) : []; if (!source || !sameArray(intervals.flat(), slab.cutIntervalsMm.flat()) || source.spaceId !== slab.spaceId || slab.elevationMm !== sourceStorey?.elevationMm || slab.thicknessMm !== source.thicknessMm) issues.push(`slab_mismatch:${slab.id}`); }
    for (const ceiling of storey.ceilings) { const source = expected.architecture.ceilings.find(item => item.id === ceiling.id), intervals = source ? polygonCutIntervals(source.boundaryMm, normalizedCut.coordinateMm) : []; if (!source || !sameArray(intervals.flat(), ceiling.cutIntervalsMm.flat()) || source.spaceId !== ceiling.spaceId || ceiling.elevationMm !== storey.baseElevationMm + source.elevationMm || ceiling.thicknessMm !== (source.thicknessMm ?? null)) issues.push(`ceiling_mismatch:${ceiling.id}`); }
  }
  return issues.length ? { status: 'failed', verifierId: 'architecture-interior-section-structural.v1', issues: [...new Set(issues)] } : { status: 'passed', verifierId: 'architecture-interior-section-structural.v1', issues: [] };
}
export function verifyArchitectureInteriorSectionDrawingArtifact(input: { payload: unknown; contentHash: unknown }, workspace: ArchitectureInteriorWorkspaceV2): ArchitectureInteriorSectionVerification { try { return verifyInternal(input, workspace); } catch { return { status: 'failed', verifierId: 'architecture-interior-section-structural.v1', issues: ['verifier_exception'] }; } }
function stableIdIssues(workspace: ArchitectureInteriorWorkspaceV2): string[] { const ids = [workspace.projectId, workspace.architecture.documentId, workspace.interior.documentId, ...workspace.architecture.document.storeys, ...workspace.architecture.document.spaces, ...workspace.architecture.document.walls, ...workspace.architecture.document.slabs, ...workspace.architecture.document.ceilings, ...workspace.architecture.document.openings].map(item => typeof item === 'string' ? item : item.id), seen = new Set<string>(), issues: string[] = []; for (const id of ids) { if (unsafeIdentifier(id)) issues.push(`unsafe_or_empty_id:${id || '(empty)'}`); if (seen.has(id)) issues.push(`duplicate_stable_id:${id}`); seen.add(id); } return issues; }

export function buildArchitectureInteriorSectionArtifact(workspace: ArchitectureInteriorWorkspaceV2, cutOrInputs?: ArchitectureInteriorSectionCut | readonly ArtifactInputBinding[], modelInputsOverride?: readonly ArtifactInputBinding[]): ArchitectureInteriorSectionResult {
  let workspaceIssues: string[]; try { workspaceIssues = validateArchitectureInteriorWorkspaceV2(workspace); } catch { return { ok: false, code: 'invalid_workspace', issues: ['workspace_validation_failed'] }; }
  if (workspaceIssues.length) return { ok: false, code: 'invalid_workspace', issues: workspaceIssues };
  const cutValue = Array.isArray(cutOrInputs) || cutOrInputs === undefined ? undefined : cutOrInputs;
  const override = Array.isArray(cutOrInputs) ? cutOrInputs : modelInputsOverride;
  let cut: ArchitectureInteriorSectionCut; try { cut = normalizeCut(cutValue); } catch { return { ok: false, code: 'invalid_cut', issues: ['cut_definition_invalid'] }; }
  const ids = stableIdIssues(workspace); if (ids.length) return { ok: false, code: 'unsafe_identifier', issues: ids.slice(0, 32) };
  let payload: ArchitectureInteriorSectionPayload; try { payload = makePayload(workspace, cut); } catch { return { ok: false, code: 'section_reconciliation_failed', issues: ['section_payload_build_failed'] }; }
  if (!bounded(payload)) return { ok: false, code: 'geometry_bounds_exceeded', issues: ['section_geometry_out_of_bounds'] };
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_OUTPUT_BYTES) return { ok: false, code: 'output_too_large', issues: ['section_payload_limit_exceeded'] };
  const contentHash = hashArchitectureInteriorEvidenceV2(payload), structural = verifyArchitectureInteriorSectionDrawingArtifact({ payload, contentHash }, workspace); if (structural.status !== 'passed') return { ok: false, code: 'section_reconciliation_failed', issues: structural.issues };
  const resolvedInputs = resolveModelInputs(workspace, override); if (resolvedInputs.issues.length) return { ok: false, code: 'section_reconciliation_failed', issues: resolvedInputs.issues };
  const inputs = resolvedInputs.inputs, artifactId = `drawing:architecture-section:${workspace.workspace.revision}`;
  const evidenceHash = hashArchitectureInteriorEvidenceV2({ schema: `${ARCHITECTURE_INTERIOR_SECTION_SCHEMA}-verification`, binding: payload.binding, cut, contentHash, sourceObjectCount: payload.view.storeys.reduce((sum, item) => sum + item.walls.length + item.openings.length + item.slabs.length + item.ceilings.length, 0) });
  const verification = { status: 'passed' as const, verifierId: 'architecture-interior-section-structural.v1' as const, evidenceHash, issues: [] as [] };
  const artifact: DesignArtifactNode = { id: artifactId, kind: 'drawing', revision: workspace.workspace.revision, contentHash, state: 'current', inputs, verification, staleBecause: [] };
  return { ok: true, result: { payload, contentHash, verification, artifact, dependencies: dependencies(inputs, artifactId) } };
}
