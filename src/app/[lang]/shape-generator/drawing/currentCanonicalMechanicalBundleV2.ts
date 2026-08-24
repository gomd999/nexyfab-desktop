import { createHash } from 'node:crypto';
import type { DbAdapter } from '@/lib/db-adapter';
import { IDENTITY_QUAT } from '@/lib/assembly/assemblyState';
import {
  canonicalCadConsumerDraftJson,
  type CanonicalCadRevisionRef,
} from '@/lib/cad/canonicalCadV2ConsumerDraft';
import { readMechanicalCurrentHeadV2 } from '@/lib/cad/mechanicalCurrentHeadV2Reader';
import { MECHANICAL_SINGLE_PART_FEATURE_TREE_V2_SCHEMA } from '@/lib/cad/mechanicalSinglePartFeatureTreeV2Extractor';
import {
  buildAssemblyDrawingHandoff,
  validateAssemblyDrawingHandoff,
  type AssemblyDrawingHandoff,
} from '../assembly/drawingHandoff';
import { enrichServerDrawingHandoffWithExactSinglePart } from './exactSinglePartServerHandoff';

export const CURRENT_CANONICAL_MECHANICAL_BUNDLE_V2_SCHEMA =
  'nexyfab.precision-cad.current-canonical-mechanical-artifact-bundle.v2' as const;

export interface CurrentCanonicalMechanicalArtifactBundleV2 {
  schema: typeof CURRENT_CANONICAL_MECHANICAL_BUNDLE_V2_SCHEMA;
  status: 'EXACT_BUNDLE_V2_PASS';
  authority: 'SERVER_CURRENT_CANONICAL_HEAD';
  verification: 'NATIVE_OCCT_STEP_ROUNDTRIP_AND_HLR';
  release: 'HOLD';
  manufacturingRelease: 'BLOCKED';
  source: {
    projectId: string;
    documentId: string;
    revision: CanonicalCadRevisionRef;
    partId: string;
    featureTreeSchema: typeof MECHANICAL_SINGLE_PART_FEATURE_TREE_V2_SCHEMA;
    featureTreeSha256: string;
    rightsReceiptRevision: string;
    rightsReceiptSha256: string;
    treatmentKind: 'fillet' | 'chamfer';
    stableEdgeRefsSha256: string;
  };
  artifacts: {
    stepSha256: string;
    drawingSha256: string;
    dimensionsSha256: string;
    bomSha256: string;
    runtimeIdentitySha256: string;
    featureRegistrySha256: string;
  };
  artifactManifestSha256: string;
  handoff: AssemblyDrawingHandoff;
}

export type CurrentCanonicalMechanicalBundleV2Result =
  | CurrentCanonicalMechanicalArtifactBundleV2
  | {
      schema: typeof CURRENT_CANONICAL_MECHANICAL_BUNDLE_V2_SCHEMA;
      status: 'HOLD';
      authority: 'SERVER_CURRENT_CANONICAL_HEAD';
      release: 'HOLD';
      manufacturingRelease: 'BLOCKED';
      blockers: readonly string[];
    };

export interface BuildCurrentCanonicalMechanicalBundleV2Input {
  db: DbAdapter;
  projectId: string;
  documentId: string;
  now?: Date;
}

export type CurrentCanonicalMechanicalBundleV2Validation =
  | { ok: true; bundle: CurrentCanonicalMechanicalArtifactBundleV2 }
  | { ok: false; reason: string };

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const BUNDLE_KEYS = [
  'schema', 'status', 'authority', 'verification', 'release', 'manufacturingRelease',
  'source', 'artifacts', 'artifactManifestSha256', 'handoff',
] as const;
const SOURCE_KEYS = [
  'projectId', 'documentId', 'revision', 'partId', 'featureTreeSchema',
  'featureTreeSha256', 'rightsReceiptRevision', 'rightsReceiptSha256',
  'treatmentKind', 'stableEdgeRefsSha256',
] as const;
const ARTIFACT_KEYS = [
  'stepSha256', 'drawingSha256', 'dimensionsSha256', 'bomSha256',
  'runtimeIdentitySha256', 'featureRegistrySha256',
] as const;
const REVISION_KEYS = ['revisionId', 'sequence', 'contentSha256'] as const;

function safeRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some(key => typeof key !== 'string')) return false;
  const actual = (ownKeys as string[]).sort();
  const wanted = [...keys].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) return false;
  return ownKeys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return !!descriptor && descriptor.enumerable && 'value' in descriptor;
  });
}

function sha256(value: unknown): string {
  return createHash('sha256')
    .update(canonicalCadConsumerDraftJson(value as never), 'utf8')
    .digest('hex');
}

