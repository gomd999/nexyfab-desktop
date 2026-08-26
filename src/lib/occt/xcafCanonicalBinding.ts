import {
  createCanonicalCadDocumentV2,
  sealCanonicalCadObjectV2,
  sealCanonicalCadRelationshipV2,
  type CanonicalCadCoordinateFrame,
  type CanonicalCadDomain,
  type CanonicalCadDocumentV2ConsumerDraft,
  type CanonicalCadJsonObject,
  type CanonicalCadObjectV2,
  type CanonicalCadRelationshipV2,
  type CanonicalCadTolerancePolicy,
} from '@/lib/cad/canonicalCadV2ConsumerDraft';
import {
  hashXcafCanonicalProjection,
  hashXcafGeometrySummary,
  hashXcafObjectId,
  hashXcafRelationshipId,
  hashXcafRevisionBinding,
  hashXcafSemantic,
  isXcafSha256,
} from './xcafHash';

export const XCAF_INSPECTION_SCHEMA = 'nexyfab.occt-xcaf.inspect-result.v1' as const;
export const XCAF_NATIVE_INSPECTION_SCHEMA = 'nexyfab.occt-xcaf.inspect.v1' as const;
export const XCAF_CANONICAL_BINDING_SCHEMA = 'nexyfab.precision-cad.xcaf-canonical-binding-consumer-draft.v1' as const;
export const XCAF_CANONICAL_BINDING_STATUS = 'CONSUMER_DRAFT' as const;
// The shared canonical JSON/document validators bound total nested values,
// not only array length. 128 rich occurrence records remain below that bound;
// claiming the native worker's 20k ceiling here would fail much earlier while
// hashing or sealing the canonical projection.
export const XCAF_MAX_PRODUCTS = 128;
export const XCAF_MAX_PATH_DEPTH = 64;
export const XCAF_MAX_STRING = 10_000;
export const XCAF_MAX_ABS_TRANSLATION_MM = 1_000_000_000_000;
export const XCAF_MAX_VOLUME_MM3 = 1e36;
export const XCAF_MAX_AREA_MM2 = 1e30;
export const XCAF_MAX_TOLERANCE_MM = 1_000_000;
export const XCAF_MAX_INERTIA = 1e60;
export const XCAF_MAX_TOPOLOGY_COUNT = 2_000_000;
export const XCAF_MAX_VALIDATION_ISSUES = 256;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ROLES = ['product', 'assembly', 'assembly_occurrence', 'occurrence'] as const;
const PART_NUMBER_STATUSES = ['NOT_EXPOSED_BY_BINDING'] as const;

export type XcafRole = typeof ROLES[number];
export type XcafPartNumberStatus = typeof PART_NUMBER_STATUSES[number];

export interface XcafShapeSummary {
  solidCount: number;
  shellCount: number;
  faceCount: number;
  edgeCount: number;
  nonManifoldEdgeCount: number;
  brepValid: boolean;
  volumeMm3: number;
  surfaceAreaMm2: number;
  maxToleranceMm: number;
  bboxMm: readonly [number, number, number, number, number, number] | null;
  centroidMm: readonly [number, number, number] | null;
  massPropertiesBasis: 'volume' | 'surface' | null;
  inertiaTensor: readonly [number, number, number, number, number, number, number, number, number] | null;
  inertiaUnit: 'mm5' | 'mm4' | null;
}

export interface XcafTransform {
  matrix3x3: readonly [number, number, number, number, number, number, number, number, number];
  translationMm: readonly [number, number, number];
}

export interface XcafWorkerProduct {
  entry: string;
  role: XcafRole;
  occurrencePath: string;
  referredEntry: string | null;
  name: string | null;
  partNumber: string | null;
  partNumberStatus: XcafPartNumberStatus;
  label: string;
  transformScope: 'local_to_parent';
  transform: XcafTransform;
  color: readonly [number, number, number] | null;
  shape: XcafShapeSummary;
}

