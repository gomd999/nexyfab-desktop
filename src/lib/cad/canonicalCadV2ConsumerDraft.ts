import { Sha256 } from '@aws-crypto/sha256-js';

export const CANONICAL_CAD_DOCUMENT_CONSUMER_DRAFT_SCHEMA =
  'nexyfab.precision-cad.canonical-document-consumer-draft.v1' as const;
export const CANONICAL_CAD_COMMAND_CONSUMER_DRAFT_SCHEMA =
  'nexyfab.precision-cad.canonical-command-consumer-draft.v1' as const;
export const CANONICAL_CAD_CONTRACT_VERSION = 1 as const;
export const CANONICAL_CAD_MODEL_VERSION = 2 as const;

export type CanonicalCadJsonPrimitive = string | number | boolean | null;
export type CanonicalCadJsonValue = CanonicalCadJsonPrimitive | CanonicalCadJsonValue[] | CanonicalCadJsonObject;
export interface CanonicalCadJsonObject { [key: string]: CanonicalCadJsonValue }

export type CanonicalCadDomain = 'mechanical' | 'building' | 'interior' | 'civil' | 'landscape' | 'coordination';
export type CanonicalCadRelationshipKind = 'HOST' | 'UPSTREAM' | 'RELATES' | 'CONSTRAINS' | 'ASSEMBLES' | 'DRAWS';
export type CanonicalCadRiskClass = 'R0' | 'R1' | 'R2' | 'R3' | 'R4';
export type CanonicalCadVec3 = readonly [number, number, number];

export interface CanonicalCadRevisionRef {
  revisionId: string;
  sequence: number;
  contentSha256: string;
}

export interface CanonicalCadUnits {
  length: 'mm' | 'm';
  angle: 'deg' | 'rad';
}

export interface CanonicalCadCoordinateFrame {
  frameId: string;
  parentFrameId: string | null;
  origin: CanonicalCadVec3;
  rotationDeg: CanonicalCadVec3;
}

export interface CanonicalCadTolerancePolicy {
  linear: number;
  angularDeg: number;
}

export interface CanonicalCadTransform {
  translation: CanonicalCadVec3;
  rotationDeg: CanonicalCadVec3;
}

export interface CanonicalCadSourceBinding {
  schema: string;
  revision: string;
  contentSha256: string;
}

export interface CanonicalCadObjectV2 {
  objectId: string;
  namespace: CanonicalCadDomain;
  objectKind: string;
  objectRevision: number;
  contentSha256: string;
  payload: CanonicalCadJsonObject;
  transform: CanonicalCadTransform | null;
}

export interface CanonicalCadRelationshipV2 {
  relationshipId: string;
  kind: CanonicalCadRelationshipKind;
  fromObjectId: string;
  toObjectId: string;
  relationshipRevision: number;
  contentSha256: string;
  payload: CanonicalCadJsonObject;
}

export interface CanonicalCadDocumentV2ConsumerDraft {
  schema: typeof CANONICAL_CAD_DOCUMENT_CONSUMER_DRAFT_SCHEMA;
  contractVersion: typeof CANONICAL_CAD_CONTRACT_VERSION;
  modelVersion: typeof CANONICAL_CAD_MODEL_VERSION;
  authority: 'CONSUMER_DRAFT';
  projectId: string;
  documentId: string;
  domains: CanonicalCadDomain[];
  revision: CanonicalCadRevisionRef;
  units: CanonicalCadUnits;
  coordinateFrame: CanonicalCadCoordinateFrame;
  tolerancePolicy: CanonicalCadTolerancePolicy;
  objects: CanonicalCadObjectV2[];
  relationships: CanonicalCadRelationshipV2[];
  sourceBindings: CanonicalCadSourceBinding[];
  verification: 'NOT_RUN';
  release: 'HOLD';
}

export interface CanonicalCadActor {
  kind: 'human' | 'agent' | 'system';
  actorId: string;
  agentIdentity: {
    agentId: string;
    modelId: string;
    promptSha256: string;
  } | null;
}

export interface CanonicalCadArtifactBinding {
  artifactId: string;
  contentSha256: string;
}

export interface CanonicalCadAuthorization {
  permission: 'EDIT_DOCUMENT';
  riskClass: CanonicalCadRiskClass;
  approvalScope: string;
  approvalReceiptSha256: string | null;
}

export interface CanonicalCadResourceBudget {
  timeoutMs: number;
  memoryMb: number;
  maxIterations: number;
  maxRetries: number;
}

export interface CanonicalCadLockEvidence {
  lockId: string;
  scope: 'workspace' | 'object' | 'field';
  objectId: string;
  fieldPath: string | null;
  ownerActorId: string;
  source: 'human' | 'authority';
}

export interface CanonicalCadPreconditions {
  lockSetSha256: string;
  locks: CanonicalCadLockEvidence[];
  selectedObjectIds: string[];
  parameterPaths: string[];
}

export interface CanonicalCadDeclaredSideEffects {
  canonicalDocument: true;
  externalTransmission: false;
  quoteOrRfq: false;
}

export interface CanonicalCadVerificationPlan {
  verifierIds: string[];
  blockers: string[];
}

export interface CanonicalCadTiming {
  issuedAt: string;
  expiresAt: string;
}

export interface CanonicalCadStaleCondition {
  baseRevisionChanges: true;
  baseContentHashChanges: true;
}

export interface CanonicalCadExecutionContext {
  currentLocks: CanonicalCadLockEvidence[];
  evaluatedAt: string;
}

export type CanonicalCadOperationV2 =
  | { kind: 'create'; object: CanonicalCadObjectV2 }
  | { kind: 'update'; objectId: string; expectedObjectContentSha256: string; payload: CanonicalCadJsonObject }
  | { kind: 'delete'; objectId: string; expectedObjectContentSha256: string }
  | { kind: 'move'; objectId: string; expectedObjectContentSha256: string; transform: CanonicalCadTransform }
  | ({ kind: 'relate' } & (
      | { mode: 'create'; relationship: CanonicalCadRelationshipV2 }
      | { mode: 'delete'; relationshipId: string; expectedRelationshipContentSha256: string }
    ))
  | { kind: 'host'; relationship: CanonicalCadRelationshipV2 }
  | { kind: 'constraint'; targetObjectId: string; payload: CanonicalCadJsonObject }
  | { kind: 'feature'; targetObjectId: string; payload: CanonicalCadJsonObject }
  | { kind: 'assembly'; targetObjectId: string; payload: CanonicalCadJsonObject }
  | { kind: 'drawing'; targetObjectId: string; payload: CanonicalCadJsonObject };

