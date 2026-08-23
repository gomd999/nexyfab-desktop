import { createHash } from 'node:crypto';
import type { ArchitectureStair, ArchitectureStorey } from './architectureInteriorDocuments';
import type { ArchitectureExactKernelAdapter } from './architectureInteriorExactGeometry';

export const ARCHITECTURE_STAIR_EXACT_CONTRACT_VERSION = 'nexyfab.architecture-stair-exact.v1';

type V2 = readonly [number, number];
type V3 = readonly [number, number, number];
type Side = 'left' | 'right';

export interface StairExactBinding {
  projectId: string;
  architectureDocumentId: string;
  workspaceRevision: number;
  workspaceContentHash: string;
}

export interface StairExactCoordinateFrame {
  id: string;
  parentId: string;
  originMm: V3;
  rotationDeg: V3;
}

export interface StairExactLanding {
  id: string;
  kind: 'bottom' | 'top';
  depthMm: number;
  widthMm: number;
  thicknessMm: number;
  sourceHash: string;
}

/** The bounded exact representation is a straight rectangular panel along one side. */
export interface StairExactGuardrail {
  id: string;
  side: Side;
  offsetMm: number;
  heightMm: number;
  thicknessMm: number;
  sourceHash: string;
}

/** The bounded exact representation is a straight rectangular handrail panel. */
export interface StairExactHandrail {
  id: string;
  side: Side;
  offsetMm: number;
  baseHeightMm: number;
  heightMm: number;
  thicknessMm: number;
  sourceHash: string;
}

export interface ArchitectureStairExactGeometryRequest {
  contractVersion: typeof ARCHITECTURE_STAIR_EXACT_CONTRACT_VERSION;
  units: 'mm';
  toleranceMm: number;
  binding: StairExactBinding;
  coordinateFrame: StairExactCoordinateFrame;
  stair: ArchitectureStair;
  storeys: readonly ArchitectureStorey[];
  landings: readonly StairExactLanding[];
  guardrails: readonly StairExactGuardrail[];
  handrails: readonly StairExactHandrail[];
  clearWidthMm: number;
  requiredHeadroomMm: number;
  providedHeadroomMm: number;
  stairSourceHash: string;
}

export interface StairExactShapeReceipt {
  kind: 'riser_tread' | 'landing' | 'guardrail_panel' | 'handrail_panel';
  elementId: string;
  sourceHash: string;
  stepText: string;
  stepBytes: number;
  stepSha256: string;
  shapeHash: string;
  absoluteVolume: number;
  bbox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
  manifoldSolid: boolean;
  maxToleranceMm: number;
}

export interface ArchitectureStairExactGeometryReceipt {
  contractVersion: typeof ARCHITECTURE_STAIR_EXACT_CONTRACT_VERSION;
  units: 'mm';
  binding: StairExactBinding;
  coordinateFrame: StairExactCoordinateFrame;
  stairId: string;
  fromStoreyId: string;
  toStoreyId: string;
  floorLevelsMm: readonly [number, number];
  riserCount: number;
  riserHeightMm: number;
  treadDepthMm: number;
  totalRiseMm: number;
  totalRunMm: number;
  clearWidthMm: number;
  requiredHeadroomMm: number;
  providedHeadroomMm: number;
  stairSourceHash: string;
  steps: readonly StairExactShapeReceipt[];
  landings: readonly StairExactShapeReceipt[];
  guardrails: readonly StairExactShapeReceipt[];
  handrails: readonly StairExactShapeReceipt[];
  contentHash: string;
  releaseReady: false;
  hold: readonly ['egress_code_not_run', 'structural_approval_not_run', 'field_measurement_not_run', 'native_ifc_drawing_quantity_not_run', 'independent_step_reimport_not_run'];
}

export type ArchitectureStairExactGeometryResult =
  | { ok: true; receipt: ArchitectureStairExactGeometryReceipt }
  | { ok: false; code: 'EXACT_STAIR_INVALID_REQUEST' | 'EXACT_STAIR_KERNEL_FAILED' | 'EXACT_STAIR_VERIFICATION_FAILED' | 'EXACT_STAIR_STALE'; details: string[] };

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_COORDINATE_MM = 1_000_000_000;
const MAX_STEPS = 1000;
const HOLD = ['egress_code_not_run', 'structural_approval_not_run', 'field_measurement_not_run', 'native_ifc_drawing_quantity_not_run', 'independent_step_reimport_not_run'] as const;

