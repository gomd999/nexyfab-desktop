import { createHash } from 'node:crypto';
import type { ArchitectureElevator, ArchitectureShaft, ArchitectureSlab, ArchitectureStorey } from './architectureInteriorDocuments';
import type { ArchitectureExactKernelAdapter } from './architectureInteriorExactGeometry';

export const ARCHITECTURE_VERTICAL_TRANSPORT_EXACT_CONTRACT_VERSION = 'nexyfab.architecture-vertical-transport-exact.v1';

type V2 = readonly [number, number];
type V3 = readonly [number, number, number];

export interface AxisAlignedRectangle {
  minMm: V2;
  maxMm: V2;
}

export interface VerticalTransportExactBinding {
  projectId: string;
  architectureDocumentId: string;
  workspaceRevision: number;
  workspaceContentHash: string;
}

export interface VerticalTransportCoordinateFrame {
  id: string;
  parentId: string;
  originMm: V3;
  rotationDeg: V3;
}

export interface VerticalTransportHostSlab {
  slab: ArchitectureSlab;
  sourceHash: string;
}

export interface VerticalTransportExactGeometryRequest {
  contractVersion: typeof ARCHITECTURE_VERTICAL_TRANSPORT_EXACT_CONTRACT_VERSION;
  units: 'mm';
  toleranceMm: number;
  binding: VerticalTransportExactBinding;
  coordinateFrame: VerticalTransportCoordinateFrame;
  shaft: ArchitectureShaft;
  elevator: ArchitectureElevator;
  storeys: readonly ArchitectureStorey[];
  hostSlabs: readonly VerticalTransportHostSlab[];
  carFootprintMm: AxisAlignedRectangle;
  carHeightMm: number;
  clearanceMm: { x: number; y: number; z: number };
}

export interface VerticalTransportShapeReceipt {
  kind: 'shaft_void_cutter' | 'elevator_car' | 'elevator_envelope' | 'host_slab_final';
  elementId: string;
  stepText: string;
  stepBytes: number;
  stepSha256: string;
  shapeHash: string;
  absoluteVolume: number;
  bbox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
  manifoldSolid: boolean;
  maxToleranceMm: number;
}

export interface VerticalTransportHostSlabReceipt {
  slabId: string;
  storeyId: string;
  sourceHash: string;
  resultingShapeHash: string;
  resultingStepSha256: string;
  result: VerticalTransportShapeReceipt;
}

export interface VerticalTransportExactReceipt {
  contractVersion: typeof ARCHITECTURE_VERTICAL_TRANSPORT_EXACT_CONTRACT_VERSION;
  units: 'mm';
  binding: VerticalTransportExactBinding;
  coordinateFrame: VerticalTransportCoordinateFrame;
  shaftId: string;
  elevatorId: string;
  servedStoreyIds: readonly string[];
  shaftBoundaryMm: AxisAlignedRectangle;
  carFootprintMm: AxisAlignedRectangle;
  carHeightMm: number;
  clearanceMm: { x: number; y: number; z: number };
  absoluteZRangeMm: readonly [number, number];
  shaftVoid: VerticalTransportShapeReceipt;
  elevatorCar: VerticalTransportShapeReceipt;
  elevatorEnvelope: VerticalTransportShapeReceipt;
  hostSlabs: readonly VerticalTransportHostSlabReceipt[];
  contentHash: string;
  releaseReady: false;
  hold: readonly ['capacity_speed_not_run', 'egress_code_not_run', 'structural_approval_not_run', 'native_ifc_drawing_quantity_not_run', 'non_identity_coordinate_transform_not_supported', 'independent_step_reimport_not_run'];
}

export type VerticalTransportExactResult =
  | { ok: true; receipt: VerticalTransportExactReceipt }
  | { ok: false; code: 'EXACT_VERTICAL_TRANSPORT_INVALID_REQUEST' | 'EXACT_VERTICAL_TRANSPORT_KERNEL_FAILED' | 'EXACT_VERTICAL_TRANSPORT_VERIFICATION_FAILED' | 'EXACT_VERTICAL_TRANSPORT_STALE'; details: string[] };

const ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_COORDINATE_MM = 1_000_000_000;
const HOLD = ['capacity_speed_not_run', 'egress_code_not_run', 'structural_approval_not_run', 'native_ifc_drawing_quantity_not_run', 'non_identity_coordinate_transform_not_supported', 'independent_step_reimport_not_run'] as const;

