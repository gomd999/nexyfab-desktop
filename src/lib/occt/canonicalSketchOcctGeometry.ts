import { Sha256 } from '@aws-crypto/sha256-js';
import { canonicalCadConsumerDraftJson, type CanonicalCadJsonValue } from '@/lib/cad/canonicalCadV2ConsumerDraft';
import { decideFeatureExecution } from '@/lib/cad/featureRegistryDecision';
import {
  verifyCanonicalSketchPreflight,
  type CanonicalSketchPlane,
  type CanonicalSketchPoint,
  type CanonicalSketchPreflightPass,
} from '@/lib/cad/canonicalSketchPreflight';
import { loadNodeOcctCommercialRuntime } from './nodeOcctCommercialRuntime';
import type { OcctDetailedShapeInspection } from './bridge';
import type { OcctShape } from './types';

export const CANONICAL_SKETCH_OCCT_GEOMETRY_SCHEMA = 'nexyfab.precision-cad.canonical-sketch-occt-geometry.v1' as const;

export interface CanonicalSketchOcctGeometryReceipt {
  schema: typeof CANONICAL_SKETCH_OCCT_GEOMETRY_SCHEMA;
  status: 'GEOMETRY_PASS';
  verification: 'ACTUAL_NODE_OCCT_PLANAR_FACE_STEP';
  release: 'HOLD';
  projectId: string;
  documentId: string;
  revisionId: string;
  revisionSequence: number;
  revisionContentSha256: string;
  sketchId: string;
  plane: CanonicalSketchPlane;
  canonicalSketchSha256: string;
  runtimeIdentitySha256: string;
  areaMm2: number;
  perimeterMm: number;
  boundaryEdgeCount: number;
  stepSha256: string;
  commercialReleaseReady: false;
  receiptSha256: string;
}

export type CanonicalSketchOcctGeometryResult =
  | { status: 'GEOMETRY_PASS'; blockerCodes: readonly []; receipt: CanonicalSketchOcctGeometryReceipt; stepArtifact: string }
  | { status: 'HOLD'; blockerCodes: readonly string[]; receipt: null; stepArtifact: null };

const MAX_POINTS = 32;
const MAX_STEP_BYTES = 4 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const RECEIPT_KEYS = [
  'schema', 'status', 'verification', 'release', 'projectId', 'documentId', 'revisionId',
  'revisionSequence', 'revisionContentSha256', 'sketchId', 'plane', 'canonicalSketchSha256',
  'runtimeIdentitySha256', 'areaMm2', 'perimeterMm', 'boundaryEdgeCount', 'stepSha256',
  'commercialReleaseReady', 'receiptSha256',
] as const;
const RESULT_KEYS = ['status', 'blockerCodes', 'receipt', 'stepArtifact'] as const;

type PlainRecord = Record<string, unknown>;

