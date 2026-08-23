import { createHash } from 'node:crypto';
import { canonicalDesignJson, designRevisionSha256 } from '@/lib/designArtifactBinding';
import {
  civilTinExactSurfaceIssues,
  parseCivilTinExactSurfaceArtifact,
  queryCivilTinElevation,
  type CivilTinExactSurfaceArtifact,
  type CivilTinExactSurfacePayload,
  type CivilTinUnit,
} from './civilTinExactSurface';

export const LANDSCAPE_GRADING_EXACT_SCHEMA = 'nexyfab.landscape-grading-exact.v1' as const;
export const LANDSCAPE_GRADING_EXACT_RECEIPT_SCHEMA = 'nexyfab.landscape-grading-exact-probe.v1' as const;
export const LANDSCAPE_GRADING_EXACT_CAPABILITY_ID = 'landscape.grading.exact.internal' as const;
const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_ITEMS = 100_000;
const EPSILON_M = 1e-9;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && ID.test(value) && value.trim() === value;
const nonEmptyText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const exactKeys = (value: unknown, expected: readonly string[]) => record(value) && Object.keys(value).length === expected.length && Object.keys(value).every(key => expected.includes(key));
const sortedById = <T extends { id: string }>(items: readonly T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));

type Point2 = [number, number];
type Point3 = [number, number, number];
type BoundsM = { minX: number; maxX: number; minY: number; maxY: number };
export type LandscapeTerrainModifier =
  | { id: string; kind: 'pad'; boundaryM: Point2[]; targetElevationM: number }
  | { id: string; kind: 'slope'; boundaryM: Point2[]; axisStartM: Point2; axisEndM: Point2; startElevationM: number; endElevationM: number };
export type LandscapeSpotGrade = { id: string; positionM: Point2; elevationM: number; toleranceM: number };
export type LandscapeBreakline = { id: string; kind: 'hard' | 'soft'; pointsM: Point3[] };
export type LandscapeDrainagePath = { id: string; pointsM: Point2[]; outletObjectId: string; minimumSlopePercent: number };
export type LandscapeGradingExactInput = {
  modifiers: LandscapeTerrainModifier[];
  spotGrades: LandscapeSpotGrade[];
  breaklines: LandscapeBreakline[];
  drainagePaths: LandscapeDrainagePath[];
  grid: { cellSizeM: number };
};
export type LandscapeGradingExactPayload = {
  schema: typeof LANDSCAPE_GRADING_EXACT_SCHEMA;
  binding: { workspaceRevisionId: string; workspaceContentHash: string; baseTinArtifactSha256: string; designTinArtifactSha256: string };
  terrain: { baseSurfaceId: string; designSurfaceId: string };
  units: { horizontal: CivilTinUnit; vertical: CivilTinUnit; volume: 'm3' };
  crs: { epsg: number; horizontalDatum: string; verticalDatum: string };
  modifiers: LandscapeTerrainModifier[];
  spotGrades: LandscapeSpotGrade[];
  breaklines: LandscapeBreakline[];
  drainagePaths: Array<{ id: string; pointsM: Array<{ x: number; y: number; z: number }>; outletObjectId: string; minimumSlopePercent: number; segmentSlopesPercent: number[]; minObservedSlopePercent: number }>;
  grid: { boundsM: BoundsM; cellSizeM: number; cellCount: number; integratedTriangleCount: number };
  quantities: { cutM3: number; fillM3: number; netM3: number; integrationMethod: 'grid_triangle_vertex_linear_v1' };
  drainage: { pathCount: number; verifiedPathIds: string[]; minimumSlopePercent: number };
  counts: { modifierCount: number; spotGradeCount: number; breaklineCount: number; drainagePathCount: number };
  externalHydraulicSolver: 'NOT_RUN';
  nativeRoundtrip: 'HOLD';
  fieldSurvey: 'NOT_RUN';
  releaseReady: false;
};
export type LandscapeGradingExactArtifact = { payload: LandscapeGradingExactPayload; contentHash: string; bytes: Uint8Array; artifactSha256: string; artifactName: string; artifactMime: 'application/json' };
export type LandscapeGradingExactParseResult = { payload: LandscapeGradingExactPayload; contentHash: string; artifactSha256: string };
export type LandscapeGradingExactVerification =
  | { status: 'passed'; verifierId: 'landscape-grading-exact-structural.v1'; issues: [] }
  | { status: 'failed'; verifierId: 'landscape-grading-exact-structural.v1'; issues: string[] };
export type LandscapeGradingExactReceipt = {
  schema: typeof LANDSCAPE_GRADING_EXACT_RECEIPT_SCHEMA;
  capabilityId: typeof LANDSCAPE_GRADING_EXACT_CAPABILITY_ID;
  format: 'json';
  workspaceRevisionId: string;
  workspaceContentHash: string;
  baseTinArtifactSha256: string;
  designTinArtifactSha256: string;
  artifactSha256: string;
  artifactBytes: number;
  parserResult: 'verified';
  parserOutputSha256: string;
  verifierEvidenceSha256: string;
  stableIds: { modifiers: string[]; spotGrades: string[]; breaklines: string[]; drainagePaths: string[] };
  quantities: LandscapeGradingExactPayload['quantities'];
  drainage: LandscapeGradingExactPayload['drainage'];
  externalHydraulicSolver: 'NOT_RUN';
  nativeRoundtrip: 'HOLD';
  fieldSurvey: 'NOT_RUN';
  releaseReady: false;
};