const fail = (code: Extract<VerticalTransportExactResult, { ok: false }>['code'], ...details: string[]): VerticalTransportExactResult => ({ ok: false, code, details });
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const canonical = (value: unknown): string => JSON.stringify(value);
const finiteV = (value: readonly number[], size: number): boolean => Array.isArray(value) && value.length === size && value.every(item => typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= MAX_COORDINATE_MM);
const finitePositive = (value: number): boolean => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_COORDINATE_MM;
const finiteNonNegative = (value: number): boolean => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_COORDINATE_MM;

function rectangle(rect: AxisAlignedRectangle | undefined): { minX: number; minY: number; maxX: number; maxY: number } | undefined {
  if (!rect || !finiteV(rect.minMm, 2) || !finiteV(rect.maxMm, 2) || !(rect.minMm[0] < rect.maxMm[0]) || !(rect.minMm[1] < rect.maxMm[1])) return undefined;
  return { minX: rect.minMm[0], minY: rect.minMm[1], maxX: rect.maxMm[0], maxY: rect.maxMm[1] };
}

function boundaryRectangle(boundary: readonly V2[]): { minX: number; minY: number; maxX: number; maxY: number } | undefined {
  if (!Array.isArray(boundary) || boundary.length !== 4 || boundary.some(point => !finiteV(point, 2))) return undefined;
  const xs = boundary.map(point => point[0]);
  const ys = boundary.map(point => point[1]);
  const uniqueX = [...new Set(xs)].sort((a, b) => a - b);
  const uniqueY = [...new Set(ys)].sort((a, b) => a - b);
  if (uniqueX.length !== 2 || uniqueY.length !== 2 || boundary.some(point => !uniqueX.includes(point[0]) || !uniqueY.includes(point[1]))) return undefined;
  return { minX: uniqueX[0]!, minY: uniqueY[0]!, maxX: uniqueX[1]!, maxY: uniqueY[1]! };
}

const contains = (outer: ReturnType<typeof rectangle>, inner: ReturnType<typeof rectangle>, tolerance: number): boolean => !!outer && !!inner && inner.minX >= outer.minX + tolerance && inner.minY >= outer.minY + tolerance && inner.maxX <= outer.maxX - tolerance && inner.maxY <= outer.maxY - tolerance;
const rectLoop = (rect: NonNullable<ReturnType<typeof rectangle>>): readonly { x: number; y: number }[] => [{ x: rect.minX, y: rect.minY }, { x: rect.maxX, y: rect.minY }, { x: rect.maxX, y: rect.maxY }, { x: rect.minX, y: rect.maxY }];

function expectedGeometry(request: VerticalTransportExactGeometryRequest): { shaftRect: NonNullable<ReturnType<typeof rectangle>>; envelopeRect: NonNullable<ReturnType<typeof rectangle>>; zMin: number; zMax: number; carZ: number; shaftFrom: ArchitectureStorey; shaftTo: ArchitectureStorey; served: ArchitectureStorey[] } | undefined {
  const shaftRect = boundaryRectangle(request?.shaft?.boundaryMm ?? []);
  const shaftFrom = request?.storeys?.find(item => item.id === request.shaft?.fromStoreyId);
  const shaftTo = request?.storeys?.find(item => item.id === request.shaft?.toStoreyId);
  const served = (request?.elevator?.servedStoreyIds ?? []).map(id => request.storeys?.find(item => item.id === id)).filter((item): item is ArchitectureStorey => !!item);
  const carRect = rectangle(request?.carFootprintMm);
  const envelopeRect = carRect && { minX: carRect.minX - (request.clearanceMm?.x ?? Number.NaN), minY: carRect.minY - (request.clearanceMm?.y ?? Number.NaN), maxX: carRect.maxX + (request.clearanceMm?.x ?? Number.NaN), maxY: carRect.maxY + (request.clearanceMm?.y ?? Number.NaN) };
  if (!shaftRect || !shaftFrom || !shaftTo || !envelopeRect) return undefined;
  return { shaftRect, envelopeRect, zMin: shaftFrom.elevationMm, zMax: shaftTo.elevationMm + shaftTo.heightMm, carZ: served[0]?.elevationMm ?? shaftFrom.elevationMm, shaftFrom, shaftTo, served };
}

