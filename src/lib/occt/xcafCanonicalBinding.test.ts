import { describe, expect, it } from 'vitest';
import { allocateXcafId, buildXcafCanonicalBinding, validateXcafInspection, XCAF_MAX_PRODUCTS, type XcafInspectionResult, type XcafWorkerProduct } from './xcafCanonicalBinding';

const SHA = 'a'.repeat(64);
const product = (overrides: Partial<XcafWorkerProduct> = {}): XcafWorkerProduct => ({
  entry: '0:1', role: 'assembly', occurrencePath: '0:1', referredEntry: null, name: 'Root', partNumber: null,
  partNumberStatus: 'NOT_EXPOSED_BY_BINDING', label: '0:1', transformScope: 'local_to_parent',
  transform: { matrix3x3: [1, 0, 0, 0, 1, 0, 0, 0, 1], translationMm: [0, 0, 0] }, color: [0.2, 0.3, 0.4],
  shape: {
    solidCount: 1, shellCount: 1, faceCount: 6, edgeCount: 12,
    nonManifoldEdgeCount: 0, brepValid: true, volumeMm3: 1000,
    surfaceAreaMm2: 600, maxToleranceMm: 0.001, bboxMm: [0, 0, 0, 10, 10, 10],
    centroidMm: [5, 5, 5], massPropertiesBasis: 'volume',
    inertiaTensor: [1, 0, 0, 0, 1, 0, 0, 0, 1], inertiaUnit: 'mm5',
  }, ...overrides,
});
const inspection = (products: XcafWorkerProduct[] = [product()]): XcafInspectionResult => ({
  schema: 'nexyfab.occt-xcaf.inspect-result.v1', status: 'PASS_NATIVE', inputSha256: SHA,
  nativeBinarySha256: 'b'.repeat(64), nativeInvocationSha256: 'c'.repeat(64),
  native: {
    schema: 'nexyfab.occt-xcaf.inspect.v1', status: 'PASS_NATIVE', inputSha256: SHA, unit: 'MM',
    programIdentity: { name: 'occt-xcaf-inspect', version: '2', buildIdentity: 'test-native' },
    kernelIdentity: { name: 'OpenCASCADE', version: '7.6.3', buildIdentity: 'test-occt' },
    productIdentitySource: 'STEPCAFControl_Reader+XCAFDoc_ShapeTool', products,
  },
});

