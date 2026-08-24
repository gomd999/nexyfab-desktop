// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalCadConsumerDraftJson } from '../cad/canonicalCadV2ConsumerDraft';
import {
  buildCurrentCanonicalXcafOccurrenceV2,
  validateCurrentCanonicalXcafOccurrenceEnvelope,
  type CurrentCanonicalMechanicalBundleV2Reference,
} from './currentCanonicalXcafOccurrence';
import type { XcafInspectionResult, XcafWorkerProduct } from './xcafCanonicalBinding';

const SHA = (letter: string) => letter.repeat(64);
const STEP_SHA = SHA('a');
const hash = (value: unknown): string => createHash('sha256')
  .update(canonicalCadConsumerDraftJson(value as never))
  .digest('hex');

function product(overrides: Partial<XcafWorkerProduct> = {}): XcafWorkerProduct {
  return {
    entry: '0:1', role: 'product', occurrencePath: '0:1', referredEntry: null,
    name: 'V2 internal part', partNumber: null,
    partNumberStatus: 'NOT_EXPOSED_BY_BINDING', label: '0:1',
    transformScope: 'local_to_parent',
    transform: {
      matrix3x3: [1, 0, 0, 0, 1, 0, 0, 0, 1], translationMm: [0, 0, 0],
    },
    color: null,
    shape: {
      solidCount: 1, shellCount: 1, faceCount: 12, edgeCount: 24,
      nonManifoldEdgeCount: 0, brepValid: true, volumeMm3: 5900,
      surfaceAreaMm2: 2200, maxToleranceMm: 0.001,
      bboxMm: [0, 0, 0, 30, 20, 10], centroidMm: [15, 10, 5],
      massPropertiesBasis: 'volume',
      inertiaTensor: [1, 0, 0, 0, 1, 0, 0, 0, 1], inertiaUnit: 'mm5',
    },
    ...overrides,
  };
}

function inspection(): XcafInspectionResult {
  return {
    schema: 'nexyfab.occt-xcaf.inspect-result.v1',
    status: 'PASS_NATIVE',
    inputSha256: STEP_SHA,
    nativeBinarySha256: SHA('b'),
    nativeInvocationSha256: SHA('c'),
    native: {
      schema: 'nexyfab.occt-xcaf.inspect.v1',
      status: 'PASS_NATIVE',
      inputSha256: STEP_SHA,
      unit: 'MM',
      programIdentity: {
        name: 'occt-xcaf-inspect', version: '2', buildIdentity: 'test-native-contract',
      },
      kernelIdentity: {
        name: 'OpenCASCADE', version: '7.6.3', buildIdentity: 'test-occt-contract',
      },
      productIdentitySource: 'STEPCAFControl_Reader+XCAFDoc_ShapeTool',
      products: [product()],
    },
  };
}

function bundle(): CurrentCanonicalMechanicalBundleV2Reference {
  const tree = {
    nodes: [
      { id: 'base', name: 'Base', dependencies: [], payload: { kind: 'extrude' } },
      {
        id: 'treatment', name: 'Treatment', dependencies: ['base'],
        payload: { kind: 'fillet', edgeRefs: ['e.vert.0', 'e.vert.1'] },
      },
      { id: 'hole', name: 'Hole', dependencies: ['treatment'], payload: { kind: 'hole' } },
    ],
  };
  const source = {
    projectId: 'project-1',
    documentId: 'document-1',
    revision: { revisionId: 'revision-8', sequence: 8, contentSha256: SHA('d') },
    partId: 'part-1',
    featureTreeSchema: 'nexyfab.precision-cad.mechanical-single-part-feature-tree.v2' as const,
    featureTreeSha256: hash(tree),
    rightsReceiptRevision: 'rights-8',
    rightsReceiptSha256: SHA('f'),
    treatmentKind: 'fillet' as const,
    stableEdgeRefsSha256: hash(['e.vert.0', 'e.vert.1']),
  };
  const artifacts = {
    stepSha256: STEP_SHA,
    drawingSha256: SHA('1'),
    dimensionsSha256: SHA('2'),
    bomSha256: SHA('3'),
    runtimeIdentitySha256: SHA('4'),
    featureRegistrySha256: SHA('5'),
  };
  return {
    schema: 'nexyfab.precision-cad.current-canonical-mechanical-artifact-bundle.v2',
    status: 'EXACT_BUNDLE_V2_PASS',
    authority: 'SERVER_CURRENT_CANONICAL_HEAD',
    verification: 'NATIVE_OCCT_STEP_ROUNDTRIP_AND_HLR',
    release: 'HOLD',
    manufacturingRelease: 'BLOCKED',
    source,
    artifacts,
    artifactManifestSha256: hash({
      schema: 'nexyfab.precision-cad.current-canonical-mechanical-artifact-bundle.v2',
      source,
      artifacts,
    }),
    handoff: {
      assembly: { featureTrees: { 'part-1': tree } },
      exactSinglePart: {
        part: { id: 'part-1' },
        step: { sha256: STEP_SHA },
        source: {
          partFeatureTreeSha256: source.featureTreeSha256,
          canonicalRevision: {
            schema: 'nexyfab.precision-cad.canonical-drawing-revision-binding.v1',
            documentId: 'document-1', revisionId: 'revision-8', sequence: 8,
            contentSha256: SHA('d'),
          },
        },
      },
    },
  };
}