const fail = (code: Extract<ArchitectureStairExactGeometryResult, { ok: false }>['code'], ...details: string[]): ArchitectureStairExactGeometryResult => ({ ok: false, code, details });
const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
};
const finite = (value: number): boolean => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE_MM;
const positive = (value: number): boolean => finite(value) && value > 0;
const hash = (value: string): boolean => typeof value === 'string' && HASH.test(value);
const finiteV3 = (value: readonly number[] | undefined): value is V3 => !!value && Array.isArray(value) && value.length === 3 && value.every(finite);

interface StairGeometry {
  from: ArchitectureStorey;
  to: ArchitectureStorey;
  start: V3;
  end: V3;
  tangent: V2;
  normal: V2;
  horizontalRunMm: number;
  totalRiseMm: number;
  riserHeightMm: number;
}

function expectedGeometry(request: ArchitectureStairExactGeometryRequest): StairGeometry | undefined {
  const from = request.storeys?.find(item => item.id === request.stair?.fromStoreyId);
  const to = request.storeys?.find(item => item.id === request.stair?.toStoreyId);
  const start = request.stair?.pathMm?.[0];
  const end = request.stair?.pathMm?.[1];
  if (!from || !to || !finiteV3(start) || !finiteV3(end)) return undefined;
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const horizontalRunMm = Math.hypot(dx, dy);
  if (horizontalRunMm <= 0) return undefined;
  const totalRiseMm = to.elevationMm - from.elevationMm;
  return { from, to, start, end, tangent: [dx / horizontalRunMm, dy / horizontalRunMm], normal: [-dy / horizontalRunMm, dx / horizontalRunMm], horizontalRunMm, totalRiseMm, riserHeightMm: totalRiseMm / request.stair.riserCount };
}

