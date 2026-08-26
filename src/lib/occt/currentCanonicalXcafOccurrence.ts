import { createHash } from 'node:crypto';
import { canonicalCadConsumerDraftJson } from '../cad/canonicalCadV2ConsumerDraft';
import {
  adaptXcafInspectionToCanonicalDraft,
} from './xcafDocumentAdapter';
import type { XcafInspectionResult } from './xcafCanonicalBinding';

export const CURRENT_CANONICAL_XCAF_OCCURRENCE_SCHEMA =
  'nexyfab.precision-cad.current-head-xcaf-occurrence-envelope.v1' as const;

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_NODES = 100_000;
const MAX_DEPTH = 48;
const MAX_ARRAY_ITEMS = 4_096;
const MAX_STRING_BYTES = 8 * 1024 * 1024;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const ENVELOPE_KEYS = [
  'schema', 'status', 'authority', 'verification', 'release', 'geometryIdentity',
  'source', 'occurrence', 'evidence', 'envelopeSha256',
] as const;
const SOURCE_KEYS = [
  'projectId', 'documentId', 'partId', 'revision', 'stepSha256',
  'bundleArtifactStepSha256', 'bundleArtifactManifestSha256',
  'rightsReceiptRevision', 'rightsReceiptSha256',
] as const;
const REVISION_KEYS = ['revisionId', 'sequence', 'contentSha256'] as const;
const OCCURRENCE_KEYS = [
  'objectId', 'entry', 'occurrencePath', 'referredEntry',
  'semanticSha256', 'geometrySummarySha256', 'shape',
] as const;
const SHAPE_KEYS = ['solidCount', 'brepValid', 'nonManifoldEdgeCount', 'volumeMm3'] as const;
const EVIDENCE_KEYS = [
  'inputSha256', 'nativeBinarySha256', 'nativeInvocationSha256',
  'xcafRevisionBindingSha256', 'workerStatus', 'kernelStatus',
] as const;
const ARTIFACT_KEYS = [
  'stepSha256', 'drawingSha256', 'dimensionsSha256', 'bomSha256',
  'runtimeIdentitySha256', 'featureRegistrySha256',
] as const;

type PlainRecord = Record<string, unknown>;

/** The validated bundle is intentionally consumed structurally to keep this
 * pure envelope helper below the app/drawing dependency layer. */
export interface CurrentCanonicalMechanicalBundleReference {
  schema: string;
  status: string;
  authority: string;
  verification: string;
  release: string;
  manufacturingRelease: string;
  source: {
    projectId: string;
    documentId: string;
    revision: { revisionId: string; sequence: number; contentSha256: string };
    partId: string;
    featureTreeSha256: string;
    rightsReceiptRevision: string;
    rightsReceiptSha256: string;
  };
  artifacts: Record<string, string> & { stepSha256: string };
  artifactManifestSha256: string;
  handoff: {
    assembly?: { featureTrees: Record<string, unknown> };
    exactSinglePart?: {
      part: { id: string };
      step: { sha256: string };
      source: {
        partFeatureTreeSha256?: string;
        canonicalRevision?: {
        schema: string;
        documentId: string;
        revisionId: string;
        sequence: number;
        contentSha256: string;
        };
      };
    };
  };
}

export interface CurrentCanonicalMechanicalBundleV2Reference
  extends Omit<CurrentCanonicalMechanicalBundleReference, 'source'> {
  source: CurrentCanonicalMechanicalBundleReference['source'] & {
    featureTreeSchema: 'nexyfab.precision-cad.mechanical-single-part-feature-tree.v2';
    treatmentKind: 'fillet' | 'chamfer';
    stableEdgeRefsSha256: string;
  };
}

