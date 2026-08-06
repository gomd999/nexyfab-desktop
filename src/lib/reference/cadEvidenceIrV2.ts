import { createHash } from 'node:crypto';
import type { CadCorpusEvidence, EvidenceStatus } from './cadCorpusEvidence';

export type EvidenceAssertionStatus = EvidenceStatus;
export type EvidenceScalar = string | number | boolean | null;

export interface EvidenceArtifactRefV2 {
  sha256: string;
  role: 'input' | 'measurement' | 'report' | 'output' | 'log';
  mediaType?: string;
  sizeBytes?: number;
}

export interface EvidenceCriterionV2 {
  description: string;
  operator?: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'within' | 'exists';
  expected?: EvidenceScalar;
  tolerance?: number;
  toleranceUnit?: string;
}

export interface EvidenceAssertionV2 {
  id: string;
  status: EvidenceAssertionStatus;
  method: string;
  criterion: EvidenceCriterionV2;
  measured?: EvidenceScalar;
  unit?: string;
  confidence: number;
  reason: string;
  artifactHashes: string[];
}

export interface EvidenceSideEffectsV2 {
  quoteCreated: boolean;
  rfqSent: boolean;
  sourceModified: boolean;
  additional: string[];
}

export interface CadEvidenceIrV2 {
  schemaVersion: 2;
  scenarioId: string;
  input: {
    sha256: string;
    extension: string;
    sizeBytes: number;
  };
  producer: {
    adapter: string;
    version: string;
  };
  status: EvidenceStatus;
  assertions: EvidenceAssertionV2[];
  artifacts: EvidenceArtifactRefV2[];
  sideEffects: EvidenceSideEffectsV2;
  /** Informational only; omitted from canonical serialization by default. */
  generatedAt?: string;
}

export interface EvidenceValidationIssue {
  path: string;
  message: string;
}

export type EvidenceValidationResult =
  | { ok: true; value: CadEvidenceIrV2; issues: [] }
  | { ok: false; issues: EvidenceValidationIssue[] };

