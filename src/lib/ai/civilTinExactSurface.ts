import { createHash } from 'node:crypto';
import { canonicalDesignJson, designRevisionSha256 } from '@/lib/designArtifactBinding';

export const CIVIL_TIN_EXACT_SURFACE_SCHEMA = 'nexyfab.civil-tin-exact-surface.v1' as const;
export const CIVIL_TIN_EXACT_SURFACE_RECEIPT_SCHEMA = 'nexyfab.civil-tin-exact-surface-probe.v1' as const;
export const CIVIL_TIN_EXACT_SURFACE_CAPABILITY_ID = 'civil.tin.exact.surface.internal' as const;
const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_ITEMS = 100_000;
const EPSILON_M = 1e-12;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && ID.test(value) && value.trim() === value;
const nonEmptyText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const exactKeys = (value: unknown, expected: readonly string[]) => record(value) && Object.keys(value).length === expected.length && Object.keys(value).every(key => expected.includes(key));
const sortedById = <T extends { id: string }>(items: readonly T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));

export type CivilTinUnit = 'm' | 'mm';
export type CivilTinUnits = { horizontal: CivilTinUnit; vertical: CivilTinUnit };
export type CivilTinCrs = { epsg: number; horizontalDatum: string; verticalDatum: string };
export type CivilTinBounds = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
export type CivilTinPoint = { id: string; x: number; y: number; z: number };
export type CivilTinTriangle = { id: string; pointIds: [string, string, string] };
export type CivilTinExactSurfaceInput = {
  surfaceId: string;
  kind: 'existing' | 'proposed';
  units: CivilTinUnits;
  crs: CivilTinCrs;
  bounds: CivilTinBounds;
  points: CivilTinPoint[];
  triangles: CivilTinTriangle[];
};
export type CivilTinExactSurfacePayload = CivilTinExactSurfaceInput & {
  schema: typeof CIVIL_TIN_EXACT_SURFACE_SCHEMA;
  binding: { workspaceRevisionId: string; workspaceContentHash: string };
  counts: { pointCount: number; triangleCount: number; edgeCount: number };
};
export type CivilTinExactSurfaceArtifact = {
  payload: CivilTinExactSurfacePayload;
  contentHash: string;
  bytes: Uint8Array;
  artifactSha256: string;
  artifactName: string;
  artifactMime: 'application/json';
};
export type CivilTinExactSurfaceParseResult = { payload: CivilTinExactSurfacePayload; contentHash: string; artifactSha256: string };
export type CivilTinExactSurfaceVerification =
  | { status: 'passed'; verifierId: 'civil-tin-exact-surface-structural.v1'; issues: [] }
  | { status: 'failed'; verifierId: 'civil-tin-exact-surface-structural.v1'; issues: string[] };
export type CivilTinExactSurfaceReceipt = {
  schema: typeof CIVIL_TIN_EXACT_SURFACE_RECEIPT_SCHEMA;
  capabilityId: typeof CIVIL_TIN_EXACT_SURFACE_CAPABILITY_ID;
  format: 'json';
  surfaceId: string;
  kind: 'existing' | 'proposed';
  workspaceRevisionId: string;
  workspaceContentHash: string;
  artifactSha256: string;
  artifactBytes: number;
  parserResult: 'verified';
  stablePointIds: string[];
  stableTriangleIds: string[];
  queryMethod: 'barycentric_xy';
  units: CivilTinUnits;
  crs: CivilTinCrs;
  externalSurvey: 'NOT_RUN';
  nativeRoundtrip: 'HOLD';
  fieldValidation: 'NOT_RUN';
  releaseReady: false;
};