function validateRequest(request: VerticalTransportExactGeometryRequest): string[] {
  const issues: string[] = [];
  if (!request || request.contractVersion !== ARCHITECTURE_VERTICAL_TRANSPORT_EXACT_CONTRACT_VERSION) issues.push('contract_version_invalid');
  if (request?.units !== 'mm') issues.push('units_must_be_mm');
  if (!Number.isFinite(request?.toleranceMm) || request.toleranceMm <= 0 || request.toleranceMm > 10) issues.push('tolerance_invalid');
  const binding = request?.binding;
  if (!binding || !ID.test(binding.projectId) || !ID.test(binding.architectureDocumentId) || !Number.isSafeInteger(binding.workspaceRevision) || binding.workspaceRevision < 0 || !HASH.test(binding.workspaceContentHash)) issues.push('workspace_binding_invalid');
  const frame = request?.coordinateFrame;
  if (!frame || !ID.test(frame.id) || !ID.test(frame.parentId) || !finiteV(frame.originMm, 3) || !finiteV(frame.rotationDeg, 3) || frame.originMm.some(value => value !== 0) || frame.rotationDeg.some(value => value !== 0)) issues.push('identity_coordinate_frame_required');
  if (!request?.shaft || !ID.test(request.shaft.id) || !ID.test(request.shaft.fromStoreyId) || !ID.test(request.shaft.toStoreyId) || request.shaft.fromStoreyId === request.shaft.toStoreyId || !Array.isArray(request.shaft.hostSpaceIds) || request.shaft.hostSpaceIds.length === 0 || new Set(request.shaft.hostSpaceIds).size !== request.shaft.hostSpaceIds.length || request.shaft.hostSpaceIds.some(id => !ID.test(id))) issues.push('shaft_identity_or_host_invalid');
  if (!request?.elevator || !ID.test(request.elevator.id) || !ID.test(request.elevator.shaftId) || request.elevator.shaftId !== request.shaft?.id || !Array.isArray(request.elevator.servedStoreyIds) || request.elevator.servedStoreyIds.length < 2 || new Set(request.elevator.servedStoreyIds).size !== request.elevator.servedStoreyIds.length || request.elevator.servedStoreyIds.some(id => !ID.test(id))) issues.push('elevator_identity_or_served_storeys_invalid');
  if (!Array.isArray(request?.storeys) || request.storeys.length === 0 || new Set(request.storeys.map(item => item.id)).size !== request.storeys.length || request.storeys.some(item => !ID.test(item.id) || typeof item.name !== 'string' || !finiteV([item.elevationMm, item.heightMm], 2) || item.heightMm <= 0)) issues.push('storey_registry_invalid');
  const geometry = request && expectedGeometry(request);
  if (!geometry) issues.push('axis_aligned_geometry_invalid');
  if (geometry && (!contains(geometry.shaftRect, rectangle(request.carFootprintMm), request.toleranceMm) || !contains(geometry.shaftRect, geometry.envelopeRect, request.toleranceMm))) issues.push('car_or_clearance_outside_shaft');
  if (!finitePositive(request?.carHeightMm) || !finiteNonNegative(request?.clearanceMm?.x) || !finiteNonNegative(request?.clearanceMm?.y) || !finiteNonNegative(request?.clearanceMm?.z)) issues.push('car_dimensions_or_clearance_invalid');
  if (geometry && (geometry.carZ < geometry.zMin || geometry.carZ + request.carHeightMm + request.clearanceMm.z > geometry.zMax)) issues.push('car_absolute_z_range_invalid');
  if (geometry && (geometry.shaftFrom.elevationMm >= geometry.shaftTo.elevationMm || geometry.served.length !== (request.elevator?.servedStoreyIds?.length ?? -1) || geometry.served.some((item, index) => index > 0 && item.elevationMm <= geometry.served[index - 1]!.elevationMm) || geometry.served.some(item => item.elevationMm < geometry.shaftFrom.elevationMm || item.elevationMm > geometry.shaftTo.elevationMm))) issues.push('served_storey_order_or_range_invalid');
  if (!Array.isArray(request?.hostSlabs) || new Set(request.hostSlabs.map(item => item.slab?.id)).size !== request.hostSlabs.length || request.hostSlabs.some(item => !item?.slab || !ID.test(item.slab.id) || !ID.test(item.slab.storeyId) || !request.shaft?.hostSpaceIds.includes(item.slab.spaceId) || !HASH.test(item.sourceHash) || !boundaryRectangle(item.slab.boundaryMm) || !finitePositive(item.slab.thicknessMm))) issues.push('host_slab_registry_invalid');
  if (geometry && Array.isArray(request.hostSlabs)) for (const host of request.hostSlabs) {
    const hostRect = boundaryRectangle(host.slab.boundaryMm);
    const hostStorey = request.storeys.find(item => item.id === host.slab.storeyId);
    if (!hostStorey || !contains(hostRect, geometry.shaftRect, 0) || hostStorey.elevationMm + host.slab.thicknessMm < geometry.zMin - request.toleranceMm || hostStorey.elevationMm > geometry.zMax + request.toleranceMm) issues.push(`${host.slab.id}_host_overlap_or_storey_invalid`);
  }
  return issues;
}