function scale(unit: CivilTinUnit): number { return unit === 'mm' ? 0.001 : 1; }
function asM(value: number, unit: CivilTinUnit): number { return value * scale(unit); }
function polygonArea(points: readonly Point2[]): number { return points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]!; return sum + point[0] * next[1] - next[0] * point[1]; }, 0) / 2; }
function orientation(a: Point2, b: Point2, c: Point2): number { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
function properCross(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const ab = orientation(a, b, c), ad = orientation(a, b, d), ca = orientation(c, d, a), cb = orientation(c, d, b);
  return ((ab > EPSILON_M && ad < -EPSILON_M) || (ab < -EPSILON_M && ad > EPSILON_M)) && ((ca > EPSILON_M && cb < -EPSILON_M) || (ca < -EPSILON_M && cb > EPSILON_M));
}
function pointInPolygon(point: Point2, polygon: readonly Point2[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[previous]!, b = polygon[index]!;
    if (Math.abs(orientation(a, b, point)) <= EPSILON_M && point[0] >= Math.min(a[0], b[0]) - EPSILON_M && point[0] <= Math.max(a[0], b[0]) + EPSILON_M && point[1] >= Math.min(a[1], b[1]) - EPSILON_M && point[1] <= Math.max(a[1], b[1]) + EPSILON_M) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function polygonSimple(points: readonly Point2[]): boolean {
  if (points.length < 3 || points.some(point => point.length !== 2 || !point.every(finite)) || Math.abs(polygonArea(points)) <= EPSILON_M) return false;
  for (let first = 0; first < points.length; first += 1) for (let second = first + 1; second < points.length; second += 1) {
    const firstNext = (first + 1) % points.length, secondNext = (second + 1) % points.length;
    if (first === second || firstNext === second || secondNext === first) continue;
    if (properCross(points[first]!, points[firstNext]!, points[second]!, points[secondNext]!)) return false;
  }
  return true;
}
function boundsForTin(payload: CivilTinExactSurfacePayload): BoundsM {
  return { minX: asM(payload.bounds.minX, payload.units.horizontal), maxX: asM(payload.bounds.maxX, payload.units.horizontal), minY: asM(payload.bounds.minY, payload.units.horizontal), maxY: asM(payload.bounds.maxY, payload.units.horizontal) };
}
function insideBounds(point: Point2, bounds: BoundsM): boolean { return point[0] >= bounds.minX - EPSILON_M && point[0] <= bounds.maxX + EPSILON_M && point[1] >= bounds.minY - EPSILON_M && point[1] <= bounds.maxY + EPSILON_M; }
function polygonsOverlap(left: readonly Point2[], right: readonly Point2[]): boolean {
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
    if (properCross(left[leftIndex]!, left[(leftIndex + 1) % left.length]!, right[rightIndex]!, right[(rightIndex + 1) % right.length]!)) return true;
  }
  return pointInPolygon(left[0]!, right) || pointInPolygon(right[0]!, left);
}
function stableIds(payload: LandscapeGradingExactPayload): LandscapeGradingExactReceipt['stableIds'] {
  return { modifiers: payload.modifiers.map(item => item.id), spotGrades: payload.spotGrades.map(item => item.id), breaklines: payload.breaklines.map(item => item.id), drainagePaths: payload.drainagePaths.map(item => item.id) };
}
function allIds(input: LandscapeGradingExactInput): string[] { return [...input.modifiers, ...input.spotGrades, ...input.breaklines, ...input.drainagePaths].map(item => item.id); }

export function landscapeGradingExactIssues(value: unknown): string[] {
  const issues: string[] = [];
  if (!record(value) || value.schema !== LANDSCAPE_GRADING_EXACT_SCHEMA) return ['grading_schema_invalid'];
  const payload = value as Partial<LandscapeGradingExactPayload>;
  if (!exactKeys(payload, ['schema', 'binding', 'terrain', 'units', 'crs', 'modifiers', 'spotGrades', 'breaklines', 'drainagePaths', 'grid', 'quantities', 'drainage', 'counts', 'externalHydraulicSolver', 'nativeRoundtrip', 'fieldSurvey', 'releaseReady'])) issues.push('grading_unknown_key');
  if (!exactKeys(payload.binding, ['workspaceRevisionId', 'workspaceContentHash', 'baseTinArtifactSha256', 'designTinArtifactSha256']) || !identifier(payload.binding?.workspaceRevisionId) || !SHA256.test(String(payload.binding?.workspaceContentHash)) || !SHA256.test(String(payload.binding?.baseTinArtifactSha256)) || !SHA256.test(String(payload.binding?.designTinArtifactSha256))) issues.push('grading_binding_invalid');
  if (!exactKeys(payload.terrain, ['baseSurfaceId', 'designSurfaceId']) || !identifier(payload.terrain?.baseSurfaceId) || !identifier(payload.terrain?.designSurfaceId)) issues.push('grading_terrain_invalid');
  if (!exactKeys(payload.units, ['horizontal', 'vertical', 'volume']) || payload.units?.horizontal !== 'm' || payload.units?.vertical !== 'm' || payload.units?.volume !== 'm3') issues.push('grading_units_invalid');
  if (!exactKeys(payload.crs, ['epsg', 'horizontalDatum', 'verticalDatum']) || !Number.isSafeInteger(payload.crs?.epsg) || Number(payload.crs?.epsg) <= 0 || !nonEmptyText(payload.crs?.horizontalDatum) || !nonEmptyText(payload.crs?.verticalDatum)) issues.push('grading_crs_invalid');
  if (payload.externalHydraulicSolver !== 'NOT_RUN' || payload.nativeRoundtrip !== 'HOLD' || payload.fieldSurvey !== 'NOT_RUN' || payload.releaseReady !== false) issues.push('grading_release_truth_invalid');
  if (!Array.isArray(payload.modifiers) || !Array.isArray(payload.spotGrades) || !Array.isArray(payload.breaklines) || !Array.isArray(payload.drainagePaths)) return [...new Set([...issues, 'grading_collections_invalid'])];
  const sortedCollection = (items: readonly { id: string }[]) => items.every((item, index) => index === 0 || items[index - 1]!.id.localeCompare(item.id) < 0);
  if (!sortedCollection(payload.modifiers as Array<{ id: string }>) || !sortedCollection(payload.spotGrades as Array<{ id: string }>) || !sortedCollection(payload.breaklines as Array<{ id: string }>) || !sortedCollection(payload.drainagePaths as Array<{ id: string }>)) issues.push('grading_collections_not_sorted');
  const ids: string[] = [];
  for (const modifier of payload.modifiers) {
    if (!record(modifier) || !identifier(modifier.id) || !['pad', 'slope'].includes(String(modifier.kind)) || !Array.isArray(modifier.boundaryM) || !polygonSimple(modifier.boundaryM as Point2[])) { issues.push('grading_modifier_invalid'); continue; }
    ids.push(modifier.id);
    if (modifier.kind === 'pad' && (!exactKeys(modifier, ['id', 'kind', 'boundaryM', 'targetElevationM']) || !finite(modifier.targetElevationM))) issues.push(`grading_pad_invalid:${modifier.id}`);
    if (modifier.kind === 'slope' && (!exactKeys(modifier, ['id', 'kind', 'boundaryM', 'axisStartM', 'axisEndM', 'startElevationM', 'endElevationM']) || !Array.isArray(modifier.axisStartM) || !Array.isArray(modifier.axisEndM) || modifier.axisStartM.length !== 2 || modifier.axisEndM.length !== 2 || !modifier.axisStartM.every(finite) || !modifier.axisEndM.every(finite) || !finite(modifier.startElevationM) || !finite(modifier.endElevationM) || Math.hypot(modifier.axisEndM[0] - modifier.axisStartM[0], modifier.axisEndM[1] - modifier.axisStartM[1]) <= EPSILON_M)) issues.push(`grading_slope_invalid:${modifier.id}`);
  }
  for (const spot of payload.spotGrades) {
    if (!exactKeys(spot, ['id', 'positionM', 'elevationM', 'toleranceM']) || !identifier(spot.id) || !Array.isArray(spot.positionM) || spot.positionM.length !== 2 || !spot.positionM.every(finite) || !finite(spot.elevationM) || !finite(spot.toleranceM) || spot.toleranceM < 0) issues.push('grading_spot_grade_invalid');
    else ids.push(spot.id);
  }
  for (const breakline of payload.breaklines) {
    if (!exactKeys(breakline, ['id', 'kind', 'pointsM']) || !identifier(breakline.id) || !['hard', 'soft'].includes(String(breakline.kind)) || !Array.isArray(breakline.pointsM) || breakline.pointsM.length < 2 || breakline.pointsM.some(point => !Array.isArray(point) || point.length !== 3 || !point.every(finite))) issues.push('grading_breakline_invalid');
    else ids.push(breakline.id);
  }
  for (const path of payload.drainagePaths) {
    if (!exactKeys(path, ['id', 'pointsM', 'outletObjectId', 'minimumSlopePercent', 'segmentSlopesPercent', 'minObservedSlopePercent']) || !identifier(path.id) || !Array.isArray(path.pointsM) || path.pointsM.length < 2 || path.pointsM.some(point => !record(point) || !exactKeys(point, ['x', 'y', 'z']) || !finite(point.x) || !finite(point.y) || !finite(point.z)) || !identifier(path.outletObjectId) || !finite(path.minimumSlopePercent) || path.minimumSlopePercent <= 0 || !Array.isArray(path.segmentSlopesPercent) || path.segmentSlopesPercent.length !== path.pointsM.length - 1 || !path.segmentSlopesPercent.every(finite) || !finite(path.minObservedSlopePercent)) issues.push('grading_drainage_path_invalid');
    else { ids.push(path.id); if (path.segmentSlopesPercent.some(slope => slope < path.minimumSlopePercent - 1e-8)) issues.push(`grading_drainage_reverse_slope:${path.id}`); }
  }
  if (new Set(ids).size !== ids.length || ids.some(identifier) === false) issues.push('grading_stable_id_invalid');
  const toPayloadM = (point: Point2): Point2 => point;
  const allPoints = payload.modifiers.flatMap(item => item.boundaryM as Point2[]).concat(payload.spotGrades.map(item => item.positionM), payload.breaklines.flatMap(item => item.pointsM.map(point => [point[0], point[1]] as Point2)), payload.drainagePaths.flatMap(item => item.pointsM.map(point => [point.x, point.y] as Point2))).map(toPayloadM);
  const bounds = payload.grid?.boundsM;
  if (!exactKeys(bounds, ['minX', 'maxX', 'minY', 'maxY']) || !finite(bounds?.minX) || !finite(bounds?.maxX) || !finite(bounds?.minY) || !finite(bounds?.maxY) || Number(bounds?.maxX) <= Number(bounds?.minX) || Number(bounds?.maxY) <= Number(bounds?.minY) || allPoints.some(point => !insideBounds(point, bounds as BoundsM))) issues.push('grading_geometry_bounds_invalid');
  const modifiers = payload.modifiers as LandscapeTerrainModifier[];
  for (let first = 0; first < modifiers.length; first += 1) for (let second = first + 1; second < modifiers.length; second += 1) if (polygonsOverlap(modifiers[first]!.boundaryM.map(toPayloadM), modifiers[second]!.boundaryM.map(toPayloadM))) issues.push(`grading_modifier_overlap:${modifiers[first]!.id}:${modifiers[second]!.id}`);
  for (const breakline of payload.breaklines) { const points = breakline.pointsM.map(point => [point[0], point[1]] as Point2).map(toPayloadM); if (points.some(point => !insideBounds(point, bounds as BoundsM)) || points.some((point, index) => index > 0 && Math.hypot(point[0] - points[index - 1]![0], point[1] - points[index - 1]![1]) <= EPSILON_M)) issues.push(`grading_breakline_geometry_invalid:${breakline.id}`); }
  const grid = payload.grid;
  if (!exactKeys(grid, ['boundsM', 'cellSizeM', 'cellCount', 'integratedTriangleCount']) || !finite(grid?.cellSizeM) || Number(grid?.cellSizeM) <= 0 || !Number.isSafeInteger(grid?.cellCount) || Number(grid?.cellCount) <= 0 || !Number.isSafeInteger(grid?.integratedTriangleCount) || Number(grid?.integratedTriangleCount) !== Number(grid?.cellCount) * 2) issues.push('grading_grid_invalid');
  const quantities = payload.quantities;
  if (!exactKeys(quantities, ['cutM3', 'fillM3', 'netM3', 'integrationMethod']) || !finite(quantities?.cutM3) || Number(quantities?.cutM3) < 0 || !finite(quantities?.fillM3) || Number(quantities?.fillM3) < 0 || !finite(quantities?.netM3) || quantities?.netM3 !== Number(quantities.fillM3) - Number(quantities.cutM3) || quantities?.integrationMethod !== 'grid_triangle_vertex_linear_v1') issues.push('grading_quantities_invalid');
  const drainage = payload.drainage;
  const drainagePaths = payload.drainagePaths as LandscapeGradingExactPayload['drainagePaths'];
  if (!exactKeys(drainage, ['pathCount', 'verifiedPathIds', 'minimumSlopePercent']) || !Number.isSafeInteger(drainage?.pathCount) || drainage?.pathCount !== drainagePaths.length || drainage.pathCount <= 0 || !Array.isArray(drainage?.verifiedPathIds) || new Set(drainage.verifiedPathIds).size !== drainage.verifiedPathIds.length || drainage.verifiedPathIds.length !== drainagePaths.length || drainage.verifiedPathIds.some((id, index) => id !== drainagePaths[index]?.id) || !finite(drainage?.minimumSlopePercent) || drainage.minimumSlopePercent <= 0) issues.push('grading_drainage_summary_invalid');
  const counts = payload.counts;
  if (!exactKeys(counts, ['modifierCount', 'spotGradeCount', 'breaklineCount', 'drainagePathCount']) || counts?.modifierCount !== payload.modifiers.length || counts?.spotGradeCount !== payload.spotGrades.length || counts?.breaklineCount !== payload.breaklines.length || counts?.drainagePathCount !== payload.drainagePaths.length) issues.push('grading_counts_mismatch');
  return [...new Set(issues)];
}

function validateTinArtifacts(input: { baseTin: CivilTinExactSurfaceArtifact; designTin: CivilTinExactSurfaceArtifact; expectedBaseTinArtifactSha256: string; expectedDesignTinArtifactSha256: string; workspaceRevisionId: string; workspaceContentHash: string }): { base: CivilTinExactSurfacePayload; design: CivilTinExactSurfacePayload } {
  if (!SHA256.test(input.expectedBaseTinArtifactSha256) || !SHA256.test(input.expectedDesignTinArtifactSha256) || input.baseTin.artifactSha256 !== input.expectedBaseTinArtifactSha256 || input.designTin.artifactSha256 !== input.expectedDesignTinArtifactSha256 || sha256(input.baseTin.bytes) !== input.baseTin.artifactSha256 || sha256(input.designTin.bytes) !== input.designTin.artifactSha256) throw new Error('LANDSCAPE_GRADING_TIN_HASH_MISMATCH');
  const base = parseCivilTinExactSurfaceArtifact(input.baseTin.bytes, { workspaceRevisionId: input.workspaceRevisionId, workspaceContentHash: input.workspaceContentHash }).payload;
  const design = parseCivilTinExactSurfaceArtifact(input.designTin.bytes, { workspaceRevisionId: input.workspaceRevisionId, workspaceContentHash: input.workspaceContentHash }).payload;
  if (civilTinExactSurfaceIssues(base).length || civilTinExactSurfaceIssues(design).length || base.kind !== 'existing' || design.kind !== 'proposed' || base.units.horizontal !== design.units.horizontal || base.units.vertical !== design.units.vertical || base.crs.epsg !== design.crs.epsg || base.crs.horizontalDatum !== design.crs.horizontalDatum || base.crs.verticalDatum !== design.crs.verticalDatum) throw new Error('LANDSCAPE_GRADING_TIN_CONTRACT_MISMATCH');
  return { base, design };
}

function queryM(tin: CivilTinExactSurfacePayload, x: number, y: number): number { const result = queryCivilTinElevation(tin, { x, y, unit: 'm' }); return asM(result.elevation, result.unit); }
function validateInputGeometry(input: LandscapeGradingExactInput, base: CivilTinExactSurfacePayload, design: CivilTinExactSurfacePayload): void {
  const bounds = boundsForTin(base); const all = allIds(input); if (all.length > MAX_ITEMS || new Set(all).size !== all.length || all.some(id => !identifier(id))) throw new Error('LANDSCAPE_GRADING_STABLE_ID_INVALID');
  if (input.drainagePaths.length === 0) throw new Error('LANDSCAPE_GRADING_DRAINAGE_REQUIRED');
  const toMPoint = (point: Point2): Point2 => point;
  for (const modifier of input.modifiers) {
    const polygon = modifier.boundaryM.map(toMPoint); if (!polygonSimple(polygon) || polygon.some(point => !insideBounds(point, bounds))) throw new Error(`LANDSCAPE_GRADING_MODIFIER_INVALID:${modifier.id}`);
    if (modifier.kind === 'pad' && !finite(modifier.targetElevationM)) throw new Error(`LANDSCAPE_GRADING_PAD_INVALID:${modifier.id}`);
    if (modifier.kind === 'slope' && (!finite(modifier.startElevationM) || !finite(modifier.endElevationM) || !Array.isArray(modifier.axisStartM) || !Array.isArray(modifier.axisEndM) || !insideBounds(toMPoint(modifier.axisStartM), bounds) || !insideBounds(toMPoint(modifier.axisEndM), bounds) || Math.hypot(toMPoint(modifier.axisEndM)[0] - toMPoint(modifier.axisStartM)[0], toMPoint(modifier.axisEndM)[1] - toMPoint(modifier.axisStartM)[1]) <= EPSILON_M)) throw new Error(`LANDSCAPE_GRADING_SLOPE_INVALID:${modifier.id}`);
  }
  for (let first = 0; first < input.modifiers.length; first += 1) for (let second = first + 1; second < input.modifiers.length; second += 1) if (polygonsOverlap(input.modifiers[first]!.boundaryM.map(toMPoint), input.modifiers[second]!.boundaryM.map(toMPoint))) throw new Error(`LANDSCAPE_GRADING_MODIFIER_OVERLAP:${input.modifiers[first]!.id}:${input.modifiers[second]!.id}`);
  for (const spot of input.spotGrades) { const point = toMPoint(spot.positionM); if (!insideBounds(point, bounds) || !finite(spot.elevationM) || !finite(spot.toleranceM) || spot.toleranceM < 0) throw new Error(`LANDSCAPE_GRADING_SPOT_INVALID:${spot.id}`); }
  for (const breakline of input.breaklines) { const points = breakline.pointsM; if (!identifier(breakline.id) || !['hard', 'soft'].includes(breakline.kind) || points.length < 2 || points.some(point => !point.every(finite) || !insideBounds([point[0], point[1]], bounds))) throw new Error(`LANDSCAPE_GRADING_BREAKLINE_INVALID:${breakline.id}`); for (let index = 1; index < points.length; index += 1) if (Math.hypot(points[index]![0] - points[index - 1]![0], points[index]![1] - points[index - 1]![1]) <= EPSILON_M) throw new Error(`LANDSCAPE_GRADING_BREAKLINE_INVALID:${breakline.id}`); }
  for (const path of input.drainagePaths) { if (!identifier(path.id) || !identifier(path.outletObjectId) || path.pointsM.length < 2 || !finite(path.minimumSlopePercent) || path.minimumSlopePercent <= 0 || path.pointsM.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(finite) || !insideBounds(toMPoint(point), bounds))) throw new Error(`LANDSCAPE_GRADING_DRAINAGE_INVALID:${path.id}`); }
  const designBounds = boundsForTin(design); for (const path of input.drainagePaths) for (const point of path.pointsM) if (!insideBounds(toMPoint(point), designBounds)) throw new Error(`LANDSCAPE_GRADING_DRAINAGE_OUT_OF_RANGE:${path.id}`);
}

function integrate(input: LandscapeGradingExactInput, base: CivilTinExactSurfacePayload, design: CivilTinExactSurfacePayload) {
  const baseBounds = boundsForTin(base), designBounds = boundsForTin(design); const bounds: BoundsM = { minX: Math.max(baseBounds.minX, designBounds.minX), maxX: Math.min(baseBounds.maxX, designBounds.maxX), minY: Math.max(baseBounds.minY, designBounds.minY), maxY: Math.min(baseBounds.maxY, designBounds.maxY) };
  const cellSizeM = input.grid.cellSizeM; if (!finite(cellSizeM) || cellSizeM <= 0) throw new Error('LANDSCAPE_GRADING_GRID_INVALID');
  const columns = Math.ceil((bounds.maxX - bounds.minX) / cellSizeM), rows = Math.ceil((bounds.maxY - bounds.minY) / cellSizeM), cellCount = columns * rows; if (columns <= 0 || rows <= 0 || cellCount > MAX_ITEMS) throw new Error('LANDSCAPE_GRADING_GRID_TOO_LARGE');
  let cutM3 = 0, fillM3 = 0, integratedTriangleCount = 0;
  const sample = (point: Point2) => { const baseZ = queryM(base, point[0], point[1]), designZ = queryM(design, point[0], point[1]); return designZ - baseZ; };
  const integrateTriangle = (triangle: [Point2, Point2, Point2]) => { const area = Math.abs(orientation(triangle[0], triangle[1], triangle[2])) / 2; if (area <= EPSILON_M) return; const deltas = triangle.map(sample); const cut = area * deltas.reduce((sum, delta) => sum + Math.max(0, -delta), 0) / 3; const fill = area * deltas.reduce((sum, delta) => sum + Math.max(0, delta), 0) / 3; cutM3 += cut; fillM3 += fill; integratedTriangleCount += 1; };
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) { const x = bounds.minX + column * cellSizeM, y = bounds.minY + row * cellSizeM, nx = Math.min(bounds.maxX, x + cellSizeM), ny = Math.min(bounds.maxY, y + cellSizeM); integrateTriangle([[x, y], [nx, y], [nx, ny]]); integrateTriangle([[x, y], [nx, ny], [x, ny]]); }
  return { bounds, cellSizeM, cellCount, integratedTriangleCount, cutM3, fillM3, netM3: fillM3 - cutM3 };
}