function scaleFor(unit: CivilTinUnit): number { return unit === 'mm' ? 0.001 : 1; }
function toMeters(value: number, unit: CivilTinUnit): number { return value * scaleFor(unit); }
function fromMeters(value: number, unit: CivilTinUnit): number { return value / scaleFor(unit); }
function pointsInMeters(payload: Pick<CivilTinExactSurfacePayload, 'points' | 'units'>): Map<string, CivilTinPoint> {
  return new Map(payload.points.map(point => [point.id, { id: point.id, x: toMeters(point.x, payload.units.horizontal), y: toMeters(point.y, payload.units.horizontal), z: toMeters(point.z, payload.units.vertical) }]));
}
function orient(a: CivilTinPoint, b: CivilTinPoint, c: CivilTinPoint): number { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
function collinearPositiveOverlap(a: CivilTinPoint, b: CivilTinPoint, c: CivilTinPoint, d: CivilTinPoint): boolean {
  if (Math.abs(orient(a, b, c)) > EPSILON_M || Math.abs(orient(a, b, d)) > EPSILON_M) return false;
  const useX = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  const left = useX ? Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) : Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
  const right = useX ? Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) : Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
  return right - left > EPSILON_M;
}
function properCross(a: CivilTinPoint, b: CivilTinPoint, c: CivilTinPoint, d: CivilTinPoint): boolean {
  const first = orient(a, b, c), second = orient(a, b, d), third = orient(c, d, a), fourth = orient(c, d, b);
  return ((first > EPSILON_M && second < -EPSILON_M) || (first < -EPSILON_M && second > EPSILON_M))
    && ((third > EPSILON_M && fourth < -EPSILON_M) || (third < -EPSILON_M && fourth > EPSILON_M));
}
function strictlyInside(point: CivilTinPoint, triangle: readonly CivilTinPoint[]): boolean {
  const values = [orient(triangle[0]!, triangle[1]!, point), orient(triangle[1]!, triangle[2]!, point), orient(triangle[2]!, triangle[0]!, point)];
  return values.every(value => value > EPSILON_M) || values.every(value => value < -EPSILON_M);
}
function triangleHasOverlap(left: readonly CivilTinPoint[], right: readonly CivilTinPoint[], sharedPointCount: number): boolean {
  if (sharedPointCount === 2) {
    const edge = left.filter(point => right.some(candidate => candidate.id === point.id));
    const leftThird = left.find(point => !edge.some(candidate => candidate.id === point.id))!;
    const rightThird = right.find(point => !edge.some(candidate => candidate.id === point.id))!;
    return orient(edge[0]!, edge[1]!, leftThird) * orient(edge[0]!, edge[1]!, rightThird) > -EPSILON_M;
  }
  for (let leftIndex = 0; leftIndex < 3; leftIndex += 1) {
    const leftNext = (leftIndex + 1) % 3;
    for (let rightIndex = 0; rightIndex < 3; rightIndex += 1) {
      const rightNext = (rightIndex + 1) % 3;
      if (properCross(left[leftIndex]!, left[leftNext]!, right[rightIndex]!, right[rightNext]!) || collinearPositiveOverlap(left[leftIndex]!, left[leftNext]!, right[rightIndex]!, right[rightNext]!)) return true;
    }
  }
  return strictlyInside(left[0]!, right) || strictlyInside(right[0]!, left);
}

