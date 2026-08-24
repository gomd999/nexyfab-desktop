import { Sha256 } from '@aws-crypto/sha256-js';
import { canonicalCadConsumerDraftJson, type CanonicalCadJsonValue } from '@/lib/cad/canonicalCadV2ConsumerDraft';
import { FEATURE_REGISTRY_HASH } from '@/lib/cad/featureRegistry';
import { decideFeatureExecution } from '@/lib/cad/featureRegistryDecision';
import { loadNodeOcctCommercialRuntime } from './nodeOcctCommercialRuntime';
import type { OcctDetailedShapeInspection } from './bridge';
import type { OcctShape } from './types';

export const BOUNDED_WELDMENT_REQUEST_SCHEMA = 'nexyfab.precision-cad.bounded-weldment-request.v1' as const;
export const BOUNDED_WELDMENT_CUT_LIST_SCHEMA = 'nexyfab.precision-cad.bounded-weldment-cut-list.v1' as const;
export const BOUNDED_WELDMENT_RECEIPT_SCHEMA = 'nexyfab.precision-cad.bounded-weldment-receipt.v1' as const;

export interface BoundedWeldmentMember {
  memberId: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
}

export interface BoundedWeldmentRequest {
  schema: typeof BOUNDED_WELDMENT_REQUEST_SCHEMA;
  featureId: 'cad.mechanical.weldment';
  operationId: string;
  projectId: string;
  documentId: string;
  baseRevisionId: string;
  baseSequence: number;
  baseContentSha256: string;
  parameters: {
    unit: 'mm';
    primary: BoundedWeldmentMember;
    branch: BoundedWeldmentMember;
    joint: {
      kind: 'square-corner-contact';
      primaryEnd: 'positive_x';
      branchSide: 'negative_x';
      weldBead: 'not_modelled';
    };
  };
}

export type BoundedWeldmentBlockerCode =
  | 'INVALID_REQUEST'
  | 'RUNTIME_UNAVAILABLE'
  | 'REGISTRY_HOLD'
  | 'HANDLER_UNAVAILABLE'
  | 'MEMBER_BUILD_FAILED'
  | 'COMPOUND_BUILD_FAILED'
  | 'BREP_INVALID'
  | 'FEATURE_INVARIANT_MISMATCH'
  | 'STEP_EXPORT_FAILED'
  | 'STEP_REIMPORT_FAILED'
  | 'ROUNDTRIP_MISMATCH'
  | 'RESOURCE_LIMIT_EXCEEDED';

export interface BoundedWeldmentCutList {
  schema: typeof BOUNDED_WELDMENT_CUT_LIST_SCHEMA;
  unit: 'mm';
  sourceRequestSha256: string;
  stepSha256: string;
  registryHash: string;
  runtimeIdentitySha256: string;
  members: readonly [
    {
      role: 'primary';
      memberId: string;
      quantity: 1;
      profile: { kind: 'rectangular'; widthMm: number; heightMm: number };
      cutLengthMm: number;
      endTreatment: readonly ['square', 'square'];
      materialSpecification: 'UNSPECIFIED';
    },
    {
      role: 'branch';
      memberId: string;
      quantity: 1;
      profile: { kind: 'rectangular'; widthMm: number; heightMm: number };
      cutLengthMm: number;
      endTreatment: readonly ['square', 'square'];
      materialSpecification: 'UNSPECIFIED';
    },
  ];
  joint: {
    kind: 'square-corner-contact';
    memberIds: readonly [string, string];
    weldBeadGeometry: 'NOT_MODELLED';
    processSpecification: 'NOT_AUTHORIZED';
  };
}

export interface BoundedWeldmentReceipt {
  schema: typeof BOUNDED_WELDMENT_RECEIPT_SCHEMA;
  status: 'EXACT_PASS';
  featureId: 'cad.mechanical.weldment';
  operationId: string;
  projectId: string;
  documentId: string;
  baseRevisionId: string;
  baseSequence: number;
  baseContentSha256: string;
  registryHash: string;
  runtimeIdentitySha256: string;
  requestSha256: string;
  resultInspectionSha256: string;
  roundtripInspectionSha256: string;
  stepSha256: string;
  cutListSha256: string;
  solidCount: 2;
  compoundCount: 1;
  cutListMemberCount: 2;
  xcafOccurrenceVerification: 'NOT_RUN';
  weldProcessAuthority: 'NOT_CLAIMED';
  blockerCodes: readonly [];
  authoritativeCommit: false;
  commercialReleaseReady: false;
  receiptSha256: string;
}