function drainageResults(input: LandscapeGradingExactInput, design: CivilTinExactSurfacePayload) {
  return input.drainagePaths.map(path => { const points = path.pointsM.map(point => { const x = point[0], y = point[1]; const elevation = queryCivilTinElevation(design, { x, y, unit: 'm' }); return { x, y, z: asM(elevation.elevation, elevation.unit) }; }); const slopes = points.slice(0, -1).map((point, index) => { const next = points[index + 1]!; const horizontal = Math.hypot(next.x - point.x, next.y - point.y); if (horizontal <= EPSILON_M) throw new Error(`LANDSCAPE_GRADING_DRAINAGE_ZERO_SEGMENT:${path.id}`); return ((point.z - next.z) / horizontal) * 100; }); if (slopes.some(slope => slope < path.minimumSlopePercent - 1e-8)) throw new Error(`LANDSCAPE_GRADING_REVERSE_SLOPE:${path.id}`); return { id: path.id, pointsM: points, outletObjectId: path.outletObjectId, minimumSlopePercent: path.minimumSlopePercent, segmentSlopesPercent: slopes, minObservedSlopePercent: Math.min(...slopes) }; });
}

export function exportLandscapeGradingExactArtifact(input: { workspaceRevisionId: string; expectedWorkspaceRevisionId: string; workspaceRevisionValue: unknown; expectedWorkspaceContentHash: string; expectedBaseTinArtifactSha256: string; expectedDesignTinArtifactSha256: string; baseTin: CivilTinExactSurfaceArtifact; designTin: CivilTinExactSurfaceArtifact; grading: LandscapeGradingExactInput; artifactName?: string }): LandscapeGradingExactArtifact {
  if (!identifier(input.workspaceRevisionId) || input.workspaceRevisionId !== input.expectedWorkspaceRevisionId) throw new Error('LANDSCAPE_GRADING_STALE_REVISION');
  const workspaceContentHash = designRevisionSha256(input.workspaceRevisionValue); if (!SHA256.test(input.expectedWorkspaceContentHash) || workspaceContentHash !== input.expectedWorkspaceContentHash) throw new Error('LANDSCAPE_GRADING_STALE_REVISION_HASH');
  const { base, design } = validateTinArtifacts({ ...input, workspaceRevisionId: input.workspaceRevisionId, workspaceContentHash }); validateInputGeometry(input.grading, base, design);
  const grid = integrate(input.grading, base, design); const drainage = drainageResults(input.grading, design);
  const payload: LandscapeGradingExactPayload = { schema: LANDSCAPE_GRADING_EXACT_SCHEMA, binding: { workspaceRevisionId: input.workspaceRevisionId, workspaceContentHash, baseTinArtifactSha256: input.expectedBaseTinArtifactSha256, designTinArtifactSha256: input.expectedDesignTinArtifactSha256 }, terrain: { baseSurfaceId: base.surfaceId, designSurfaceId: design.surfaceId }, units: { horizontal: 'm', vertical: 'm', volume: 'm3' }, crs: base.crs, modifiers: sortedById(input.grading.modifiers), spotGrades: sortedById(input.grading.spotGrades), breaklines: sortedById(input.grading.breaklines), drainagePaths: sortedById(drainage), grid: { boundsM: grid.bounds, cellSizeM: grid.cellSizeM, cellCount: grid.cellCount, integratedTriangleCount: grid.integratedTriangleCount }, quantities: { cutM3: grid.cutM3, fillM3: grid.fillM3, netM3: grid.netM3, integrationMethod: 'grid_triangle_vertex_linear_v1' }, drainage: { pathCount: drainage.length, verifiedPathIds: drainage.map(path => path.id), minimumSlopePercent: Math.min(...input.grading.drainagePaths.map(path => path.minimumSlopePercent)) }, counts: { modifierCount: input.grading.modifiers.length, spotGradeCount: input.grading.spotGrades.length, breaklineCount: input.grading.breaklines.length, drainagePathCount: drainage.length }, externalHydraulicSolver: 'NOT_RUN', nativeRoundtrip: 'HOLD', fieldSurvey: 'NOT_RUN', releaseReady: false };
  const issues = landscapeGradingExactIssues(payload); if (issues.length) throw new Error(`LANDSCAPE_GRADING_PAYLOAD_INVALID:${issues[0]}`); const contentHash = designRevisionSha256(payload); const bytes = encoder.encode(canonicalDesignJson({ payload, contentHash })); return { payload, contentHash, bytes, artifactSha256: sha256(bytes), artifactName: input.artifactName ?? 'landscape-grading-exact.json', artifactMime: 'application/json' };
}