export interface CanonicalCadCommandV2ConsumerDraft {
  schema: typeof CANONICAL_CAD_COMMAND_CONSUMER_DRAFT_SCHEMA;
  contractVersion: typeof CANONICAL_CAD_CONTRACT_VERSION;
  modelVersion: typeof CANONICAL_CAD_MODEL_VERSION;
  commandId: string;
  commandSha256: string;
  idempotencyKey: string;
  projectId: string;
  documentId: string;
  baseRevision: CanonicalCadRevisionRef;
  nextRevisionId: string;
  actor: CanonicalCadActor;
  units: CanonicalCadUnits;
  coordinateFrame: CanonicalCadCoordinateFrame;
  tolerancePolicy: CanonicalCadTolerancePolicy;
  preconditions: CanonicalCadPreconditions;
  dependencies: string[];
  compensationForCommandId: string | null;
  expectedChangedObjectIds: string[];
  artifacts: { inputs: CanonicalCadArtifactBinding[]; expectedOutputs: CanonicalCadArtifactBinding[] };
  authorization: CanonicalCadAuthorization;
  resourceBudget: CanonicalCadResourceBudget;
  sideEffects: CanonicalCadDeclaredSideEffects;
  verification: CanonicalCadVerificationPlan;
  timing: CanonicalCadTiming;
  staleIf: CanonicalCadStaleCondition;
  operations: CanonicalCadOperationV2[];
}

export type CanonicalCadDraftTransaction =
  | {
      committed: true;
      authority: 'CONSUMER_DRAFT';
      document: CanonicalCadDocumentV2ConsumerDraft;
      changedObjectIds: string[];
      changedRelationshipIds: string[];
      issues: [];
    }
  | {
      committed: false;
      authority: 'CONSUMER_DRAFT';
      document: CanonicalCadDocumentV2ConsumerDraft;
      changedObjectIds: [];
      changedRelationshipIds: [];
      issues: string[];
    };

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const KIND = /^[a-z][a-z0-9._:-]{0,127}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const DOMAINS: readonly CanonicalCadDomain[] = ['mechanical', 'building', 'interior', 'civil', 'landscape', 'coordination'];
const RELATIONSHIP_KINDS: readonly CanonicalCadRelationshipKind[] = ['HOST', 'UPSTREAM', 'RELATES', 'CONSTRAINS', 'ASSEMBLES', 'DRAWS'];
const MAX_DEPTH = 32;
const MAX_VALUES = 20_000;
const MAX_STRING = 10_000;
const MAX_OBJECTS = 10_000;
const MAX_RELATIONSHIPS = 20_000;
const RFC3339_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const DOCUMENT_KEYS = ['schema', 'contractVersion', 'modelVersion', 'authority', 'projectId', 'documentId', 'domains', 'revision', 'units', 'coordinateFrame', 'tolerancePolicy', 'objects', 'relationships', 'sourceBindings', 'verification', 'release'] as const;
const OBJECT_KEYS = ['objectId', 'namespace', 'objectKind', 'objectRevision', 'contentSha256', 'payload', 'transform'] as const;
const RELATIONSHIP_KEYS = ['relationshipId', 'kind', 'fromObjectId', 'toObjectId', 'relationshipRevision', 'contentSha256', 'payload'] as const;
const REVISION_KEYS = ['revisionId', 'sequence', 'contentSha256'] as const;
const UNITS_KEYS = ['length', 'angle'] as const;
const FRAME_KEYS = ['frameId', 'parentFrameId', 'origin', 'rotationDeg'] as const;
const TOLERANCE_KEYS = ['linear', 'angularDeg'] as const;
const TRANSFORM_KEYS = ['translation', 'rotationDeg'] as const;
const SOURCE_KEYS = ['schema', 'revision', 'contentSha256'] as const;
const COMMAND_KEYS = ['schema', 'contractVersion', 'modelVersion', 'commandId', 'commandSha256', 'idempotencyKey', 'projectId', 'documentId', 'baseRevision', 'nextRevisionId', 'actor', 'units', 'coordinateFrame', 'tolerancePolicy', 'preconditions', 'dependencies', 'compensationForCommandId', 'expectedChangedObjectIds', 'artifacts', 'authorization', 'resourceBudget', 'sideEffects', 'verification', 'timing', 'staleIf', 'operations'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some(key => typeof key !== 'string')) return false;
  if (ownKeys.some(key => !Object.getOwnPropertyDescriptor(value, key)?.enumerable)) return false;
  const actual = (ownKeys as string[]).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}

function isSha(value: unknown): value is string {
  return typeof value === 'string' && SHA256.test(value);
}

function finiteVec3(value: unknown): value is CanonicalCadVec3 {
  return Array.isArray(value) && value.length === 3
    && value.every(item => typeof item === 'number' && Number.isFinite(item));
}

function safeJson(value: unknown, depth = 0, count = { value: 0 }, ancestors = new Set<object>()): boolean {
  if (depth > MAX_DEPTH || ++count.value > MAX_VALUES) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= MAX_STRING;
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return false;
    const next = new Set(ancestors).add(value);
    return value.length <= MAX_VALUES && value.every(item => safeJson(item, depth + 1, count, next));
  }
  if (!isRecord(value)) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some(key => typeof key !== 'string') || ownKeys.length !== Object.keys(value).length) return false;
  if (ancestors.has(value)) return false;
  const next = new Set(ancestors).add(value);
  return Object.entries(value).every(([key, item]) => (
    key.length > 0 && key.length <= 128 && !FORBIDDEN_KEYS.has(key)
      && item !== undefined && safeJson(item, depth + 1, count, next)
  ));
}

/** Stable JSON for the consumer draft. Object keys sort; array order remains authored and semantic. */
export function canonicalCadConsumerDraftJson(value: unknown): string {
  if (!safeJson(value)) throw new Error('invalid_canonical_json');
  const visit = (item: CanonicalCadJsonValue): string => {
    if (Array.isArray(item)) return `[${item.map(visit).join(',')}]`;
    if (isRecord(item)) return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${visit(item[key] as CanonicalCadJsonValue)}`).join(',')}}`;
    return JSON.stringify(item);
  };
  return visit(value as CanonicalCadJsonValue);
}