describe('XCAF canonical binding', () => {
  it('projects nested occurrences deterministically and preserves source labels separately', () => {
    const child = product({ entry: '0:2', role: 'occurrence', occurrencePath: '0:1/0:2', label: '0:2', referredEntry: '0:20', name: 'Child' });
    const a = buildXcafCanonicalBinding({ projectId: 'p', documentId: 'd', namespace: 'mechanical', revisionId: 'r1', sequence: 0, inspection: inspection([product(), child]) });
    const b = buildXcafCanonicalBinding({ projectId: 'p', documentId: 'd', namespace: 'mechanical', revisionId: 'r1', sequence: 0, inspection: inspection([child, product()]) });
    expect(a.document).toEqual(b.document);
    expect(a.binding.relationships).toHaveLength(1);
    expect(a.binding.objects[0]!.payload.sourceLabel).toBe('0:1');
    expect(a.binding.objects[0]!.objectId).not.toBe(a.binding.objects[0]!.payload.sourceLabel);
    expect(a.binding.objects[0]!.payload.partNumber).toBeNull();
    expect(a.binding.objects[0]!.transform).toBeNull();
    expect(a.binding.objects[0]!.payload.transformProjection).toEqual({ status: 'NOT_RUN', reason: 'matrix_convention_not_graduated' });
    expect(a.document.authority).toBe('CONSUMER_DRAFT');
    expect(a.document.verification).toBe('NOT_RUN');
    expect(a.document.release).toBe('HOLD');
    expect(a.binding.geometryIdentity).toBe('NOT_EXPOSED_BY_BINDING');
    expect(a.binding.kernelIdentity.status).toBe('NATIVE_CLAIM_DYNAMIC_LINKAGE_UNBOUND');
    expect(a.binding.workerIdentity.status).toBe('PASS_NATIVE_INVOCATION_BOUND');
    expect(a.binding.workerIdentity.nativeBinarySha256).toBe('b'.repeat(64));
    expect(a.binding.workerIdentity.nativeInvocationSha256).toBe('c'.repeat(64));
    expect(a.binding.canonicalDocumentSha256).toBe(a.document.revision.contentSha256);
  });

  it('does not infer part number from display name', () => {
    const result = buildXcafCanonicalBinding({ projectId: 'p', documentId: 'd', namespace: 'mechanical', revisionId: 'r1', sequence: 0, inspection: inspection([product({ name: 'PART-123', partNumber: null, partNumberStatus: 'NOT_EXPOSED_BY_BINDING' })]) });
    expect(result.binding.objects[0]!.payload.partNumber).toBeNull();
    expect(result.binding.objects[0]!.payload.name).toBe('PART-123');
  });

  it('rejects malformed, cyclic, oversized, and unsupported native input without throwing in validation', () => {
    expect(validateXcafInspection(null)).toContain('inspection_keys_invalid');
    expect(validateXcafInspection({})).toContain('inspection_keys_invalid');
    expect(validateXcafInspection(inspection([product({ occurrencePath: '/0:1' })]))).toContain('products_0_occurrence_path_invalid');
    expect(validateXcafInspection(inspection([product({ occurrencePath: '0:1/0:1' })]))).toContain('products_0_occurrence_path_invalid');
    expect(validateXcafInspection(inspection([product(), product({ entry: '0:2', occurrencePath: '0:1' })]))).toContain('products_1_duplicate_occurrence_path');
    const tooDeep = Array.from({ length: 65 }, (_, index) => `x${index}`).join('/');
    expect(validateXcafInspection(inspection([product({ occurrencePath: tooDeep })]))).toContain('products_0_occurrence_path_invalid');
    expect(validateXcafInspection(inspection(Array.from({ length: XCAF_MAX_PRODUCTS + 1 }, (_, index) => product({ entry: `0:${index + 1}`, occurrencePath: `0:${index + 1}` }))))).toContain('products_count_invalid');
    expect(validateXcafInspection(inspection([product({ partNumber: 'P', partNumberStatus: 'NOT_EXPOSED_BY_BINDING' })]))).toContain('products_0_part_number_must_be_null');
    expect(validateXcafInspection(inspection([product({ partNumber: null, partNumberStatus: 'EXPLICIT' as never })]))).toContain('products_0_part_number_status_invalid');
    expect(validateXcafInspection(inspection([product({ transform: { matrix3x3: [2, 0, 0, 0, 1, 0, 0, 0, 1], translationMm: [0, 0, 0] } })]))).toContain('products_0_transform_matrix_invalid');
    expect(validateXcafInspection(inspection([product({ shape: { ...product().shape, bboxMm: [10, 0, 0, 0, 10, 10] } })]))).toContain('products_0_shape_bbox_order_invalid');
    expect(validateXcafInspection(inspection([product({ shape: { ...product().shape, volumeMm3: Number.MAX_VALUE } })]))).toContain('products_0_shape_volume_invalid');
    expect(validateXcafInspection(inspection([product({ shape: { ...product().shape, bboxMm: [0, 0, 0, 1e13, 10, 10] } })]))).toContain('products_0_shape_bbox_invalid');
    expect(validateXcafInspection(inspection([product({ shape: { ...product().shape, nonManifoldEdgeCount: 1 } })]))).toContain('products_0_shape_valid_non_manifold_contradiction');
    expect(validateXcafInspection(inspection([product({ shape: { ...product().shape, centroidMm: [20, 5, 5] } })]))).toContain('products_0_shape_centroid_outside_bbox');
    expect(validateXcafInspection(inspection([product({ shape: { ...product().shape, solidCount: 0 } })]))).toContain('products_0_shape_volume_mass_properties_inconsistent');
    expect(validateXcafInspection(inspection([product(), product({ entry: '0:2', label: '0:2', role: 'product', occurrencePath: '0:1/0:2' })]))).toContain('products_1_child_role_invalid');
    expect(validateXcafInspection(inspection([product({ role: 'product' }), product({ entry: '0:2', label: '0:2', role: 'occurrence', occurrencePath: '0:1/0:2' })]))).toContain('products_1_parent_role_invalid');
    expect(validateXcafInspection(inspection([product(), product({ entry: '0:2', label: '0:3', role: 'occurrence', occurrencePath: '0:1/0:2' })]))).toContain('products_1_path_identity_mismatch');
    expect(validateXcafInspection(inspection([product(), product({ role: 'occurrence', occurrencePath: '0:2' })]))).toContain('products_1_duplicate_entry');
    const unreadable = new Proxy({}, { getPrototypeOf() { throw new Error('trap'); } });
    expect(validateXcafInspection(unreadable)).toEqual(['inspection_unreadable']);
  });

  it('keeps deterministic IDs bounded and resolves a collision with a suffix', () => {
    const occupied = new Set<string>();
    const first = allocateXcafId('object', { seed: 'one' }, occupied);
    const second = allocateXcafId('object', { seed: 'one' }, occupied);
    expect(second).not.toBe(first);
    expect(second.length).toBeLessThanOrEqual(128);
    expect(second).toMatch(/:1$/);
  });

  it('builds the advertised adapter ceiling without exceeding canonical document bounds', () => {
    const products = Array.from({ length: XCAF_MAX_PRODUCTS }, (_, index) => {
      const entry = `0:${index + 1}`;
      return product({ entry, label: entry, role: 'product', occurrencePath: entry, name: `Part ${index + 1}` });
    });
    const result = buildXcafCanonicalBinding({ projectId: 'p', documentId: 'd', namespace: 'mechanical', revisionId: 'r1', sequence: 0, inspection: inspection(products) });
    expect(result.binding.objects).toHaveLength(XCAF_MAX_PRODUCTS);
    expect(result.document.objects).toHaveLength(XCAF_MAX_PRODUCTS);
  });
});