export function parseLandscapeGradingExactArtifact(bytes: Uint8Array, expectedBinding?: { workspaceRevisionId: string; workspaceContentHash: string; baseTinArtifactSha256: string; designTinArtifactSha256: string }): LandscapeGradingExactParseResult {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error('LANDSCAPE_GRADING_ARTIFACT_EMPTY'); let text: string; try { text = decoder.decode(bytes); } catch { throw new Error('LANDSCAPE_GRADING_ARTIFACT_INVALID_UTF8'); } let parsed: unknown; try { parsed = JSON.parse(text) as unknown; } catch { throw new Error('LANDSCAPE_GRADING_ARTIFACT_JSON_INVALID'); }
  if (!record(parsed) || !record(parsed.payload) || typeof parsed.contentHash !== 'string' || !SHA256.test(parsed.contentHash) || !exactKeys(parsed, ['payload', 'contentHash'])) throw new Error('LANDSCAPE_GRADING_ENVELOPE_INVALID'); if (canonicalDesignJson(parsed) !== text) throw new Error('LANDSCAPE_GRADING_NON_CANONICAL'); const issues = landscapeGradingExactIssues(parsed.payload); if (issues.length) throw new Error(`LANDSCAPE_GRADING_ARTIFACT_INVALID:${issues[0]}`); const payload = parsed.payload as LandscapeGradingExactPayload; if (designRevisionSha256(payload) !== parsed.contentHash) throw new Error('LANDSCAPE_GRADING_CONTENT_HASH_MISMATCH'); if (expectedBinding && (payload.binding.workspaceRevisionId !== expectedBinding.workspaceRevisionId || payload.binding.workspaceContentHash !== expectedBinding.workspaceContentHash || payload.binding.baseTinArtifactSha256 !== expectedBinding.baseTinArtifactSha256 || payload.binding.designTinArtifactSha256 !== expectedBinding.designTinArtifactSha256)) throw new Error('LANDSCAPE_GRADING_STALE_BINDING'); return { payload, contentHash: parsed.contentHash, artifactSha256: sha256(bytes) };
}