function exactKeys(value: PlainRecord, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string' || !Object.getOwnPropertyDescriptor(value, key)?.enumerable)) return false;
  const actual = (keys as string[]).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function plain(value: unknown): value is PlainRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sha256String(value: string): string {
  const hash = new Sha256();
  hash.update(value);
  return [...hash.digestSync()].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function sha256Canonical(value: unknown): string {
  return sha256String(canonicalCadConsumerDraftJson(value as CanonicalCadJsonValue));
}

function hold(...codes: string[]): CanonicalSketchOcctGeometryResult {
  return { status: 'HOLD', blockerCodes: [...new Set(codes)], receipt: null, stepArtifact: null };
}

function orderedLoop(preflight: CanonicalSketchPreflightPass): CanonicalSketchPoint[] | null {
  const byId = new Map(preflight.points.map(point => [point.id, point]));
  const points = preflight.loop.pointIds.map(id => byId.get(id));
  return points.every((point): point is CanonicalSketchPoint => !!point) ? points : null;
}

function analytic(loop: readonly CanonicalSketchPoint[]): { area: number; perimeter: number } | null {
  let twiceArea = 0;
  let perimeter = 0;
  for (let index = 0; index < loop.length; index += 1) {
    const a = loop[index]!;
    const b = loop[(index + 1) % loop.length]!;
    twiceArea += a.x * b.y - b.x * a.y;
    perimeter += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const area = Math.abs(twiceArea) / 2;
  return Number.isFinite(area) && area > 0 && Number.isFinite(perimeter) && perimeter > 0
    ? { area, perimeter }
    : null;
}

function geometryValid(
  inspection: OcctDetailedShapeInspection,
  plane: CanonicalSketchPlane,
  edgeCount: number,
  area: number,
): boolean {
  const areaError = Math.abs(inspection.surfaceArea - area) / area;
  const normalSpan = plane === 'XY'
    ? inspection.bbox.max.z - inspection.bbox.min.z
    : plane === 'XZ'
      ? inspection.bbox.max.y - inspection.bbox.min.y
      : inspection.bbox.max.x - inspection.bbox.min.x;
  const adjacency = inspection.faceAdjacency;
  return inspection.valid && inspection.solidCount === 0 && inspection.faceCount === 1
    && inspection.edgeCount === edgeCount && inspection.absoluteVolume === 0
    && areaError <= 1e-7 && Math.abs(normalSpan) <= 1e-6
    && inspection.surfaceTypes.status === 'available'
    && inspection.surfaceTypes.counts.plane === 1
    && Object.keys(inspection.surfaceTypes.counts).length === 1
    && adjacency.status === 'available'
    && adjacency.faceCount === 1 && adjacency.uniqueEdgeCount === edgeCount
    && adjacency.boundaryEdgeCount === edgeCount && adjacency.nonManifoldEdgeCount === 0;
}

function clonePreflight(input: unknown): CanonicalSketchPreflightPass | null {
  try {
    const copied = structuredClone(input);
    if (!verifyCanonicalSketchPreflight(copied)) return null;
    return copied as CanonicalSketchPreflightPass;
  } catch {
    return null;
  }
}

/**
 * Native geometry evidence only. This does not upgrade solver status,
 * fully-constrained status, canonical commit authority, or product release.
 */
export async function executeCanonicalSketchOcctGeometry(input: unknown): Promise<CanonicalSketchOcctGeometryResult> {
  const preflight = clonePreflight(input);
  if (!preflight || preflight.points.length > MAX_POINTS) return hold('PREFLIGHT_INVALID');
  const loop = orderedLoop(preflight);
  const expected = loop ? analytic(loop) : null;
  if (!loop || !expected) return hold('PROFILE_INVALID');
  const runtime = await loadNodeOcctCommercialRuntime();
  if (!runtime.ok) return hold('RUNTIME_UNAVAILABLE');
  if (decideFeatureExecution({
    featureId: 'cad.mechanical.sketch', intent: 'AUTHORITATIVE', runtime: runtime.capabilities,
  }).status !== 'ALLOW_EXACT') return hold('REGISTRY_HOLD');
  const { bridge } = runtime;
  if (!bridge.inspectShapeDetailed || !bridge.exportSTEP || !bridge.importSTEP) return hold('HANDLER_UNAVAILABLE');
  const owned: OcctShape[] = [];
  try {
    const loop2d = loop.map(point => ({ x: point.x, y: point.y }));
    const built = preflight.plane === 'XY'
      ? await bridge.buildPlanarFace?.(loop2d, 0)
      : await bridge.buildPlanarFaceOriented?.(
        loop2d,
        [0, 0, 0],
        preflight.plane === 'XZ' ? [0, 1, 0] : [1, 0, 0],
      );
    if (!built?.ok || !built.shape) return hold('FACE_BUILD_FAILED');
    owned.push(built.shape);
    const inspection = await bridge.inspectShapeDetailed(built.shape);
    if (!geometryValid(inspection, preflight.plane, loop.length, expected.area)) return hold('GEOMETRY_INVARIANT_MISMATCH');
    let step: string;
    try { step = await bridge.exportSTEP(built.shape); } catch { return hold('STEP_EXPORT_FAILED'); }
    if (!step.startsWith('ISO-10303-21;') || !step.includes('ADVANCED_FACE')
      || new TextEncoder().encode(step).byteLength > MAX_STEP_BYTES) return hold('STEP_EXPORT_FAILED');
    const imported = await bridge.importSTEP(step);
    if (!imported.ok || !imported.shape) return hold('STEP_REIMPORT_FAILED');
    owned.push(imported.shape);
    const roundtrip = await bridge.inspectShapeDetailed(imported.shape);
    if (!geometryValid(roundtrip, preflight.plane, loop.length, expected.area)) return hold('STEP_ROUNDTRIP_MISMATCH');
    const core = {
      schema: CANONICAL_SKETCH_OCCT_GEOMETRY_SCHEMA,
      status: 'GEOMETRY_PASS' as const,
      verification: 'ACTUAL_NODE_OCCT_PLANAR_FACE_STEP' as const,
      release: 'HOLD' as const,
      projectId: preflight.projectId,
      documentId: preflight.documentId,
      revisionId: preflight.currentRevision.revisionId,
      revisionSequence: preflight.currentRevision.sequence,
      revisionContentSha256: preflight.currentRevision.contentSha256,
      sketchId: preflight.sketchId,
      plane: preflight.plane,
      canonicalSketchSha256: preflight.canonicalSketchSha256,
      runtimeIdentitySha256: runtime.identity.runtimeIdentitySha256,
      areaMm2: expected.area,
      perimeterMm: expected.perimeter,
      boundaryEdgeCount: loop.length,
      stepSha256: sha256String(step),
      commercialReleaseReady: false as const,
    };
    const receipt = Object.freeze({ ...core, receiptSha256: sha256Canonical(core) });
    return { status: 'GEOMETRY_PASS', blockerCodes: [], receipt, stepArtifact: step };
  } catch {
    return hold('GEOMETRY_EXECUTION_FAILED');
  } finally {
    for (const shape of owned) {
      try { bridge.release(shape); } catch { /* best-effort native cleanup */ }
    }
  }
}

export function validateCanonicalSketchOcctGeometryResult(input: unknown): input is CanonicalSketchOcctGeometryResult {
  try {
    const copied = structuredClone(input);
    if (!plain(copied) || !exactKeys(copied, RESULT_KEYS)
      || copied.status !== 'GEOMETRY_PASS' || !Array.isArray(copied.blockerCodes) || copied.blockerCodes.length !== 0
      || typeof copied.stepArtifact !== 'string' || !copied.stepArtifact.startsWith('ISO-10303-21;')
      || !copied.stepArtifact.includes('ADVANCED_FACE') || !plain(copied.receipt)) return false;
    const receipt = copied.receipt;
    if (!exactKeys(receipt, RECEIPT_KEYS)
      || receipt.schema !== CANONICAL_SKETCH_OCCT_GEOMETRY_SCHEMA
      || receipt.status !== 'GEOMETRY_PASS' || receipt.verification !== 'ACTUAL_NODE_OCCT_PLANAR_FACE_STEP'
      || receipt.release !== 'HOLD' || receipt.commercialReleaseReady !== false
      || typeof receipt.stepSha256 !== 'string' || !SHA256.test(receipt.stepSha256)
      || receipt.stepSha256 !== sha256String(copied.stepArtifact)
      || typeof receipt.receiptSha256 !== 'string' || !SHA256.test(receipt.receiptSha256)) return false;
    const { receiptSha256, ...core } = receipt;
    return sha256Canonical(core) === receiptSha256;
  } catch {
    return false;
  }
}