async function shapeReceipt(adapter: ArchitectureExactKernelAdapter, kind: VerticalTransportShapeReceipt['kind'], elementId: string, built: { ok: boolean; shape?: import('@/lib/occt/types').OcctShape; error?: string }, expectedBounds: { min: V3; max: V3 }, expectedVolumeMm3: number, toleranceMm: number): Promise<VerticalTransportShapeReceipt | VerticalTransportExactResult> {
  if (!built.ok || !built.shape) return fail('EXACT_VERTICAL_TRANSPORT_KERNEL_FAILED', `${elementId}:build_failed`);
  try {
    const inspection = await adapter.inspectShape(built.shape);
    const detailed = adapter.inspectShapeDetailed ? await adapter.inspectShapeDetailed(built.shape) : undefined;
    const bounded = detailed && detailed.bbox.min.x >= expectedBounds.min[0] - toleranceMm && detailed.bbox.min.y >= expectedBounds.min[1] - toleranceMm && detailed.bbox.min.z >= expectedBounds.min[2] - toleranceMm && detailed.bbox.max.x <= expectedBounds.max[0] + toleranceMm && detailed.bbox.max.y <= expectedBounds.max[1] + toleranceMm && detailed.bbox.max.z <= expectedBounds.max[2] + toleranceMm;
    const volumeTolerance = Math.max(1e-3, expectedVolumeMm3 * 1e-8);
    if (!inspection.valid || inspection.solidCount !== 1 || !detailed?.valid || detailed.solidCount !== 1 || detailed.maxTolerance === undefined || detailed.maxTolerance > toleranceMm || !bounded || detailed.absoluteVolume <= 0 || Math.abs(detailed.absoluteVolume - expectedVolumeMm3) > volumeTolerance) return fail('EXACT_VERTICAL_TRANSPORT_VERIFICATION_FAILED', `${elementId}:solid_bounds_volume_or_tolerance_invalid`);
    const stepText = await adapter.exportSTEP(built.shape);
    if (!stepText.includes('ISO-10303-21;') || !stepText.includes('MANIFOLD_SOLID_BREP') || !stepText.includes('END-ISO-10303-21;')) return fail('EXACT_VERTICAL_TRANSPORT_VERIFICATION_FAILED', `${elementId}:step_not_manifold_solid`);
    const stepSha256 = sha256(stepText);
    return { kind, elementId, stepText, stepBytes: Buffer.byteLength(stepText, 'utf8'), stepSha256, shapeHash: stepSha256, absoluteVolume: detailed.absoluteVolume, bbox: detailed.bbox, manifoldSolid: true, maxToleranceMm: detailed.maxTolerance };
  } catch (error) {
    return fail('EXACT_VERTICAL_TRANSPORT_KERNEL_FAILED', `${elementId}:${error instanceof Error ? error.message : 'inspection_or_step_failed'}`);
  } finally {
    try { adapter.release(built.shape); } catch { /* best effort */ }
  }
}

function contentHash(receipt: Omit<VerticalTransportExactReceipt, 'contentHash'>): string {
  return sha256(canonical({ ...receipt, shaftVoid: { ...receipt.shaftVoid, stepText: undefined }, elevatorCar: { ...receipt.elevatorCar, stepText: undefined }, elevatorEnvelope: { ...receipt.elevatorEnvelope, stepText: undefined }, hostSlabs: receipt.hostSlabs.map(item => ({ ...item, result: { ...item.result, stepText: undefined } })) }));
}