export interface CurrentCanonicalXcafOccurrenceEnvelope {
  schema: typeof CURRENT_CANONICAL_XCAF_OCCURRENCE_SCHEMA;
  status: 'PASS_NATIVE_INVOCATION_BOUND';
  authority: 'SERVER_CURRENT_CANONICAL_HEAD';
  verification: 'XCAF_OCCURRENCE_IDENTITY_ONLY';
  release: 'HOLD';
  geometryIdentity: 'NOT_EXPOSED_BY_BINDING';
  source: {
    projectId: string;
    documentId: string;
    partId: string;
    revision: { revisionId: string; sequence: number; contentSha256: string };
    stepSha256: string;
    bundleArtifactStepSha256: string;
    bundleArtifactManifestSha256: string;
    rightsReceiptRevision: string;
    rightsReceiptSha256: string;
  };
  occurrence: {
    objectId: string;
    entry: string;
    occurrencePath: string;
    referredEntry: string | null;
    semanticSha256: string;
    geometrySummarySha256: string;
    shape: {
      solidCount: 1;
      brepValid: true;
      nonManifoldEdgeCount: 0;
      volumeMm3: number;
    };
  };
  evidence: {
    inputSha256: string;
    nativeBinarySha256: string;
    nativeInvocationSha256: string;
    xcafRevisionBindingSha256: string;
    workerStatus: 'PASS_NATIVE_INVOCATION_BOUND';
    kernelStatus: 'NATIVE_CLAIM_DYNAMIC_LINKAGE_UNBOUND';
  };
  envelopeSha256: string;
}

export type CurrentCanonicalXcafOccurrenceResult =
  | CurrentCanonicalXcafOccurrenceEnvelope
  | {
      schema: typeof CURRENT_CANONICAL_XCAF_OCCURRENCE_SCHEMA;
      status: 'HOLD';
      release: 'HOLD';
      blockers: readonly string[];
    };

export interface BuildCurrentCanonicalXcafOccurrenceInput {
  bundle: CurrentCanonicalMechanicalBundleReference;
  inspection: XcafInspectionResult;
}

export interface BuildCurrentCanonicalXcafOccurrenceV2Input {
  bundle: CurrentCanonicalMechanicalBundleV2Reference;
  inspection: XcafInspectionResult;
}

export type CurrentCanonicalXcafOccurrenceValidation =
  | { ok: true; envelope: CurrentCanonicalXcafOccurrenceEnvelope }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is PlainRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: PlainRecord, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string')) return false;
  const actual = (keys as string[]).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

/** Descriptor-safe bounded copy. Hidden/symbol/accessor properties are not
 * part of a trusted CAD evidence boundary, even when they are otherwise
 * ignored by Object.keys(). */
function snapshot(value: unknown, seen = new Set<object>(), budget = { nodes: 0 }, depth = 0): unknown {
  if (++budget.nodes > MAX_NODES) throw new Error('snapshot_limit');
  if (depth > MAX_DEPTH) throw new Error('snapshot_depth');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > MAX_STRING_BYTES) throw new Error('snapshot_string');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('snapshot_number');
    return value;
  }
  if (typeof value !== 'object' || seen.has(value)) throw new Error('snapshot_type');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_ITEMS) throw new Error('snapshot_array_length');
      const keys = Reflect.ownKeys(value);
      if (keys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)))) throw new Error('snapshot_array_key');
      return value.map((_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error('snapshot_accessor');
        return snapshot(descriptor.value, seen, budget, depth + 1);
      });
    }
    if (!isRecord(value)) throw new Error('snapshot_object');
    const keys = Reflect.ownKeys(value);
    if (keys.length > MAX_NODES || keys.some(key => typeof key !== 'string' || FORBIDDEN_KEYS.has(key))) throw new Error('snapshot_object_key');
    const result: PlainRecord = {};
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error('snapshot_accessor');
      result[key] = snapshot(descriptor.value, seen, budget, depth + 1);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function sha256Canonical(value: unknown): string {
  return createHash('sha256')
    .update(canonicalCadConsumerDraftJson(value as never), 'utf8')
    .digest('hex');
}

function hold(...blockers: string[]): CurrentCanonicalXcafOccurrenceResult {
  return {
    schema: CURRENT_CANONICAL_XCAF_OCCURRENCE_SCHEMA,
    status: 'HOLD',
    release: 'HOLD',
    blockers: [...new Set(blockers)],
  };
}

function sha(value: unknown): value is string {
  return typeof value === 'string' && SHA256.test(value);
}