export interface XcafNativeInspection {
  schema: typeof XCAF_NATIVE_INSPECTION_SCHEMA;
  status: 'PASS_NATIVE';
  inputSha256: string;
  unit: 'MM';
  programIdentity: { name: 'occt-xcaf-inspect'; version: string; buildIdentity: string };
  kernelIdentity: { name: 'OpenCASCADE'; version: string; buildIdentity: string };
  productIdentitySource: 'STEPCAFControl_Reader+XCAFDoc_ShapeTool';
  products: XcafWorkerProduct[];
}

export interface XcafInspectionResult {
  schema: typeof XCAF_INSPECTION_SCHEMA;
  status: 'PASS_NATIVE';
  inputSha256: string;
  nativeBinarySha256: string;
  nativeInvocationSha256: string;
  native: XcafNativeInspection;
}

export interface XcafCanonicalBindingInput {
  projectId: string;
  documentId: string;
  namespace: CanonicalCadDomain;
  revisionId: string;
  sequence: number;
  tolerancePolicy?: CanonicalCadTolerancePolicy;
  coordinateFrame?: CanonicalCadCoordinateFrame;
  inspection: XcafInspectionResult;
}

export interface XcafCanonicalBinding {
  schema: typeof XCAF_CANONICAL_BINDING_SCHEMA;
  status: typeof XCAF_CANONICAL_BINDING_STATUS;
  authority: 'CONSUMER_DRAFT';
  release: 'HOLD';
  verification: 'NOT_RUN';
  sourceFormat: 'STEP';
  inputSha256: string;
  nativeBinarySha256: string;
  nativeInvocationSha256: string;
  workerIdentity: {
    status: 'PASS_NATIVE_INVOCATION_BOUND';
    resultSchema: typeof XCAF_INSPECTION_SCHEMA;
    nativeBinarySha256: string;
    nativeInvocationSha256: string;
    program: XcafNativeInspection['programIdentity'];
  };
  kernelIdentity: {
    status: 'NATIVE_CLAIM_DYNAMIC_LINKAGE_UNBOUND';
    apiIdentity: 'STEPCAFControl_Reader+XCAFDoc_ShapeTool';
    kernel: XcafNativeInspection['kernelIdentity'];
  };
  geometryIdentity: 'NOT_EXPOSED_BY_BINDING';
  geometrySummarySha256: string;
  semanticSha256: string;
  canonicalProjectionSha256: string;
  canonicalDocumentSha256: string;
  revisionBindingSha256: string;
  objects: CanonicalCadObjectV2[];
  relationships: CanonicalCadRelationshipV2[];
}