function bboxMatches(actual: VerticalTransportShapeReceipt, expected: { min: V3; max: V3 }, tolerance: number): boolean { return [actual.bbox.min.x - expected.min[0], actual.bbox.min.y - expected.min[1], actual.bbox.min.z - expected.min[2], actual.bbox.max.x - expected.max[0], actual.bbox.max.y - expected.max[1], actual.bbox.max.z - expected.max[2]].every(value => Math.abs(value) <= tolerance); }
function shapeReceiptConsistent(shape: VerticalTransportShapeReceipt): boolean {
  if (!shape || typeof shape.stepText !== 'string' || !shape.bbox?.min || !shape.bbox.max) return false;
  return HASH.test(shape.stepSha256) && shape.shapeHash === shape.stepSha256 && shape.stepBytes === Buffer.byteLength(shape.stepText, 'utf8') && shape.stepText.includes('ISO-10303-21;') && shape.stepText.includes('MANIFOLD_SOLID_BREP') && shape.stepText.includes('END-ISO-10303-21;') && shape.manifoldSolid === true && Number.isFinite(shape.absoluteVolume) && shape.absoluteVolume > 0 && Number.isFinite(shape.maxToleranceMm) && shape.maxToleranceMm >= 0 && finiteV([shape.bbox.min.x, shape.bbox.min.y, shape.bbox.min.z], 3) && finiteV([shape.bbox.max.x, shape.bbox.max.y, shape.bbox.max.z], 3) && sha256(shape.stepText) === shape.stepSha256;
}