function sha256(value: string): string {
  const hash = new Sha256();
  hash.update(value);
  return [...hash.digestSync()].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function jsonEqual(left: unknown, right: unknown): boolean {
  try { return canonicalCadConsumerDraftJson(left) === canonicalCadConsumerDraftJson(right); }
  catch { return false; }
}

export function hashCanonicalCadObjectV2(object: CanonicalCadObjectV2): string {
  return sha256(canonicalCadConsumerDraftJson({ ...object, contentSha256: '' }));
}

export function sealCanonicalCadObjectV2(input: Omit<CanonicalCadObjectV2, 'contentSha256'>): CanonicalCadObjectV2 {
  const draft = { ...structuredClone(input), contentSha256: '' } as CanonicalCadObjectV2;
  draft.contentSha256 = hashCanonicalCadObjectV2(draft);
  return draft;
}

export function hashCanonicalCadRelationshipV2(relationship: CanonicalCadRelationshipV2): string {
  return sha256(canonicalCadConsumerDraftJson({ ...relationship, contentSha256: '' }));
}

export function sealCanonicalCadRelationshipV2(input: Omit<CanonicalCadRelationshipV2, 'contentSha256'>): CanonicalCadRelationshipV2 {
  const draft = { ...structuredClone(input), contentSha256: '' } as CanonicalCadRelationshipV2;
  draft.contentSha256 = hashCanonicalCadRelationshipV2(draft);
  return draft;
}

export function hashCanonicalCadDocumentV2(document: CanonicalCadDocumentV2ConsumerDraft): string {
  const copy = structuredClone(document);
  copy.revision.contentSha256 = '';
  return sha256(canonicalCadConsumerDraftJson(copy as unknown as CanonicalCadJsonValue));
}

export function createCanonicalCadDocumentV2(input: Omit<CanonicalCadDocumentV2ConsumerDraft, 'schema' | 'contractVersion' | 'modelVersion' | 'authority' | 'verification' | 'release'>): CanonicalCadDocumentV2ConsumerDraft {
  const document: CanonicalCadDocumentV2ConsumerDraft = {
    schema: CANONICAL_CAD_DOCUMENT_CONSUMER_DRAFT_SCHEMA,
    contractVersion: CANONICAL_CAD_CONTRACT_VERSION,
    modelVersion: CANONICAL_CAD_MODEL_VERSION,
    authority: 'CONSUMER_DRAFT',
    ...structuredClone(input),
    verification: 'NOT_RUN',
    release: 'HOLD',
  };
  document.revision.contentSha256 = hashCanonicalCadDocumentV2(document);
  const issues = validateCanonicalCadDocumentV2(document);
  if (issues.length) throw new Error(issues.join(','));
  return document;
}

function validateRevision(value: unknown, path: string, issues: string[]): value is CanonicalCadRevisionRef {
  if (!isRecord(value) || !exactKeys(value, REVISION_KEYS)) { issues.push(`${path}_keys_invalid`); return false; }
  if (!isId(value.revisionId)) issues.push(`${path}_id_invalid`);
  if (!Number.isSafeInteger(value.sequence) || Number(value.sequence) < 0) issues.push(`${path}_sequence_invalid`);
  if (!isSha(value.contentSha256)) issues.push(`${path}_hash_invalid`);
  return true;
}

function validateUnits(value: unknown, path: string, issues: string[]): value is CanonicalCadUnits {
  if (!isRecord(value) || !exactKeys(value, UNITS_KEYS)) { issues.push(`${path}_keys_invalid`); return false; }
  if (value.length !== 'mm' && value.length !== 'm') issues.push(`${path}_length_invalid`);
  if (value.angle !== 'deg' && value.angle !== 'rad') issues.push(`${path}_angle_invalid`);
  return true;
}

function validateFrame(value: unknown, path: string, issues: string[]): value is CanonicalCadCoordinateFrame {
  if (!isRecord(value) || !exactKeys(value, FRAME_KEYS)) { issues.push(`${path}_keys_invalid`); return false; }
  if (!isId(value.frameId)) issues.push(`${path}_id_invalid`);
  if (value.parentFrameId !== null && !isId(value.parentFrameId)) issues.push(`${path}_parent_invalid`);
  if (!finiteVec3(value.origin)) issues.push(`${path}_origin_invalid`);
  if (!finiteVec3(value.rotationDeg)) issues.push(`${path}_rotation_invalid`);
  return true;
}

function validateTolerance(value: unknown, path: string, issues: string[]): value is CanonicalCadTolerancePolicy {
  if (!isRecord(value) || !exactKeys(value, TOLERANCE_KEYS)) { issues.push(`${path}_keys_invalid`); return false; }
  if (typeof value.linear !== 'number' || !Number.isFinite(value.linear) || value.linear <= 0) issues.push(`${path}_linear_invalid`);
  if (typeof value.angularDeg !== 'number' || !Number.isFinite(value.angularDeg) || value.angularDeg <= 0) issues.push(`${path}_angular_invalid`);
  return true;
}

function validateTransform(value: unknown, path: string, issues: string[]): value is CanonicalCadTransform {
  if (!isRecord(value) || !exactKeys(value, TRANSFORM_KEYS)) { issues.push(`${path}_keys_invalid`); return false; }
  if (!finiteVec3(value.translation)) issues.push(`${path}_translation_invalid`);
  if (!finiteVec3(value.rotationDeg)) issues.push(`${path}_rotation_invalid`);
  return true;
}

function validateObject(value: unknown, path: string, issues: string[]): value is CanonicalCadObjectV2 {
  if (!isRecord(value) || !exactKeys(value, OBJECT_KEYS)) { issues.push(`${path}_keys_invalid`); return false; }
  if (!isId(value.objectId)) issues.push(`${path}_id_invalid`);
  if (!DOMAINS.includes(value.namespace as CanonicalCadDomain)) issues.push(`${path}_namespace_invalid`);
  if (typeof value.objectKind !== 'string' || !KIND.test(value.objectKind)) issues.push(`${path}_kind_invalid`);
  if (!Number.isSafeInteger(value.objectRevision) || Number(value.objectRevision) < 0) issues.push(`${path}_revision_invalid`);
  if (!isRecord(value.payload) || !safeJson(value.payload)) issues.push(`${path}_payload_invalid`);
  if (value.transform !== null) validateTransform(value.transform, `${path}_transform`, issues);
  if (!isSha(value.contentSha256)) issues.push(`${path}_hash_invalid`);
  else {
    try {
      if (value.contentSha256 !== hashCanonicalCadObjectV2(value as unknown as CanonicalCadObjectV2)) issues.push(`${path}_hash_mismatch`);
    } catch { issues.push(`${path}_hash_mismatch`); }
  }
  return true;
}

function validateRelationship(value: unknown, path: string, issues: string[]): value is CanonicalCadRelationshipV2 {
  if (!isRecord(value) || !exactKeys(value, RELATIONSHIP_KEYS)) { issues.push(`${path}_keys_invalid`); return false; }
  if (!isId(value.relationshipId)) issues.push(`${path}_id_invalid`);
  if (!RELATIONSHIP_KINDS.includes(value.kind as CanonicalCadRelationshipKind)) issues.push(`${path}_kind_invalid`);
  if (!isId(value.fromObjectId)) issues.push(`${path}_from_invalid`);
  if (!isId(value.toObjectId)) issues.push(`${path}_to_invalid`);
  if (!Number.isSafeInteger(value.relationshipRevision) || Number(value.relationshipRevision) < 0) issues.push(`${path}_revision_invalid`);
  if (!isRecord(value.payload) || !safeJson(value.payload)) issues.push(`${path}_payload_invalid`);
  if (!isSha(value.contentSha256)) issues.push(`${path}_hash_invalid`);
  else {
    try {
      if (value.contentSha256 !== hashCanonicalCadRelationshipV2(value as unknown as CanonicalCadRelationshipV2)) issues.push(`${path}_hash_mismatch`);
    } catch { issues.push(`${path}_hash_mismatch`); }
  }
  return true;
}

function relationshipCycleIssues(relationships: readonly unknown[]): string[] {
  const edges = new Map<string, string[]>();
  for (const relation of relationships) {
    if (!isRecord(relation)) continue;
    if (relation.kind !== 'HOST' && relation.kind !== 'UPSTREAM') continue;
    if (!isId(relation.fromObjectId) || !isId(relation.toObjectId)) continue;
    const targets = edges.get(relation.fromObjectId);
    if (targets) targets.push(relation.toObjectId);
    else edges.set(relation.fromObjectId, [relation.toObjectId]);
  }
  const state = new Map<string, 1 | 2>();
  const issues = new Set<string>();
  for (const start of edges.keys()) {
    if (state.get(start) === 2) continue;
    const stack: Array<{ id: string; next: number }> = [{ id: start, next: 0 }];
    state.set(start, 1);
    while (stack.length) {
      const frame = stack[stack.length - 1]!;
      const targets = edges.get(frame.id) ?? [];
      if (frame.next >= targets.length) {
        state.set(frame.id, 2);
        stack.pop();
        continue;
      }
      const target = targets[frame.next++]!;
      if (state.get(target) === 1) { issues.add(`relationship_cycle:${target}`); continue; }
      if (state.get(target) === 2) continue;
      state.set(target, 1);
      stack.push({ id: target, next: 0 });
    }
  }
  return [...issues];
}

export function validateCanonicalCadDocumentV2(input: unknown): string[] {
  if (!isRecord(input) || !exactKeys(input, DOCUMENT_KEYS)) return ['document_keys_invalid'];
  const document = input as unknown as CanonicalCadDocumentV2ConsumerDraft;
  const issues: string[] = [];
  if (document.schema !== CANONICAL_CAD_DOCUMENT_CONSUMER_DRAFT_SCHEMA) issues.push('document_schema_invalid');
  if (document.contractVersion !== CANONICAL_CAD_CONTRACT_VERSION) issues.push('contract_version_invalid');
  if (document.modelVersion !== CANONICAL_CAD_MODEL_VERSION) issues.push('model_version_invalid');
  if (document.authority !== 'CONSUMER_DRAFT') issues.push('authority_invalid');
  if (!isId(document.projectId)) issues.push('project_id_invalid');
  if (!isId(document.documentId)) issues.push('document_id_invalid');
  if (!Array.isArray(document.domains) || document.domains.length === 0 || document.domains.length > DOMAINS.length || new Set(document.domains).size !== document.domains.length
    || document.domains.some(domain => !DOMAINS.includes(domain))) issues.push('domains_invalid');
  validateRevision(document.revision, 'revision', issues);
  validateUnits(document.units, 'units', issues);
  validateFrame(document.coordinateFrame, 'coordinate_frame', issues);
  validateTolerance(document.tolerancePolicy, 'tolerance_policy', issues);
  if (!Array.isArray(document.objects) || document.objects.length > MAX_OBJECTS) issues.push('objects_invalid');
  if (!Array.isArray(document.relationships) || document.relationships.length > MAX_RELATIONSHIPS) issues.push('relationships_invalid');
  if (!Array.isArray(document.sourceBindings) || document.sourceBindings.length === 0 || document.sourceBindings.length > 1_000) issues.push('source_bindings_invalid');

  const declaredDomains = Array.isArray(document.domains) ? document.domains.slice(0, DOMAINS.length) : [];
  const objectIds = new Set<string>();
  for (const [index, object] of (Array.isArray(document.objects) ? document.objects.slice(0, MAX_OBJECTS) : []).entries()) {
    const path = `objects[${index}]`;
    validateObject(object, path, issues);
    if (isRecord(object) && isId(object.objectId)) {
      if (objectIds.has(object.objectId)) issues.push(`${path}_id_duplicate`);
      objectIds.add(object.objectId);
    }
    if (isRecord(object) && DOMAINS.includes(object.namespace as CanonicalCadDomain) && !declaredDomains.includes(object.namespace as CanonicalCadDomain)) issues.push(`${path}_namespace_not_declared`);
  }

  const relationIds = new Set<string>();
  const boundedRelationships = Array.isArray(document.relationships) ? document.relationships.slice(0, MAX_RELATIONSHIPS) : [];
  for (const [index, relationship] of boundedRelationships.entries()) {
    const path = `relationships[${index}]`;
    validateRelationship(relationship, path, issues);
    if (!isRecord(relationship)) continue;
    if (isId(relationship.relationshipId)) {
      if (relationIds.has(relationship.relationshipId)) issues.push(`${path}_id_duplicate`);
      relationIds.add(relationship.relationshipId);
    }
    if (!objectIds.has(String(relationship.fromObjectId))) issues.push(`${path}_from_dangling`);
    if (!objectIds.has(String(relationship.toObjectId))) issues.push(`${path}_to_dangling`);
    if (relationship.fromObjectId === relationship.toObjectId) issues.push(`${path}_self_reference`);
  }
  issues.push(...relationshipCycleIssues(boundedRelationships));

  for (const [index, source] of (Array.isArray(document.sourceBindings) ? document.sourceBindings.slice(0, 1_000) : []).entries()) {
    const path = `source_bindings[${index}]`;
    if (!isRecord(source) || !exactKeys(source, SOURCE_KEYS)) { issues.push(`${path}_keys_invalid`); continue; }
    if (typeof source.schema !== 'string' || source.schema.length === 0 || source.schema.length > 256) issues.push(`${path}_schema_invalid`);
    if (typeof source.revision !== 'string' || source.revision.length === 0 || source.revision.length > 128) issues.push(`${path}_revision_invalid`);
    if (!isSha(source.contentSha256)) issues.push(`${path}_hash_invalid`);
  }
  if (document.verification !== 'NOT_RUN') issues.push('verification_promotion_blocked');
  if (document.release !== 'HOLD') issues.push('release_promotion_blocked');
  if (isSha(document.revision?.contentSha256)) {
    try {
      if (document.revision.contentSha256 !== hashCanonicalCadDocumentV2(document)) issues.push('document_hash_mismatch');
    } catch { issues.push('document_hash_mismatch'); }
  }
  return [...new Set(issues)];
}

export function hashCanonicalCadCommandV2(command: CanonicalCadCommandV2ConsumerDraft): string {
  return sha256(canonicalCadConsumerDraftJson({ ...command, commandSha256: '' }));
}

export function hashCanonicalCadLockSet(locks: readonly CanonicalCadLockEvidence[]): string {
  const ordered = [...structuredClone(locks)].sort((left, right) => left.lockId.localeCompare(right.lockId));
  return sha256(canonicalCadConsumerDraftJson(ordered as unknown as CanonicalCadJsonValue));
}

export function sealCanonicalCadCommandV2(input: Omit<CanonicalCadCommandV2ConsumerDraft, 'schema' | 'contractVersion' | 'modelVersion' | 'commandSha256'>): CanonicalCadCommandV2ConsumerDraft {
  const command: CanonicalCadCommandV2ConsumerDraft = {
    schema: CANONICAL_CAD_COMMAND_CONSUMER_DRAFT_SCHEMA,
    contractVersion: CANONICAL_CAD_CONTRACT_VERSION,
    modelVersion: CANONICAL_CAD_MODEL_VERSION,
    ...structuredClone(input),
    commandSha256: '',
  };
  command.commandSha256 = hashCanonicalCadCommandV2(command);
  const issues = validateCanonicalCadCommandV2(command);
  if (issues.length) throw new Error(issues.join(','));
  return command;
}

function validateArtifactArray(value: unknown, path: string, issues: string[]): void {
  if (!Array.isArray(value) || value.length > 1_000) { issues.push(`${path}_invalid`); return; }
  const ids = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (!isRecord(item) || !exactKeys(item, ['artifactId', 'contentSha256'])) { issues.push(`${path}[${index}]_keys_invalid`); continue; }
    if (!isId(item.artifactId) || ids.has(item.artifactId)) issues.push(`${path}[${index}]_id_invalid`); else ids.add(item.artifactId);
    if (!isSha(item.contentSha256)) issues.push(`${path}[${index}]_hash_invalid`);
  }
}