function hold(...blockers: string[]): CurrentCanonicalMechanicalBundleV2Result {
  return {
    schema: CURRENT_CANONICAL_MECHANICAL_BUNDLE_V2_SCHEMA,
    status: 'HOLD',
    authority: 'SERVER_CURRENT_CANONICAL_HEAD',
    release: 'HOLD',
    manufacturingRelease: 'BLOCKED',
    blockers: [...new Set(blockers)],
  };
}

/** Recomputes the v2 revision/tree/edge/artifact bindings and exact handoff. */
export async function validateCurrentCanonicalMechanicalArtifactBundleV2(
  value: unknown,
): Promise<CurrentCanonicalMechanicalBundleV2Validation> {
  try {
    if (!safeRecord(value, BUNDLE_KEYS)
      || !safeRecord(value.source, SOURCE_KEYS)
      || !safeRecord(value.artifacts, ARTIFACT_KEYS)
      || !safeRecord(value.source.revision, REVISION_KEYS)) {
      return { ok: false, reason: 'CURRENT_CANONICAL_MECHANICAL_BUNDLE_V2_SCHEMA_INVALID' };
    }
    const bundle = value as unknown as CurrentCanonicalMechanicalArtifactBundleV2;
    const revision = bundle.source.revision;
    if (bundle.schema !== CURRENT_CANONICAL_MECHANICAL_BUNDLE_V2_SCHEMA
      || bundle.status !== 'EXACT_BUNDLE_V2_PASS'
      || bundle.authority !== 'SERVER_CURRENT_CANONICAL_HEAD'
      || bundle.verification !== 'NATIVE_OCCT_STEP_ROUNDTRIP_AND_HLR'
      || bundle.release !== 'HOLD' || bundle.manufacturingRelease !== 'BLOCKED'
      || !SAFE_ID.test(bundle.source.projectId) || !SAFE_ID.test(bundle.source.documentId)
      || !SAFE_ID.test(bundle.source.partId) || !SAFE_ID.test(bundle.source.rightsReceiptRevision)
      || bundle.source.featureTreeSchema !== MECHANICAL_SINGLE_PART_FEATURE_TREE_V2_SCHEMA
      || (bundle.source.treatmentKind !== 'fillet' && bundle.source.treatmentKind !== 'chamfer')
      || !SAFE_ID.test(revision.revisionId) || !Number.isSafeInteger(revision.sequence) || revision.sequence < 0
      || !SHA256.test(revision.contentSha256) || !SHA256.test(bundle.source.featureTreeSha256)
      || !SHA256.test(bundle.source.rightsReceiptSha256) || !SHA256.test(bundle.source.stableEdgeRefsSha256)
      || Object.values(bundle.artifacts).some(hash => !SHA256.test(hash))
      || !SHA256.test(bundle.artifactManifestSha256)) {
      return { ok: false, reason: 'CURRENT_CANONICAL_MECHANICAL_BUNDLE_V2_VALUE_INVALID' };
    }

    const validation = await validateAssemblyDrawingHandoff(bundle.handoff);
    const exact = validation.ok ? validation.handoff.exactSinglePart : undefined;
    const canonical = validation.ok ? validation.handoff.source.canonicalRevision : undefined;
    const boundTree = validation.ok
      ? validation.handoff.assembly.featureTrees[bundle.source.partId]
      : undefined;
    if (!validation.ok || !exact || !canonical || !boundTree
      || validation.handoff.source.projectId !== bundle.source.projectId
      || canonical.documentId !== bundle.source.documentId
      || canonical.revisionId !== revision.revisionId
      || canonical.sequence !== revision.sequence
      || canonical.contentSha256 !== revision.contentSha256
      || exact.part.id !== bundle.source.partId
      || sha256(boundTree) !== bundle.source.featureTreeSha256
      || exact.source.partFeatureTreeSha256 !== bundle.source.featureTreeSha256
      || exact.step.sha256 !== bundle.artifacts.stepSha256
      || exact.drawing.sha256 !== bundle.artifacts.drawingSha256
      || exact.dimensions.sha256 !== bundle.artifacts.dimensionsSha256
      || exact.bom.sha256 !== bundle.artifacts.bomSha256
      || exact.verification.runtimeIdentitySha256 !== bundle.artifacts.runtimeIdentitySha256
      || exact.verification.registrySha256 !== bundle.artifacts.featureRegistrySha256) {
      return { ok: false, reason: 'CURRENT_CANONICAL_MECHANICAL_BUNDLE_V2_BINDING_INVALID' };
    }
    const manifest = sha256({
      schema: CURRENT_CANONICAL_MECHANICAL_BUNDLE_V2_SCHEMA,
      source: bundle.source,
      artifacts: bundle.artifacts,
    });
    return manifest === bundle.artifactManifestSha256
      ? { ok: true, bundle }
      : { ok: false, reason: 'CURRENT_CANONICAL_MECHANICAL_BUNDLE_V2_HASH_MISMATCH' };
  } catch {
    return { ok: false, reason: 'CURRENT_CANONICAL_MECHANICAL_BUNDLE_V2_MALFORMED' };
  }
}