const SHA256 = /^[a-f0-9]{64}$/;
const STATUSES = new Set<EvidenceStatus>(['pass', 'fail', 'not_run']);
const ARTIFACT_ROLES = new Set<EvidenceArtifactRefV2['role']>(['input', 'measurement', 'report', 'output', 'log']);
const OPERATORS = new Set<NonNullable<EvidenceCriterionV2['operator']>>(['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'within', 'exists']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function scalar(value: unknown): value is EvidenceScalar {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || finiteNumber(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function deriveEvidenceStatus(assertions: ReadonlyArray<Pick<EvidenceAssertionV2, 'status'>>): EvidenceStatus {
  if (assertions.some(item => item.status === 'fail')) return 'fail';
  if (assertions.length === 0 || assertions.some(item => item.status === 'not_run')) return 'not_run';
  return 'pass';
}

/** Strict runtime validation. Unknown fields are retained, but all governed fields fail closed. */
export function validateCadEvidenceIrV2(value: unknown): EvidenceValidationResult {
  const issues: EvidenceValidationIssue[] = [];
  const issue = (path: string, message: string) => issues.push({ path, message });
  if (!isRecord(value)) return { ok: false, issues: [{ path: '$', message: 'Expected an object.' }] };

  if (value.schemaVersion !== 2) issue('schemaVersion', 'Expected schemaVersion 2.');
  if (!nonEmpty(value.scenarioId)) issue('scenarioId', 'Expected a non-empty string.');

  const input = value.input;
  if (!isRecord(input)) issue('input', 'Expected an object.');
  else {
    if (typeof input.sha256 !== 'string' || !SHA256.test(input.sha256)) issue('input.sha256', 'Expected a lowercase SHA-256 hex digest.');
    if (!nonEmpty(input.extension)) issue('input.extension', 'Expected a non-empty extension.');
    if (!Number.isSafeInteger(input.sizeBytes) || (input.sizeBytes as number) < 0) issue('input.sizeBytes', 'Expected a non-negative safe integer.');
  }

  const producer = value.producer;
  if (!isRecord(producer)) issue('producer', 'Expected an object.');
  else {
    if (!nonEmpty(producer.adapter)) issue('producer.adapter', 'Expected a non-empty string.');
    if (!nonEmpty(producer.version)) issue('producer.version', 'Expected a non-empty string.');
  }

  if (!STATUSES.has(value.status as EvidenceStatus)) issue('status', 'Expected pass, fail, or not_run.');
  const assertions = value.assertions;
  if (!Array.isArray(assertions)) issue('assertions', 'Expected an array.');
  else {
    const ids = new Set<string>();
    assertions.forEach((raw, index) => {
      const path = `assertions[${index}]`;
      if (!isRecord(raw)) { issue(path, 'Expected an object.'); return; }
      if (!nonEmpty(raw.id)) issue(`${path}.id`, 'Expected a non-empty string.');
      else if (ids.has(raw.id)) issue(`${path}.id`, 'Assertion ids must be unique.');
      else ids.add(raw.id);
      if (!STATUSES.has(raw.status as EvidenceStatus)) issue(`${path}.status`, 'Expected pass, fail, or not_run.');
      if (!nonEmpty(raw.method)) issue(`${path}.method`, 'Expected a non-empty method.');
      if (!nonEmpty(raw.reason)) issue(`${path}.reason`, 'Expected a non-empty reason.');
      if (!finiteNumber(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) issue(`${path}.confidence`, 'Expected a finite number from 0 through 1.');
      if ('measured' in raw && !scalar(raw.measured)) issue(`${path}.measured`, 'Expected a finite scalar; NaN and Infinity are forbidden.');
      if ('unit' in raw && !nonEmpty(raw.unit)) issue(`${path}.unit`, 'Expected a non-empty string when present.');
      if (!Array.isArray(raw.artifactHashes)) issue(`${path}.artifactHashes`, 'Expected an array.');
      else raw.artifactHashes.forEach((hash, hashIndex) => {
        if (typeof hash !== 'string' || !SHA256.test(hash)) issue(`${path}.artifactHashes[${hashIndex}]`, 'Expected a lowercase SHA-256 hex digest.');
      });
      if (!isRecord(raw.criterion)) issue(`${path}.criterion`, 'Expected an object.');
      else {
        if (!nonEmpty(raw.criterion.description)) issue(`${path}.criterion.description`, 'Expected a non-empty description.');
        if ('operator' in raw.criterion && !OPERATORS.has(raw.criterion.operator as NonNullable<EvidenceCriterionV2['operator']>)) issue(`${path}.criterion.operator`, 'Unsupported criterion operator.');
        if ('expected' in raw.criterion && !scalar(raw.criterion.expected)) issue(`${path}.criterion.expected`, 'Expected a finite scalar; NaN and Infinity are forbidden.');
        if ('tolerance' in raw.criterion && (!finiteNumber(raw.criterion.tolerance) || raw.criterion.tolerance < 0)) issue(`${path}.criterion.tolerance`, 'Expected a finite non-negative number.');
        if ('toleranceUnit' in raw.criterion && !nonEmpty(raw.criterion.toleranceUnit)) issue(`${path}.criterion.toleranceUnit`, 'Expected a non-empty string when present.');
      }
    });
    if (STATUSES.has(value.status as EvidenceStatus) && value.status !== deriveEvidenceStatus(assertions.filter(isRecord) as unknown as EvidenceAssertionV2[])) {
      issue('status', 'Document status must equal the fail-closed status derived from its assertions.');
    }
  }

  const artifacts = value.artifacts;
  if (!Array.isArray(artifacts)) issue('artifacts', 'Expected an array.');
  else artifacts.forEach((raw, index) => {
    const path = `artifacts[${index}]`;
    if (!isRecord(raw)) { issue(path, 'Expected an object.'); return; }
    if (typeof raw.sha256 !== 'string' || !SHA256.test(raw.sha256)) issue(`${path}.sha256`, 'Expected a lowercase SHA-256 hex digest.');
    if (!ARTIFACT_ROLES.has(raw.role as EvidenceArtifactRefV2['role'])) issue(`${path}.role`, 'Unsupported artifact role.');
    if ('mediaType' in raw && !nonEmpty(raw.mediaType)) issue(`${path}.mediaType`, 'Expected a non-empty string when present.');
    if ('sizeBytes' in raw && (!Number.isSafeInteger(raw.sizeBytes) || (raw.sizeBytes as number) < 0)) issue(`${path}.sizeBytes`, 'Expected a non-negative safe integer.');
  });

  const sideEffects = value.sideEffects;
  if (!isRecord(sideEffects)) issue('sideEffects', 'Expected an object.');
  else {
    for (const key of ['quoteCreated', 'rfqSent', 'sourceModified'] as const) {
      if (typeof sideEffects[key] !== 'boolean') issue(`sideEffects.${key}`, 'Expected a boolean.');
    }
    if (!Array.isArray(sideEffects.additional) || sideEffects.additional.some(item => !nonEmpty(item))) issue('sideEffects.additional', 'Expected an array of non-empty strings.');
  }
  if ('generatedAt' in value && (typeof value.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.generatedAt)))) issue('generatedAt', 'Expected an ISO-compatible timestamp when present.');

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: value as unknown as CadEvidenceIrV2, issues: [] };
}

