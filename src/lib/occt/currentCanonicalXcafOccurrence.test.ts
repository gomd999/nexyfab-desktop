// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalCadConsumerDraftJson } from '../cad/canonicalCadV2ConsumerDraft';
import {
  buildCurrentCanonicalXcafOccurrence,
  CURRENT_CANONICAL_XCAF_OCCURRENCE_SCHEMA,
  validateCurrentCanonicalXcafOccurrenceEnvelope,
  type CurrentCanonicalMechanicalBundleReference,
} from './currentCanonicalXcafOccurrence';
import type { XcafInspectionResult, XcafWorkerProduct } from './xcafCanonicalBinding';

const SHA = (letter: string) => letter.repeat(64);
const STEP_SHA = SHA('a');

function product(overrides: Partial<XcafWorkerProduct> = {}): XcafWorkerProduct {
  return {
    entry: '0:1', role: 'product', occurrencePath: '0:1', referredEntry: null,
    name: 'Internal test part', partNumber: null, partNumberStatus: 'NOT_EXPOSED_BY_BINDING', label: '0:1',
    transformScope: 'local_to_parent',
    transform: { matrix3x3: [1, 0, 0, 0, 1, 0, 0, 0, 1], translationMm: [0, 0, 0] },
    color: null,
    shape: {
      solidCount: 1, shellCount: 1, faceCount: 6, edgeCount: 12, nonManifoldEdgeCount: 0,
      brepValid: true, volumeMm3: 1000, surfaceAreaMm2: 600, maxToleranceMm: 0.001,
      bboxMm: [0, 0, 0, 10, 10, 10], centroidMm: [5, 5, 5], massPropertiesBasis: 'volume',
      inertiaTensor: [1, 0, 0, 0, 1, 0, 0, 0, 1], inertiaUnit: 'mm5',
    },
    ...overrides,
  };
}

function inspection(products = [product()]): XcafInspectionResult {
  return {
    schema: 'nexyfab.occt-xcaf.inspect-result.v1', status: 'PASS_NATIVE', inputSha256: STEP_SHA,
    nativeBinarySha256: SHA('b'), nativeInvocationSha256: SHA('c'),
    native: {
      schema: 'nexyfab.occt-xcaf.inspect.v1', status: 'PASS_NATIVE', inputSha256: STEP_SHA, unit: 'MM',
      programIdentity: { name: 'occt-xcaf-inspect', version: '2', buildIdentity: 'test-native-contract' },
      kernelIdentity: { name: 'OpenCASCADE', version: '7.6.3', buildIdentity: 'test-occt-contract' },
      productIdentitySource: 'STEPCAFControl_Reader+XCAFDoc_ShapeTool', products,
    },
  };
}

function bundle(): CurrentCanonicalMechanicalBundleReference {
  const source = {
    projectId: 'project-1', documentId: 'document-1',
    revision: { revisionId: 'revision-7', sequence: 7, contentSha256: SHA('d') },
    partId: 'part-1', featureTreeSha256: SHA('e'), rightsReceiptRevision: 'rights-1', rightsReceiptSha256: SHA('f'),
  };
  const artifacts = {
    stepSha256: STEP_SHA, drawingSha256: SHA('1'), dimensionsSha256: SHA('2'), bomSha256: SHA('3'),
    runtimeIdentitySha256: SHA('4'), featureRegistrySha256: SHA('5'),
  };
  return {
    schema: 'nexyfab.precision-cad.current-canonical-mechanical-artifact-bundle.v1',
    status: 'EXACT_BUNDLE_PASS', authority: 'SERVER_CURRENT_CANONICAL_HEAD',
    verification: 'NATIVE_OCCT_STEP_ROUNDTRIP_AND_HLR', release: 'HOLD', manufacturingRelease: 'BLOCKED',
    source,
    artifacts,
    artifactManifestSha256: createHash('sha256').update(canonicalCadConsumerDraftJson({
      schema: 'nexyfab.precision-cad.current-canonical-mechanical-artifact-bundle.v1', source, artifacts,
    })).digest('hex'),
    handoff: {
      exactSinglePart: {
        part: { id: 'part-1' }, step: { sha256: STEP_SHA },
        source: { canonicalRevision: {
          schema: 'nexyfab.precision-cad.canonical-drawing-revision-binding.v1', documentId: 'document-1',
          revisionId: 'revision-7', sequence: 7, contentSha256: SHA('d'),
        } },
      },
    },
  };
}