/**
 * Current-head-only v2 vertical: extrude -> stable-edge fillet/chamfer ->
 * drilled hole -> native OCCT validation -> STEP round-trip -> HLR/dim/BOM.
 */
export async function buildCurrentCanonicalMechanicalArtifactBundleV2(
  input: BuildCurrentCanonicalMechanicalBundleV2Input,
): Promise<CurrentCanonicalMechanicalBundleV2Result> {
  const current = await readMechanicalCurrentHeadV2(input.db, input.projectId, input.documentId);
  if (!current.ok) return hold(`CURRENT_HEAD_${current.code}`, ...current.issues);
  const { bound } = current;
  const canonicalRevision = {
    schema: 'nexyfab.precision-cad.canonical-drawing-revision-binding.v1' as const,
    documentId: bound.documentId,
    revisionId: bound.revision.revisionId,
    sequence: bound.revision.sequence,
    contentSha256: bound.revision.contentSha256,
  };

  let handoff: AssemblyDrawingHandoff;
  try {
    handoff = await buildAssemblyDrawingHandoff({
      projectId: bound.projectId,
      canonicalRevision,
      state: {
        parts: [{
          id: bound.partId,
          name: bound.name,
          partTemplateId: `canonical-v2:${bound.documentId}:${bound.partId}`,
          fixed: true,
          position: { x: 0, y: 0, z: 0 },
          orientation: IDENTITY_QUAT,
        }],
        mates: [],
      },
      featureTrees: { [bound.partId]: bound.tree },
      now: input.now,
    });
  } catch {
    return hold('CANONICAL_V2_HANDOFF_BUILD_FAILED');
  }

  const exactResult = await enrichServerDrawingHandoffWithExactSinglePart(handoff);
  if (exactResult.status !== 'PASS') {
    return hold(`EXACT_V2_ENRICHMENT_${exactResult.status}`, exactResult.reason);
  }
  const validation = await validateAssemblyDrawingHandoff(exactResult.handoff);
  const exact = exactResult.handoff.exactSinglePart;
  if (!validation.ok || !exact || !exact.source.canonicalRevision
    || canonicalCadConsumerDraftJson(exact.source.canonicalRevision as never)
      !== canonicalCadConsumerDraftJson(canonicalRevision as never)
    || exact.source.partFeatureTreeSha256 !== bound.treeSha256) {
    return hold('EXACT_V2_HANDOFF_REVISION_OR_TREE_BINDING_INVALID');
  }

  const source: CurrentCanonicalMechanicalArtifactBundleV2['source'] = {
    projectId: bound.projectId,
    documentId: bound.documentId,
    revision: bound.revision,
    partId: bound.partId,
    featureTreeSchema: MECHANICAL_SINGLE_PART_FEATURE_TREE_V2_SCHEMA,
    featureTreeSha256: bound.treeSha256,
    rightsReceiptRevision: bound.rightsReceiptRevision,
    rightsReceiptSha256: bound.rightsReceiptSha256,
    treatmentKind: bound.treatmentKind,
    stableEdgeRefsSha256: sha256(bound.edgeRefs),
  };
  const artifacts = {
    stepSha256: exact.step.sha256,
    drawingSha256: exact.drawing.sha256,
    dimensionsSha256: exact.dimensions.sha256,
    bomSha256: exact.bom.sha256,
    runtimeIdentitySha256: exact.verification.runtimeIdentitySha256,
    featureRegistrySha256: exact.verification.registrySha256,
  };
  const bundle: CurrentCanonicalMechanicalArtifactBundleV2 = {
    schema: CURRENT_CANONICAL_MECHANICAL_BUNDLE_V2_SCHEMA,
    status: 'EXACT_BUNDLE_V2_PASS',
    authority: 'SERVER_CURRENT_CANONICAL_HEAD',
    verification: 'NATIVE_OCCT_STEP_ROUNDTRIP_AND_HLR',
    release: 'HOLD',
    manufacturingRelease: 'BLOCKED',
    source,
    artifacts,
    artifactManifestSha256: sha256({
      schema: CURRENT_CANONICAL_MECHANICAL_BUNDLE_V2_SCHEMA,
      source,
      artifacts,
    }),
    handoff: validation.handoff,
  };
  const bundleValidation = await validateCurrentCanonicalMechanicalArtifactBundleV2(bundle);
  return bundleValidation.ok ? bundleValidation.bundle : hold(bundleValidation.reason);
}
