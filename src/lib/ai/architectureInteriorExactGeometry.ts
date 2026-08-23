import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ANALYTIC_CYLINDER_WARNING, type BooleanOperandIds, type OcctBridge, type OcctDetailedShapeInspection } from '@/lib/occt/bridge';
import type { OcctOperationResult, OcctShape } from '@/lib/occt/types';

/** Contract version for the server-side architecture/interior exact path. */
export const ARCHITECTURE_EXACT_GEOMETRY_CONTRACT_VERSION = 'nexyfab.architecture-exact-geometry.v1';

export type ExactGeometryBlockerCode =
  | 'EXACT_GEOMETRY_INVALID_REQUEST'
  | 'EXACT_GEOMETRY_UNTRUSTED_INPUT'
  | 'EXACT_GEOMETRY_KERNEL_UNAVAILABLE'
  | 'EXACT_GEOMETRY_KERNEL_OPERATION_FAILED'
  | 'EXACT_GEOMETRY_SERVICE_OPENING_UNSUPPORTED'
  | 'EXACT_GEOMETRY_ARC_WALL_UNSUPPORTED'
  | 'EXACT_GEOMETRY_ARC_OPENING_UNSUPPORTED'
  | 'EXACT_GEOMETRY_VERIFICATION_FAILED';

type V2 = readonly [number, number];

export interface ExactGeometryBinding {
  projectId: string;
  revision: number;
  documentId: string;
  documentHash: string;
}

export interface ExactLineWall {
  id: string;
  kind: 'line';
  startMm: V2;
  endMm: V2;
  thicknessMm: number;
  heightMm: number;
  z0Mm: number;
}

export interface ExactArcWall {
  id: string;
  kind: 'arc';
  centerMm: V2;
  radiusMm: number;
  startAngleDeg: number;
  endAngleDeg: number;
  thicknessMm: number;
  heightMm: number;
  z0Mm: number;
}

export type ExactWall = ExactLineWall | ExactArcWall;

export interface ExactSlab {
  id: string;
  boundaryMm: readonly V2[];
  z0Mm: number;
  thicknessMm: number;
}

export interface ExactCeiling {
  id: string;
  boundaryMm: readonly V2[];
  elevationMm: number;
  thicknessMm: number;
}

/** offsetMm is the distance from the host line's start to the opening start. */
export interface ExactHostedOpening {
  id: string;
  kind: 'door' | 'window';
  hostWallId: string;
  offsetMm: number;
  widthMm: number;
  heightMm: number;
  sillMm: number;
}

/** A semantic service opening promoted to an exact round cutter request. */
export interface ExactServiceOpening {
  id: string;
  hostId: string;
  sourceRouteId: string;
  sourceSleeveId: string;
  centerMm: readonly [number, number, number];
  axis: readonly [number, number, number];
  cutDiameterMm: number;
  depthMm: number;
  firestopAnnulusMm: number;
  structuralApprovalId?: string;
}

export interface ArchitectureExactGeometryRequest {
  contractVersion: typeof ARCHITECTURE_EXACT_GEOMETRY_CONTRACT_VERSION;
  units: 'mm';
  binding: ExactGeometryBinding;
  toleranceMm: number;
  walls: readonly ExactWall[];
  slabs: readonly ExactSlab[];
  ceilings: readonly ExactCeiling[];
  openings: readonly ExactHostedOpening[];
  serviceOpenings: readonly ExactServiceOpening[];
}

export interface ArchitectureExactKernelIdentity {
  backend: 'occt-node';
  kernel: 'opencascade.js';
  /** A real kernel is required. Stub/mesh adapters cannot satisfy this contract. */
  realKernel: true;
  version: string;
  buildSha256: string;
  wasmSha256: string;
}

export interface ArchitectureExactKernelAdapter {
  readonly identity: ArchitectureExactKernelIdentity;
  buildPrismAt(loop: readonly { x: number; y: number }[], z0: number, heightMm: number): Promise<OcctOperationResult>;
  /**
   * Analytic arbitrary-axis round cutter. It remains optional so adapters
   * without a native analytic cylinder fail closed instead of sampling the
   * circle into a polygonal prism.
   */
  buildRoundCylinderAt?(center: readonly [number, number, number], axis: readonly [number, number, number], radiusMm: number, depthMm: number): Promise<OcctOperationResult>;
  /** Optional analytic annular-sector builder. The shipped OCCT bridge does not expose one yet. */
  buildArcWall?(wall: ExactArcWall): Promise<OcctOperationResult>;
  subtract(base: OcctShape, tool: OcctShape, ids?: BooleanOperandIds): Promise<OcctOperationResult>;
  inspectShape(shape: OcctShape): Promise<{ valid: boolean; solidCount: number; faceCount: number; edgeCount: number }>;
  inspectShapeDetailed?(shape: OcctShape): Promise<OcctDetailedShapeInspection>;
  exportSTEP(shape: OcctShape): Promise<string>;
  release(shape: OcctShape): void;
}

export interface ExactGeometryShapeReceipt {
  elementId: string;
  kind: 'wall' | 'slab' | 'ceiling';
  shapeHash: string;
  stepSha256: string;
  stepBytes: number;
  /** Exact STEP content is retained for the immutable artifact writer. */
  stepText: string;
  closedSolid: true;
  verification: {
    valid: true;
    solidCount: number;
    faceCount: number;
    edgeCount: number;
    toleranceMm: number;
    maxToleranceMm?: number;
    toleranceVerified: boolean;
  };
}

export interface ExactServiceOpeningReceipt {
  openingId: string;
  hostId: string;
  sourceRouteId: string;
  sourceSleeveId: string;
  centerMm: readonly [number, number, number];
  axis: readonly [number, number, number];
  cutDiameterMm: number;
  depthMm: number;
  firestopAnnulusMm: number;
  structuralApprovalId?: string;
  hostShapeHash: string;
  hostStepSha256: string;
  bindingHash: string;
}