export function civilTinExactSurfaceIssues(value: unknown): string[] {
  const issues: string[] = [];
  if (!record(value) || value.schema !== CIVIL_TIN_EXACT_SURFACE_SCHEMA) return ['surface_schema_invalid'];
  const payload = value as Partial<CivilTinExactSurfacePayload>;
  if (!exactKeys(payload, ['schema', 'binding', 'surfaceId', 'kind', 'units', 'crs', 'bounds', 'points', 'triangles', 'counts'])) issues.push('surface_unknown_key');
  if (!record(payload.binding) || !identifier(payload.binding.workspaceRevisionId) || !SHA256.test(String(payload.binding.workspaceContentHash))) issues.push('surface_binding_invalid');
  if (!identifier(payload.surfaceId) || !['existing', 'proposed'].includes(String(payload.kind))) issues.push('surface_identity_invalid');
  if (!exactKeys(payload.units, ['horizontal', 'vertical']) || !['m', 'mm'].includes(String(payload.units?.horizontal)) || !['m', 'mm'].includes(String(payload.units?.vertical))) issues.push('surface_units_invalid');
  if (!exactKeys(payload.crs, ['epsg', 'horizontalDatum', 'verticalDatum']) || !Number.isSafeInteger(payload.crs?.epsg) || Number(payload.crs?.epsg) <= 0 || !nonEmptyText(payload.crs?.horizontalDatum) || !nonEmptyText(payload.crs?.verticalDatum)) issues.push('surface_crs_invalid');
  if (!exactKeys(payload.bounds, ['minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ']) || !finite(payload.bounds?.minX) || !finite(payload.bounds?.maxX) || !finite(payload.bounds?.minY) || !finite(payload.bounds?.maxY) || !finite(payload.bounds?.minZ) || !finite(payload.bounds?.maxZ) || Number(payload.bounds?.maxX) <= Number(payload.bounds?.minX) || Number(payload.bounds?.maxY) <= Number(payload.bounds?.minY) || Number(payload.bounds?.maxZ) < Number(payload.bounds?.minZ)) issues.push('surface_bounds_invalid');
  if (!Array.isArray(payload.points) || !Array.isArray(payload.triangles) || payload.points.length === 0 || payload.triangles.length === 0 || payload.points.length > MAX_ITEMS || payload.triangles.length > MAX_ITEMS) return [...new Set([...issues, 'surface_collections_invalid'])];
  const points = payload.points as unknown[], triangles = payload.triangles as unknown[];
  const pointIds: string[] = [], pointsById = new Map<string, CivilTinPoint>(), coordinateKeys = new Set<string>();
  const horizontalScale = payload.units && (payload.units.horizontal === 'm' || payload.units.horizontal === 'mm') ? scaleFor(payload.units.horizontal) : 1;
  const verticalScale = payload.units && (payload.units.vertical === 'm' || payload.units.vertical === 'mm') ? scaleFor(payload.units.vertical) : 1;
  for (const point of points) {
    if (!exactKeys(point, ['id', 'x', 'y', 'z']) || !record(point) || !identifier(point.id) || !finite(point.x) || !finite(point.y) || !finite(point.z)) { issues.push('surface_point_invalid'); continue; }
    if (pointsById.has(point.id)) issues.push(`surface_point_duplicate:${point.id}`);
    const normalized = { id: point.id, x: point.x * horizontalScale, y: point.y * horizontalScale, z: point.z * verticalScale };
    const coordinateKey = `${normalized.x},${normalized.y}`;
    if (coordinateKeys.has(coordinateKey)) issues.push(`surface_duplicate_point_coordinate:${point.id}`);
    coordinateKeys.add(coordinateKey); pointIds.push(point.id); pointsById.set(point.id, normalized);
    const bounds = payload.bounds;
    if (bounds && (point.x < bounds.minX! || point.x > bounds.maxX! || point.y < bounds.minY! || point.y > bounds.maxY! || point.z < bounds.minZ! || point.z > bounds.maxZ!)) issues.push(`surface_point_out_of_bounds:${point.id}`);
  }
  const triangleIds: string[] = [], triangleKeys = new Set<string>(), edgeCounts = new Map<string, number>(), trianglesById = new Map<string, CivilTinPoint[]>();
  for (const triangle of triangles) {
    if (!exactKeys(triangle, ['id', 'pointIds']) || !record(triangle) || !identifier(triangle.id) || !Array.isArray(triangle.pointIds) || triangle.pointIds.length !== 3 || new Set(triangle.pointIds).size !== 3 || triangle.pointIds.some(id => !pointsById.has(id))) { issues.push('surface_triangle_reference_invalid'); continue; }
    const refs = triangle.pointIds as [string, string, string];
    if (triangleIds.includes(triangle.id)) issues.push(`surface_triangle_duplicate:${triangle.id}`);
    const triangleKey = [...refs].sort().join('|');
    if (triangleKeys.has(triangleKey)) issues.push(`surface_triangle_duplicate_geometry:${triangle.id}`);
    triangleKeys.add(triangleKey); triangleIds.push(triangle.id);
    const vertices = refs.map(id => pointsById.get(id)!);
    trianglesById.set(triangle.id, vertices);
    if (Math.abs(orient(vertices[0]!, vertices[1]!, vertices[2]!)) <= EPSILON_M) issues.push(`surface_triangle_degenerate:${triangle.id}`);
    for (let index = 0; index < 3; index += 1) {
      const edge = [refs[index]!, refs[(index + 1) % 3]!].sort().join('|');
      edgeCounts.set(edge, (edgeCounts.get(edge) ?? 0) + 1);
    }
  }
  for (const [edge, count] of edgeCounts) if (count > 2) issues.push(`surface_non_manifold_edge:${edge}`);
  const orderedTriangles = [...trianglesById.entries()]
    .map(([id, vertices]) => ({
      id,
      vertices,
      minX: Math.min(...vertices.map(point => point.x)),
      maxX: Math.max(...vertices.map(point => point.x)),
      minY: Math.min(...vertices.map(point => point.y)),
      maxY: Math.max(...vertices.map(point => point.y)),
    }))
    .sort((a, b) => a.minX - b.minX || a.id.localeCompare(b.id));
  for (let leftIndex = 0; leftIndex < orderedTriangles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < orderedTriangles.length; rightIndex += 1) {
      const left = orderedTriangles[leftIndex]!; const right = orderedTriangles[rightIndex]!;
      if (right.minX > left.maxX + EPSILON_M) break;
      if (right.maxY < left.minY - EPSILON_M || right.minY > left.maxY + EPSILON_M) continue;
      const shared = left.vertices.filter(point => right.vertices.some(candidate => candidate.id === point.id)).length;
      if (triangleHasOverlap(left.vertices, right.vertices, shared)) issues.push(`surface_triangle_overlap:${left.id}:${right.id}`);
    }
  }
  const counts = payload.counts;
  if (!exactKeys(counts, ['pointCount', 'triangleCount', 'edgeCount']) || !record(counts) || counts.pointCount !== points.length || counts.triangleCount !== triangles.length || counts.edgeCount !== edgeCounts.size) issues.push('surface_counts_mismatch');
  return [...new Set(issues)];
}