function validateRequest(request: ArchitectureStairExactGeometryRequest): string[] {
  const issues: string[] = [];
  if (!request || request.contractVersion !== ARCHITECTURE_STAIR_EXACT_CONTRACT_VERSION) issues.push('contract_version_invalid');
  if (request?.units !== 'mm') issues.push('units_must_be_mm');
  if (!finite(request?.toleranceMm) || request.toleranceMm <= 0 || request.toleranceMm > 10) issues.push('tolerance_invalid');
  const binding = request?.binding;
  if (!binding || !ID.test(binding.projectId) || !ID.test(binding.architectureDocumentId) || !Number.isSafeInteger(binding.workspaceRevision) || binding.workspaceRevision < 0 || !hash(binding.workspaceContentHash)) issues.push('workspace_binding_invalid');
  const frame = request?.coordinateFrame;
  // The bounded stair builder emits world-coordinate prisms and does not
  // apply a frame transform.  Accepting a non-identity frame would therefore
  // produce a receipt in the wrong coordinate system.
  if (!frame || !ID.test(frame.id) || !ID.test(frame.parentId) || !finiteV3(frame.originMm) || !finiteV3(frame.rotationDeg) || frame.originMm.some(value => value !== 0) || frame.rotationDeg.some(value => value !== 0)) issues.push('identity_coordinate_frame_required');
  const stair = request?.stair;
  if (!stair || !ID.test(stair.id) || !ID.test(stair.fromStoreyId) || !ID.test(stair.toStoreyId) || stair.fromStoreyId === stair.toStoreyId || !positive(stair.widthMm) || !Number.isSafeInteger(stair.riserCount) || stair.riserCount < 1 || stair.riserCount > MAX_STEPS || !positive(stair.treadDepthMm) || !Array.isArray(stair.pathMm) || stair.pathMm.length !== 2 || stair.pathMm.some(point => !finiteV3(point))) issues.push('straight_stair_semantics_invalid');
  if (!Array.isArray(request?.storeys) || request.storeys.length === 0 || new Set(request.storeys.map(item => item.id)).size !== request.storeys.length || request.storeys.some(item => !ID.test(item.id) || typeof item.name !== 'string' || !finite(item.elevationMm) || !positive(item.heightMm))) issues.push('storey_registry_invalid');
  const geometry = request && expectedGeometry(request);
  if (!geometry) issues.push('stair_storey_geometry_invalid');
  if (geometry && (geometry.totalRiseMm <= 0 || Math.abs(geometry.start[2] - geometry.from.elevationMm) > request.toleranceMm || Math.abs(geometry.end[2] - geometry.to.elevationMm) > request.toleranceMm || Math.abs(geometry.horizontalRunMm - request.stair.treadDepthMm * request.stair.riserCount) > request.toleranceMm || !positive(geometry.riserHeightMm) || geometry.riserHeightMm > 1000)) issues.push('riser_tread_or_floor_level_inconsistent');
  if (!positive(request?.clearWidthMm) || !positive(request?.requiredHeadroomMm) || !positive(request?.providedHeadroomMm) || request.providedHeadroomMm + request.toleranceMm < request.requiredHeadroomMm || !geometry || Math.abs(request.clearWidthMm - request.stair.widthMm) > request.toleranceMm) issues.push('clear_width_or_headroom_invalid');
  if (!hash(request?.stairSourceHash)) issues.push('stair_source_hash_invalid');
  const landings = request?.landings;
  if (!Array.isArray(landings) || landings.length !== 2 || new Set(landings.map(item => item.id)).size !== landings.length || new Set(landings.map(item => item.kind)).size !== 2 || landings.some(item => !ID.test(item.id) || !positive(item.depthMm) || !positive(item.widthMm) || !positive(item.thicknessMm) || !hash(item.sourceHash) || (stair && item.widthMm + request.toleranceMm < stair.widthMm))) issues.push('landing_contract_invalid');
  const guardrails = request?.guardrails;
  if (!Array.isArray(guardrails) || guardrails.length !== 2 || new Set(guardrails.map(item => item.id)).size !== guardrails.length || new Set(guardrails.map(item => item.side)).size !== 2 || guardrails.some(item => !ID.test(item.id) || !['left', 'right'].includes(item.side) || !finite(item.offsetMm) || item.offsetMm < 0 || !positive(item.heightMm) || !positive(item.thicknessMm) || !hash(item.sourceHash))) issues.push('guardrail_contract_invalid');
  const handrails = request?.handrails;
  if (!Array.isArray(handrails) || handrails.length !== 2 || new Set(handrails.map(item => item.id)).size !== handrails.length || new Set(handrails.map(item => item.side)).size !== 2 || handrails.some(item => !ID.test(item.id) || !['left', 'right'].includes(item.side) || !finite(item.offsetMm) || item.offsetMm < 0 || !finite(item.baseHeightMm) || item.baseHeightMm < 0 || !positive(item.heightMm) || !positive(item.thicknessMm) || !hash(item.sourceHash))) issues.push('handrail_contract_invalid');
  if (stair && landings && guardrails && handrails) {
    const ids = [stair.id, ...landings.map(item => item.id), ...guardrails.map(item => item.id), ...handrails.map(item => item.id)];
    if (new Set(ids).size !== ids.length) issues.push('stable_id_collision');
  }
  return issues;
}

function panelLoop(geometry: StairGeometry, startDistanceMm: number, endDistanceMm: number, offsetMm: number, widthMm: number, side: Side | undefined): readonly { x: number; y: number }[] {
  const sign = side === 'left' ? 1 : side === 'right' ? -1 : 0;
  const centerOffset = sign * offsetMm;
  const halfWidth = widthMm / 2;
  const p0: V2 = [geometry.start[0] + geometry.tangent[0] * startDistanceMm + geometry.normal[0] * centerOffset, geometry.start[1] + geometry.tangent[1] * startDistanceMm + geometry.normal[1] * centerOffset];
  const p1: V2 = [geometry.start[0] + geometry.tangent[0] * endDistanceMm + geometry.normal[0] * centerOffset, geometry.start[1] + geometry.tangent[1] * endDistanceMm + geometry.normal[1] * centerOffset];
  return [{ x: p0[0] - geometry.normal[0] * halfWidth, y: p0[1] - geometry.normal[1] * halfWidth }, { x: p1[0] - geometry.normal[0] * halfWidth, y: p1[1] - geometry.normal[1] * halfWidth }, { x: p1[0] + geometry.normal[0] * halfWidth, y: p1[1] + geometry.normal[1] * halfWidth }, { x: p0[0] + geometry.normal[0] * halfWidth, y: p0[1] + geometry.normal[1] * halfWidth }];
}