function validateOperation(operation: unknown, index: number, issues: string[]): void {
  const path = `operations[${index}]`;
  if (!isRecord(operation) || typeof operation.kind !== 'string') { issues.push(`${path}_invalid`); return; }
  if (operation.kind === 'create') {
    if (!exactKeys(operation, ['kind', 'object'])) issues.push(`${path}_keys_invalid`);
    else validateObject(operation.object, `${path}_object`, issues);
  } else if (operation.kind === 'update') {
    if (!exactKeys(operation, ['kind', 'objectId', 'expectedObjectContentSha256', 'payload'])) issues.push(`${path}_keys_invalid`);
    if (!isId(operation.objectId)) issues.push(`${path}_object_id_invalid`);
    if (!isSha(operation.expectedObjectContentSha256)) issues.push(`${path}_expected_hash_invalid`);
    if (!isRecord(operation.payload) || !safeJson(operation.payload)) issues.push(`${path}_payload_invalid`);
  } else if (operation.kind === 'delete') {
    if (!exactKeys(operation, ['kind', 'objectId', 'expectedObjectContentSha256'])) issues.push(`${path}_keys_invalid`);
    if (!isId(operation.objectId)) issues.push(`${path}_object_id_invalid`);
    if (!isSha(operation.expectedObjectContentSha256)) issues.push(`${path}_expected_hash_invalid`);
  } else if (operation.kind === 'move') {
    if (!exactKeys(operation, ['kind', 'objectId', 'expectedObjectContentSha256', 'transform'])) issues.push(`${path}_keys_invalid`);
    if (!isId(operation.objectId)) issues.push(`${path}_object_id_invalid`);
    if (!isSha(operation.expectedObjectContentSha256)) issues.push(`${path}_expected_hash_invalid`);
    validateTransform(operation.transform, `${path}_transform`, issues);
  } else if (operation.kind === 'relate') {
    if (operation.mode === 'create') {
      if (!exactKeys(operation, ['kind', 'mode', 'relationship'])) issues.push(`${path}_keys_invalid`);
      else validateRelationship(operation.relationship, `${path}_relationship`, issues);
    } else if (operation.mode === 'delete') {
      if (!exactKeys(operation, ['kind', 'mode', 'relationshipId', 'expectedRelationshipContentSha256'])) issues.push(`${path}_keys_invalid`);
      if (!isId(operation.relationshipId)) issues.push(`${path}_relationship_id_invalid`);
      if (!isSha(operation.expectedRelationshipContentSha256)) issues.push(`${path}_expected_hash_invalid`);
    } else issues.push(`${path}_mode_invalid`);
  } else if (operation.kind === 'host') {
    if (!exactKeys(operation, ['kind', 'relationship'])) issues.push(`${path}_keys_invalid`);
    else {
      validateRelationship(operation.relationship, `${path}_relationship`, issues);
      if (isRecord(operation.relationship) && operation.relationship.kind !== 'HOST') issues.push(`${path}_host_kind_required`);
    }
  } else if (['constraint', 'feature', 'assembly', 'drawing'].includes(operation.kind)) {
    if (!exactKeys(operation, ['kind', 'targetObjectId', 'payload'])) issues.push(`${path}_keys_invalid`);
    if (!isId(operation.targetObjectId)) issues.push(`${path}_target_invalid`);
    if (!isRecord(operation.payload) || !safeJson(operation.payload)) issues.push(`${path}_payload_invalid`);
  } else issues.push(`${path}_kind_invalid`);
}

