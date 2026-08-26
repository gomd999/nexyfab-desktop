import { Sha256 } from '@aws-crypto/sha256-js';
import { canonicalCadConsumerDraftJson, type CanonicalCadJsonValue } from '@/lib/cad/canonicalCadV2ConsumerDraft';
import { decideFeatureExecution } from '@/lib/cad/featureRegistryDecision';
import {
  NATIVE_MECHANICAL_EXACT_REQUEST_SCHEMA,
  executeNativeMechanicalExactFeature,
  type BendExactRequest,
  type FlangeExactRequest,
} from './nativeMechanicalExactFeatureLoop';
import { loadNodeOcctCommercialRuntime } from './nodeOcctCommercialRuntime';
import type { OcctDetailedShapeInspection } from './bridge';
import type { OcctShape } from './types';

export const BOUNDED_SHEET_METAL_FLAT_PATTERN_REQUEST_SCHEMA = 'nexyfab.precision-cad.bounded-sheet-metal-flat-pattern-request.v1' as const;
export const BOUNDED_SHEET_METAL_FLAT_PATTERN_RECEIPT_SCHEMA = 'nexyfab.precision-cad.bounded-sheet-metal-flat-pattern-receipt.v1' as const;

export interface BoundedSheetMetalFlatPatternRequest {
  schema: typeof BOUNDED_SHEET_METAL_FLAT_PATTERN_REQUEST_SCHEMA;
  operationId: string;
  sourceRequest: BendExactRequest | FlangeExactRequest;
}

export interface BoundedSheetMetalFlatPatternReceipt {
  schema: typeof BOUNDED_SHEET_METAL_FLAT_PATTERN_RECEIPT_SCHEMA;
  status: 'EXACT_FLAT_PATTERN_PASS';
  verification: 'ACTUAL_NODE_OCCT_FACE_STEP_AND_DXF_REPARSE';
  release: 'HOLD';
  operationId: string;
  sourceFeatureId: 'cad.mechanical.bend' | 'cad.mechanical.flange';
  projectId: string;
  documentId: string;
  baseRevisionId: string;
  baseSequence: number;
  baseContentSha256: string;
  sourceReceiptSha256: string;
  sourceStepSha256: string;
  developedLengthMm: number;
  widthMm: number;
  bendLineMm: number;
  stepSha256: string;
  dxfSha256: string;
  commercialReleaseReady: false;
  receiptSha256: string;
}

export type BoundedSheetMetalFlatPatternResult =
  | { status: 'EXACT_FLAT_PATTERN_PASS'; blockerCodes: readonly []; receipt: BoundedSheetMetalFlatPatternReceipt; stepArtifact: string; dxfArtifact: string }
  | { status: 'HOLD'; blockerCodes: readonly string[]; receipt: null; stepArtifact: null; dxfArtifact: null };

export interface ParsedFlatPatternDxf {
  units: 'mm';
  lines: ReadonlyArray<{ layer: 'OUTLINE' | 'BEND_UP'; x1: number; y1: number; x2: number; y2: number }>;
}

const REQUEST_KEYS = ['schema', 'operationId', 'sourceRequest'] as const;
const RESULT_KEYS = ['status', 'blockerCodes', 'receipt', 'stepArtifact', 'dxfArtifact'] as const;
const RECEIPT_KEYS = [
  'schema', 'status', 'verification', 'release', 'operationId', 'sourceFeatureId',
  'projectId', 'documentId', 'baseRevisionId', 'baseSequence', 'baseContentSha256',
  'sourceReceiptSha256', 'sourceStepSha256', 'developedLengthMm', 'widthMm', 'bendLineMm',
  'stepSha256', 'dxfSha256', 'commercialReleaseReady', 'receiptSha256',
] as const;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024;