function stepLoop(geometry: StairGeometry, index: number, request: ArchitectureStairExactGeometryRequest): readonly { x: number; y: number }[] {
  return panelLoop(geometry, index * request.stair.treadDepthMm, (index + 1) * request.stair.treadDepthMm, 0, request.stair.widthMm, undefined);
}

function bboxOfLoop(loop: readonly { x: number; y: number }[], z0: number, heightMm: number): { min: V3; max: V3 } {
  const xs = loop.map(point => point.x), ys = loop.map(point => point.y);
  return { min: [Math.min(...xs), Math.min(...ys), z0], max: [Math.max(...xs), Math.max(...ys), z0 + heightMm] };
}

async function shapeReceipt(adapter: ArchitectureExactKernelAdapter, kind: StairExactShapeReceipt['kind'], elementId: string, sourceHash: string, built: { ok: boolean; shape?: import('@/lib/occt/types').OcctShape }, expectedBounds: { min: V3; max: V3 }, toleranceMm: number): Promise<StairExactShapeReceipt | ArchitectureStairExactGeometryResult> {
  if (!built.ok || !built.shape) return fail('EXACT_STAIR_KERNEL_FAILED', `${elementId}:build_failed`);
  try {
    const inspection = await adapter.inspectShape(built.shape);
    const detailed = adapter.inspectShapeDetailed ? await adapter.inspectShapeDetailed(built.shape) : undefined;
    const bounded = detailed && detailed.bbox.min.x >= expectedBounds.min[0] - toleranceMm && detailed.bbox.min.y >= expectedBounds.min[1] - toleranceMm && detailed.bbox.min.z >= expectedBounds.min[2] - toleranceMm && detailed.bbox.max.x <= expectedBounds.max[0] + toleranceMm && detailed.bbox.max.y <= expectedBounds.max[1] + toleranceMm && detailed.bbox.max.z <= expectedBounds.max[2] + toleranceMm;
    if (!inspection.valid || inspection.solidCount !== 1 || !detailed?.valid || detailed.solidCount !== 1 || detailed.maxTolerance === undefined || detailed.maxTolerance > toleranceMm || !bounded || detailed.absoluteVolume <= 0) return fail('EXACT_STAIR_VERIFICATION_FAILED', `${elementId}:solid_bounds_or_tolerance_invalid`);
    const stepText = await adapter.exportSTEP(built.shape);
    if (!stepText.includes('ISO-10303-21;') || !stepText.includes('MANIFOLD_SOLID_BREP') || !stepText.includes('END-ISO-10303-21;')) return fail('EXACT_STAIR_VERIFICATION_FAILED', `${elementId}:step_not_manifold_solid`);
    const stepSha256 = sha256(stepText);
    return { kind, elementId, sourceHash, stepText, stepBytes: Buffer.byteLength(stepText, 'utf8'), stepSha256, shapeHash: stepSha256, absoluteVolume: detailed.absoluteVolume, bbox: detailed.bbox, manifoldSolid: true, maxToleranceMm: detailed.maxTolerance };
  } catch (error) {
    return fail('EXACT_STAIR_KERNEL_FAILED', `${elementId}:${error instanceof Error ? error.message : 'inspection_or_step_failed'}`);
  } finally {
    try { adapter.release(built.shape); } catch { /* best effort */ }
  }
}

function contentHash(receipt: Omit<ArchitectureStairExactGeometryReceipt, 'contentHash'>): string {
  const strip = (shape: StairExactShapeReceipt): Omit<StairExactShapeReceipt, 'stepText'> => { const { stepText: _stepText, ...rest } = shape; return rest; };
  return sha256(canonical({ ...receipt, steps: receipt.steps.map(strip), landings: receipt.landings.map(strip), guardrails: receipt.guardrails.map(strip), handrails: receipt.handrails.map(strip) }));
}