function resealManifest(value: CurrentCanonicalMechanicalBundleV2Reference): void {
  value.artifactManifestSha256 = hash({
    schema: value.schema, source: value.source, artifacts: value.artifacts,
  });
}

describe('current canonical XCAF occurrence v2 bundle binding', () => {
  it('binds the v2 bundle manifest and native occurrence to the same current revision and STEP', () => {
    const source = bundle();
    const result = buildCurrentCanonicalXcafOccurrenceV2({ bundle: source, inspection: inspection() });
    expect(result).toMatchObject({
      status: 'PASS_NATIVE_INVOCATION_BOUND',
      verification: 'XCAF_OCCURRENCE_IDENTITY_ONLY',
      geometryIdentity: 'NOT_EXPOSED_BY_BINDING',
      release: 'HOLD',
      source: {
        revision: source.source.revision,
        stepSha256: STEP_SHA,
        bundleArtifactManifestSha256: source.artifactManifestSha256,
      },
    });
    expect(result.status === 'PASS_NATIVE_INVOCATION_BOUND'
      && validateCurrentCanonicalXcafOccurrenceEnvelope(result)).toMatchObject({ ok: true });
  });

  it('rejects v1 downgrade and recomputed-manifest tree or edge authority substitutions', () => {
    const downgraded = bundle() as unknown as Record<string, unknown>;
    downgraded.schema = 'nexyfab.precision-cad.current-canonical-mechanical-artifact-bundle.v1';
    expect(buildCurrentCanonicalXcafOccurrenceV2({
      bundle: downgraded as never, inspection: inspection(),
    })).toMatchObject({ status: 'HOLD', blockers: ['BUNDLE_NOT_VERIFIED'] });

    const treeSwap = bundle();
    treeSwap.source.featureTreeSha256 = SHA('9');
    treeSwap.handoff.exactSinglePart!.source.partFeatureTreeSha256 = SHA('9');
    resealManifest(treeSwap);
    expect(buildCurrentCanonicalXcafOccurrenceV2({
      bundle: treeSwap, inspection: inspection(),
    })).toMatchObject({ status: 'HOLD', blockers: ['BUNDLE_FEATURE_TREE_BINDING_INVALID'] });

    const edgeSwap = bundle();
    edgeSwap.source.stableEdgeRefsSha256 = SHA('8');
    resealManifest(edgeSwap);
    expect(buildCurrentCanonicalXcafOccurrenceV2({
      bundle: edgeSwap, inspection: inspection(),
    })).toMatchObject({ status: 'HOLD', blockers: ['BUNDLE_EDGE_AUTHORITY_BINDING_INVALID'] });
  });

  it('rejects STEP and native single-root topology drift', () => {
    const wrongStep = inspection();
    wrongStep.inputSha256 = SHA('7');
    wrongStep.native.inputSha256 = SHA('7');
    expect(buildCurrentCanonicalXcafOccurrenceV2({
      bundle: bundle(), inspection: wrongStep,
    })).toMatchObject({ status: 'HOLD', blockers: ['XCAF_STEP_HASH_MISMATCH'] });

    const invalid = inspection();
    invalid.native.products[0]!.shape.brepValid = false;
    expect(buildCurrentCanonicalXcafOccurrenceV2({
      bundle: bundle(), inspection: invalid,
    })).toMatchObject({ status: 'HOLD', blockers: ['XCAF_BREP_INVALID'] });
  });
});