export interface XcafBindingResult {
  binding: XcafCanonicalBinding;
  document: CanonicalCadDocumentV2ConsumerDraft;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).every(key => {
    const descriptor = descriptors[key as keyof typeof descriptors];
    return Boolean(descriptor && descriptor.enumerable === true && Object.hasOwn(descriptor, 'value'));
  });
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value);
  if (actual.some(key => typeof key !== 'string')) return false;
  const expected = [...keys].sort();
  const received = (actual as string[]).sort();
  return expected.length === received.length && expected.every((key, index) => key === received[index]);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function boundedString(value: unknown, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= XCAF_MAX_STRING && (allowEmpty || value.length > 0);
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

function validTransform(value: unknown, path: string, issues: string[]): value is XcafTransform {
  if (!isRecord(value) || !exactKeys(value, ['matrix3x3', 'translationMm'])) {
    issues.push(`${path}_keys_invalid`);
    return false;
  }
  if (!Array.isArray(value.matrix3x3) || value.matrix3x3.length !== 9 || value.matrix3x3.some(item => !finiteNumber(item)) || !rigidMatrix(value.matrix3x3 as number[])) issues.push(`${path}_matrix_invalid`);
  if (!Array.isArray(value.translationMm) || value.translationMm.length !== 3 || value.translationMm.some(item => !finiteNumber(item) || Math.abs(item) > XCAF_MAX_ABS_TRANSLATION_MM)) issues.push(`${path}_translation_invalid`);
  return true;
}

function rigidMatrix(matrix: readonly number[]): boolean {
  if (matrix.length !== 9 || matrix.some(value => !Number.isFinite(value) || Math.abs(value) > 1.000001)) return false;
  const rows = [matrix.slice(0, 3), matrix.slice(3, 6), matrix.slice(6, 9)];
  const dot = (left: readonly number[], right: readonly number[]) => left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
  for (let index = 0; index < 3; index++) {
    if (Math.abs(dot(rows[index]!, rows[index]!) - 1) > 1e-6) return false;
    for (let other = index + 1; other < 3; other++) if (Math.abs(dot(rows[index]!, rows[other]!)) > 1e-6) return false;
  }
  const determinant = matrix[0]! * (matrix[4]! * matrix[8]! - matrix[5]! * matrix[7]!)
    - matrix[1]! * (matrix[3]! * matrix[8]! - matrix[5]! * matrix[6]!)
    + matrix[2]! * (matrix[3]! * matrix[7]! - matrix[4]! * matrix[6]!);
  return Math.abs(determinant - 1) <= 1e-6;
}

function validShape(value: unknown, path: string, issues: string[]): value is XcafShapeSummary {
  const keys = [
    'solidCount', 'shellCount', 'faceCount', 'edgeCount', 'nonManifoldEdgeCount',
    'brepValid', 'volumeMm3', 'surfaceAreaMm2', 'maxToleranceMm', 'bboxMm',
    'centroidMm', 'massPropertiesBasis', 'inertiaTensor', 'inertiaUnit',
  ] as const;
  if (!isRecord(value) || !exactKeys(value, keys)) {
    issues.push(`${path}_keys_invalid`);
    return false;
  }
  for (const key of ['solidCount', 'shellCount', 'faceCount', 'edgeCount'] as const) {
    const count = value[key];
    if (!Number.isSafeInteger(count) || (count as number) < 0 || (count as number) > XCAF_MAX_TOPOLOGY_COUNT) issues.push(`${path}_${key}_invalid`);
  }
  const nonManifoldEdgeCount = value.nonManifoldEdgeCount as number;
  const edgeCount = value.edgeCount as number;
  const solidCount = value.solidCount as number;
  const faceCount = value.faceCount as number;
  if (!Number.isSafeInteger(nonManifoldEdgeCount) || nonManifoldEdgeCount < 0
    || nonManifoldEdgeCount > XCAF_MAX_TOPOLOGY_COUNT
    || (Number.isSafeInteger(edgeCount) && nonManifoldEdgeCount > edgeCount)) issues.push(`${path}_non_manifold_edge_count_invalid`);
  if (typeof value.brepValid !== 'boolean') issues.push(`${path}_brep_valid_invalid`);
  if (!finiteNumber(value.volumeMm3) || value.volumeMm3 < 0 || value.volumeMm3 > XCAF_MAX_VOLUME_MM3) issues.push(`${path}_volume_invalid`);
  if (!finiteNumber(value.surfaceAreaMm2) || value.surfaceAreaMm2 < 0 || value.surfaceAreaMm2 > XCAF_MAX_AREA_MM2) issues.push(`${path}_surface_area_invalid`);
  if (!finiteNumber(value.maxToleranceMm) || value.maxToleranceMm < 0 || value.maxToleranceMm > XCAF_MAX_TOLERANCE_MM) issues.push(`${path}_tolerance_invalid`);
  if (value.bboxMm !== null && (!Array.isArray(value.bboxMm) || value.bboxMm.length !== 6 || value.bboxMm.some(item => !finiteNumber(item) || Math.abs(item) > XCAF_MAX_ABS_TRANSLATION_MM))) issues.push(`${path}_bbox_invalid`);
  else if (Array.isArray(value.bboxMm) && (value.bboxMm[0] > value.bboxMm[3] || value.bboxMm[1] > value.bboxMm[4] || value.bboxMm[2] > value.bboxMm[5])) issues.push(`${path}_bbox_order_invalid`);
  if (value.centroidMm === null) {
    if (value.massPropertiesBasis !== null || value.inertiaTensor !== null || value.inertiaUnit !== null) issues.push(`${path}_mass_properties_null_tuple_invalid`);
  } else {
    if (!Array.isArray(value.centroidMm) || value.centroidMm.length !== 3
      || value.centroidMm.some(item => !finiteNumber(item) || Math.abs(item) > XCAF_MAX_ABS_TRANSLATION_MM)) issues.push(`${path}_centroid_invalid`);
    if (value.massPropertiesBasis !== 'volume' && value.massPropertiesBasis !== 'surface') issues.push(`${path}_mass_properties_basis_invalid`);
    if (!Array.isArray(value.inertiaTensor) || value.inertiaTensor.length !== 9
      || value.inertiaTensor.some(item => !finiteNumber(item) || Math.abs(item) > XCAF_MAX_INERTIA)) issues.push(`${path}_inertia_invalid`);
    const expectedUnit = value.massPropertiesBasis === 'volume' ? 'mm5' : value.massPropertiesBasis === 'surface' ? 'mm4' : null;
    if (value.inertiaUnit !== expectedUnit) issues.push(`${path}_inertia_unit_invalid`);
  }
  if (value.brepValid === true && nonManifoldEdgeCount !== 0) issues.push(`${path}_valid_non_manifold_contradiction`);
  if (Number.isSafeInteger(solidCount) && solidCount > 0) {
    if (!(Number.isSafeInteger(faceCount) && faceCount > 0)
      || !(Number.isSafeInteger(edgeCount) && edgeCount > 0)
      || value.bboxMm === null) issues.push(`${path}_solid_topology_incomplete`);
  }
  if (finiteNumber(value.volumeMm3) && value.volumeMm3 > 0) {
    if (solidCount === 0 || value.centroidMm === null || value.massPropertiesBasis !== 'volume') issues.push(`${path}_volume_mass_properties_inconsistent`);
  }
  if (Array.isArray(value.bboxMm) && Array.isArray(value.centroidMm)
    && (value.centroidMm[0] < value.bboxMm[0] || value.centroidMm[0] > value.bboxMm[3]
      || value.centroidMm[1] < value.bboxMm[1] || value.centroidMm[1] > value.bboxMm[4]
      || value.centroidMm[2] < value.bboxMm[2] || value.centroidMm[2] > value.bboxMm[5])) issues.push(`${path}_centroid_outside_bbox`);
  return true;
}

function validNativeIdentity(value: unknown, kind: 'program' | 'kernel', issues: string[]): boolean {
  const path = kind === 'program' ? 'native_program_identity' : 'native_kernel_identity';
  if (!isRecord(value) || !exactKeys(value, ['name', 'version', 'buildIdentity'])) {
    issues.push(`${path}_keys_invalid`);
    return false;
  }
  const expectedName = kind === 'program' ? 'occt-xcaf-inspect' : 'OpenCASCADE';
  if (value.name !== expectedName) issues.push(`${path}_name_invalid`);
  if (!boundedString(value.version) || (kind === 'program' && value.version !== '2')) issues.push(`${path}_version_invalid`);
  if (!boundedString(value.buildIdentity)) issues.push(`${path}_build_invalid`);
  return true;
}

function pathSegments(path: string): string[] | null {
  // The native writer emits OCAF label entries as `0:1/0:1:1`, without a
  // leading slash. Accepting a second spelling would make IDs non-canonical.
  if (path.startsWith('/') || path.endsWith('/') || path.includes('//')) return null;
  const segments = path.split('/');
  if (segments.length === 0 || segments.length > XCAF_MAX_PATH_DEPTH || segments.some(segment => !boundedString(segment) || !validId(segment))) return null;
  if (new Set(segments).size !== segments.length) return null;
  return segments;
}

function validateProduct(value: unknown, index: number, issues: string[]): value is XcafWorkerProduct {
  const path = `products_${index}`;
  const keys = ['entry', 'role', 'occurrencePath', 'referredEntry', 'name', 'partNumber', 'partNumberStatus', 'label', 'transformScope', 'transform', 'color', 'shape'] as const;
  if (!isRecord(value) || !exactKeys(value, keys)) {
    issues.push(`${path}_keys_invalid`);
    return false;
  }
  if (!boundedString(value.entry) || !validId(value.entry)) issues.push(`${path}_entry_invalid`);
  if (!ROLES.includes(value.role as XcafRole)) issues.push(`${path}_role_invalid`);
  const segments = typeof value.occurrencePath === 'string' ? pathSegments(value.occurrencePath) : null;
  if (!segments) issues.push(`${path}_occurrence_path_invalid`);
  if (value.referredEntry !== null && (!boundedString(value.referredEntry) || !validId(value.referredEntry))) issues.push(`${path}_referred_entry_invalid`);
  for (const key of ['name', 'partNumber'] as const) if (value[key] !== null && !boundedString(value[key])) issues.push(`${path}_${key}_invalid`);
  if (!PART_NUMBER_STATUSES.includes(value.partNumberStatus as XcafPartNumberStatus)) issues.push(`${path}_part_number_status_invalid`);
  if (value.partNumberStatus === 'NOT_EXPOSED_BY_BINDING' && value.partNumber !== null) issues.push(`${path}_part_number_must_be_null`);
  if (!boundedString(value.label) || !validId(value.label)) issues.push(`${path}_label_invalid`);
  if (value.transformScope !== 'local_to_parent') issues.push(`${path}_transform_scope_invalid`);
  validTransform(value.transform, `${path}_transform`, issues);
  if (value.color !== null && (!Array.isArray(value.color) || value.color.length !== 3 || value.color.some(item => !finiteNumber(item) || item < 0 || item > 1))) issues.push(`${path}_color_invalid`);
  validShape(value.shape, `${path}_shape`, issues);
  return true;
}

function validateXcafInspectionUnsafe(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value) || !exactKeys(value, ['schema', 'status', 'inputSha256', 'nativeBinarySha256', 'nativeInvocationSha256', 'native'])) return ['inspection_keys_invalid'];
  if (value.schema !== XCAF_INSPECTION_SCHEMA) issues.push('inspection_schema_invalid');
  if (value.status !== 'PASS_NATIVE') issues.push('inspection_status_invalid');
  if (!isXcafSha256(value.inputSha256)) issues.push('input_sha256_invalid');
  if (!isXcafSha256(value.nativeBinarySha256)) issues.push('native_binary_sha256_invalid');
  if (!isXcafSha256(value.nativeInvocationSha256)) issues.push('native_invocation_sha256_invalid');
  if (!isRecord(value.native) || !exactKeys(value.native, ['schema', 'status', 'inputSha256', 'unit', 'programIdentity', 'kernelIdentity', 'productIdentitySource', 'products'])) {
    issues.push('native_keys_invalid');
    return issues;
  }
  if (value.native.schema !== XCAF_NATIVE_INSPECTION_SCHEMA) issues.push('native_schema_invalid');
  if (value.native.status !== 'PASS_NATIVE') issues.push('native_status_invalid');
  if (value.native.inputSha256 !== value.inputSha256) issues.push('native_input_sha256_mismatch');
  if (value.native.unit !== 'MM') issues.push('native_unit_unsupported');
  validNativeIdentity(value.native.programIdentity, 'program', issues);
  validNativeIdentity(value.native.kernelIdentity, 'kernel', issues);
  if (value.native.productIdentitySource !== 'STEPCAFControl_Reader+XCAFDoc_ShapeTool') issues.push('native_identity_source_invalid');
  if (!Array.isArray(value.native.products) || value.native.products.length === 0 || value.native.products.length > XCAF_MAX_PRODUCTS) issues.push('products_count_invalid');
  else {
    const paths = new Set<string>();
    const entries = new Set<string>();
    const productsByPath = new Map<string, XcafWorkerProduct>();
    value.native.products.forEach((product, index) => {
      if (validateProduct(product, index, issues)) {
        if (paths.has(product.occurrencePath)) issues.push(`products_${index}_duplicate_occurrence_path`);
        if (entries.has(product.entry)) issues.push(`products_${index}_duplicate_entry`);
        const segments = pathSegments(product.occurrencePath);
        if (!segments || segments.at(-1) !== product.entry || product.label !== product.entry) issues.push(`products_${index}_path_identity_mismatch`);
        paths.add(product.occurrencePath);
        entries.add(product.entry);
        productsByPath.set(product.occurrencePath, product);
      }
    });
    value.native.products.forEach((product, index) => {
      if (!isRecord(product) || typeof product.occurrencePath !== 'string') return;
      const validated = productsByPath.get(product.occurrencePath);
      if (!validated) return;
      const parent = parentPath(validated.occurrencePath);
      if (parent === null) {
        if (validated.role !== 'product' && validated.role !== 'assembly') issues.push(`products_${index}_root_role_invalid`);
        if (validated.referredEntry !== null) issues.push(`products_${index}_root_reference_invalid`);
      } else {
        if (validated.role !== 'occurrence' && validated.role !== 'assembly_occurrence') issues.push(`products_${index}_child_role_invalid`);
        if (validated.role === 'assembly_occurrence' && validated.referredEntry === null) issues.push(`products_${index}_assembly_reference_required`);
        const parentProduct = productsByPath.get(parent);
        if (!parentProduct) issues.push(`products_${index}_parent_missing`);
        else if (parentProduct.role !== 'assembly' && parentProduct.role !== 'assembly_occurrence') issues.push(`products_${index}_parent_role_invalid`);
      }
      if (validated.referredEntry === validated.entry) issues.push(`products_${index}_self_reference_invalid`);
    });
  }
  return [...new Set(issues)].slice(0, XCAF_MAX_VALIDATION_ISSUES);
}