function payloadFor(input: { binding: CivilTinExactSurfacePayload['binding']; surface: CivilTinExactSurfaceInput }): CivilTinExactSurfacePayload {
  const points = sortedById(input.surface.points);
  const triangles = sortedById(input.surface.triangles);
  const edgeCount = new Set(triangles.flatMap(triangle => [0, 1, 2].map(index => [triangle.pointIds[index]!, triangle.pointIds[(index + 1) % 3]!].sort().join('|')))).size;
  return { schema: CIVIL_TIN_EXACT_SURFACE_SCHEMA, binding: input.binding, surfaceId: input.surface.surfaceId, kind: input.surface.kind, units: input.surface.units, crs: input.surface.crs, bounds: input.surface.bounds, points, triangles, counts: { pointCount: points.length, triangleCount: triangles.length, edgeCount } };
}

export function exportCivilTinExactSurfaceArtifact(input: {
  workspaceRevisionId: string;
  expectedWorkspaceRevisionId: string;
  workspaceRevisionValue: unknown;
  expectedWorkspaceContentHash: string;
  surface: CivilTinExactSurfaceInput;
  artifactName?: string;
}): CivilTinExactSurfaceArtifact {
  if (!identifier(input.workspaceRevisionId) || input.workspaceRevisionId !== input.expectedWorkspaceRevisionId) throw new Error('CIVIL_TIN_EXACT_SURFACE_STALE_REVISION');
  const workspaceContentHash = designRevisionSha256(input.workspaceRevisionValue);
  if (!SHA256.test(input.expectedWorkspaceContentHash) || workspaceContentHash !== input.expectedWorkspaceContentHash) throw new Error('CIVIL_TIN_EXACT_SURFACE_STALE_REVISION_HASH');
  const payload = payloadFor({ binding: { workspaceRevisionId: input.workspaceRevisionId, workspaceContentHash }, surface: input.surface });
  const issues = civilTinExactSurfaceIssues(payload); if (issues.length) throw new Error(`CIVIL_TIN_EXACT_SURFACE_INVALID:${issues[0]}`);
  const contentHash = designRevisionSha256(payload); const bytes = encoder.encode(canonicalDesignJson({ payload, contentHash }));
  return { payload, contentHash, bytes, artifactSha256: sha256(bytes), artifactName: input.artifactName ?? 'civil-tin-exact-surface.json', artifactMime: 'application/json' };
}