function bboxMatches(actual: StairExactShapeReceipt, expected: { min: V3; max: V3 }, tolerance: number): boolean { return [actual.bbox.min.x - expected.min[0], actual.bbox.min.y - expected.min[1], actual.bbox.min.z - expected.min[2], actual.bbox.max.x - expected.max[0], actual.bbox.max.y - expected.max[1], actual.bbox.max.z - expected.max[2]].every(value => Math.abs(value) <= tolerance); } function volumeMatches(actual: number, expected: number, tolerance: number): boolean { return Math.abs(actual - expected) <= Math.max(1e-3, expected * 1e-8, tolerance * Math.max(1, Math.cbrt(expected))); }
function shapeReceiptConsistent(shape: StairExactShapeReceipt): boolean {
  if (!shape || typeof shape.stepText !== 'string' || !shape.bbox?.min || !shape.bbox.max) return false;
  return ID.test(shape.elementId) && hash(shape.sourceHash) && hash(shape.stepSha256) && shape.shapeHash === shape.stepSha256 && shape.stepBytes === Buffer.byteLength(shape.stepText, 'utf8') && shape.stepText.includes('ISO-10303-21;') && shape.stepText.includes('MANIFOLD_SOLID_BREP') && shape.stepText.includes('END-ISO-10303-21;') && shape.manifoldSolid === true && Number.isFinite(shape.absoluteVolume) && shape.absoluteVolume > 0 && Number.isFinite(shape.maxToleranceMm) && shape.maxToleranceMm >= 0 && [shape.bbox.min.x, shape.bbox.min.y, shape.bbox.min.z, shape.bbox.max.x, shape.bbox.max.y, shape.bbox.max.z].every(finite) && sha256(shape.stepText) === shape.stepSha256;
}