function validateLockArray(value: unknown, pathPrefix: string, issues: string[]): value is CanonicalCadLockEvidence[] {
  if (!Array.isArray(value) || value.length > 10_000) { issues.push(`${pathPrefix}_invalid`); return false; }
  const lockIds = new Set<string>();
  for (const [index, lock] of value.entries()) {
    const path = `${pathPrefix}[${index}]`;
    if (!isRecord(lock) || !exactKeys(lock, ['lockId', 'scope', 'objectId', 'fieldPath', 'ownerActorId', 'source'])) { issues.push(`${path}_keys_invalid`); continue; }
    if (!isId(lock.lockId) || lockIds.has(lock.lockId)) issues.push(`${path}_id_invalid`); else lockIds.add(lock.lockId);
    if (!['workspace', 'object', 'field'].includes(String(lock.scope)) || !isId(lock.objectId) || !isId(lock.ownerActorId) || !['human', 'authority'].includes(String(lock.source))) issues.push(`${path}_invalid`);
    if ((lock.scope === 'field' && (typeof lock.fieldPath !== 'string' || lock.fieldPath.length === 0 || lock.fieldPath.length > 256))
      || (lock.scope !== 'field' && lock.fieldPath !== null)) issues.push(`${path}_field_invalid`);
  }
  return true;
}