function canonicalize(value: unknown, omitTimestamp: boolean): unknown {
  if (Array.isArray(value)) return value.map(item => canonicalize(item, omitTimestamp));
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (omitTimestamp && key === 'generatedAt') continue;
    const child = value[key];
    if (child !== undefined) result[key] = canonicalize(child, omitTimestamp);
  }
  return result;
}

export function serializeCadEvidenceCanonical(value: CadEvidenceIrV2, options: { includeTimestamp?: boolean } = {}): string {
  const checked = validateCadEvidenceIrV2(value);
  if (!checked.ok) throw new TypeError(`Invalid CadEvidenceIrV2: ${checked.issues.map(item => `${item.path}: ${item.message}`).join('; ')}`);
  return JSON.stringify(canonicalize(checked.value, options.includeTimestamp !== true));
}

export function hashCadEvidenceCanonical(value: CadEvidenceIrV2, options: { includeTimestamp?: boolean } = {}): string {
  return createHash('sha256').update(serializeCadEvidenceCanonical(value, options)).digest('hex');
}

function inferUnit(measured: EvidenceScalar | undefined): string | undefined {
  return typeof measured === 'number' ? 'count' : undefined;
}

/** Lossless-for-v1-fields migration. Missing v2 semantics are explicitly labelled as migrated legacy evidence. */
export function migrateCadCorpusEvidenceV1(value: CadCorpusEvidence, generatedAt?: string): CadEvidenceIrV2 {
  const inputHash = value.input.sha256.toLowerCase();
  const assertions: EvidenceAssertionV2[] = value.assertions.map(item => ({
    id: item.assertion,
    status: item.status,
    method: `legacy:${value.importer}`,
    criterion: { description: 'Legacy v1 assertion criterion; consult reason for original semantics.' },
    ...(item.measured === undefined ? {} : { measured: item.measured, ...(inferUnit(item.measured) ? { unit: inferUnit(item.measured) } : {}) }),
    confidence: item.status === 'not_run' ? 0 : 1,
    reason: item.reason,
    artifactHashes: [inputHash],
  }));
  const migrated: CadEvidenceIrV2 = {
    schemaVersion: 2,
    scenarioId: value.scenarioId,
    input: { ...value.input, sha256: inputHash },
    producer: { adapter: value.importer, version: 'v1-migration' },
    status: deriveEvidenceStatus(assertions),
    assertions,
    artifacts: [{ sha256: inputHash, role: 'input', sizeBytes: value.input.sizeBytes }],
    sideEffects: { ...value.sideEffects, additional: [] },
    ...(generatedAt === undefined ? {} : { generatedAt }),
  };
  const checked = validateCadEvidenceIrV2(migrated);
  if (!checked.ok) throw new TypeError(`Cannot migrate invalid v1 evidence: ${checked.issues.map(item => `${item.path}: ${item.message}`).join('; ')}`);
  return checked.value;
}