export function validateArchitectureStairExactGeometryReceipt(receipt: ArchitectureStairExactGeometryReceipt, request: ArchitectureStairExactGeometryRequest): boolean {
  if (!receipt || !request || receipt.contractVersion !== ARCHITECTURE_STAIR_EXACT_CONTRACT_VERSION || receipt.units !== 'mm' || receipt.releaseReady !== false || canonical(receipt.hold) !== canonical(HOLD) || canonical(receipt.binding) !== canonical(request.binding) || canonical(receipt.coordinateFrame) !== canonical(request.coordinateFrame) || receipt.stairId !== request.stair.id || receipt.fromStoreyId !== request.stair.fromStoreyId || receipt.toStoreyId !== request.stair.toStoreyId || receipt.riserCount !== request.stair.riserCount || receipt.treadDepthMm !== request.stair.treadDepthMm || receipt.clearWidthMm !== request.clearWidthMm || receipt.requiredHeadroomMm !== request.requiredHeadroomMm || receipt.providedHeadroomMm !== request.providedHeadroomMm || receipt.stairSourceHash !== request.stairSourceHash || !hash(receipt.contentHash) || !Array.isArray(receipt.steps) || !Array.isArray(receipt.landings) || !Array.isArray(receipt.guardrails) || !Array.isArray(receipt.handrails)) return false;
  const geometry = expectedGeometry(request);
  if (receipt.steps.some((item, index) => { const l = stepLoop(geometry!, index, request); return !bboxMatches(item, bboxOfLoop(l, geometry!.from.elevationMm, geometry!.riserHeightMm * (index + 1)), request.toleranceMm) || !volumeMatches(item.absoluteVolume, request.stair.widthMm * request.stair.treadDepthMm * geometry!.riserHeightMm * (index + 1), request.toleranceMm); }) || receipt.landings.some((item, index) => { const landing = request.landings[index]!; const start = landing.kind === 'bottom' ? -landing.depthMm : geometry!.horizontalRunMm; const l = panelLoop(geometry!, start, start + landing.depthMm, 0, landing.widthMm, undefined); const z = (landing.kind === 'bottom' ? geometry!.from.elevationMm : geometry!.to.elevationMm) - landing.thicknessMm; return !bboxMatches(item, bboxOfLoop(l, z, landing.thicknessMm), request.toleranceMm) || !volumeMatches(item.absoluteVolume, landing.widthMm * landing.depthMm * landing.thicknessMm, request.toleranceMm); }) || receipt.guardrails.some((item, index) => { const rail = request.guardrails[index]!; const l = panelLoop(geometry!, 0, geometry!.horizontalRunMm, request.stair.widthMm / 2 + rail.offsetMm, rail.thicknessMm, rail.side); return !bboxMatches(item, bboxOfLoop(l, geometry!.from.elevationMm, rail.heightMm), request.toleranceMm) || !volumeMatches(item.absoluteVolume, geometry!.horizontalRunMm * rail.thicknessMm * rail.heightMm, request.toleranceMm); }) || receipt.handrails.some((item, index) => { const rail = request.handrails[index]!; const l = panelLoop(geometry!, 0, geometry!.horizontalRunMm, request.stair.widthMm / 2 + rail.offsetMm, rail.thicknessMm, rail.side); const z = geometry!.from.elevationMm + rail.baseHeightMm; return !bboxMatches(item, bboxOfLoop(l, z, rail.heightMm), request.toleranceMm) || !volumeMatches(item.absoluteVolume, geometry!.horizontalRunMm * rail.thicknessMm * rail.heightMm, request.toleranceMm); })) return false; if (!geometry || canonical(receipt.floorLevelsMm) !== canonical([geometry.from.elevationMm, geometry.to.elevationMm]) || Math.abs(receipt.riserHeightMm - geometry.riserHeightMm) > request.toleranceMm || Math.abs(receipt.totalRiseMm - geometry.totalRiseMm) > request.toleranceMm || Math.abs(receipt.totalRunMm - geometry.horizontalRunMm) > request.toleranceMm) return false;
  const expected = [...Array.from({ length: request.stair.riserCount }, (_, index) => `${request.stair.id}:step:${index + 1}`), ...request.landings.map(item => item.id), ...request.guardrails.map(item => item.id), ...request.handrails.map(item => item.id)];
  if (receipt.steps.some((item, index) => item.kind !== 'riser_tread' || item.elementId !== `${request.stair.id}:step:${index + 1}`) || receipt.landings.some((item, index) => item.kind !== 'landing' || item.elementId !== request.landings[index]!.id) || receipt.guardrails.some((item, index) => item.kind !== 'guardrail_panel' || item.elementId !== request.guardrails[index]!.id) || receipt.handrails.some((item, index) => item.kind !== 'handrail_panel' || item.elementId !== request.handrails[index]!.id)) return false; const actual = [...receipt.steps, ...receipt.landings, ...receipt.guardrails, ...receipt.handrails];
  if (actual.length !== expected.length || new Set(actual.map(item => item.elementId)).size !== actual.length || actual.some(item => !shapeReceiptConsistent(item) || !expected.includes(item.elementId))) return false;
  if (receipt.steps.length !== request.stair.riserCount || receipt.landings.length !== request.landings.length || receipt.guardrails.length !== request.guardrails.length || receipt.handrails.length !== request.handrails.length) return false;
  for (const item of request.landings) { const actualItem = receipt.landings.find(shape => shape.elementId === item.id); if (!actualItem || actualItem.sourceHash !== item.sourceHash) return false; }
  for (const item of request.guardrails) { const actualItem = receipt.guardrails.find(shape => shape.elementId === item.id); if (!actualItem || actualItem.sourceHash !== item.sourceHash) return false; }
  for (const item of request.handrails) { const actualItem = receipt.handrails.find(shape => shape.elementId === item.id); if (!actualItem || actualItem.sourceHash !== item.sourceHash) return false; }
  if (receipt.steps.some((item, index) => item.elementId !== `${request.stair.id}:step:${index + 1}` || item.sourceHash !== request.stairSourceHash)) return false;
  const { contentHash: _contentHash, ...unsigned } = receipt;
  return contentHash(unsigned) === receipt.contentHash;
}