type PlainRecord = Record<string, unknown>;
const plain = (value: unknown): value is PlainRecord => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const exactKeys = (value: PlainRecord, keys: readonly string[]): boolean => {
  const own = Reflect.ownKeys(value);
  if (own.some(key => typeof key !== 'string' || !Object.getOwnPropertyDescriptor(value, key)?.enumerable)) return false;
  const actual = (own as string[]).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const sha256String = (value: string): string => {
  const hash = new Sha256(); hash.update(value);
  return [...hash.digestSync()].map(byte => byte.toString(16).padStart(2, '0')).join('');
};
const sha256Canonical = (value: unknown): string => sha256String(canonicalCadConsumerDraftJson(value as CanonicalCadJsonValue));
const hold = (...codes: string[]): BoundedSheetMetalFlatPatternResult => ({
  status: 'HOLD', blockerCodes: [...new Set(codes)], receipt: null, stepArtifact: null, dxfArtifact: null,
});

function flatDimensions(source: BendExactRequest | FlangeExactRequest): { length: number; width: number; bendLine: number } {
  if (source.featureId === 'cad.mechanical.bend') {
    return { length: source.parameters.host.lengthMm, width: source.parameters.host.widthMm, bendLine: source.parameters.fixedLengthMm };
  }
  const p = source.parameters;
  const arc = p.angleDeg * Math.PI / 180 * (p.innerRadiusMm + p.host.thicknessMm / 2);
  return { length: p.host.lengthMm + arc + p.straightLegLengthMm, width: p.host.widthMm, bendLine: p.host.lengthMm };
}

const pair = (code: number, value: string | number): string => `${code}\n${value}`;
const lineEntity = (layer: 'OUTLINE' | 'BEND_UP', x1: number, y1: number, x2: number, y2: number): string => [
  pair(0, 'LINE'), pair(8, layer), pair(10, x1), pair(20, y1), pair(30, 0),
  pair(11, x2), pair(21, y2), pair(31, 0),
].join('\n');

export function createBoundedFlatPatternDxf(length: number, width: number, bendLine: number): string {
  return [
    pair(0, 'SECTION'), pair(2, 'HEADER'), pair(9, '$INSUNITS'), pair(70, 4), pair(0, 'ENDSEC'),
    pair(0, 'SECTION'), pair(2, 'ENTITIES'),
    lineEntity('OUTLINE', 0, 0, length, 0), lineEntity('OUTLINE', length, 0, length, width),
    lineEntity('OUTLINE', length, width, 0, width), lineEntity('OUTLINE', 0, width, 0, 0),
    lineEntity('BEND_UP', bendLine, 0, bendLine, width),
    pair(0, 'ENDSEC'), pair(0, 'EOF'), '',
  ].join('\n');
}

export function parseBoundedFlatPatternDxf(source: unknown): ParsedFlatPatternDxf | null {
  if (typeof source !== 'string' || source.length === 0 || source.length > MAX_ARTIFACT_BYTES) return null;
  const rows = source.replace(/\r/g, '').split('\n');
  if (rows.at(-1) === '') rows.pop();
  if (rows.length % 2 !== 0) return null;
  const pairs = Array.from({ length: rows.length / 2 }, (_, index) => ({
    code: Number(rows[index * 2]), value: rows[index * 2 + 1]!,
  }));
  if (pairs.some(item => !Number.isInteger(item.code))
    || !pairs.some((item, index) => item.code === 9 && item.value === '$INSUNITS'
      && pairs[index + 1]?.code === 70 && pairs[index + 1]?.value === '4')) return null;
  const lines: ParsedFlatPatternDxf['lines'][number][] = [];
  for (let index = 0; index < pairs.length; index += 1) {
    if (pairs[index]?.code !== 0 || pairs[index]?.value !== 'LINE') continue;
    const entity = pairs.slice(index + 1, index + 8);
    const expectedCodes = [8, 10, 20, 30, 11, 21, 31];
    if (entity.length !== expectedCodes.length || entity.some((item, offset) => item.code !== expectedCodes[offset])) return null;
    const layer = entity[0]!.value;
    const numbers = entity.slice(1).map(item => Number(item.value));
    if ((layer !== 'OUTLINE' && layer !== 'BEND_UP') || numbers.some(value => !Number.isFinite(value))
      || numbers[2] !== 0 || numbers[5] !== 0) return null;
    lines.push({ layer, x1: numbers[0]!, y1: numbers[1]!, x2: numbers[3]!, y2: numbers[4]! });
    index += 7;
  }
  return lines.length === 5 && lines.filter(line => line.layer === 'OUTLINE').length === 4
    && lines.filter(line => line.layer === 'BEND_UP').length === 1
    ? { units: 'mm', lines }
    : null;
}

function faceValid(inspection: OcctDetailedShapeInspection, area: number): boolean {
  const adjacency = inspection.faceAdjacency;
  return inspection.valid && inspection.solidCount === 0 && inspection.faceCount === 1 && inspection.edgeCount === 4
    && Math.abs(inspection.absoluteVolume) <= 1e-12
    && Math.abs(inspection.surfaceArea - area) / area <= 1e-7
    && inspection.surfaceTypes.status === 'available' && inspection.surfaceTypes.counts.plane === 1
    && adjacency.status === 'available' && adjacency.boundaryEdgeCount === 4 && adjacency.nonManifoldEdgeCount === 0;
}

function clonedRequest(input: unknown): BoundedSheetMetalFlatPatternRequest | null {
  try {
    const copied = structuredClone(input);
    if (!plain(copied) || !exactKeys(copied, REQUEST_KEYS)
      || copied.schema !== BOUNDED_SHEET_METAL_FLAT_PATTERN_REQUEST_SCHEMA
      || typeof copied.operationId !== 'string' || !SAFE_ID.test(copied.operationId)
      || !plain(copied.sourceRequest)
      || copied.sourceRequest.schema !== NATIVE_MECHANICAL_EXACT_REQUEST_SCHEMA
      || (copied.sourceRequest.featureId !== 'cad.mechanical.bend' && copied.sourceRequest.featureId !== 'cad.mechanical.flange')) return null;
    return copied as unknown as BoundedSheetMetalFlatPatternRequest;
  } catch { return null; }
}

export async function executeBoundedSheetMetalFlatPattern(input: unknown): Promise<BoundedSheetMetalFlatPatternResult> {
  const request = clonedRequest(input);
  if (!request) return hold('INVALID_REQUEST');
  const source = await executeNativeMechanicalExactFeature(request.sourceRequest);
  if (source.status !== 'EXACT_PASS') return hold('SOURCE_EXACT_HOLD');
  const dimensions = flatDimensions(request.sourceRequest);
  if (![dimensions.length, dimensions.width, dimensions.bendLine].every(Number.isFinite)
    || !(dimensions.length > 0) || !(dimensions.width > 0)
    || !(dimensions.bendLine > 0 && dimensions.bendLine < dimensions.length)) return hold('FLAT_DIMENSIONS_INVALID');
  const runtime = await loadNodeOcctCommercialRuntime();
  if (!runtime.ok) return hold('RUNTIME_UNAVAILABLE');
  if (decideFeatureExecution({
    featureId: 'cad.mechanical.flat-pattern', intent: 'AUTHORITATIVE', runtime: runtime.capabilities,
  }).status !== 'ALLOW_EXACT') return hold('REGISTRY_HOLD');
  const { bridge } = runtime;
  if (!bridge.buildPlanarFace || !bridge.inspectShapeDetailed || !bridge.exportSTEP || !bridge.importSTEP) return hold('HANDLER_UNAVAILABLE');
  const owned: OcctShape[] = [];
  try {
    const flat = await bridge.buildPlanarFace([
      { x: 0, y: 0 }, { x: dimensions.length, y: 0 },
      { x: dimensions.length, y: dimensions.width }, { x: 0, y: dimensions.width },
    ], 0);
    if (!flat.ok || !flat.shape) return hold('FACE_BUILD_FAILED');
    owned.push(flat.shape);
    const area = dimensions.length * dimensions.width;
    if (!faceValid(await bridge.inspectShapeDetailed(flat.shape), area)) return hold('FACE_INVARIANT_MISMATCH');
    const step = await bridge.exportSTEP(flat.shape);
    if (!step.startsWith('ISO-10303-21;') || !step.includes('ADVANCED_FACE')
      || new TextEncoder().encode(step).byteLength > MAX_ARTIFACT_BYTES) return hold('STEP_EXPORT_FAILED');
    const imported = await bridge.importSTEP(step);
    if (!imported.ok || !imported.shape) return hold('STEP_REIMPORT_FAILED');
    owned.push(imported.shape);
    if (!faceValid(await bridge.inspectShapeDetailed(imported.shape), area)) return hold('STEP_ROUNDTRIP_MISMATCH');
    const dxf = createBoundedFlatPatternDxf(dimensions.length, dimensions.width, dimensions.bendLine);
    const parsed = parseBoundedFlatPatternDxf(dxf);
    if (!parsed) return hold('DXF_REPARSE_FAILED');
    const core = {
      schema: BOUNDED_SHEET_METAL_FLAT_PATTERN_RECEIPT_SCHEMA,
      status: 'EXACT_FLAT_PATTERN_PASS' as const,
      verification: 'ACTUAL_NODE_OCCT_FACE_STEP_AND_DXF_REPARSE' as const,
      release: 'HOLD' as const,
      operationId: request.operationId,
      sourceFeatureId: request.sourceRequest.featureId,
      projectId: request.sourceRequest.projectId,
      documentId: request.sourceRequest.documentId,
      baseRevisionId: request.sourceRequest.baseRevisionId,
      baseSequence: request.sourceRequest.baseSequence,
      baseContentSha256: request.sourceRequest.baseContentSha256,
      sourceReceiptSha256: source.receipt.receiptSha256,
      sourceStepSha256: source.receipt.stepSha256,
      developedLengthMm: dimensions.length,
      widthMm: dimensions.width,
      bendLineMm: dimensions.bendLine,
      stepSha256: sha256String(step),
      dxfSha256: sha256String(dxf),
      commercialReleaseReady: false as const,
    };
    const receipt = Object.freeze({ ...core, receiptSha256: sha256Canonical(core) });
    return { status: 'EXACT_FLAT_PATTERN_PASS', blockerCodes: [], receipt, stepArtifact: step, dxfArtifact: dxf };
  } catch { return hold('FLAT_PATTERN_EXECUTION_FAILED'); }
  finally { for (const shape of owned) { try { bridge.release(shape); } catch { /* best effort */ } } }
}

export function validateBoundedSheetMetalFlatPatternResult(input: unknown): input is BoundedSheetMetalFlatPatternResult {
  try {
    const copied = structuredClone(input);
    if (!plain(copied) || !exactKeys(copied, RESULT_KEYS)
      || copied.status !== 'EXACT_FLAT_PATTERN_PASS' || !Array.isArray(copied.blockerCodes) || copied.blockerCodes.length !== 0
      || typeof copied.stepArtifact !== 'string' || typeof copied.dxfArtifact !== 'string'
      || !plain(copied.receipt) || !parseBoundedFlatPatternDxf(copied.dxfArtifact)) return false;
    const receipt = copied.receipt;
    if (!exactKeys(receipt, RECEIPT_KEYS)
      || receipt.schema !== BOUNDED_SHEET_METAL_FLAT_PATTERN_RECEIPT_SCHEMA
      || receipt.status !== 'EXACT_FLAT_PATTERN_PASS'
      || receipt.verification !== 'ACTUAL_NODE_OCCT_FACE_STEP_AND_DXF_REPARSE'
      || receipt.release !== 'HOLD' || receipt.commercialReleaseReady !== false
      || typeof receipt.stepSha256 !== 'string' || !SHA256.test(receipt.stepSha256)
      || typeof receipt.dxfSha256 !== 'string' || !SHA256.test(receipt.dxfSha256)
      || receipt.stepSha256 !== sha256String(copied.stepArtifact)
      || receipt.dxfSha256 !== sha256String(copied.dxfArtifact)
      || typeof receipt.receiptSha256 !== 'string' || !SHA256.test(receipt.receiptSha256)) return false;
    const { receiptSha256, ...core } = receipt;
    return sha256Canonical(core) === receiptSha256;
  } catch { return false; }
}