export type BoundedWeldmentResult =
  | {
      status: 'EXACT_PASS';
      blockerCodes: readonly [];
      receipt: BoundedWeldmentReceipt;
      stepArtifact: string;
      cutListArtifact: string;
    }
  | {
      status: 'HOLD';
      blockerCodes: readonly BoundedWeldmentBlockerCode[];
      receipt: null;
      stepArtifact: null;
      cutListArtifact: null;
    };

type PlainRecord = Record<string, unknown>;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_COORDINATE = 1_000_000;
const MAX_STEP_BYTES = 8 * 1024 * 1024;
const MAX_CUT_LIST_BYTES = 256 * 1024;
const MAX_ELAPSED_MS = 60_000;
const REQUEST_KEYS = ['schema', 'featureId', 'operationId', 'projectId', 'documentId', 'baseRevisionId', 'baseSequence', 'baseContentSha256', 'parameters'] as const;
const PARAMETER_KEYS = ['unit', 'primary', 'branch', 'joint'] as const;
const MEMBER_KEYS = ['memberId', 'lengthMm', 'widthMm', 'heightMm'] as const;
const JOINT_KEYS = ['kind', 'primaryEnd', 'branchSide', 'weldBead'] as const;
const RESULT_KEYS = ['status', 'blockerCodes', 'receipt', 'stepArtifact', 'cutListArtifact'] as const;
const RECEIPT_KEYS = [
  'schema', 'status', 'featureId', 'operationId', 'projectId', 'documentId',
  'baseRevisionId', 'baseSequence', 'baseContentSha256', 'registryHash',
  'runtimeIdentitySha256', 'requestSha256', 'resultInspectionSha256',
  'roundtripInspectionSha256', 'stepSha256', 'cutListSha256', 'solidCount',
  'compoundCount', 'cutListMemberCount', 'xcafOccurrenceVerification',
  'weldProcessAuthority', 'blockerCodes', 'authoritativeCommit',
  'commercialReleaseReady', 'receiptSha256',
] as const;
const BLOCKER_CODES: readonly BoundedWeldmentBlockerCode[] = [
  'INVALID_REQUEST', 'RUNTIME_UNAVAILABLE', 'REGISTRY_HOLD', 'HANDLER_UNAVAILABLE',
  'MEMBER_BUILD_FAILED', 'COMPOUND_BUILD_FAILED', 'BREP_INVALID',
  'FEATURE_INVARIANT_MISMATCH', 'STEP_EXPORT_FAILED', 'STEP_REIMPORT_FAILED',
  'ROUNDTRIP_MISMATCH', 'RESOURCE_LIMIT_EXCEEDED',
];