export function verifyLandscapeGradingExactArtifact(input: { artifact: LandscapeGradingExactParseResult; workspaceRevisionId: string; workspaceContentHash: string; baseTinArtifactSha256: string; designTinArtifactSha256: string }): LandscapeGradingExactVerification {
  const issues: string[] = []; try { issues.push(...landscapeGradingExactIssues(input.artifact.payload)); if (input.artifact.contentHash !== designRevisionSha256(input.artifact.payload)) issues.push('content_hash_mismatch'); const binding = input.artifact.payload.binding; if (binding.workspaceRevisionId !== input.workspaceRevisionId || binding.workspaceContentHash !== input.workspaceContentHash || binding.baseTinArtifactSha256 !== input.baseTinArtifactSha256 || binding.designTinArtifactSha256 !== input.designTinArtifactSha256) issues.push('stale_binding'); } catch { issues.push('verifier_exception'); } return issues.length ? { status: 'failed', verifierId: 'landscape-grading-exact-structural.v1', issues: [...new Set(issues)] } : { status: 'passed', verifierId: 'landscape-grading-exact-structural.v1', issues: [] };
}

export function buildLandscapeGradingExactReceipt(input: { artifact: LandscapeGradingExactArtifact; parserOutputBytes: Uint8Array; verifierEvidenceBytes: Uint8Array }): Uint8Array {
  if (sha256(input.artifact.bytes) !== input.artifact.artifactSha256 || input.parserOutputBytes.byteLength === 0 || input.verifierEvidenceBytes.byteLength === 0) throw new Error('LANDSCAPE_GRADING_RECEIPT_HASH_INPUT_INVALID'); const parsed = parseLandscapeGradingExactArtifact(input.artifact.bytes, input.artifact.payload.binding); if (parsed.artifactSha256 !== input.artifact.artifactSha256 || parsed.contentHash !== input.artifact.contentHash || canonicalDesignJson(parsed.payload) !== canonicalDesignJson(input.artifact.payload)) throw new Error('LANDSCAPE_GRADING_RECEIPT_ARTIFACT_BINDING_MISMATCH'); const payload = input.artifact.payload; const receipt: LandscapeGradingExactReceipt = { schema: LANDSCAPE_GRADING_EXACT_RECEIPT_SCHEMA, capabilityId: LANDSCAPE_GRADING_EXACT_CAPABILITY_ID, format: 'json', workspaceRevisionId: payload.binding.workspaceRevisionId, workspaceContentHash: payload.binding.workspaceContentHash, baseTinArtifactSha256: payload.binding.baseTinArtifactSha256, designTinArtifactSha256: payload.binding.designTinArtifactSha256, artifactSha256: input.artifact.artifactSha256, artifactBytes: input.artifact.bytes.byteLength, parserResult: 'verified', parserOutputSha256: sha256(input.parserOutputBytes), verifierEvidenceSha256: sha256(input.verifierEvidenceBytes), stableIds: stableIds(payload), quantities: payload.quantities, drainage: payload.drainage, externalHydraulicSolver: 'NOT_RUN', nativeRoundtrip: 'HOLD', fieldSurvey: 'NOT_RUN', releaseReady: false }; return encoder.encode(canonicalDesignJson(receipt));
}