export function validateVerticalTransportExactReceipt(receipt: VerticalTransportExactReceipt, request: VerticalTransportExactGeometryRequest): boolean {
  if (!receipt || receipt.contractVersion !== ARCHITECTURE_VERTICAL_TRANSPORT_EXACT_CONTRACT_VERSION || receipt.units !== 'mm' || receipt.releaseReady !== false || canonical(receipt.hold) !== canonical(HOLD) || canonical(receipt.binding) !== canonical(request.binding) || canonical(receipt.coordinateFrame) !== canonical(request.coordinateFrame) || receipt.shaftId !== request.shaft.id || receipt.elevatorId !== request.elevator.id || canonical(receipt.servedStoreyIds) !== canonical(request.elevator.servedStoreyIds) || canonical(receipt.carFootprintMm) !== canonical(request.carFootprintMm) || receipt.carHeightMm !== request.carHeightMm || canonical(receipt.clearanceMm) !== canonical(request.clearanceMm) || !HASH.test(receipt.contentHash) || !Array.isArray(receipt.hostSlabs) || !shapeReceiptConsistent(receipt.shaftVoid) || !shapeReceiptConsistent(receipt.elevatorCar) || !shapeReceiptConsistent(receipt.elevatorEnvelope)) return false;
  if (receipt.shaftVoid.kind !== 'shaft_void_cutter' || receipt.shaftVoid.elementId !== request.shaft.id || receipt.elevatorCar.kind !== 'elevator_car' || receipt.elevatorCar.elementId !== request.elevator.id || receipt.elevatorEnvelope.kind !== 'elevator_envelope' || receipt.elevatorEnvelope.elementId !== `${request.elevator.id}:envelope` || receipt.hostSlabs.some(item => item.result.kind !== 'host_slab_final' || item.result.elementId !== item.slabId || item.sourceHash !== request.hostSlabs.find(host => host.slab.id === item.slabId)?.sourceHash)) return false; const geometry = expectedGeometry(request); if (geometry && (!bboxMatches(receipt.shaftVoid, { min: [geometry.shaftRect.minX, geometry.shaftRect.minY, geometry.zMin], max: [geometry.shaftRect.maxX, geometry.shaftRect.maxY, geometry.zMax] }, request.toleranceMm) || !bboxMatches(receipt.elevatorCar, { min: [rectangle(request.carFootprintMm)!.minX, rectangle(request.carFootprintMm)!.minY, geometry.carZ], max: [rectangle(request.carFootprintMm)!.maxX, rectangle(request.carFootprintMm)!.maxY, geometry.carZ + request.carHeightMm] }, request.toleranceMm))) return false;
  if (!geometry || canonical(receipt.absoluteZRangeMm) !== canonical([geometry.zMin, geometry.zMax])) return false;
  if (canonical(receipt.shaftBoundaryMm) !== canonical({ minMm: [geometry.shaftRect.minX, geometry.shaftRect.minY], maxMm: [geometry.shaftRect.maxX, geometry.shaftRect.maxY] })) return false;
  if (receipt.hostSlabs.some(item => { const host = request.hostSlabs.find(candidate => candidate.slab.id === item.slabId); const hostStorey = host && request.storeys.find(storey => storey.id === host.slab.storeyId); const hostRect = host && boundaryRectangle(host.slab.boundaryMm); return !host || !hostStorey || !hostRect || !bboxMatches(item.result, { min: [hostRect.minX, hostRect.minY, hostStorey.elevationMm], max: [hostRect.maxX, hostRect.maxY, hostStorey.elevationMm + host.slab.thicknessMm] }, request.toleranceMm); })) return false;
  const shaftArea = (geometry.shaftRect.maxX - geometry.shaftRect.minX) * (geometry.shaftRect.maxY - geometry.shaftRect.minY);
  const carRect = rectangle(request.carFootprintMm)!; const carArea = (carRect.maxX - carRect.minX) * (carRect.maxY - carRect.minY); const envelopeArea = (geometry.envelopeRect.maxX - geometry.envelopeRect.minX) * (geometry.envelopeRect.maxY - geometry.envelopeRect.minY);
  if (Math.abs(receipt.shaftVoid.absoluteVolume - shaftArea * (geometry.zMax - geometry.zMin)) > Math.max(1e-3, receipt.shaftVoid.absoluteVolume * 1e-8) || Math.abs(receipt.elevatorCar.absoluteVolume - carArea * request.carHeightMm) > Math.max(1e-3, receipt.elevatorCar.absoluteVolume * 1e-8) || Math.abs(receipt.elevatorEnvelope.absoluteVolume - envelopeArea * (request.carHeightMm + request.clearanceMm.z)) > Math.max(1e-3, receipt.elevatorEnvelope.absoluteVolume * 1e-8)) return false;
  if (receipt.hostSlabs.length !== request.hostSlabs.length || receipt.hostSlabs.some(item => { const expected = request.hostSlabs.find(host => host.slab.id === item.slabId); const hostRect = expected && boundaryRectangle(expected.slab.boundaryMm); const expectedVolume = expected && hostRect ? ((hostRect.maxX - hostRect.minX) * (hostRect.maxY - hostRect.minY) - shaftArea) * expected.slab.thicknessMm : Number.NaN; return !expected || !shapeReceiptConsistent(item.result) || Math.abs(item.result.absoluteVolume - expectedVolume) > Math.max(1e-3, expectedVolume * 1e-8) || item.sourceHash !== expected.sourceHash || item.resultingShapeHash !== item.result.shapeHash || item.resultingStepSha256 !== item.result.stepSha256 || item.storeyId !== expected.slab.storeyId; })) return false;
  const unsigned = { ...receipt, contentHash: undefined } as Omit<VerticalTransportExactReceipt, 'contentHash'>;
  return contentHash(unsigned) === receipt.contentHash;
}