function isRecord(value: unknown): value is PlainRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: PlainRecord, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function snapshot(value: unknown, seen = new Set<object>(), budget = { count: 0 }, depth = 0): unknown {
  if (depth > 10 || budget.count++ > 512) throw new Error('snapshot_limit');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('snapshot_number');
    return value;
  }
  if (typeof value !== 'object' || seen.has(value)) throw new Error('snapshot_type');
  seen.add(value);
  try {
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some(key => typeof key !== 'string')) throw new Error('snapshot_symbol');
    if (Array.isArray(value)) {
      if (ownKeys.some(key => key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key as string))) throw new Error('snapshot_array_key');
      return value.map((_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error('snapshot_descriptor');
        return snapshot(descriptor.value, seen, budget, depth + 1);
      });
    }
    if (!isRecord(value)) throw new Error('snapshot_record');
    const output: PlainRecord = {};
    for (const key of ownKeys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error('snapshot_descriptor');
      output[key] = snapshot(descriptor.value, seen, budget, depth + 1);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function hashString(value: string): string {
  const hash = new Sha256();
  hash.update(value);
  return [...hash.digestSync()].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function hashCanonical(value: unknown): string {
  return hashString(canonicalCadConsumerDraftJson(value as CanonicalCadJsonValue));
}

function validMember(value: unknown): value is BoundedWeldmentMember {
  return isRecord(value) && exactKeys(value, MEMBER_KEYS)
    && typeof value.memberId === 'string' && SAFE_ID.test(value.memberId)
    && [value.lengthMm, value.widthMm, value.heightMm].every(item =>
      typeof item === 'number' && Number.isFinite(item) && item >= 0.001 && item <= 100_000);
}

function validateRequest(input: unknown): BoundedWeldmentRequest | null {
  let copied: unknown;
  try { copied = snapshot(input); } catch { return null; }
  if (!isRecord(copied) || !exactKeys(copied, REQUEST_KEYS)
    || copied.schema !== BOUNDED_WELDMENT_REQUEST_SCHEMA
    || copied.featureId !== 'cad.mechanical.weldment'
    || ![copied.operationId, copied.projectId, copied.documentId, copied.baseRevisionId]
      .every(value => typeof value === 'string' && SAFE_ID.test(value))
    || !Number.isSafeInteger(copied.baseSequence) || (copied.baseSequence as number) < 0
    || typeof copied.baseContentSha256 !== 'string' || !SHA256.test(copied.baseContentSha256)
    || !isRecord(copied.parameters) || !exactKeys(copied.parameters, PARAMETER_KEYS)
    || copied.parameters.unit !== 'mm'
    || !validMember(copied.parameters.primary) || !validMember(copied.parameters.branch)
    || copied.parameters.primary.memberId === copied.parameters.branch.memberId
    || !isRecord(copied.parameters.joint) || !exactKeys(copied.parameters.joint, JOINT_KEYS)
    || copied.parameters.joint.kind !== 'square-corner-contact'
    || copied.parameters.joint.primaryEnd !== 'positive_x'
    || copied.parameters.joint.branchSide !== 'negative_x'
    || copied.parameters.joint.weldBead !== 'not_modelled') return null;
  const { primary, branch } = copied.parameters;
  if (primary.lengthMm + branch.widthMm > MAX_COORDINATE
    || Math.max(primary.widthMm, branch.lengthMm) > MAX_COORDINATE
    || Math.max(primary.heightMm, branch.heightMm) > MAX_COORDINATE) return null;
  return copied as unknown as BoundedWeldmentRequest;
}

function hold(...codes: BoundedWeldmentBlockerCode[]): BoundedWeldmentResult {
  return {
    status: 'HOLD', blockerCodes: [...new Set(codes)], receipt: null,
    stepArtifact: null, cutListArtifact: null,
  };
}

function boundedInspectionSnapshot(inspection: OcctDetailedShapeInspection): CanonicalCadJsonValue {
  return {
    valid: inspection.valid,
    solidCount: inspection.solidCount,
    faceCount: inspection.faceCount,
    edgeCount: inspection.edgeCount,
    compoundCount: inspection.shapeTypeCounts?.compound ?? -1,
    shellCount: inspection.shapeTypeCounts?.shell ?? -1,
    bboxMm: [
      inspection.bbox.min.x, inspection.bbox.min.y, inspection.bbox.min.z,
      inspection.bbox.max.x, inspection.bbox.max.y, inspection.bbox.max.z,
    ],
    absoluteVolumeMm3: inspection.absoluteVolume,
    surfaceAreaMm2: inspection.surfaceArea,
    surfaceTypes: inspection.surfaceTypes.status === 'available'
      ? inspection.surfaceTypes.counts
      : { unavailable: inspection.surfaceTypes.reason },
    boundaryEdgeCount: inspection.faceAdjacency.status === 'available'
      ? inspection.faceAdjacency.boundaryEdgeCount : -1,
    nonManifoldEdgeCount: inspection.faceAdjacency.status === 'available'
      ? inspection.faceAdjacency.nonManifoldEdgeCount : -1,
  } as CanonicalCadJsonValue;
}

function inspectionMatches(
  inspection: OcctDetailedShapeInspection,
  request: BoundedWeldmentRequest,
): boolean {
  const { primary, branch } = request.parameters;
  const expectedVolume = primary.lengthMm * primary.widthMm * primary.heightMm
    + branch.widthMm * branch.lengthMm * branch.heightMm;
  const expectedArea = 2 * (
    primary.lengthMm * primary.widthMm
    + primary.widthMm * primary.heightMm
    + primary.lengthMm * primary.heightMm
    + branch.widthMm * branch.lengthMm
    + branch.lengthMm * branch.heightMm
    + branch.widthMm * branch.heightMm
  );
  const expectedBbox = [
    0, 0, 0,
    primary.lengthMm + branch.widthMm,
    Math.max(primary.widthMm, branch.lengthMm),
    Math.max(primary.heightMm, branch.heightMm),
  ];
  const actualBbox = [
    inspection.bbox.min.x, inspection.bbox.min.y, inspection.bbox.min.z,
    inspection.bbox.max.x, inspection.bbox.max.y, inspection.bbox.max.z,
  ];
  const bboxError = Math.max(...expectedBbox.map((value, index) => Math.abs(actualBbox[index]! - value)));
  const volumeError = Math.abs(inspection.absoluteVolume - expectedVolume) / expectedVolume;
  const areaError = Math.abs(inspection.surfaceArea - expectedArea) / expectedArea;
  const adjacency = inspection.faceAdjacency;
  const types = inspection.surfaceTypes;
  return inspection.valid && inspection.solidCount === 2
    && inspection.faceCount === 12 && inspection.edgeCount === 24
    && inspection.shapeTypeCounts?.compound === 1
    && inspection.shapeTypeCounts?.shell === 2
    && volumeError <= 1e-6 && areaError <= 1e-6 && bboxError <= 1e-5
    && types.status === 'available' && types.counts.plane === 12
    && Object.keys(types.counts).length === 1
    && adjacency.status === 'available'
    && adjacency.boundaryEdgeCount === 0 && adjacency.nonManifoldEdgeCount === 0;
}

function buildCutList(
  request: BoundedWeldmentRequest,
  requestSha256: string,
  stepSha256: string,
  runtimeIdentitySha256: string,
): BoundedWeldmentCutList {
  const member = <R extends 'primary' | 'branch'>(role: R, value: BoundedWeldmentMember) => ({
    role,
    memberId: value.memberId,
    quantity: 1 as const,
    profile: { kind: 'rectangular' as const, widthMm: value.widthMm, heightMm: value.heightMm },
    cutLengthMm: value.lengthMm,
    endTreatment: ['square', 'square'] as const,
    materialSpecification: 'UNSPECIFIED' as const,
  });
  return {
    schema: BOUNDED_WELDMENT_CUT_LIST_SCHEMA,
    unit: 'mm',
    sourceRequestSha256: requestSha256,
    stepSha256,
    registryHash: FEATURE_REGISTRY_HASH,
    runtimeIdentitySha256,
    members: [member('primary', request.parameters.primary), member('branch', request.parameters.branch)],
    joint: {
      kind: 'square-corner-contact',
      memberIds: [request.parameters.primary.memberId, request.parameters.branch.memberId],
      weldBeadGeometry: 'NOT_MODELLED',
      processSpecification: 'NOT_AUTHORIZED',
    },
  };
}

/** Trusted server-side bounded weldment producer. No bridge or cut list is accepted from the caller. */
export async function executeBoundedWeldment(input: unknown): Promise<BoundedWeldmentResult> {
  const startedAt = Date.now();
  const overBudget = (): boolean => Date.now() - startedAt > MAX_ELAPSED_MS;
  const request = validateRequest(input);
  if (!request) return hold('INVALID_REQUEST');
  const requestSha256 = hashCanonical(request);
  const runtime = await loadNodeOcctCommercialRuntime();
  if (overBudget()) return hold('RESOURCE_LIMIT_EXCEEDED');
  if (!runtime.ok) return hold('RUNTIME_UNAVAILABLE');
  const decision = decideFeatureExecution({
    featureId: request.featureId,
    intent: 'AUTHORITATIVE',
    runtime: runtime.capabilities,
  });
  if (decision.status !== 'ALLOW_EXACT') return hold('REGISTRY_HOLD');
  const { bridge } = runtime;
  if (!bridge.buildPrismAt || !bridge.makeCompound || !bridge.inspectShapeDetailed
    || !bridge.exportSTEP || !bridge.importSTEP) return hold('HANDLER_UNAVAILABLE');
  const owned = new Map<string, OcctShape>();
  const own = (shape: OcctShape): OcctShape => { owned.set(shape.id, shape); return shape; };
  try {
    const { primary, branch } = request.parameters;
    const primaryResult = await bridge.buildPrismAt([
      { x: 0, y: 0 }, { x: primary.lengthMm, y: 0 },
      { x: primary.lengthMm, y: primary.widthMm }, { x: 0, y: primary.widthMm },
    ], 0, primary.heightMm);
    const branchResult = await bridge.buildPrismAt([
      { x: primary.lengthMm, y: 0 },
      { x: primary.lengthMm + branch.widthMm, y: 0 },
      { x: primary.lengthMm + branch.widthMm, y: branch.lengthMm },
      { x: primary.lengthMm, y: branch.lengthMm },
    ], 0, branch.heightMm);
    if (!primaryResult.ok || !primaryResult.shape || !branchResult.ok || !branchResult.shape) {
      return hold('MEMBER_BUILD_FAILED');
    }
    const primaryShape = own(primaryResult.shape);
    const branchShape = own(branchResult.shape);
    const compoundResult = await bridge.makeCompound([primaryShape, branchShape]);
    if (!compoundResult.ok || !compoundResult.shape) return hold('COMPOUND_BUILD_FAILED');
    const compound = own(compoundResult.shape);
    const resultInspection = await bridge.inspectShapeDetailed(compound);
    if (!resultInspection.valid) return hold('BREP_INVALID');
    if (!inspectionMatches(resultInspection, request)) return hold('FEATURE_INVARIANT_MISMATCH');
    if (resultInspection.productOccurrences?.status === 'available') return hold('FEATURE_INVARIANT_MISMATCH');

    let stepArtifact: string;
    try { stepArtifact = await bridge.exportSTEP(compound); } catch { return hold('STEP_EXPORT_FAILED'); }
    if (!stepArtifact.startsWith('ISO-10303-21;')
      || !stepArtifact.includes('ADVANCED_BREP_SHAPE_REPRESENTATION')) return hold('STEP_EXPORT_FAILED');
    if (new TextEncoder().encode(stepArtifact).byteLength > MAX_STEP_BYTES || overBudget()) {
      return hold('RESOURCE_LIMIT_EXCEEDED');
    }
    const imported = await bridge.importSTEP(stepArtifact);
    if (!imported.ok || !imported.shape) return hold('STEP_REIMPORT_FAILED');
    const importedShape = own(imported.shape);
    const roundtripInspection = await bridge.inspectShapeDetailed(importedShape);
    if (!inspectionMatches(roundtripInspection, request)) return hold('ROUNDTRIP_MISMATCH');

    const stepSha256 = hashString(stepArtifact);
    const cutList = buildCutList(request, requestSha256, stepSha256, runtime.identity.runtimeIdentitySha256);
    const cutListArtifact = canonicalCadConsumerDraftJson(cutList as unknown as CanonicalCadJsonValue);
    if (new TextEncoder().encode(cutListArtifact).byteLength > MAX_CUT_LIST_BYTES || overBudget()) {
      return hold('RESOURCE_LIMIT_EXCEEDED');
    }
    const core = {
      schema: BOUNDED_WELDMENT_RECEIPT_SCHEMA,
      status: 'EXACT_PASS' as const,
      featureId: 'cad.mechanical.weldment' as const,
      operationId: request.operationId,
      projectId: request.projectId,
      documentId: request.documentId,
      baseRevisionId: request.baseRevisionId,
      baseSequence: request.baseSequence,
      baseContentSha256: request.baseContentSha256,
      registryHash: FEATURE_REGISTRY_HASH,
      runtimeIdentitySha256: runtime.identity.runtimeIdentitySha256,
      requestSha256,
      resultInspectionSha256: hashCanonical(boundedInspectionSnapshot(resultInspection)),
      roundtripInspectionSha256: hashCanonical(boundedInspectionSnapshot(roundtripInspection)),
      stepSha256,
      cutListSha256: hashString(cutListArtifact),
      solidCount: 2 as const,
      compoundCount: 1 as const,
      cutListMemberCount: 2 as const,
      xcafOccurrenceVerification: 'NOT_RUN' as const,
      weldProcessAuthority: 'NOT_CLAIMED' as const,
      blockerCodes: [] as const,
      authoritativeCommit: false as const,
      commercialReleaseReady: false as const,
    };
    const receipt: BoundedWeldmentReceipt = Object.freeze({
      ...core,
      receiptSha256: hashCanonical(core),
    });
    return Object.freeze({
      status: 'EXACT_PASS' as const,
      blockerCodes: [] as const,
      receipt,
      stepArtifact,
      cutListArtifact,
    });
  } catch {
    return hold('COMPOUND_BUILD_FAILED');
  } finally {
    for (const shape of owned.values()) {
      try { bridge.release(shape); } catch { /* best-effort native cleanup */ }
    }
  }
}

function validateCutListArtifact(
  artifact: string,
  receipt: PlainRecord,
): boolean {
  try {
    const parsed = snapshot(JSON.parse(artifact));
    if (!isRecord(parsed)
      || parsed.schema !== BOUNDED_WELDMENT_CUT_LIST_SCHEMA
      || parsed.unit !== 'mm'
      || parsed.sourceRequestSha256 !== receipt.requestSha256
      || parsed.stepSha256 !== receipt.stepSha256
      || parsed.registryHash !== receipt.registryHash
      || parsed.runtimeIdentitySha256 !== receipt.runtimeIdentitySha256
      || !Array.isArray(parsed.members) || parsed.members.length !== 2
      || !isRecord(parsed.joint)
      || parsed.joint.weldBeadGeometry !== 'NOT_MODELLED'
      || parsed.joint.processSpecification !== 'NOT_AUTHORIZED') return false;
    return true;
  } catch {
    return false;
  }
}

/** Strict untrusted-boundary validator for receipt plus both artifacts. */
export function validateBoundedWeldmentResult(
  input: unknown,
  transportedStep?: unknown,
  transportedCutList?: unknown,
): input is BoundedWeldmentResult {
  try {
    const copied = snapshot(input);
    if (!isRecord(copied) || !exactKeys(copied, RESULT_KEYS)
      || (copied.status !== 'EXACT_PASS' && copied.status !== 'HOLD')
      || !Array.isArray(copied.blockerCodes)
      || copied.blockerCodes.some(code => typeof code !== 'string'
        || !BLOCKER_CODES.includes(code as BoundedWeldmentBlockerCode))) return false;
    if (copied.status === 'HOLD') {
      return copied.blockerCodes.length > 0 && copied.receipt === null
        && copied.stepArtifact === null && copied.cutListArtifact === null;
    }
    if (copied.blockerCodes.length !== 0 || typeof copied.stepArtifact !== 'string'
      || typeof copied.cutListArtifact !== 'string' || !isRecord(copied.receipt)) return false;
    const receipt = copied.receipt;
    if (!exactKeys(receipt, RECEIPT_KEYS)
      || receipt.schema !== BOUNDED_WELDMENT_RECEIPT_SCHEMA
      || receipt.status !== 'EXACT_PASS'
      || receipt.featureId !== 'cad.mechanical.weldment'
      || receipt.registryHash !== FEATURE_REGISTRY_HASH
      || receipt.solidCount !== 2 || receipt.compoundCount !== 1
      || receipt.cutListMemberCount !== 2
      || receipt.xcafOccurrenceVerification !== 'NOT_RUN'
      || receipt.weldProcessAuthority !== 'NOT_CLAIMED'
      || receipt.authoritativeCommit !== false || receipt.commercialReleaseReady !== false
      || !Array.isArray(receipt.blockerCodes) || receipt.blockerCodes.length !== 0
      || ![receipt.baseContentSha256, receipt.registryHash, receipt.runtimeIdentitySha256,
        receipt.requestSha256, receipt.resultInspectionSha256,
        receipt.roundtripInspectionSha256, receipt.stepSha256,
        receipt.cutListSha256, receipt.receiptSha256]
        .every(value => typeof value === 'string' && SHA256.test(value))) return false;
    if (hashString(copied.stepArtifact) !== receipt.stepSha256
      || hashString(copied.cutListArtifact) !== receipt.cutListSha256
      || (transportedStep !== undefined
        && (typeof transportedStep !== 'string' || hashString(transportedStep) !== receipt.stepSha256))
      || (transportedCutList !== undefined
        && (typeof transportedCutList !== 'string' || hashString(transportedCutList) !== receipt.cutListSha256))
      || !validateCutListArtifact(copied.cutListArtifact, receipt)) return false;
    const { receiptSha256: _receiptSha256, ...core } = receipt;
    return hashCanonical(core) === receipt.receiptSha256;
  } catch {
    return false;
  }
}