export function claimLandscapeGradingExactReceipt(input: { artifact: LandscapeGradingExactArtifact; receiptBytes: Uint8Array; parserOutputBytes: Uint8Array; verifierEvidenceBytes: Uint8Array }): LandscapeGradingExactReceipt & { receiptSha256: string; claim: 'internal-landscape-grading-exact-verified' } {
  let text: string; let receipt: LandscapeGradingExactReceipt; try { text = decoder.decode(input.receiptBytes); receipt = JSON.parse(text) as LandscapeGradingExactReceipt; } catch { throw new Error('LANDSCAPE_GRADING_RECEIPT_INVALID'); }
  if (!exactKeys(receipt, ['schema', 'capabilityId', 'format', 'workspaceRevisionId', 'workspaceContentHash', 'baseTinArtifactSha256', 'designTinArtifactSha256', 'artifactSha256', 'artifactBytes', 'parserResult', 'parserOutputSha256', 'verifierEvidenceSha256', 'stableIds', 'quantities', 'drainage', 'externalHydraulicSolver', 'nativeRoundtrip', 'fieldSurvey', 'releaseReady']) || canonicalDesignJson(receipt) !== text) throw new Error('LANDSCAPE_GRADING_RECEIPT_NON_CANONICAL');
  const expected = JSON.parse(decoder.decode(buildLandscapeGradingExactReceipt(input))) as LandscapeGradingExactReceipt; if (canonicalDesignJson(receipt) !== canonicalDesignJson(expected) || receipt.artifactSha256 !== input.artifact.artifactSha256 || sha256(input.artifact.bytes) !== receipt.artifactSha256 || receipt.artifactBytes !== input.artifact.bytes.byteLength || sha256(input.parserOutputBytes) !== receipt.parserOutputSha256 || sha256(input.verifierEvidenceBytes) !== receipt.verifierEvidenceSha256 || receipt.parserResult !== 'verified' || receipt.externalHydraulicSolver !== 'NOT_RUN' || receipt.nativeRoundtrip !== 'HOLD' || receipt.fieldSurvey !== 'NOT_RUN' || receipt.releaseReady !== false) throw new Error('LANDSCAPE_GRADING_RECEIPT_BINDING_MISMATCH'); return { ...receipt, receiptSha256: sha256(input.receiptBytes), claim: 'internal-landscape-grading-exact-verified' };
}