export async function generateArchitectureVerticalTransportExactGeometry(request: VerticalTransportExactGeometryRequest, adapter: ArchitectureExactKernelAdapter): Promise<VerticalTransportExactResult> {
  const issues = validateRequest(request);
  if (issues.length > 0) return fail('EXACT_VERTICAL_TRANSPORT_INVALID_REQUEST', ...issues);
  const geometry = expectedGeometry(request)!;
  const zDepth = geometry.zMax - geometry.zMin;
  const cutterRect = geometry.shaftRect;
  const cutter = await adapter.buildPrismAt(rectLoop(cutterRect), geometry.zMin, zDepth);
  const shaftArea = (cutterRect.maxX - cutterRect.minX) * (cutterRect.maxY - cutterRect.minY);
  const shaftVoid = await shapeReceipt(adapter, 'shaft_void_cutter', request.shaft.id, cutter, { min: [cutterRect.minX, cutterRect.minY, geometry.zMin], max: [cutterRect.maxX, cutterRect.maxY, geometry.zMax] }, shaftArea * zDepth, request.toleranceMm);
  if (!('kind' in shaftVoid)) return shaftVoid;
  const carRect = rectangle(request.carFootprintMm)!;
  const carArea = (carRect.maxX - carRect.minX) * (carRect.maxY - carRect.minY);
  const car = await shapeReceipt(adapter, 'elevator_car', request.elevator.id, await adapter.buildPrismAt(rectLoop(carRect), geometry.carZ, request.carHeightMm), { min: [carRect.minX, carRect.minY, geometry.carZ], max: [carRect.maxX, carRect.maxY, geometry.carZ + request.carHeightMm] }, carArea * request.carHeightMm, request.toleranceMm);
  if (!('kind' in car)) return car;
  const envelopeArea = (geometry.envelopeRect.maxX - geometry.envelopeRect.minX) * (geometry.envelopeRect.maxY - geometry.envelopeRect.minY);
  const envelope = await shapeReceipt(adapter, 'elevator_envelope', `${request.elevator.id}:envelope`, await adapter.buildPrismAt(rectLoop(geometry.envelopeRect), geometry.carZ, request.carHeightMm + request.clearanceMm.z), { min: [geometry.envelopeRect.minX, geometry.envelopeRect.minY, geometry.carZ], max: [geometry.envelopeRect.maxX, geometry.envelopeRect.maxY, geometry.carZ + request.carHeightMm + request.clearanceMm.z] }, envelopeArea * (request.carHeightMm + request.clearanceMm.z), request.toleranceMm);
  if (!('kind' in envelope)) return envelope;
  const hostSlabs: VerticalTransportHostSlabReceipt[] = [];
  for (const host of request.hostSlabs) {
    const slabStorey = request.storeys.find(item => item.id === host.slab.storeyId)!;
    const base = await adapter.buildPrismAt(host.slab.boundaryMm.map(([x, y]) => ({ x, y })), slabStorey.elevationMm, host.slab.thicknessMm);
    const openingTool = await adapter.buildPrismAt(rectLoop(cutterRect), geometry.zMin - request.toleranceMm, zDepth + request.toleranceMm * 2);
    if (!base.ok || !base.shape || !openingTool.ok || !openingTool.shape) return fail('EXACT_VERTICAL_TRANSPORT_KERNEL_FAILED', `${host.slab.id}:host_or_opening_build_failed`);
    let cut;
    try { cut = await adapter.subtract(base.shape, openingTool.shape, { baseId: host.slab.id, toolId: request.shaft.id, opId: `vertical-shaft-opening:${request.shaft.id}:${host.slab.id}` }); }
    finally { try { adapter.release(base.shape); } catch { /* best effort */ } try { adapter.release(openingTool.shape); } catch { /* best effort */ } }
    const hostRect = boundaryRectangle(host.slab.boundaryMm)!;
    const hostArea = (hostRect.maxX - hostRect.minX) * (hostRect.maxY - hostRect.minY);
    const final = await shapeReceipt(adapter, 'host_slab_final', host.slab.id, cut, { min: [hostRect.minX, hostRect.minY, slabStorey.elevationMm], max: [hostRect.maxX, hostRect.maxY, slabStorey.elevationMm + host.slab.thicknessMm] }, (hostArea - shaftArea) * host.slab.thicknessMm, request.toleranceMm);
    if (!('kind' in final)) return final;
    hostSlabs.push({ slabId: host.slab.id, storeyId: host.slab.storeyId, sourceHash: host.sourceHash, resultingShapeHash: final.shapeHash, resultingStepSha256: final.stepSha256, result: final });
  }
  const receiptWithoutHash: Omit<VerticalTransportExactReceipt, 'contentHash'> = { contractVersion: ARCHITECTURE_VERTICAL_TRANSPORT_EXACT_CONTRACT_VERSION, units: 'mm', binding: request.binding, coordinateFrame: request.coordinateFrame, shaftId: request.shaft.id, elevatorId: request.elevator.id, servedStoreyIds: request.elevator.servedStoreyIds, shaftBoundaryMm: { minMm: [geometry.shaftRect.minX, geometry.shaftRect.minY], maxMm: [geometry.shaftRect.maxX, geometry.shaftRect.maxY] }, carFootprintMm: request.carFootprintMm, carHeightMm: request.carHeightMm, clearanceMm: request.clearanceMm, absoluteZRangeMm: [geometry.zMin, geometry.zMax], shaftVoid, elevatorCar: car, elevatorEnvelope: envelope, hostSlabs, releaseReady: false, hold: HOLD };
  const receipt: VerticalTransportExactReceipt = { ...receiptWithoutHash, contentHash: contentHash(receiptWithoutHash) };
  return { ok: true, receipt };
}