export function validateXcafInspection(value: unknown): string[] {
  try {
    return validateXcafInspectionUnsafe(value);
  } catch {
    return ['inspection_unreadable'];
  }
}

function allocateId(kind: 'object' | 'relationship', seed: CanonicalCadJsonObject, occupied: Set<string>): string {
  const base = kind === 'object' ? hashXcafObjectId(seed) : hashXcafRelationshipId(seed);
  for (let counter = 0; counter <= 1_000; counter++) {
    const id = counter === 0 ? base : `${base}:${counter}`;
    if (id.length > 128) throw new Error(`xcaf_${kind}_id_collision_limit`);
    if (!occupied.has(id)) {
      occupied.add(id);
      return id;
    }
  }
  throw new Error(`xcaf_${kind}_id_collision_limit`);
}

export function allocateXcafId(kind: 'object' | 'relationship', seed: CanonicalCadJsonObject, occupied = new Set<string>()): string {
  return allocateId(kind, seed, occupied);
}

function productSemantic(product: XcafWorkerProduct) {
  return {
    entry: product.entry,
    role: product.role,
    occurrencePath: product.occurrencePath,
    referredEntry: product.referredEntry,
    name: product.name,
    partNumber: product.partNumber,
    partNumberStatus: product.partNumberStatus,
    label: product.label,
    transformScope: product.transformScope,
    color: product.color,
  };
}

