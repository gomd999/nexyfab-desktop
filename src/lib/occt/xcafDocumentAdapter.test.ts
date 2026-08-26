import { describe, expect, it } from 'vitest';
import { adaptXcafInspectionToCanonicalDraft } from './xcafDocumentAdapter';
import type { XcafInspectionResult, XcafWorkerProduct } from './xcafCanonicalBinding';

const SHA = 'a'.repeat(64);
const baseProduct = (overrides: Partial<XcafWorkerProduct> = {}): XcafWorkerProduct => ({
  entry: '0:1', role: 'product', occurrencePath: '0:1', referredEntry: null, name: 'Motor', partNumber: null,
  partNumberStatus: 'NOT_EXPOSED_BY_BINDING', label: '0:1', transformScope: 'local_to_parent',
  transform: { matrix3x3: [1, 0, 0, 0, 1, 0, 0, 0, 1], translationMm: [1, 2, 3] }, color: null,
  shape: {
    solidCount: 1, shellCount: 1, faceCount: 6, edgeCount: 12,
    nonManifoldEdgeCount: 0, brepValid: true, volumeMm3: 1000,
    surfaceAreaMm2: 600, maxToleranceMm: 0.001, bboxMm: [0, 0, 0, 10, 10, 10],
    centroidMm: [5, 5, 5], massPropertiesBasis: 'volume',
    inertiaTensor: [1, 0, 0, 0, 1, 0, 0, 0, 1], inertiaUnit: 'mm5',
  }, ...overrides,
});
const input = (bytes = SHA, products = [baseProduct()]): XcafInspectionResult => ({
  schema: 'nexyfab.occt-xcaf.inspect-result.v1', status: 'PASS_NATIVE', inputSha256: bytes,
  nativeBinarySha256: 'b'.repeat(64), nativeInvocationSha256: 'c'.repeat(64),
  native: {
    schema: 'nexyfab.occt-xcaf.inspect.v1', status: 'PASS_NATIVE', inputSha256: bytes, unit: 'MM',
    programIdentity: { name: 'occt-xcaf-inspect', version: '2', buildIdentity: 'test-native' },
    kernelIdentity: { name: 'OpenCASCADE', version: '7.6.3', buildIdentity: 'test-occt' },
    productIdentitySource: 'STEPCAFControl_Reader+XCAFDoc_ShapeTool', products,
  },
});
const adapter = (inspection: unknown, sourceFormat?: string) => adaptXcafInspectionToCanonicalDraft({ projectId: 'project-1', documentId: 'document-1', namespace: 'mechanical', revisionId: 'revision-1', sequence: 0, sourceFormat, inspection });

describe('XCAF document adapter', () => {
  it('is deterministic for identical input and keeps source/canonical/revision hashes distinct', () => {
    const left = adapter(input(), 'STEP');
    const right = adapter(input(), 'STEP');
    expect(left).toEqual(right);
    if (!left.ok) throw new Error(left.issues.join(','));
    expect(left.document.sourceBindings[0]!.contentSha256).toBe(SHA);
    expect(left.binding.inputSha256).toBe(SHA);
    expect(left.binding.canonicalProjectionSha256).not.toBe(SHA);
    expect(left.binding.geometrySummarySha256).not.toBe(SHA);
    expect(left.binding.geometryIdentity).toBe('NOT_EXPOSED_BY_BINDING');
    expect(left.binding.canonicalDocumentSha256).toBe(left.document.revision.contentSha256);
    expect(left.binding.revisionBindingSha256).not.toBe(left.binding.canonicalProjectionSha256);
  });

  it('rejects changed bytes or worker/native binding mismatch', () => {
    const original = adapter(input(), 'STEP');
    const changed = adapter(input('c'.repeat(64)), 'STEP');
    expect(changed.ok).toBe(true);
    if (original.ok && changed.ok) {
      expect(changed.binding.inputSha256).toBe('c'.repeat(64));
      expect(changed.binding.objects.map(object => object.objectId)).toEqual(original.binding.objects.map(object => object.objectId));
      expect(changed.binding.semanticSha256).toBe(original.binding.semanticSha256);
      expect(changed.binding.revisionBindingSha256).not.toBe(original.binding.revisionBindingSha256);
    }
    const mismatch = input();
    mismatch.native.inputSha256 = 'd'.repeat(64);
    const result = adapter(mismatch, 'STEP');
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('native_input_sha256_mismatch');
  });

  it('rejects IGES explicitly and never falls back to another geometry path', () => {
    const result = adapter(input(), 'IGES');
    expect(result).toMatchObject({ ok: false, status: 'HOLD', binding: null, document: null });
    expect(result.ok ? [] : result.issues).toContain('format_unsupported:IGES');
  });

  it('fails closed for malformed input while preserving draft authority states', () => {
    const result = adapter({ malformed: true });
    expect(result).toMatchObject({ ok: false, status: 'HOLD', authority: 'CONSUMER_DRAFT', verification: 'NOT_RUN', release: 'HOLD' });
    expect(() => adapter({ malformed: true })).not.toThrow();
  });
});