export interface ArchitectureExactGeometryReceipt {
  contractVersion: typeof ARCHITECTURE_EXACT_GEOMETRY_CONTRACT_VERSION;
  units: 'mm';
  binding: ExactGeometryBinding;
  kernel: ArchitectureExactKernelIdentity;
  toleranceMm: number;
  shapes: readonly ExactGeometryShapeReceipt[];
  serviceOpenings?: readonly ExactServiceOpeningReceipt[];
  contentHash: string;
  exactGeometryProduced: true;
}

export type ArchitectureExactGeometryResult =
  | { ok: true; receipt: ArchitectureExactGeometryReceipt }
  | { ok: false; code: ExactGeometryBlockerCode; details: readonly string[] };

export type NodeArchitectureExactKernelResult =
  | { ok: true; adapter: ArchitectureExactKernelAdapter }
  | { ok: false; code: 'EXACT_GEOMETRY_KERNEL_UNAVAILABLE'; details: readonly string[] };

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DENY_KEY = /(?:path|url|secret|token|password|credential|filename|filepath)/i;
const MAX_ELEMENTS_PER_KIND = 2_000;
const MAX_BOUNDARY_POINTS = 4_096;
const MAX_STEP_BYTES_PER_SHAPE = 64 * 1024 * 1024;
const MAX_TOTAL_STEP_BYTES = 256 * 1024 * 1024;
const MAX_ABS_COORDINATE_MM = 1_000_000_000;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function untrustedValue(value: unknown, key = ''): boolean {
  if (DENY_KEY.test(key)) return true;
  if (typeof value === 'string') return value.includes('://') || value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(value);
  if (Array.isArray(value)) return value.some(item => untrustedValue(item, key));
  if (value && typeof value === 'object') return Object.entries(value).some(([name, item]) => untrustedValue(item, name));
  return false;
}

function finitePair(point: V2): boolean {
  return Array.isArray(point) && point.length === 2 && point.every(value => Number.isFinite(value) && Math.abs(value) <= MAX_ABS_COORDINATE_MM);
}

function finiteTriplet(point: readonly [number, number, number]): boolean {
  return Array.isArray(point) && point.length === 3 && point.every(value => Number.isFinite(value) && Math.abs(value) <= MAX_ABS_COORDINATE_MM);
}

function boundedFinite(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= MAX_ABS_COORDINATE_MM;
}