function validateBundleReference(bundle: unknown, version: 'v1' | 'v2'): string[] {
  if (!isRecord(bundle)) return ['BUNDLE_INVALID'];
  if (!exactKeys(bundle, ['schema', 'status', 'authority', 'verification', 'release', 'manufacturingRelease', 'source', 'artifacts', 'artifactManifestSha256', 'handoff'])) return ['BUNDLE_KEYS_INVALID'];
  const expectedSchema = version === 'v1'
    ? 'nexyfab.precision-cad.current-canonical-mechanical-artifact-bundle.v1'
    : 'nexyfab.precision-cad.current-canonical-mechanical-artifact-bundle.v2';
  const expectedStatus = version === 'v1' ? 'EXACT_BUNDLE_PASS' : 'EXACT_BUNDLE_V2_PASS';
  if (bundle.schema !== expectedSchema
    || bundle.status !== expectedStatus
    || bundle.authority !== 'SERVER_CURRENT_CANONICAL_HEAD'
    || bundle.verification !== 'NATIVE_OCCT_STEP_ROUNDTRIP_AND_HLR'
    || bundle.release !== 'HOLD' || bundle.manufacturingRelease !== 'BLOCKED') return ['BUNDLE_NOT_VERIFIED'];
  const source = bundle.source;
  const sourceKeys = version === 'v1'
    ? ['projectId', 'documentId', 'revision', 'partId', 'featureTreeSha256', 'rightsReceiptRevision', 'rightsReceiptSha256']
    : ['projectId', 'documentId', 'revision', 'partId', 'featureTreeSchema', 'featureTreeSha256', 'rightsReceiptRevision', 'rightsReceiptSha256', 'treatmentKind', 'stableEdgeRefsSha256'];
  if (!isRecord(source) || !exactKeys(source, sourceKeys)) return ['BUNDLE_SOURCE_INVALID'];
  const revision = source.revision;
  const revisionRecord = revision as PlainRecord;
  if (!isRecord(revision) || !exactKeys(revision, REVISION_KEYS)
    || typeof revisionRecord.revisionId !== 'string' || !SAFE_ID.test(revisionRecord.revisionId)
    || typeof revisionRecord.sequence !== 'number' || !Number.isSafeInteger(revisionRecord.sequence) || revisionRecord.sequence < 0
    || !sha(revisionRecord.contentSha256)) return ['BUNDLE_REVISION_INVALID'];
  if (![source.projectId, source.documentId, source.partId, source.rightsReceiptRevision].every(value => typeof value === 'string' && SAFE_ID.test(value))
    || !sha(source.featureTreeSha256) || !sha(source.rightsReceiptSha256)) return ['BUNDLE_SOURCE_VALUE_INVALID'];
  if (version === 'v2' && (source.featureTreeSchema !== 'nexyfab.precision-cad.mechanical-single-part-feature-tree.v2'
    || (source.treatmentKind !== 'fillet' && source.treatmentKind !== 'chamfer')
    || !sha(source.stableEdgeRefsSha256))) return ['BUNDLE_SOURCE_VALUE_INVALID'];
  const artifacts = bundle.artifacts;
  if (!isRecord(artifacts) || !exactKeys(artifacts, ARTIFACT_KEYS)
    || Object.values(artifacts).some(value => !sha(value))) return ['BUNDLE_ARTIFACTS_INVALID'];
  if (!sha(bundle.artifactManifestSha256)) return ['BUNDLE_MANIFEST_INVALID'];
  const manifest = sha256Canonical({
    schema: bundle.schema,
    source,
    artifacts,
  });
  if (manifest !== bundle.artifactManifestSha256) return ['BUNDLE_MANIFEST_HASH_MISMATCH'];
  const handoff = bundle.handoff;
  if (!isRecord(handoff) || !isRecord(handoff.exactSinglePart)) return ['BUNDLE_EXACT_PART_MISSING'];
  const exact = handoff.exactSinglePart;
  if (!isRecord(exact.part) || !isRecord(exact.step) || !isRecord(exact.source)
    || typeof exact.part.id !== 'string' || !SAFE_ID.test(exact.part.id)
    || !sha(exact.step.sha256) || !isRecord(exact.source.canonicalRevision)) return ['BUNDLE_EXACT_PART_INVALID'];
  const canonical = exact.source.canonicalRevision;
  if (!isRecord(canonical) || !exactKeys(canonical, ['schema', 'documentId', 'revisionId', 'sequence', 'contentSha256'])
    || canonical.schema !== 'nexyfab.precision-cad.canonical-drawing-revision-binding.v1'
    || canonical.documentId !== source.documentId || canonical.revisionId !== revisionRecord.revisionId
    || canonical.sequence !== revisionRecord.sequence || canonical.contentSha256 !== revisionRecord.contentSha256) return ['BUNDLE_HANDOFF_REVISION_INVALID'];
  if (exact.part.id !== source.partId || exact.step.sha256 !== artifacts.stepSha256) return ['BUNDLE_STEP_BINDING_INVALID'];
  if (version === 'v2' && (exact.source.partFeatureTreeSha256 !== source.featureTreeSha256
    || !sha(exact.source.partFeatureTreeSha256))) return ['BUNDLE_FEATURE_TREE_BINDING_INVALID'];
  if (version === 'v2') {
    if (!isRecord(handoff.assembly) || !isRecord(handoff.assembly.featureTrees)) {
      return ['BUNDLE_FEATURE_TREE_BINDING_INVALID'];
    }
    const tree = handoff.assembly.featureTrees[source.partId as string];
    if (!isRecord(tree) || sha256Canonical(tree) !== source.featureTreeSha256
      || !Array.isArray(tree.nodes) || tree.nodes.length !== 3) {
      return ['BUNDLE_FEATURE_TREE_BINDING_INVALID'];
    }
    const treatment = tree.nodes[1];
    const payload = isRecord(treatment) ? treatment.payload : null;
    if (!isRecord(payload) || payload.kind !== source.treatmentKind
      || !Array.isArray(payload.edgeRefs)
      || sha256Canonical(payload.edgeRefs) !== source.stableEdgeRefsSha256) {
      return ['BUNDLE_EDGE_AUTHORITY_BINDING_INVALID'];
    }
  }
  return [];
}