export function parseCivilTinExactSurfaceArtifact(bytes: Uint8Array, expectedBinding?: { workspaceRevisionId: string; workspaceContentHash: string }): CivilTinExactSurfaceParseResult {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error('CIVIL_TIN_EXACT_SURFACE_ARTIFACT_EMPTY');
  let text: string; try { text = decoder.decode(bytes); } catch { throw new Error('CIVIL_TIN_EXACT_SURFACE_ARTIFACT_INVALID_UTF8'); }
  let parsed: unknown; try { parsed = JSON.parse(text) as unknown; } catch { throw new Error('CIVIL_TIN_EXACT_SURFACE_ARTIFACT_JSON_INVALID'); }
  if (!record(parsed) || !record(parsed.payload) || typeof parsed.contentHash !== 'string' || !SHA256.test(parsed.contentHash) || !exactKeys(parsed, ['payload', 'contentHash'])) throw new Error('CIVIL_TIN_EXACT_SURFACE_ENVELOPE_INVALID');
  if (canonicalDesignJson(parsed) !== text) throw new Error('CIVIL_TIN_EXACT_SURFACE_NON_CANONICAL');
  const issues = civilTinExactSurfaceIssues(parsed.payload); if (issues.length) throw new Error(`CIVIL_TIN_EXACT_SURFACE_INVALID:${issues[0]}`);
  const payload = parsed.payload as CivilTinExactSurfacePayload;
  if (designRevisionSha256(payload) !== parsed.contentHash) throw new Error('CIVIL_TIN_EXACT_SURFACE_CONTENT_HASH_MISMATCH');
  if (expectedBinding && (payload.binding.workspaceRevisionId !== expectedBinding.workspaceRevisionId || payload.binding.workspaceContentHash !== expectedBinding.workspaceContentHash)) throw new Error('CIVIL_TIN_EXACT_SURFACE_STALE_REVISION');
  return { payload, contentHash: parsed.contentHash, artifactSha256: sha256(bytes) };
}

export function verifyCivilTinExactSurfaceArtifact(input: { artifact: CivilTinExactSurfaceParseResult; workspaceRevisionId: string; workspaceContentHash: string }): CivilTinExactSurfaceVerification {
  const issues: string[] = [];
  try {
    issues.push(...civilTinExactSurfaceIssues(input.artifact.payload));
    if (input.artifact.contentHash !== designRevisionSha256(input.artifact.payload)) issues.push('content_hash_mismatch');
    const binding = input.artifact.payload.binding;
    if (binding.workspaceRevisionId !== input.workspaceRevisionId || binding.workspaceContentHash !== input.workspaceContentHash) issues.push('stale_revision_binding');
  } catch { issues.push('verifier_exception'); }
  return issues.length ? { status: 'failed', verifierId: 'civil-tin-exact-surface-structural.v1', issues: [...new Set(issues)] } : { status: 'passed', verifierId: 'civil-tin-exact-surface-structural.v1', issues: [] };
}

export function queryCivilTinElevation(payload: CivilTinExactSurfacePayload, query: { x: number; y: number; unit?: CivilTinUnit }): { triangleId: string; elevation: number; unit: CivilTinUnit; barycentric: [number, number, number] } {
  const issues = civilTinExactSurfaceIssues(payload); if (issues.length) throw new Error(`CIVIL_TIN_QUERY_SURFACE_INVALID:${issues[0]}`);
  if (!finite(query.x) || !finite(query.y)) throw new Error('CIVIL_TIN_QUERY_COORDINATE_INVALID');
  const queryUnit = query.unit ?? payload.units.horizontal; if (queryUnit !== 'm' && queryUnit !== 'mm') throw new Error('CIVIL_TIN_QUERY_UNIT_INVALID');
  const points = pointsInMeters(payload); const x = toMeters(query.x, queryUnit); const y = toMeters(query.y, queryUnit);
  const triangles = [...payload.triangles].sort((a, b) => a.id.localeCompare(b.id));
  for (const triangle of triangles) {
    const vertices = triangle.pointIds.map(id => points.get(id)!);
    const denominator = orient(vertices[0]!, vertices[1]!, vertices[2]!);
    const w0 = orient(vertices[1]!, vertices[2]!, { id: 'query', x, y, z: 0 }) / denominator;
    const w1 = orient(vertices[2]!, vertices[0]!, { id: 'query', x, y, z: 0 }) / denominator;
    const w2 = 1 - w0 - w1;
    if (w0 >= -EPSILON_M && w1 >= -EPSILON_M && w2 >= -EPSILON_M) {
      const weights = [Math.max(0, w0), Math.max(0, w1), Math.max(0, w2)]; const total = weights[0]! + weights[1]! + weights[2]!;
      const barycentric: [number, number, number] = [weights[0]! / total, weights[1]! / total, weights[2]! / total];
      const elevationM = barycentric[0] * vertices[0]!.z + barycentric[1] * vertices[1]!.z + barycentric[2] * vertices[2]!.z;
      const outputUnit = payload.units.vertical;
      return { triangleId: triangle.id, elevation: fromMeters(elevationM, outputUnit), unit: outputUnit, barycentric };
    }
  }
  throw new Error('CIVIL_TIN_QUERY_OUT_OF_RANGE');
}