describe('current canonical XCAF occurrence envelope', () => {
  it('binds one root product to the verified STEP and complete canonical revision', () => {
    const result = buildCurrentCanonicalXcafOccurrence({ bundle: bundle(), inspection: inspection() });
    expect(result).toMatchObject({
      schema: CURRENT_CANONICAL_XCAF_OCCURRENCE_SCHEMA,
      status: 'PASS_NATIVE_INVOCATION_BOUND', release: 'HOLD',
      geometryIdentity: 'NOT_EXPOSED_BY_BINDING',
      source: { stepSha256: STEP_SHA, bundleArtifactStepSha256: STEP_SHA, partId: 'part-1', revision: { revisionId: 'revision-7', sequence: 7, contentSha256: SHA('d') } },
      occurrence: { entry: '0:1', occurrencePath: '0:1', referredEntry: null, shape: { solidCount: 1, brepValid: true, nonManifoldEdgeCount: 0 } },
      evidence: { inputSha256: STEP_SHA, nativeBinarySha256: SHA('b'), nativeInvocationSha256: SHA('c') },
    });
    expect(result.status === 'PASS_NATIVE_INVOCATION_BOUND' && validateCurrentCanonicalXcafOccurrenceEnvelope(result)).toMatchObject({ ok: true });
  });

  it('does not turn contract/mock native output into commercial release evidence', () => {
    const result = buildCurrentCanonicalXcafOccurrence({ bundle: bundle(), inspection: inspection() });
    expect(result).toMatchObject({ status: 'PASS_NATIVE_INVOCATION_BOUND', release: 'HOLD', verification: 'XCAF_OCCURRENCE_IDENTITY_ONLY' });
    if (result.status === 'PASS_NATIVE_INVOCATION_BOUND') expect(result.evidence.kernelStatus).toBe('NATIVE_CLAIM_DYNAMIC_LINKAGE_UNBOUND');
  });

  it.each([
    ['multi_product', inspection([product(), product({ entry: '0:2', label: '0:2', occurrencePath: '0:2' })])],
    ['non_manifold', inspection([product({ shape: { ...product().shape, nonManifoldEdgeCount: 1 } })])],
    ['invalid_brep', inspection([product({ shape: { ...product().shape, brepValid: false } })])],
  ])('holds %s evidence', (_name, value) => {
    expect(buildCurrentCanonicalXcafOccurrence({ bundle: bundle(), inspection: value })).toMatchObject({ status: 'HOLD' });
  });

  it('holds source STEP, bundle, and adapter hash mismatches', () => {
    const wrongInput = inspection();
    wrongInput.inputSha256 = SHA('9');
    wrongInput.native.inputSha256 = SHA('9');
    expect(buildCurrentCanonicalXcafOccurrence({ bundle: bundle(), inspection: wrongInput })).toMatchObject({ status: 'HOLD', blockers: ['XCAF_STEP_HASH_MISMATCH'] });
    const wrongStep = bundle();
    wrongStep.handoff.exactSinglePart!.step.sha256 = SHA('8');
    expect(buildCurrentCanonicalXcafOccurrence({ bundle: wrongStep, inspection: inspection() })).toMatchObject({ status: 'HOLD', blockers: ['BUNDLE_STEP_BINDING_INVALID'] });
    const forgedManifest = bundle();
    forgedManifest.artifacts.drawingSha256 = SHA('7');
    expect(buildCurrentCanonicalXcafOccurrence({ bundle: forgedManifest, inspection: inspection() })).toMatchObject({ status: 'HOLD', blockers: ['BUNDLE_MANIFEST_HASH_MISMATCH'] });
  });

  it('rejects verification drift, artifact extras, unsafe root identities, and excessive nesting', () => {
    const verificationDrift = bundle();
    verificationDrift.verification = 'STRUCTURAL_ONLY';
    expect(buildCurrentCanonicalXcafOccurrence({ bundle: verificationDrift, inspection: inspection() })).toMatchObject({ status: 'HOLD', blockers: ['BUNDLE_NOT_VERIFIED'] });
    const artifactExtra = bundle();
    artifactExtra.artifacts.extraSha256 = SHA('7');
    expect(buildCurrentCanonicalXcafOccurrence({ bundle: artifactExtra, inspection: inspection() })).toMatchObject({ status: 'HOLD', blockers: ['BUNDLE_ARTIFACTS_INVALID'] });
    expect(buildCurrentCanonicalXcafOccurrence({
      bundle: bundle(), inspection: inspection([product({ occurrencePath: '0:1/0:2' })]),
    })).toMatchObject({ status: 'HOLD' });
    let deep: Record<string, unknown> = {};
    for (let index = 0; index < 60; index += 1) deep = { child: deep };
    expect(validateCurrentCanonicalXcafOccurrenceEnvelope(deep)).toEqual({ ok: false, reason: 'ENVELOPE_MALFORMED' });
  });

  it('rejects extra, hidden, symbol, getter, and post-build tampering', () => {
    const result = buildCurrentCanonicalXcafOccurrence({ bundle: bundle(), inspection: inspection() });
    if (result.status !== 'PASS_NATIVE_INVOCATION_BOUND') throw new Error(result.blockers.join(','));
    expect(validateCurrentCanonicalXcafOccurrenceEnvelope({ ...result, extra: true })).toMatchObject({ ok: false });
    expect(validateCurrentCanonicalXcafOccurrenceEnvelope({ ...result, [Symbol('hidden')]: true })).toMatchObject({ ok: false });
    const hidden = structuredClone(result);
    Object.defineProperty(hidden.source, 'hidden', { value: true, enumerable: false });
    expect(validateCurrentCanonicalXcafOccurrenceEnvelope(hidden)).toMatchObject({ ok: false });
    const getter = structuredClone(result) as unknown as Record<string, unknown>;
    Object.defineProperty(getter, 'status', { enumerable: true, get() { throw new Error('hostile'); } });
    expect(validateCurrentCanonicalXcafOccurrenceEnvelope(getter)).toMatchObject({ ok: false });
    const tampered = structuredClone(result);
    tampered.occurrence.occurrencePath = '0:9';
    expect(validateCurrentCanonicalXcafOccurrenceEnvelope(tampered)).toMatchObject({ ok: false, reason: 'ENVELOPE_OCCURRENCE_VALUE_INVALID' });
  });
});