function validateEnvelopeShape(value: PlainRecord): string | null {
  if (!exactKeys(value, ENVELOPE_KEYS)
    || value.schema !== CURRENT_CANONICAL_XCAF_OCCURRENCE_SCHEMA
    || value.status !== 'PASS_NATIVE_INVOCATION_BOUND'
    || value.authority !== 'SERVER_CURRENT_CANONICAL_HEAD'
    || value.verification !== 'XCAF_OCCURRENCE_IDENTITY_ONLY'
    || value.release !== 'HOLD'
    || value.geometryIdentity !== 'NOT_EXPOSED_BY_BINDING') return 'ENVELOPE_VALUE_INVALID';
  const source = value.source;
  const revision = isRecord(source) ? source.revision : null;
  if (!isRecord(source) || !exactKeys(source, SOURCE_KEYS) || !isRecord(revision) || !exactKeys(revision, REVISION_KEYS)) return 'ENVELOPE_SOURCE_INVALID';
  if (![source.projectId, source.documentId, source.partId, source.rightsReceiptRevision].every(item => typeof item === 'string' && SAFE_ID.test(item))
    || !sha(source.stepSha256) || source.stepSha256 !== source.bundleArtifactStepSha256
    || !sha(source.bundleArtifactStepSha256) || !sha(source.bundleArtifactManifestSha256) || !sha(source.rightsReceiptSha256)
    || typeof revision.revisionId !== 'string' || !SAFE_ID.test(revision.revisionId)
    || typeof revision.sequence !== 'number' || !Number.isSafeInteger(revision.sequence) || revision.sequence < 0 || !sha(revision.contentSha256)) return 'ENVELOPE_SOURCE_VALUE_INVALID';
  const occurrence = value.occurrence;
  const shape = isRecord(occurrence) ? occurrence.shape : null;
  if (!isRecord(occurrence) || !exactKeys(occurrence, OCCURRENCE_KEYS) || !isRecord(shape) || !exactKeys(shape, SHAPE_KEYS)) return 'ENVELOPE_OCCURRENCE_INVALID';
  if (![occurrence.objectId, occurrence.entry, occurrence.occurrencePath].every(item => typeof item === 'string' && SAFE_ID.test(item))
    || occurrence.occurrencePath !== occurrence.entry
    || (occurrence.referredEntry !== null && (typeof occurrence.referredEntry !== 'string' || !SAFE_ID.test(occurrence.referredEntry)))
    || !sha(occurrence.semanticSha256) || !sha(occurrence.geometrySummarySha256)
    || shape.solidCount !== 1 || shape.brepValid !== true || shape.nonManifoldEdgeCount !== 0
    || typeof shape.volumeMm3 !== 'number' || !Number.isFinite(shape.volumeMm3) || shape.volumeMm3 <= 0) return 'ENVELOPE_OCCURRENCE_VALUE_INVALID';
  const evidence = value.evidence;
  if (!isRecord(evidence) || !exactKeys(evidence, EVIDENCE_KEYS)
    || !sha(evidence.inputSha256) || evidence.inputSha256 !== source.stepSha256
    || !sha(evidence.nativeBinarySha256) || !sha(evidence.nativeInvocationSha256) || !sha(evidence.xcafRevisionBindingSha256)
    || evidence.workerStatus !== 'PASS_NATIVE_INVOCATION_BOUND'
    || evidence.kernelStatus !== 'NATIVE_CLAIM_DYNAMIC_LINKAGE_UNBOUND') return 'ENVELOPE_EVIDENCE_INVALID';
  if (!sha(value.envelopeSha256)) return 'ENVELOPE_HASH_INVALID';
  const { envelopeSha256: _hash, ...core } = value;
  return sha256Canonical(core) === value.envelopeSha256 ? null : 'ENVELOPE_HASH_MISMATCH';
}