function polygonArea(loop: readonly V2[]): number {
  return Math.abs(loop.reduce((sum, point, index) => {
    const next = loop[(index + 1) % loop.length]!;
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2);
}

function pointInPolygon(point: readonly [number, number], loop: readonly V2[]): boolean {
  let inside = false;
  for (let index = 0, previous = loop.length - 1; index < loop.length; previous = index++) {
    const current = loop[index]!, prior = loop[previous]!;
    const crosses = (current[1] > point[1]) !== (prior[1] > point[1]);
    if (crosses && point[0] < (prior[0] - current[0]) * (point[1] - current[1]) / (prior[1] - current[1]) + current[0]) inside = !inside;
  }
  return inside;
}

function lineWallContainsPoint(wall: ExactLineWall, point: readonly [number, number], toleranceMm: number): boolean {
  const dx = wall.endMm[0] - wall.startMm[0], dy = wall.endMm[1] - wall.startMm[1];
  const length = Math.hypot(dx, dy);
  const tangent = [(point[0] - wall.startMm[0]) * dx / length + (point[1] - wall.startMm[1]) * dy / length, (point[0] - wall.startMm[0]) * -dy / length + (point[1] - wall.startMm[1]) * dx / length];
  return tangent[0] >= -toleranceMm && tangent[0] <= length + toleranceMm && Math.abs(tangent[1]) <= wall.thicknessMm / 2 + toleranceMm;
}

function serviceOpeningHostDepth(host: ExactLineWall | ExactSlab, axis: readonly [number, number, number]): number {
  if ('boundaryMm' in host) {
    const xs = host.boundaryMm.map(point => point[0]), ys = host.boundaryMm.map(point => point[1]);
    return Math.abs(axis[0]) * (Math.max(...xs) - Math.min(...xs)) + Math.abs(axis[1]) * (Math.max(...ys) - Math.min(...ys)) + Math.abs(axis[2]) * host.thicknessMm;
  }
  const length = Math.hypot(host.endMm[0] - host.startMm[0], host.endMm[1] - host.startMm[1]);
  const tx = (host.endMm[0] - host.startMm[0]) / length, ty = (host.endMm[1] - host.startMm[1]) / length;
  return Math.abs(axis[0] * tx + axis[1] * ty) * length + Math.abs(axis[0] * -ty + axis[1] * tx) * host.thicknessMm + Math.abs(axis[2]) * host.heightMm;
}

function invalidRequest(request: ArchitectureExactGeometryRequest, details: string[]): ArchitectureExactGeometryResult {
  return { ok: false, code: 'EXACT_GEOMETRY_INVALID_REQUEST', details: details.length > 0 ? details : ['request_invalid'] };
}

function validateRequest(request: ArchitectureExactGeometryRequest): string[] {
  const issues: string[] = [];
  if (!request || request.contractVersion !== ARCHITECTURE_EXACT_GEOMETRY_CONTRACT_VERSION) issues.push('contract_version_invalid');
  if (request?.units !== 'mm') issues.push('units_must_be_mm');
  const binding = request?.binding;
  if (!binding || !ID.test(binding.projectId) || !ID.test(binding.documentId)) issues.push('binding_id_invalid');
  if (!binding || !Number.isSafeInteger(binding.revision) || binding.revision < 0) issues.push('binding_revision_invalid');
  if (!binding || !HASH.test(binding.documentHash)) issues.push('binding_document_hash_invalid');
  if (!Number.isFinite(request?.toleranceMm) || request.toleranceMm <= 0 || request.toleranceMm > 10) issues.push('tolerance_invalid');
  if (!Array.isArray(request?.walls) || !Array.isArray(request?.slabs) || !Array.isArray(request?.ceilings) || !Array.isArray(request?.openings) || !Array.isArray(request?.serviceOpenings)) issues.push('element_arrays_invalid');
  if (Array.isArray(request?.walls) && Array.isArray(request?.slabs) && Array.isArray(request?.ceilings) && request.walls.length + request.slabs.length + request.ceilings.length === 0) issues.push('exact_shape_required');
  if ([request?.walls, request?.slabs, request?.ceilings, request?.openings, request?.serviceOpenings].some(items => Array.isArray(items) && items.length > MAX_ELEMENTS_PER_KIND)) issues.push('element_count_exceeded');
  const ids = new Set<string>();
  const register = (id: string, label: string) => { if (!ID.test(id) || ids.has(id)) issues.push(`${label}_id_duplicate_or_invalid`); ids.add(id); };
  for (const wall of request?.walls ?? []) {
    register(wall.id, 'wall');
    if (!boundedFinite(wall.z0Mm) || !boundedFinite(wall.thicknessMm) || wall.thicknessMm <= 0 || !boundedFinite(wall.heightMm) || wall.heightMm <= 0) issues.push(`${wall.id}_dimensions_invalid`);
    if (wall.kind === 'line') {
      if (!finitePair(wall.startMm) || !finitePair(wall.endMm) || Math.hypot(wall.endMm[0] - wall.startMm[0], wall.endMm[1] - wall.startMm[1]) <= request.toleranceMm) issues.push(`${wall.id}_line_invalid`);
    } else if (wall.kind === 'arc') {
      if (!finitePair(wall.centerMm) || !boundedFinite(wall.radiusMm) || wall.radiusMm <= wall.thicknessMm / 2 + request.toleranceMm || !Number.isFinite(wall.startAngleDeg) || !Number.isFinite(wall.endAngleDeg) || wall.startAngleDeg === wall.endAngleDeg || Math.abs(wall.endAngleDeg - wall.startAngleDeg) > 360) issues.push(`${wall.id}_arc_invalid`);
    } else issues.push('wall_kind_invalid');
  }
  for (const slab of request?.slabs ?? []) {
    register(slab.id, 'slab');
    if (!Array.isArray(slab.boundaryMm) || slab.boundaryMm.length < 3 || slab.boundaryMm.length > MAX_BOUNDARY_POINTS || slab.boundaryMm.some(point => !finitePair(point)) || polygonArea(slab.boundaryMm) <= request.toleranceMm ** 2 || !boundedFinite(slab.z0Mm) || !boundedFinite(slab.thicknessMm) || slab.thicknessMm <= 0) issues.push(`${slab.id}_slab_invalid`);
  }
  for (const ceiling of request?.ceilings ?? []) {
    register(ceiling.id, 'ceiling');
    if (!Array.isArray(ceiling.boundaryMm) || ceiling.boundaryMm.length < 3 || ceiling.boundaryMm.length > MAX_BOUNDARY_POINTS || ceiling.boundaryMm.some(point => !finitePair(point)) || polygonArea(ceiling.boundaryMm) <= request.toleranceMm ** 2 || !boundedFinite(ceiling.elevationMm) || !boundedFinite(ceiling.thicknessMm) || ceiling.thicknessMm <= 0) issues.push(`${ceiling.id}_ceiling_invalid`);
  }
  const wallById = new Map((request?.walls ?? []).map(wall => [wall.id, wall]));
  for (const opening of request?.openings ?? []) {
    register(opening.id, 'opening');
    const wall = wallById.get(opening.hostWallId);
    if (!wall) issues.push(`${opening.id}_host_wall_missing`);
    if (!['door', 'window'].includes(opening.kind) || !boundedFinite(opening.offsetMm) || opening.offsetMm < 0 || !boundedFinite(opening.widthMm) || opening.widthMm <= 0 || !boundedFinite(opening.heightMm) || opening.heightMm <= 0 || !boundedFinite(opening.sillMm) || opening.sillMm < 0) issues.push(`${opening.id}_opening_invalid`);
    if (wall) {
      const length = wall.kind === 'line' ? Math.hypot(wall.endMm[0] - wall.startMm[0], wall.endMm[1] - wall.startMm[1]) : Math.abs((wall.endAngleDeg - wall.startAngleDeg) * Math.PI / 180) * wall.radiusMm;
      if (opening.offsetMm + opening.widthMm > length + request.toleranceMm || opening.sillMm + opening.heightMm > wall.heightMm + request.toleranceMm) issues.push(`${opening.id}_opening_out_of_host_bounds`);
    }
  }
  const slabById = new Map((request?.slabs ?? []).map(slab => [slab.id, slab]));
  for (const opening of request?.serviceOpenings ?? []) {
    register(opening.id, 'service_opening');
    const host = wallById.get(opening.hostId) ?? slabById.get(opening.hostId);
    const validAxis = finiteTriplet(opening.axis) && Math.abs(Math.hypot(...opening.axis) - 1) <= 1e-6;
    if (!ID.test(opening.hostId) || !ID.test(opening.sourceRouteId) || !ID.test(opening.sourceSleeveId) || (opening.structuralApprovalId !== undefined && !ID.test(opening.structuralApprovalId)) || !finiteTriplet(opening.centerMm) || !validAxis || !boundedFinite(opening.cutDiameterMm) || opening.cutDiameterMm <= 0 || !boundedFinite(opening.depthMm) || opening.depthMm <= 0 || !boundedFinite(opening.firestopAnnulusMm) || opening.firestopAnnulusMm < 0) issues.push(`${opening.id}_service_opening_invalid`);
    if (!host) {
      issues.push(`${opening.id}_host_missing`);
      continue;
    }
    if ('kind' in host && host.kind === 'arc') {
      issues.push(`${opening.id}_arc_host_unsupported`);
      continue;
    }
    if (!finiteTriplet(opening.centerMm) || !validAxis) continue;
    const center: [number, number, number] = [opening.centerMm[0], opening.centerMm[1], opening.centerMm[2]];
    const lineHost = 'kind' in host && host.kind === 'line' ? host : undefined;
    const slabHost = !('kind' in host) ? host : undefined;
    if (!lineHost && !slabHost) continue;
    const footprintContains = lineHost ? lineWallContainsPoint(lineHost, [center[0], center[1]], request.toleranceMm) : pointInPolygon([center[0], center[1]], slabHost!.boundaryMm);
    const z0 = host.z0Mm;
    const z1 = lineHost ? host.z0Mm + lineHost.heightMm : host.z0Mm + slabHost!.thicknessMm;
    const segmentZ0 = center[2] - Math.abs(opening.axis[2]) * opening.depthMm / 2;
    const segmentZ1 = center[2] + Math.abs(opening.axis[2]) * opening.depthMm / 2;
    if (!footprintContains || segmentZ1 < z0 - request.toleranceMm || segmentZ0 > z1 + request.toleranceMm) issues.push(`${opening.id}_host_intersection_invalid`);
    if (validAxis && opening.depthMm + request.toleranceMm < serviceOpeningHostDepth(lineHost ?? slabHost!, opening.axis)) issues.push(`${opening.id}_through_depth_insufficient`);
  }
  for (const wall of request?.walls ?? []) {
    const hosted = (request?.openings ?? []).filter(opening => opening.hostWallId === wall.id).sort((left, right) => left.offsetMm - right.offsetMm);
    for (let index = 1; index < hosted.length; index++) if (hosted[index - 1]!.offsetMm + hosted[index - 1]!.widthMm > hosted[index]!.offsetMm + request.toleranceMm) issues.push(`${wall.id}_hosted_openings_overlap`);
  }
  return issues;
}

function wallLoop(wall: ExactLineWall): readonly { x: number; y: number }[] {
  const dx = wall.endMm[0] - wall.startMm[0], dy = wall.endMm[1] - wall.startMm[1];
  const length = Math.hypot(dx, dy), nx = -dy / length * wall.thicknessMm / 2, ny = dx / length * wall.thicknessMm / 2;
  return [{ x: wall.startMm[0] + nx, y: wall.startMm[1] + ny }, { x: wall.endMm[0] + nx, y: wall.endMm[1] + ny }, { x: wall.endMm[0] - nx, y: wall.endMm[1] - ny }, { x: wall.startMm[0] - nx, y: wall.startMm[1] - ny }];
}

function openingLoop(wall: ExactLineWall, opening: ExactHostedOpening): readonly { x: number; y: number }[] {
  const dx = wall.endMm[0] - wall.startMm[0], dy = wall.endMm[1] - wall.startMm[1], length = Math.hypot(dx, dy), tx = dx / length, ty = dy / length;
  const nx = -ty, ny = tx, margin = Math.max(1, wall.thicknessMm * 0.1);
  const start = { x: wall.startMm[0] + tx * opening.offsetMm, y: wall.startMm[1] + ty * opening.offsetMm };
  const end = { x: start.x + tx * opening.widthMm, y: start.y + ty * opening.widthMm };
  return [{ x: start.x + nx * (wall.thicknessMm / 2 + margin), y: start.y + ny * (wall.thicknessMm / 2 + margin) }, { x: end.x + nx * (wall.thicknessMm / 2 + margin), y: end.y + ny * (wall.thicknessMm / 2 + margin) }, { x: end.x - nx * (wall.thicknessMm / 2 + margin), y: end.y - ny * (wall.thicknessMm / 2 + margin) }, { x: start.x - nx * (wall.thicknessMm / 2 + margin), y: start.y - ny * (wall.thicknessMm / 2 + margin) }];
}

function arcOpeningLoop(wall: ExactArcWall, opening: ExactHostedOpening): readonly { x: number; y: number }[] {
  const sweep = (wall.endAngleDeg - wall.startAngleDeg) * Math.PI / 180;
  const direction = Math.sign(sweep) || 1;
  const angle = wall.startAngleDeg * Math.PI / 180 + direction * opening.offsetMm / wall.radiusMm;
  const radial = { x: Math.cos(angle), y: Math.sin(angle) };
  const tangent = { x: -Math.sin(angle) * direction, y: Math.cos(angle) * direction };
  const center = { x: wall.centerMm[0] + radial.x * wall.radiusMm, y: wall.centerMm[1] + radial.y * wall.radiusMm };
  const halfRadial = wall.thicknessMm / 2 + Math.max(1, wall.thicknessMm * 0.1);
  const start = { x: center.x, y: center.y };
  const end = { x: center.x + tangent.x * opening.widthMm, y: center.y + tangent.y * opening.widthMm };
  return [{ x: start.x + radial.x * halfRadial, y: start.y + radial.y * halfRadial }, { x: end.x + radial.x * halfRadial, y: end.y + radial.y * halfRadial }, { x: end.x - radial.x * halfRadial, y: end.y - radial.y * halfRadial }, { x: start.x - radial.x * halfRadial, y: start.y - radial.y * halfRadial }];
}

function failed(code: ExactGeometryBlockerCode, ...details: string[]): ArchitectureExactGeometryResult { return { ok: false, code, details }; }

export function hashExactServiceOpeningBindingForBinding(binding: ExactGeometryBinding, opening: ExactServiceOpening, hostShape: Pick<ExactGeometryShapeReceipt, 'shapeHash' | 'stepSha256'>): string {
  return sha256(canonical({ binding, opening: { id: opening.id, hostId: opening.hostId, sourceRouteId: opening.sourceRouteId, sourceSleeveId: opening.sourceSleeveId, centerMm: opening.centerMm, axis: opening.axis, cutDiameterMm: opening.cutDiameterMm, depthMm: opening.depthMm, firestopAnnulusMm: opening.firestopAnnulusMm, ...(opening.structuralApprovalId !== undefined ? { structuralApprovalId: opening.structuralApprovalId } : {}) }, hostShapeHash: hostShape.shapeHash, hostStepSha256: hostShape.stepSha256 }));
}

export function hashExactServiceOpeningBinding(request: ArchitectureExactGeometryRequest, opening: ExactServiceOpening, hostShape: ExactGeometryShapeReceipt): string {
  return hashExactServiceOpeningBindingForBinding(request.binding, opening, hostShape);
}

async function buildServiceOpeningTool(adapter: ArchitectureExactKernelAdapter, opening: ExactServiceOpening): Promise<ArchitectureExactGeometryResult | { ok: true; operation: OcctOperationResult }> {
  if (!adapter.buildRoundCylinderAt) return failed('EXACT_GEOMETRY_SERVICE_OPENING_UNSUPPORTED', `${opening.id}:analytic_round_cylinder_builder_unavailable`);
  try {
    const built = await adapter.buildRoundCylinderAt(opening.centerMm, opening.axis, opening.cutDiameterMm / 2, opening.depthMm);
    if (!built.ok && /(?:arbitrary-axis|analytic circular cylinder)/i.test(built.error ?? '')) return failed('EXACT_GEOMETRY_SERVICE_OPENING_UNSUPPORTED', `${opening.id}:arbitrary_axis_cylinder_builder_unavailable`);
    return { ok: true, operation: built };
  } catch {
    return failed('EXACT_GEOMETRY_KERNEL_OPERATION_FAILED', `${opening.id}:round_cylinder_builder_threw`);
  }
}

async function makeShape(adapter: ArchitectureExactKernelAdapter, id: string, kind: 'wall' | 'slab' | 'ceiling', built: OcctOperationResult, toleranceMm: number): Promise<ExactGeometryShapeReceipt | ArchitectureExactGeometryResult> {
  if (!built.ok || !built.shape) return failed('EXACT_GEOMETRY_KERNEL_OPERATION_FAILED', `${id}:build_failed`);
  try {
    const inspection = await adapter.inspectShape(built.shape);
    const detailed = adapter.inspectShapeDetailed ? await adapter.inspectShapeDetailed(built.shape) : undefined;
    // A plain validity/solid count is not enough for an exact receipt: it has no
    // kernel tolerance evidence. The real OCCT adapter exposes detailed
    // inspection; adapters without it remain preview-only by design.
    const valid = inspection.valid && inspection.solidCount === 1 && !!detailed && detailed.valid && detailed.solidCount === 1 && detailed.maxTolerance !== undefined;
    const maxTolerance = detailed?.maxTolerance;
    if (!valid || maxTolerance! > toleranceMm) return failed('EXACT_GEOMETRY_VERIFICATION_FAILED', `${id}:closed_solid_or_tolerance_failed`);
    let step: string;
    try { step = await adapter.exportSTEP(built.shape); } catch { return failed('EXACT_GEOMETRY_KERNEL_OPERATION_FAILED', `${id}:step_export_failed`); }
    const stepBytes = Buffer.byteLength(step, 'utf8');
    if (stepBytes > MAX_STEP_BYTES_PER_SHAPE) return failed('EXACT_GEOMETRY_VERIFICATION_FAILED', `${id}:step_artifact_too_large`);
    if (!step.includes('ISO-10303-21;') || !step.includes('MANIFOLD_SOLID_BREP') || !step.includes('END-ISO-10303-21;')) return failed('EXACT_GEOMETRY_VERIFICATION_FAILED', `${id}:step_not_manifold_solid`);
    const stepSha256 = sha256(step);
    return { elementId: id, kind, shapeHash: stepSha256, stepSha256, stepBytes, stepText: step, closedSolid: true, verification: { valid: true, solidCount: inspection.solidCount, faceCount: inspection.faceCount, edgeCount: inspection.edgeCount, toleranceMm, maxToleranceMm: maxTolerance!, toleranceVerified: true } };
  } catch {
    return failed('EXACT_GEOMETRY_KERNEL_OPERATION_FAILED', `${id}:inspection_failed`);
  } finally {
    try { adapter.release(built.shape); } catch { /* best-effort kernel cleanup */ }
  }
}

export async function generateArchitectureExactGeometry(request: ArchitectureExactGeometryRequest, adapter: ArchitectureExactKernelAdapter): Promise<ArchitectureExactGeometryResult> {
  if (untrustedValue(request)) return failed('EXACT_GEOMETRY_UNTRUSTED_INPUT', 'path_url_or_secret_input_forbidden');
  const issues = validateRequest(request);
  if (issues.length > 0) return invalidRequest(request, issues);
  if (!adapter.identity.realKernel || !adapter.identity.version?.trim() || !HASH.test(adapter.identity.buildSha256 ?? '') || !HASH.test(adapter.identity.wasmSha256 ?? '')) return failed('EXACT_GEOMETRY_KERNEL_UNAVAILABLE', 'trusted_real_kernel_identity_required');
  const shapes: ExactGeometryShapeReceipt[] = [];
  let totalStepBytes = 0;
  const wallShapes = new Map<string, OcctShape>();
  const slabShapes = new Map<string, OcctShape>();
  const serviceOpeningReceipts: ExactServiceOpeningReceipt[] = [];
  try {
    for (const wall of request.walls) {
      if (wall.kind === 'arc' && !adapter.buildArcWall) return failed('EXACT_GEOMETRY_ARC_WALL_UNSUPPORTED', `${wall.id}:analytic_arc_builder_unavailable`);
      if (wall.kind === 'arc' && request.openings.some(opening => opening.hostWallId === wall.id)) return failed('EXACT_GEOMETRY_ARC_OPENING_UNSUPPORTED', `${wall.id}:analytic_arc_opening_builder_unavailable`);
      const built = wall.kind === 'line' ? await adapter.buildPrismAt(wallLoop(wall), wall.z0Mm, wall.heightMm) : await adapter.buildArcWall!(wall);
      if (!built.ok || !built.shape) return failed('EXACT_GEOMETRY_KERNEL_OPERATION_FAILED', `${wall.id}:build_failed`);
      wallShapes.set(wall.id, built.shape);
      for (const opening of request.openings.filter(item => item.hostWallId === wall.id)) {
        const tool = await adapter.buildPrismAt(wall.kind === 'line' ? openingLoop(wall, opening) : arcOpeningLoop(wall, opening), wall.z0Mm + opening.sillMm, opening.heightMm);
        if (!tool.ok || !tool.shape) return failed('EXACT_GEOMETRY_KERNEL_OPERATION_FAILED', `${opening.id}:cutter_build_failed`);
        let cut: OcctOperationResult;
        try { cut = await adapter.subtract(wallShapes.get(wall.id)!, tool.shape); }
        finally { try { adapter.release(tool.shape); } catch { /* best-effort kernel cleanup */ } }
        if (!cut.ok || !cut.shape) return failed('EXACT_GEOMETRY_KERNEL_OPERATION_FAILED', `${opening.id}:boolean_subtract_failed`);
        try { adapter.release(wallShapes.get(wall.id)!); } catch { /* replaced shape still becomes the map owner */ }
        wallShapes.set(wall.id, cut.shape);
      }
      const hostedServiceOpenings = request.serviceOpenings.filter(item => item.hostId === wall.id);
      if (hostedServiceOpenings.length > 0 && wall.kind === 'arc') return failed('EXACT_GEOMETRY_SERVICE_OPENING_UNSUPPORTED', `${wall.id}:arc_wall_service_opening_unavailable`);
      for (const opening of hostedServiceOpenings) {
        const toolResult = await buildServiceOpeningTool(adapter, opening);
        if ('operation' in toolResult) {
          if (!toolResult.operation.ok || !toolResult.operation.shape) return failed('EXACT_GEOMETRY_KERNEL_OPERATION_FAILED', `${opening.id}:round_cutter_build_failed`);
        } else return toolResult;
        const tool = toolResult.operation;
        let cut: OcctOperationResult;
        try { cut = await adapter.subtract(wallShapes.get(wall.id)!, tool.shape!, { baseId: wall.id, toolId: opening.id, opId: `service-opening:${opening.id}` }); }
        finally { try { adapter.release(tool.shape!); } catch { /* best-effort kernel cleanup */ } }
        if (!cut.ok || !cut.shape) return failed('EXACT_GEOMETRY_KERNEL_OPERATION_FAILED', `${opening.id}:boolean_subtract_failed`);
        try { adapter.release(wallShapes.get(wall.id)!); } catch { /* replaced shape still becomes the map owner */ }
        wallShapes.set(wall.id, cut.shape);
      }
      const receipt = await makeShape(adapter, wall.id, 'wall', { ok: true, shape: wallShapes.get(wall.id)!, warnings: [] }, request.toleranceMm);
      wallShapes.delete(wall.id);
      if (!('elementId' in receipt)) return receipt;
      shapes.push(receipt);
      for (const opening of hostedServiceOpenings) serviceOpeningReceipts.push({ openingId: opening.id, hostId: opening.hostId, sourceRouteId: opening.sourceRouteId, sourceSleeveId: opening.sourceSleeveId, centerMm: opening.centerMm, axis: opening.axis, cutDiameterMm: opening.cutDiameterMm, depthMm: opening.depthMm, firestopAnnulusMm: opening.firestopAnnulusMm, ...(opening.structuralApprovalId !== undefined ? { structuralApprovalId: opening.structuralApprovalId } : {}), hostShapeHash: receipt.shapeHash, hostStepSha256: receipt.stepSha256, bindingHash: hashExactServiceOpeningBinding(request, opening, receipt) });
      totalStepBytes += receipt.stepBytes;
      if (totalStepBytes > MAX_TOTAL_STEP_BYTES) return failed('EXACT_GEOMETRY_VERIFICATION_FAILED', 'total_step_artifact_too_large');
    }
    for (const slab of request.slabs) {
      const built = await adapter.buildPrismAt(slab.boundaryMm.map(([x, y]) => ({ x, y })), slab.z0Mm, slab.thicknessMm);
      if (!built.ok || !built.shape) return failed('EXACT_GEOMETRY_KERNEL_OPERATION_FAILED', `${slab.id}:build_failed`);
      slabShapes.set(slab.id, built.shape);
      const hostedServiceOpenings = request.serviceOpenings.filter(item => item.hostId === slab.id);
      for (const opening of hostedServiceOpenings) {
        const toolResult = await buildServiceOpeningTool(adapter, opening);
        if ('operation' in toolResult) {
          if (!toolResult.operation.ok || !toolResult.operation.shape) return failed('EXACT_GEOMETRY_KERNEL_OPERATION_FAILED', `${opening.id}:round_cutter_build_failed`);
        } else return toolResult;
        const tool = toolResult.operation;
        let cut: OcctOperationResult;
        try { cut = await adapter.subtract(slabShapes.get(slab.id)!, tool.shape!, { baseId: slab.id, toolId: opening.id, opId: `service-opening:${opening.id}` }); }
        finally { try { adapter.release(tool.shape!); } catch { /* best-effort kernel cleanup */ } }
        if (!cut.ok || !cut.shape) return failed('EXACT_GEOMETRY_KERNEL_OPERATION_FAILED', `${opening.id}:boolean_subtract_failed`);
        try { adapter.release(slabShapes.get(slab.id)!); } catch { /* replaced shape still becomes the map owner */ }
        slabShapes.set(slab.id, cut.shape);
      }
      const receipt = await makeShape(adapter, slab.id, 'slab', { ok: true, shape: slabShapes.get(slab.id)!, warnings: built.warnings }, request.toleranceMm);
      slabShapes.delete(slab.id);
      if (!('elementId' in receipt)) return receipt;
      shapes.push(receipt);
      for (const opening of hostedServiceOpenings) serviceOpeningReceipts.push({ openingId: opening.id, hostId: opening.hostId, sourceRouteId: opening.sourceRouteId, sourceSleeveId: opening.sourceSleeveId, centerMm: opening.centerMm, axis: opening.axis, cutDiameterMm: opening.cutDiameterMm, depthMm: opening.depthMm, firestopAnnulusMm: opening.firestopAnnulusMm, ...(opening.structuralApprovalId !== undefined ? { structuralApprovalId: opening.structuralApprovalId } : {}), hostShapeHash: receipt.shapeHash, hostStepSha256: receipt.stepSha256, bindingHash: hashExactServiceOpeningBinding(request, opening, receipt) });
      totalStepBytes += receipt.stepBytes;
      if (totalStepBytes > MAX_TOTAL_STEP_BYTES) return failed('EXACT_GEOMETRY_VERIFICATION_FAILED', 'total_step_artifact_too_large');
    }
    for (const ceiling of request.ceilings) {
      const built = await adapter.buildPrismAt(ceiling.boundaryMm.map(([x, y]) => ({ x, y })), ceiling.elevationMm - ceiling.thicknessMm, ceiling.thicknessMm);
      const receipt = await makeShape(adapter, ceiling.id, 'ceiling', built, request.toleranceMm);
      if (!('elementId' in receipt)) return receipt;
      shapes.push(receipt);
      totalStepBytes += receipt.stepBytes;
      if (totalStepBytes > MAX_TOTAL_STEP_BYTES) return failed('EXACT_GEOMETRY_VERIFICATION_FAILED', 'total_step_artifact_too_large');
    }
  } catch (error) {
    return failed('EXACT_GEOMETRY_KERNEL_OPERATION_FAILED', error instanceof Error ? error.message : 'kernel_operation_threw');
  } finally {
    for (const shape of [...wallShapes.values(), ...slabShapes.values()]) { try { adapter.release(shape); } catch { /* already released by makeShape */ } }
  }
  if (serviceOpeningReceipts.length !== request.serviceOpenings.length) return failed('EXACT_GEOMETRY_SERVICE_OPENING_UNSUPPORTED', 'service_opening_host_shape_not_produced');
  const contentHash = sha256(canonical({ binding: request.binding, units: request.units, toleranceMm: request.toleranceMm, shapes: shapes.map(({ elementId, kind, shapeHash, stepSha256, stepBytes }) => ({ elementId, kind, shapeHash, stepSha256, stepBytes })), serviceOpenings: serviceOpeningReceipts }));
  return { ok: true, receipt: { contractVersion: ARCHITECTURE_EXACT_GEOMETRY_CONTRACT_VERSION, units: 'mm', binding: request.binding, kernel: adapter.identity, toleranceMm: request.toleranceMm, shapes, serviceOpenings: serviceOpeningReceipts, contentHash, exactGeometryProduced: true } };
}

function sampledCircle(center: V2, radius: number, count = 48): readonly { x: number; y: number }[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = index * Math.PI * 2 / count;
    return { x: center[0] + Math.cos(angle) * radius, y: center[1] + Math.sin(angle) * radius };
  });
}