export function validateCanonicalCadCommandV2(input: unknown): string[] {
  if (!isRecord(input) || !exactKeys(input, COMMAND_KEYS)) return ['command_keys_invalid'];
  const command = input as unknown as CanonicalCadCommandV2ConsumerDraft;
  const issues: string[] = [];
  if (command.schema !== CANONICAL_CAD_COMMAND_CONSUMER_DRAFT_SCHEMA) issues.push('command_schema_invalid');
  if (command.contractVersion !== CANONICAL_CAD_CONTRACT_VERSION) issues.push('contract_version_invalid');
  if (command.modelVersion !== CANONICAL_CAD_MODEL_VERSION) issues.push('model_version_invalid');
  if (!isId(command.commandId)) issues.push('command_id_invalid');
  if (!isSha(command.commandSha256)) issues.push('command_hash_invalid');
  if (!isId(command.idempotencyKey)) issues.push('idempotency_key_invalid');
  if (!isId(command.projectId)) issues.push('project_id_invalid');
  if (!isId(command.documentId)) issues.push('document_id_invalid');
  validateRevision(command.baseRevision, 'base_revision', issues);
  if (!isId(command.nextRevisionId) || command.nextRevisionId === command.baseRevision?.revisionId) issues.push('next_revision_id_invalid');
  if (!isRecord(command.actor) || !exactKeys(command.actor, ['kind', 'actorId', 'agentIdentity'])) issues.push('actor_keys_invalid');
  else {
    if (!['human', 'agent', 'system'].includes(String(command.actor.kind)) || !isId(command.actor.actorId)) issues.push('actor_invalid');
    if (command.actor.kind === 'agent') {
      const identity = command.actor.agentIdentity;
      if (!isRecord(identity) || !exactKeys(identity, ['agentId', 'modelId', 'promptSha256']) || !isId(identity.agentId) || !isId(identity.modelId) || !isSha(identity.promptSha256)) issues.push('agent_identity_invalid');
    } else if (command.actor.agentIdentity !== null) issues.push('agent_identity_forbidden');
  }
  validateUnits(command.units, 'units', issues);
  validateFrame(command.coordinateFrame, 'coordinate_frame', issues);
  validateTolerance(command.tolerancePolicy, 'tolerance_policy', issues);
  if (!isRecord(command.preconditions) || !exactKeys(command.preconditions, ['lockSetSha256', 'locks', 'selectedObjectIds', 'parameterPaths'])) issues.push('preconditions_keys_invalid');
  else {
    const locks = command.preconditions.locks;
    if (validateLockArray(locks, 'locks', issues)) {
      if (!isSha(command.preconditions.lockSetSha256) || command.preconditions.lockSetSha256 !== hashCanonicalCadLockSet(locks as CanonicalCadLockEvidence[])) issues.push('lock_set_hash_mismatch');
    }
    for (const [name, values] of [['selected_object_ids', command.preconditions.selectedObjectIds], ['parameter_paths', command.preconditions.parameterPaths]] as const) {
      if (!Array.isArray(values) || values.length > 10_000 || values.some(value => typeof value !== 'string' || value.length === 0 || value.length > 256) || new Set(values).size !== values.length) issues.push(`${name}_invalid`);
    }
  }
  for (const [name, values] of [['dependencies', command.dependencies], ['expected_changed_object_ids', command.expectedChangedObjectIds]] as const) {
    if (!Array.isArray(values) || values.length > 10_000 || values.some(value => !isId(value)) || new Set(values).size !== values.length) issues.push(`${name}_invalid`);
  }
  if (Array.isArray(command.dependencies) && command.dependencies.includes(command.commandId)) issues.push('command_dependency_self_reference');
  if (command.compensationForCommandId !== null && (!isId(command.compensationForCommandId) || command.compensationForCommandId === command.commandId)) issues.push('compensation_command_invalid');
  if (!isRecord(command.artifacts) || !exactKeys(command.artifacts, ['inputs', 'expectedOutputs'])) issues.push('artifacts_keys_invalid');
  else {
    validateArtifactArray(command.artifacts.inputs, 'artifact_inputs', issues);
    validateArtifactArray(command.artifacts.expectedOutputs, 'artifact_outputs', issues);
  }
  if (!isRecord(command.authorization) || !exactKeys(command.authorization, ['permission', 'riskClass', 'approvalScope', 'approvalReceiptSha256'])) issues.push('authorization_keys_invalid');
  else {
    if (command.authorization.permission !== 'EDIT_DOCUMENT' || !['R0', 'R1', 'R2', 'R3', 'R4'].includes(String(command.authorization.riskClass))) issues.push('authorization_invalid');
    if (typeof command.authorization.approvalScope !== 'string' || command.authorization.approvalScope.length === 0 || command.authorization.approvalScope.length > 512) issues.push('approval_scope_invalid');
    if (command.authorization.approvalReceiptSha256 !== null && !isSha(command.authorization.approvalReceiptSha256)) issues.push('approval_receipt_invalid');
  }
  if (!isRecord(command.resourceBudget) || !exactKeys(command.resourceBudget, ['timeoutMs', 'memoryMb', 'maxIterations', 'maxRetries'])) issues.push('resource_budget_keys_invalid');
  else {
    const limits = { timeoutMs: [1, 3_600_000], memoryMb: [1, 131_072], maxIterations: [1, 1_000_000], maxRetries: [0, 100] } as const;
    for (const [key, [min, max]] of Object.entries(limits)) {
      const value = command.resourceBudget[key as keyof CanonicalCadResourceBudget];
      if (!Number.isSafeInteger(value) || value < min || value > max) issues.push(`resource_budget_${key}_invalid`);
    }
  }
  if (!isRecord(command.sideEffects) || !exactKeys(command.sideEffects, ['canonicalDocument', 'externalTransmission', 'quoteOrRfq'])
    || command.sideEffects.canonicalDocument !== true || command.sideEffects.externalTransmission !== false || command.sideEffects.quoteOrRfq !== false) issues.push('side_effects_invalid');
  if (!isRecord(command.verification) || !exactKeys(command.verification, ['verifierIds', 'blockers'])
    || !Array.isArray(command.verification.verifierIds) || command.verification.verifierIds.length > 1_000 || command.verification.verifierIds.some(value => !isId(value))
    || new Set(command.verification.verifierIds).size !== command.verification.verifierIds.length
    || !Array.isArray(command.verification.blockers) || command.verification.blockers.length > 1_000 || command.verification.blockers.some(value => typeof value !== 'string' || value.length > 512)) issues.push('verification_plan_invalid');
  if (!isRecord(command.timing) || !exactKeys(command.timing, ['issuedAt', 'expiresAt'])) issues.push('timing_keys_invalid');
  else {
    const issued = Date.parse(String(command.timing.issuedAt)); const expires = Date.parse(String(command.timing.expiresAt));
    if (typeof command.timing.issuedAt !== 'string' || typeof command.timing.expiresAt !== 'string'
      || !RFC3339_INSTANT.test(command.timing.issuedAt) || !RFC3339_INSTANT.test(command.timing.expiresAt)
      || !Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued) issues.push('timing_invalid');
  }
  if (!isRecord(command.staleIf) || !exactKeys(command.staleIf, ['baseRevisionChanges', 'baseContentHashChanges'])
    || command.staleIf.baseRevisionChanges !== true || command.staleIf.baseContentHashChanges !== true) issues.push('stale_condition_invalid');
  if (!Array.isArray(command.operations) || command.operations.length === 0 || command.operations.length > 128) issues.push('operations_invalid');
  else command.operations.forEach((operation, index) => validateOperation(operation, index, issues));
  if (isSha(command.commandSha256)) {
    try {
      if (command.commandSha256 !== hashCanonicalCadCommandV2(command)) issues.push('command_hash_mismatch');
    } catch { issues.push('command_hash_mismatch'); }
  }
  return [...new Set(issues)];
}