function productGeometry(product: XcafWorkerProduct) {
  return { entry: product.entry, occurrencePath: product.occurrencePath, transform: product.transform, shape: product.shape };
}

function parentPath(path: string): string | null {
  const index = path.lastIndexOf('/');
  return index <= 0 ? null : path.slice(0, index);
}

export function buildXcafCanonicalBinding(input: XcafCanonicalBindingInput): XcafBindingResult {
  const issues = validateXcafInspection(input.inspection);
  if (!validId(input.projectId) || !validId(input.documentId) || !validId(input.revisionId)) issues.push('binding_id_invalid');
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) issues.push('binding_sequence_invalid');
  if (issues.length) throw new Error([...new Set(issues)].join(','));

  const ordinal = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
  const products = [...input.inspection.native.products].sort((left, right) => ordinal(left.occurrencePath, right.occurrencePath) || ordinal(left.entry, right.entry));
  const occupiedObjects = new Set<string>();
  const occupiedRelationships = new Set<string>();
  const objectByPath = new Map<string, string>();
  const objects: CanonicalCadObjectV2[] = [];
  const geometrySummaryHashes: string[] = [];
  const semanticHashes: string[] = [];
  for (const product of products) {
    const geometrySummarySha256 = hashXcafGeometrySummary(productGeometry(product));
    const semanticSha256 = hashXcafSemantic(productSemantic(product));
    const objectId = allocateId('object', {
      projectId: input.projectId,
      documentId: input.documentId,
      namespace: input.namespace,
      entry: product.entry,
      occurrencePath: product.occurrencePath,
      referredEntry: product.referredEntry,
    }, occupiedObjects);
    const payload: CanonicalCadJsonObject = {
      sourceLabel: product.label,
      sourceEntry: product.entry,
      occurrencePath: product.occurrencePath,
      referredEntry: product.referredEntry,
      role: product.role,
      name: product.name,
      partNumber: product.partNumber,
      partNumberStatus: product.partNumberStatus,
      transformScope: product.transformScope,
      matrix3x3: [...product.transform.matrix3x3],
      translationMm: [...product.transform.translationMm],
      transformProjection: { status: 'NOT_RUN', reason: 'matrix_convention_not_graduated' },
      color: product.color === null ? null : [...product.color],
      shape: {
        ...product.shape,
        bboxMm: product.shape.bboxMm === null ? null : [...product.shape.bboxMm],
        centroidMm: product.shape.centroidMm === null ? null : [...product.shape.centroidMm],
        inertiaTensor: product.shape.inertiaTensor === null ? null : [...product.shape.inertiaTensor],
      },
      geometryIdentity: 'NOT_EXPOSED_BY_BINDING',
      geometrySummarySha256,
      semanticSha256,
      validity: {
        status: product.shape.brepValid ? 'PASS_NATIVE' : 'FAIL_NATIVE',
        nonManifoldEdgeCount: product.shape.nonManifoldEdgeCount,
        evidence: 'BRepCheck_Analyzer+unique_edge_face_ancestors',
      },
      tolerance: {
        status: 'PASS_NATIVE',
        maxToleranceMm: product.shape.maxToleranceMm,
        evidence: 'BRep_Tool::Tolerance',
      },
    };
    objects.push(sealCanonicalCadObjectV2({ objectId, namespace: input.namespace, objectKind: 'xcaf.occurrence', objectRevision: 0, payload, transform: null }));
    objectByPath.set(product.occurrencePath, objectId);
    geometrySummaryHashes.push(geometrySummarySha256);
    semanticHashes.push(semanticSha256);
  }
  const relationships: CanonicalCadRelationshipV2[] = [];
  for (const product of products) {
    const parent = parentPath(product.occurrencePath);
    if (!parent) continue;
    const fromObjectId = objectByPath.get(parent);
    const toObjectId = objectByPath.get(product.occurrencePath);
    if (!fromObjectId || !toObjectId) throw new Error('xcaf_parent_occurrence_missing');
    const relationshipId = allocateId('relationship', {
      projectId: input.projectId,
      documentId: input.documentId,
      kind: 'ASSEMBLES',
      fromObjectId,
      toObjectId,
    }, occupiedRelationships);
    relationships.push(sealCanonicalCadRelationshipV2({ relationshipId, kind: 'ASSEMBLES', fromObjectId, toObjectId, relationshipRevision: 0, payload: { sourceParentPath: parent, sourceEntry: product.entry, sourceLabel: product.label, status: 'NOT_RUN' } }));
  }
  relationships.sort((left, right) => ordinal(left.relationshipId, right.relationshipId));
  const geometrySummarySha256 = hashXcafGeometrySummary(geometrySummaryHashes.sort());
  const semanticSha256 = hashXcafSemantic(semanticHashes.sort());
  const canonicalProjectionSha256 = hashXcafCanonicalProjection({ objects, relationships });
  const document = createCanonicalCadDocumentV2({
    projectId: input.projectId,
    documentId: input.documentId,
    domains: [input.namespace],
    revision: { revisionId: input.revisionId, sequence: input.sequence, contentSha256: '' },
    units: { length: 'mm', angle: 'deg' },
    coordinateFrame: input.coordinateFrame ?? { frameId: `xcaf:${input.documentId}`, parentFrameId: null, origin: [0, 0, 0], rotationDeg: [0, 0, 0] },
    tolerancePolicy: input.tolerancePolicy ?? { linear: 0.01, angularDeg: 0.1 },
    objects,
    relationships,
    sourceBindings: [{ schema: XCAF_INSPECTION_SCHEMA, revision: `native:${input.inspection.nativeBinarySha256}`, contentSha256: input.inspection.inputSha256 }],
  });
  const canonicalDocumentSha256 = document.revision.contentSha256;
  const revisionBindingSha256 = hashXcafRevisionBinding({
    schema: XCAF_CANONICAL_BINDING_SCHEMA,
    status: XCAF_CANONICAL_BINDING_STATUS,
    authority: 'CONSUMER_DRAFT',
    release: 'HOLD',
    verification: 'NOT_RUN',
    sourceFormat: 'STEP',
    projectId: input.projectId,
    documentId: input.documentId,
    revision: document.revision,
    inputSha256: input.inspection.inputSha256,
    nativeBinarySha256: input.inspection.nativeBinarySha256,
    nativeInvocationSha256: input.inspection.nativeInvocationSha256,
    geometrySummarySha256,
    semanticSha256,
    canonicalProjectionSha256,
    canonicalDocumentSha256,
    workerIdentity: {
      status: 'PASS_NATIVE_INVOCATION_BOUND',
      resultSchema: XCAF_INSPECTION_SCHEMA,
      nativeBinarySha256: input.inspection.nativeBinarySha256,
      nativeInvocationSha256: input.inspection.nativeInvocationSha256,
      program: input.inspection.native.programIdentity,
    },
    kernelIdentity: {
      status: 'NATIVE_CLAIM_DYNAMIC_LINKAGE_UNBOUND',
      apiIdentity: 'STEPCAFControl_Reader+XCAFDoc_ShapeTool',
      kernel: input.inspection.native.kernelIdentity,
    },
    geometryIdentity: 'NOT_EXPOSED_BY_BINDING',
  });
  const binding: XcafCanonicalBinding = {
    schema: XCAF_CANONICAL_BINDING_SCHEMA,
    status: XCAF_CANONICAL_BINDING_STATUS,
    authority: 'CONSUMER_DRAFT',
    release: 'HOLD',
    verification: 'NOT_RUN',
    sourceFormat: 'STEP',
    inputSha256: input.inspection.inputSha256,
    nativeBinarySha256: input.inspection.nativeBinarySha256,
    nativeInvocationSha256: input.inspection.nativeInvocationSha256,
    workerIdentity: {
      status: 'PASS_NATIVE_INVOCATION_BOUND',
      resultSchema: XCAF_INSPECTION_SCHEMA,
      nativeBinarySha256: input.inspection.nativeBinarySha256,
      nativeInvocationSha256: input.inspection.nativeInvocationSha256,
      program: { ...input.inspection.native.programIdentity },
    },
    kernelIdentity: {
      status: 'NATIVE_CLAIM_DYNAMIC_LINKAGE_UNBOUND',
      apiIdentity: 'STEPCAFControl_Reader+XCAFDoc_ShapeTool',
      kernel: { ...input.inspection.native.kernelIdentity },
    },
    geometryIdentity: 'NOT_EXPOSED_BY_BINDING',
    geometrySummarySha256,
    semanticSha256,
    canonicalProjectionSha256,
    canonicalDocumentSha256,
    revisionBindingSha256,
    objects,
    relationships,
  };
  return { binding, document };
}