/**
 * Construct an analytic annular sector from OCCT cylinders and prism-sector
 * intersections. The circle loops are recognized by nodeOcctBridge as exact
 * cylinders; the radial clipping prism has straight analytic boundaries, so
 * this is not a polygonal approximation of the arc.
 */
async function buildAnalyticArcWall(
  bridge: OcctBridge,
  wall: ExactArcWall,
  buildPrism: ArchitectureExactKernelAdapter['buildPrismAt'],
): Promise<OcctOperationResult> {
  const outerRadius = wall.radiusMm + wall.thicknessMm / 2;
  const innerRadius = wall.radiusMm - wall.thicknessMm / 2;
  if (!(innerRadius > 0)) return { ok: false, error: 'arc wall inner radius must be positive', warnings: [] };
  const outer = await buildPrism(sampledCircle(wall.centerMm, outerRadius), wall.z0Mm, wall.heightMm);
  const inner = await buildPrism(sampledCircle(wall.centerMm, innerRadius), wall.z0Mm, wall.heightMm);
  if (!outer.ok || !outer.shape || !inner.ok || !inner.shape) {
    if (outer.shape) bridge.release(outer.shape);
    if (inner.shape) bridge.release(inner.shape);
    return { ok: false, error: 'arc cylinder construction failed', warnings: [] };
  }
  const annulus = await bridge.boolean.subtract(outer.shape, inner.shape);
  bridge.release(outer.shape);
  bridge.release(inner.shape);
  if (!annulus.ok || !annulus.shape) return { ok: false, error: 'arc annulus boolean failed', warnings: [] };
  const sweep = (wall.endAngleDeg - wall.startAngleDeg) * Math.PI / 180;
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI * 0.9)));
  const farRadius = outerRadius * 2 + wall.thicknessMm;
  let current: OcctShape | undefined = undefined;
  try {
    for (let index = 0; index < count; index++) {
      const a0 = wall.startAngleDeg * Math.PI / 180 + sweep * index / count;
      const a1 = wall.startAngleDeg * Math.PI / 180 + sweep * (index + 1) / count;
      const wedge = await buildPrism([
        { x: wall.centerMm[0], y: wall.centerMm[1] },
        { x: wall.centerMm[0] + Math.cos(a0) * farRadius, y: wall.centerMm[1] + Math.sin(a0) * farRadius },
        { x: wall.centerMm[0] + Math.cos(a1) * farRadius, y: wall.centerMm[1] + Math.sin(a1) * farRadius },
      ], wall.z0Mm, wall.heightMm);
      if (!wedge.ok || !wedge.shape) {
        bridge.release(annulus.shape);
        if (current) bridge.release(current);
        return { ok: false, error: 'arc sector construction failed', warnings: [] };
      }
      const clipped = await bridge.boolean.intersect(annulus.shape, wedge.shape);
      bridge.release(wedge.shape);
      if (!clipped.ok || !clipped.shape) {
        bridge.release(annulus.shape);
        if (current) bridge.release(current);
        return { ok: false, error: 'arc sector intersection failed', warnings: [] };
      }
      if (!current) current = clipped.shape;
      else {
        const joined = await bridge.boolean.union(current, clipped.shape);
        bridge.release(current);
        bridge.release(clipped.shape);
        if (!joined.ok || !joined.shape) {
          bridge.release(annulus.shape);
          return { ok: false, error: 'arc sector union failed', warnings: [] };
        }
        current = joined.shape;
      }
    }
    bridge.release(annulus.shape);
    return current ? { ok: true, shape: current, warnings: [] } : { ok: false, error: 'arc sector produced no shape', warnings: [] };
  } catch (error) {
    bridge.release(annulus.shape);
    if (current) bridge.release(current);
    return { ok: false, error: error instanceof Error ? error.message : 'arc sector operation threw', warnings: [] };
  }
}