export function validateCurrentCanonicalXcafOccurrenceEnvelope(value: unknown): CurrentCanonicalXcafOccurrenceValidation {
  try {
    const copied = snapshot(value);
    if (!isRecord(copied)) return { ok: false, reason: 'ENVELOPE_INVALID' };
    const reason = validateEnvelopeShape(copied);
    return reason ? { ok: false, reason } : { ok: true, envelope: copied as unknown as CurrentCanonicalXcafOccurrenceEnvelope };
  } catch {
    return { ok: false, reason: 'ENVELOPE_MALFORMED' };
  }
}

function buildCurrentCanonicalXcafOccurrenceForVersion(
  input: BuildCurrentCanonicalXcafOccurrenceInput | BuildCurrentCanonicalXcafOccurrenceV2Input,
  version: 'v1' | 'v2',
): CurrentCanonicalXcafOccurrenceResult {
  try {
    const copied = snapshot(input);
    if (!isRecord(copied) || !exactKeys(copied, ['bundle', 'inspection'])) return hold('INPUT_KEYS_INVALID');
    const bundleIssues = validateBundleReference(copied.bundle, version);
    if (bundleIssues.length) return hold(...bundleIssues);
    const bundle = copied.bundle as PlainRecord;
    const source = bundle.source as PlainRecord;
    const revision = source.revision as PlainRecord;
    const artifacts = bundle.artifacts as PlainRecord;
    const exact = (bundle.handoff as PlainRecord).exactSinglePart as PlainRecord;
    const exactStep = exact.step as PlainRecord;
    const adapted = adaptXcafInspectionToCanonicalDraft({
      projectId: source.projectId as string,
      documentId: source.documentId as string,
      namespace: 'mechanical',
      revisionId: revision.revisionId as string,
      sequence: revision.sequence as number,
      sourceFormat: 'STEP',
      inspection: copied.inspection,
    });
    if (!adapted.ok) return hold('XCAF_ADAPTER_HOLD', ...adapted.issues);
    const inspection = copied.inspection as XcafInspectionResult;
    const products = inspection.native.products;
    if (products.length !== 1) return hold('XCAF_SINGLE_ROOT_REQUIRED');
    const product = products[0]!;
    if (product.role !== 'product' || product.occurrencePath.includes('/')) return hold('XCAF_ROOT_PRODUCT_REQUIRED');
    if (product.shape.solidCount !== 1) return hold('XCAF_SINGLE_SOLID_REQUIRED');
    if (!product.shape.brepValid) return hold('XCAF_BREP_INVALID');
    if (product.shape.nonManifoldEdgeCount !== 0) return hold('XCAF_NON_MANIFOLD');
    if (inspection.inputSha256 !== artifacts.stepSha256 || exactStep.sha256 !== artifacts.stepSha256) return hold('XCAF_STEP_HASH_MISMATCH');
    const object = adapted.binding.objects[0];
    if (!object || !isRecord(object.payload)) return hold('XCAF_OCCURRENCE_OBJECT_MISSING');
    const payload = object.payload;
    if (payload.sourceEntry !== product.entry || payload.occurrencePath !== product.occurrencePath || payload.referredEntry !== product.referredEntry) return hold('XCAF_OCCURRENCE_IDENTITY_MISMATCH');
    const core = {
      schema: CURRENT_CANONICAL_XCAF_OCCURRENCE_SCHEMA,
      status: 'PASS_NATIVE_INVOCATION_BOUND' as const,
      authority: 'SERVER_CURRENT_CANONICAL_HEAD' as const,
      verification: 'XCAF_OCCURRENCE_IDENTITY_ONLY' as const,
      release: 'HOLD' as const,
      geometryIdentity: 'NOT_EXPOSED_BY_BINDING' as const,
      source: {
        projectId: source.projectId,
        documentId: source.documentId,
        partId: source.partId,
        revision: { revisionId: revision.revisionId, sequence: revision.sequence, contentSha256: revision.contentSha256 },
        stepSha256: artifacts.stepSha256,
        bundleArtifactStepSha256: artifacts.stepSha256,
        bundleArtifactManifestSha256: bundle.artifactManifestSha256,
        rightsReceiptRevision: source.rightsReceiptRevision,
        rightsReceiptSha256: source.rightsReceiptSha256,
      },
      occurrence: {
        objectId: object.objectId,
        entry: product.entry,
        occurrencePath: product.occurrencePath,
        referredEntry: product.referredEntry,
        semanticSha256: payload.semanticSha256,
        geometrySummarySha256: payload.geometrySummarySha256,
        shape: {
          solidCount: 1 as const,
          brepValid: true as const,
          nonManifoldEdgeCount: 0 as const,
          volumeMm3: product.shape.volumeMm3,
        },
      },
      evidence: {
        inputSha256: inspection.inputSha256,
        nativeBinarySha256: inspection.nativeBinarySha256,
        nativeInvocationSha256: inspection.nativeInvocationSha256,
        xcafRevisionBindingSha256: adapted.binding.revisionBindingSha256,
        workerStatus: 'PASS_NATIVE_INVOCATION_BOUND' as const,
        kernelStatus: 'NATIVE_CLAIM_DYNAMIC_LINKAGE_UNBOUND' as const,
      },
    };
    const envelope = { ...core, envelopeSha256: sha256Canonical(core) } as CurrentCanonicalXcafOccurrenceEnvelope;
    const validation = validateCurrentCanonicalXcafOccurrenceEnvelope(envelope);
    return validation.ok ? validation.envelope : hold(validation.reason);
  } catch {
    return hold('XCAF_OCCURRENCE_MALFORMED');
  }
}

export function buildCurrentCanonicalXcafOccurrence(
  input: BuildCurrentCanonicalXcafOccurrenceInput,
): CurrentCanonicalXcafOccurrenceResult {
  return buildCurrentCanonicalXcafOccurrenceForVersion(input, 'v1');
}

/** Version-isolated v2 entry point; the v1 contract remains unchanged. */
export function buildCurrentCanonicalXcafOccurrenceV2(
  input: BuildCurrentCanonicalXcafOccurrenceV2Input,
): CurrentCanonicalXcafOccurrenceResult {
  return buildCurrentCanonicalXcafOccurrenceForVersion(input, 'v2');
}