export async function generateArchitectureStairExactGeometry(request: ArchitectureStairExactGeometryRequest, adapter: ArchitectureExactKernelAdapter): Promise<ArchitectureStairExactGeometryResult> {
  const issues = validateRequest(request);
  if (issues.length > 0) return fail('EXACT_STAIR_INVALID_REQUEST', ...issues);
  const geometry = expectedGeometry(request)!;
  const steps: StairExactShapeReceipt[] = [];
  for (let index = 0; index < request.stair.riserCount; index++) {
    const loop = stepLoop(geometry, index, request);
    const heightMm = geometry.riserHeightMm * (index + 1);
    const shape = await shapeReceipt(adapter, 'riser_tread', `${request.stair.id}:step:${index + 1}`, request.stairSourceHash, await adapter.buildPrismAt(loop, geometry.from.elevationMm, heightMm), bboxOfLoop(loop, geometry.from.elevationMm, heightMm), request.toleranceMm);
    if (!('kind' in shape)) return shape;
    steps.push(shape);
  }
  const landings: StairExactShapeReceipt[] = [];
  for (const landing of request.landings) {
    const startDistance = landing.kind === 'bottom' ? -landing.depthMm : geometry.horizontalRunMm;
    const loop = panelLoop(geometry, startDistance, startDistance + landing.depthMm, 0, landing.widthMm, undefined);
    const z0 = (landing.kind === 'bottom' ? geometry.from.elevationMm : geometry.to.elevationMm) - landing.thicknessMm;
    const shape = await shapeReceipt(adapter, 'landing', landing.id, landing.sourceHash, await adapter.buildPrismAt(loop, z0, landing.thicknessMm), bboxOfLoop(loop, z0, landing.thicknessMm), request.toleranceMm);
    if (!('kind' in shape)) return shape;
    landings.push(shape);
  }
  const guardrails: StairExactShapeReceipt[] = [];
  for (const guard of request.guardrails) {
    const loop = panelLoop(geometry, 0, geometry.horizontalRunMm, request.stair.widthMm / 2 + guard.offsetMm, guard.thicknessMm, guard.side);
    const shape = await shapeReceipt(adapter, 'guardrail_panel', guard.id, guard.sourceHash, await adapter.buildPrismAt(loop, geometry.from.elevationMm, guard.heightMm), bboxOfLoop(loop, geometry.from.elevationMm, guard.heightMm), request.toleranceMm);
    if (!('kind' in shape)) return shape;
    guardrails.push(shape);
  }
  const handrails: StairExactShapeReceipt[] = [];
  for (const handrail of request.handrails) {
    const loop = panelLoop(geometry, 0, geometry.horizontalRunMm, request.stair.widthMm / 2 + handrail.offsetMm, handrail.thicknessMm, handrail.side);
    const z0 = geometry.from.elevationMm + handrail.baseHeightMm;
    const shape = await shapeReceipt(adapter, 'handrail_panel', handrail.id, handrail.sourceHash, await adapter.buildPrismAt(loop, z0, handrail.heightMm), bboxOfLoop(loop, z0, handrail.heightMm), request.toleranceMm);
    if (!('kind' in shape)) return shape;
    handrails.push(shape);
  }
  const unsigned: Omit<ArchitectureStairExactGeometryReceipt, 'contentHash'> = { contractVersion: ARCHITECTURE_STAIR_EXACT_CONTRACT_VERSION, units: 'mm', binding: request.binding, coordinateFrame: request.coordinateFrame, stairId: request.stair.id, fromStoreyId: request.stair.fromStoreyId, toStoreyId: request.stair.toStoreyId, floorLevelsMm: [geometry.from.elevationMm, geometry.to.elevationMm], riserCount: request.stair.riserCount, riserHeightMm: geometry.riserHeightMm, treadDepthMm: request.stair.treadDepthMm, totalRiseMm: geometry.totalRiseMm, totalRunMm: geometry.horizontalRunMm, clearWidthMm: request.clearWidthMm, requiredHeadroomMm: request.requiredHeadroomMm, providedHeadroomMm: request.providedHeadroomMm, stairSourceHash: request.stairSourceHash, steps, landings, guardrails, handrails, releaseReady: false, hold: HOLD };
  return { ok: true, receipt: { ...unsigned, contentHash: contentHash(unsigned) } };
}