/** Adapt the existing real Node OCCT bridge; no stub/mesh bridge is accepted. */
export function createArchitectureExactKernelAdapter(bridge: OcctBridge, identity: ArchitectureExactKernelIdentity): ArchitectureExactKernelAdapter {
  const buildPrism: ArchitectureExactKernelAdapter['buildPrismAt'] = async (loop, z0, heightMm) => bridge.buildPrismAt ? bridge.buildPrismAt(loop, z0, heightMm) : { ok: false, error: 'buildPrismAt unavailable', warnings: [] };
  const buildRoundCylinderAt: ArchitectureExactKernelAdapter['buildRoundCylinderAt'] = bridge.buildCylinderAt ? async (center, axis, radiusMm, depthMm) => {
    const axisLength = Math.hypot(axis[0], axis[1], axis[2]);
    if (!center.every(Number.isFinite) || !axis.every(Number.isFinite) || !Number.isFinite(axisLength) || axisLength < 1e-12 || !Number.isFinite(radiusMm) || radiusMm <= 0 || !Number.isFinite(depthMm) || depthMm <= 0) {
      return { ok: false, error: 'analytic arbitrary-axis cylinder request invalid', warnings: [] };
    }
    const direction: [number, number, number] = [axis[0] / axisLength, axis[1] / axisLength, axis[2] / axisLength];
    // The document's center is the midpoint of the through-cut; the bridge
    // primitive accepts the cylinder origin and direction, so center it before
    // handing the request to the kernel.
    const origin: [number, number, number] = [center[0] - direction[0] * depthMm / 2, center[1] - direction[1] * depthMm / 2, center[2] - direction[2] * depthMm / 2];
    const built = await bridge.buildCylinderAt!(origin, direction, radiusMm, depthMm);
    if (!built.ok || !built.shape || !built.warnings.includes(ANALYTIC_CYLINDER_WARNING)) {
      if (built.shape) bridge.release(built.shape);
      return { ok: false, error: 'analytic arbitrary-axis cylinder promotion unavailable', warnings: built.warnings };
    }
    return built;
  } : undefined;
  return { identity, buildPrismAt: buildPrism, ...(buildRoundCylinderAt ? { buildRoundCylinderAt } : {}), buildArcWall: wall => buildAnalyticArcWall(bridge, wall, buildPrism), subtract: (base, tool, ids) => bridge.boolean.subtract(base, tool, ids), inspectShape: async shape => bridge.inspectShape ? bridge.inspectShape(shape) : { valid: false, solidCount: 0, faceCount: 0, edgeCount: 0 }, inspectShapeDetailed: bridge.inspectShapeDetailed ? shape => bridge.inspectShapeDetailed!(shape) : undefined, exportSTEP: shape => bridge.exportSTEP(shape), release: shape => bridge.release(shape) };
}