export function buildCivilTinExactSurfaceReceipt(input: { artifact: CivilTinExactSurfaceArtifact }): Uint8Array {
  if (sha256(input.artifact.bytes) !== input.artifact.artifactSha256) throw new Error('CIVIL_TIN_RECEIPT_ARTIFACT_HASH_MISMATCH');
  const parsed = parseCivilTinExactSurfaceArtifact(input.artifact.bytes, input.artifact.payload.binding);
  if (parsed.artifactSha256 !== input.artifact.artifactSha256
    || parsed.contentHash !== input.artifact.contentHash
    || canonicalDesignJson(parsed.payload) !== canonicalDesignJson(input.artifact.payload)) {
    throw new Error('CIVIL_TIN_RECEIPT_ARTIFACT_BINDING_MISMATCH');
  }
  const payload = input.artifact.payload;
  const receipt: CivilTinExactSurfaceReceipt = { schema: CIVIL_TIN_EXACT_SURFACE_RECEIPT_SCHEMA, capabilityId: CIVIL_TIN_EXACT_SURFACE_CAPABILITY_ID, format: 'json', surfaceId: payload.surfaceId, kind: payload.kind, workspaceRevisionId: payload.binding.workspaceRevisionId, workspaceContentHash: payload.binding.workspaceContentHash, artifactSha256: input.artifact.artifactSha256, artifactBytes: input.artifact.bytes.byteLength, parserResult: 'verified', stablePointIds: payload.points.map(point => point.id), stableTriangleIds: payload.triangles.map(triangle => triangle.id), queryMethod: 'barycentric_xy', units: payload.units, crs: payload.crs, externalSurvey: 'NOT_RUN', nativeRoundtrip: 'HOLD', fieldValidation: 'NOT_RUN', releaseReady: false };
  return encoder.encode(canonicalDesignJson(receipt));
}

export function claimCivilTinExactSurfaceReceipt(input: { artifact: CivilTinExactSurfaceArtifact; receiptBytes: Uint8Array }): CivilTinExactSurfaceReceipt & { receiptSha256: string; claim: 'internal-tin-exact-surface-verified' } {
  let receipt: CivilTinExactSurfaceReceipt;
  let receiptText: string;
  try { receiptText = decoder.decode(input.receiptBytes); receipt = JSON.parse(receiptText) as CivilTinExactSurfaceReceipt; } catch { throw new Error('CIVIL_TIN_RECEIPT_INVALID'); }
  if (!exactKeys(receipt, ['schema', 'capabilityId', 'format', 'surfaceId', 'kind', 'workspaceRevisionId', 'workspaceContentHash', 'artifactSha256', 'artifactBytes', 'parserResult', 'stablePointIds', 'stableTriangleIds', 'queryMethod', 'units', 'crs', 'externalSurvey', 'nativeRoundtrip', 'fieldValidation', 'releaseReady']) || canonicalDesignJson(receipt) !== receiptText) throw new Error('CIVIL_TIN_RECEIPT_NON_CANONICAL');
  const expected = JSON.parse(decoder.decode(buildCivilTinExactSurfaceReceipt(input))) as CivilTinExactSurfaceReceipt;
  if (canonicalDesignJson(receipt) !== canonicalDesignJson(expected) || sha256(input.artifact.bytes) !== receipt.artifactSha256 || receipt.artifactBytes !== input.artifact.bytes.byteLength || receipt.parserResult !== 'verified' || receipt.externalSurvey !== 'NOT_RUN' || receipt.nativeRoundtrip !== 'HOLD' || receipt.fieldValidation !== 'NOT_RUN' || receipt.releaseReady !== false) throw new Error('CIVIL_TIN_RECEIPT_BINDING_MISMATCH');
  return { ...receipt, receiptSha256: sha256(input.receiptBytes), claim: 'internal-tin-exact-surface-verified' };
}