const fail = (document: CanonicalCadDocumentV2ConsumerDraft, issues: string[]): CanonicalCadDraftTransaction => ({
  committed: false,
  authority: 'CONSUMER_DRAFT',
  document,
  changedObjectIds: [],
  changedRelationshipIds: [],
  issues: [...new Set(issues)],
});

function sameRevision(left: CanonicalCadRevisionRef, right: CanonicalCadRevisionRef): boolean {
  return left.revisionId === right.revisionId && left.sequence === right.sequence && left.contentSha256 === right.contentSha256;
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function operationTouches(operation: CanonicalCadOperationV2, document: CanonicalCadDocumentV2ConsumerDraft): { objectIds: string[]; fieldPaths: string[] } {
  if (operation.kind === 'create') return { objectIds: [operation.object.objectId], fieldPaths: ['object'] };
  if (operation.kind === 'update') return { objectIds: [operation.objectId], fieldPaths: ['payload'] };
  if (operation.kind === 'delete') return { objectIds: [operation.objectId], fieldPaths: ['*'] };
  if (operation.kind === 'move') return { objectIds: [operation.objectId], fieldPaths: ['transform'] };
  if (operation.kind === 'host') return { objectIds: [operation.relationship.fromObjectId, operation.relationship.toObjectId], fieldPaths: ['relationships'] };
  if (operation.kind === 'relate') {
    if (operation.mode === 'create') return { objectIds: [operation.relationship.fromObjectId, operation.relationship.toObjectId], fieldPaths: ['relationships'] };
    const relationship = document.relationships.find(item => item.relationshipId === operation.relationshipId);
    return { objectIds: relationship ? [relationship.fromObjectId, relationship.toObjectId] : [], fieldPaths: ['relationships'] };
  }
  return { objectIds: [operation.targetObjectId], fieldPaths: [operation.kind] };
}

function lockBlocks(lock: CanonicalCadLockEvidence, command: CanonicalCadCommandV2ConsumerDraft, touch: { objectIds: string[]; fieldPaths: string[] }): boolean {
  if (lock.source === 'human' && lock.ownerActorId === command.actor.actorId) return false;
  if (lock.scope === 'workspace') return true;
  if (!touch.objectIds.includes(lock.objectId)) return false;
  if (lock.scope === 'object') return true;
  if (touch.fieldPaths.includes('*')) return true;
  const field = lock.fieldPath ?? '';
  return touch.fieldPaths.some(path => path === field || path.startsWith(`${field}.`) || field.startsWith(`${path}.`));
}

/**
 * Applies only universal document-graph operations. Domain operations remain
 * declared in the contract but fail closed until a dedicated Precision
 * handler proves their exact/domain semantics.
 */
export function applyCanonicalCadCommandV2(
  document: CanonicalCadDocumentV2ConsumerDraft,
  command: CanonicalCadCommandV2ConsumerDraft,
  execution: CanonicalCadExecutionContext,
): CanonicalCadDraftTransaction {
  const issues = [...validateCanonicalCadDocumentV2(document), ...validateCanonicalCadCommandV2(command)];
  if (!isRecord(execution) || !exactKeys(execution, ['currentLocks', 'evaluatedAt'])) issues.push('execution_context_invalid');
  else {
    const currentLocks: CanonicalCadLockEvidence[] = [];
    const lockIssues: string[] = [];
    if (validateLockArray(execution.currentLocks, 'current_locks', lockIssues)) currentLocks.push(...execution.currentLocks);
    issues.push(...lockIssues);
    if (typeof execution.evaluatedAt !== 'string' || !RFC3339_INSTANT.test(execution.evaluatedAt)) issues.push('execution_time_invalid');
    else {
      const evaluatedAt = Date.parse(execution.evaluatedAt);
      const issuedAt = Date.parse(command.timing?.issuedAt);
      const expiresAt = Date.parse(command.timing?.expiresAt);
      if (Number.isFinite(evaluatedAt) && Number.isFinite(issuedAt) && evaluatedAt < issuedAt) issues.push('command_not_yet_valid');
      if (Number.isFinite(evaluatedAt) && Number.isFinite(expiresAt) && evaluatedAt >= expiresAt) issues.push('command_expired');
    }
    if (command.preconditions && hashCanonicalCadLockSet(currentLocks) !== command.preconditions.lockSetSha256) issues.push('lock_snapshot_stale');
  }
  if (document.projectId !== command.projectId) issues.push('project_mismatch');
  if (document.documentId !== command.documentId) issues.push('document_mismatch');
  if (!sameRevision(document.revision, command.baseRevision)) issues.push('stale_base_revision');
  if (!jsonEqual(document.units, command.units)) issues.push('units_mismatch');
  if (!jsonEqual(document.coordinateFrame, command.coordinateFrame)) issues.push('coordinate_frame_mismatch');
  if (!jsonEqual(document.tolerancePolicy, command.tolerancePolicy)) issues.push('tolerance_policy_mismatch');
  if (command.authorization?.riskClass === 'R0' || command.authorization?.riskClass === 'R1') issues.push('mutation_risk_class_too_low');
  if (command.authorization?.riskClass === 'R3') issues.push('trusted_approval_boundary_required');
  if (command.authorization?.riskClass === 'R4') issues.push('governed_workflow_required');
  if (issues.length) return fail(document, issues);

  const next = structuredClone(document);
  const changedObjects = new Set<string>();
  const changedRelationships = new Set<string>();

  for (const operation of command.operations) {
    const touch = operationTouches(operation, next);
    if (execution.currentLocks.some(lock => lockBlocks(lock, command, touch))) return fail(document, ['protected_by_lock']);
    if (operation.kind === 'constraint' || operation.kind === 'feature' || operation.kind === 'assembly' || operation.kind === 'drawing') {
      return fail(document, [`domain_handler_required:${operation.kind}`]);
    }
    if (operation.kind === 'create') {
      if (next.objects.some(object => object.objectId === operation.object.objectId)) return fail(document, ['object_id_exists']);
      next.objects.push(structuredClone(operation.object));
      changedObjects.add(operation.object.objectId);
      continue;
    }
    if (operation.kind === 'update' || operation.kind === 'move' || operation.kind === 'delete') {
      const index = next.objects.findIndex(object => object.objectId === operation.objectId);
      const object = next.objects[index];
      if (!object) return fail(document, ['object_not_found']);
      if (object.contentSha256 !== operation.expectedObjectContentSha256) return fail(document, ['object_hash_conflict']);
      if (operation.kind === 'delete') {
        if (next.relationships.some(relation => relation.fromObjectId === object.objectId || relation.toObjectId === object.objectId)) return fail(document, ['object_relationships_must_be_removed_first']);
        next.objects.splice(index, 1);
      } else if (operation.kind === 'update') {
        if (jsonEqual(object.payload, operation.payload)) return fail(document, ['no_effect']);
        next.objects[index] = sealCanonicalCadObjectV2({ ...object, objectRevision: object.objectRevision + 1, payload: structuredClone(operation.payload) });
      } else {
        if (jsonEqual(object.transform, operation.transform)) return fail(document, ['no_effect']);
        next.objects[index] = sealCanonicalCadObjectV2({ ...object, objectRevision: object.objectRevision + 1, transform: structuredClone(operation.transform) });
      }
      changedObjects.add(object.objectId);
      continue;
    }
    if (operation.kind === 'host') {
      if (operation.relationship.kind !== 'HOST') return fail(document, ['host_relationship_kind_required']);
      if (next.relationships.some(relation => relation.relationshipId === operation.relationship.relationshipId)) return fail(document, ['relationship_id_exists']);
      if (!next.objects.some(object => object.objectId === operation.relationship.fromObjectId)
        || !next.objects.some(object => object.objectId === operation.relationship.toObjectId)) return fail(document, ['relationship_object_missing']);
      next.relationships.push(structuredClone(operation.relationship));
      changedRelationships.add(operation.relationship.relationshipId);
      changedObjects.add(operation.relationship.fromObjectId);
      changedObjects.add(operation.relationship.toObjectId);
      continue;
    }
    if (operation.mode === 'create') {
      if (next.relationships.some(relation => relation.relationshipId === operation.relationship.relationshipId)) return fail(document, ['relationship_id_exists']);
      if (!next.objects.some(object => object.objectId === operation.relationship.fromObjectId)
        || !next.objects.some(object => object.objectId === operation.relationship.toObjectId)) return fail(document, ['relationship_object_missing']);
      next.relationships.push(structuredClone(operation.relationship));
      changedRelationships.add(operation.relationship.relationshipId);
      changedObjects.add(operation.relationship.fromObjectId);
      changedObjects.add(operation.relationship.toObjectId);
    } else {
      const index = next.relationships.findIndex(relation => relation.relationshipId === operation.relationshipId);
      const relationship = next.relationships[index];
      if (!relationship) return fail(document, ['relationship_not_found']);
      if (relationship.contentSha256 !== operation.expectedRelationshipContentSha256) return fail(document, ['relationship_hash_conflict']);
      next.relationships.splice(index, 1);
      changedRelationships.add(relationship.relationshipId);
      changedObjects.add(relationship.fromObjectId);
      changedObjects.add(relationship.toObjectId);
    }
  }

  const actualChanged = sortedUnique(changedObjects);
  if (actualChanged.length === 0) return fail(document, ['no_effect']);
  if (jsonEqual(next.objects, document.objects) && jsonEqual(next.relationships, document.relationships)) return fail(document, ['no_effect']);
  if (!jsonEqual(actualChanged, sortedUnique(command.expectedChangedObjectIds))) return fail(document, ['changed_object_set_mismatch']);

  next.revision = { revisionId: command.nextRevisionId, sequence: document.revision.sequence + 1, contentSha256: '' };
  next.verification = 'NOT_RUN';
  next.release = 'HOLD';
  next.revision.contentSha256 = hashCanonicalCadDocumentV2(next);
  const finalIssues = validateCanonicalCadDocumentV2(next);
  if (finalIssues.length) return fail(document, finalIssues.map(issue => `result:${issue}`));
  return {
    committed: true,
    authority: 'CONSUMER_DRAFT',
    document: next,
    changedObjectIds: actualChanged,
    changedRelationshipIds: sortedUnique(changedRelationships),
    issues: [],
  };
}