/** Server-only loader for the repository's actual opencascade.js WASM kernel. */
export async function createNodeArchitectureExactKernelAdapter(): Promise<NodeArchitectureExactKernelResult> {
  try {
    const { loadOcctNode } = await import('@/lib/occt/nodeOcctLoader');
    const loaded = await loadOcctNode();
    if (!loaded.ok || !loaded.oc) return { ok: false, code: 'EXACT_GEOMETRY_KERNEL_UNAVAILABLE', details: [loaded.reason ?? 'occt_runtime_unavailable'] };
    const { createNodeOcctBridge } = await import('@/lib/occt/nodeOcctBridge');
    const distDir = path.join(process.cwd(), 'node_modules', 'opencascade.js', 'dist');
    const packagePath = path.join(process.cwd(), 'node_modules', 'opencascade.js', 'package.json');
    const glue = fs.readFileSync(path.join(distDir, 'opencascade.wasm.js'));
    const wasm = fs.readFileSync(path.join(distDir, 'opencascade.wasm.wasm'));
    const packageValue = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { version?: unknown };
    if (typeof packageValue.version !== 'string' || !packageValue.version.trim()) return { ok: false, code: 'EXACT_GEOMETRY_KERNEL_UNAVAILABLE', details: ['occt_package_version_unavailable'] };
    return { ok: true, adapter: createArchitectureExactKernelAdapter(createNodeOcctBridge(loaded.oc), { backend: 'occt-node', kernel: 'opencascade.js', realKernel: true, version: packageValue.version, buildSha256: createHash('sha256').update(glue).digest('hex'), wasmSha256: createHash('sha256').update(wasm).digest('hex') }) };
  } catch (error) {
    return { ok: false, code: 'EXACT_GEOMETRY_KERNEL_UNAVAILABLE', details: [error instanceof Error ? error.message : 'occt_runtime_load_failed'] };
  }
}
