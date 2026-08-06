import { createHash } from 'node:crypto';

export type GroundTruthProvenance =
  | 'source-declared'
  | 'kernel-measured'
  | 'derived-deterministic'
  | 'reviewed-inferred'
  | 'unknown';

export type GroundTruthReviewStatus = 'draft' | 'in_review' | 'approved' | 'rejected';
export type GroundTruthFeatureImportance = 'functional' | 'structural' | 'reference' | 'decorative';
export type GroundTruthJsonValue = null | boolean | number | string | GroundTruthJsonValue[] | { [key: string]: GroundTruthJsonValue };

export interface GroundTruthExpectedNumberV1 {
  value: number;
  provenance: GroundTruthProvenance;
  tolerancePolicy: string;
  evidenceRefs?: string[];
  /** Must be explicit; absence means excluded until an evaluator applies policy. */
  kpiEligible?: boolean;
  /** Required together with approved document review for reviewed-inferred KPI values. */
  inferenceApproved?: boolean;
}

export interface GroundTruthFeatureV1 {
  id: string;
  kind: string;
  parameters: Record<string, GroundTruthJsonValue>;
  importance: GroundTruthFeatureImportance;
  provenance: GroundTruthProvenance;
  evidenceRefs: string[];
  kpiEligible?: boolean;
  inferenceApproved?: boolean;
}

export interface CadGroundTruthV1 {
  groundTruthVersion: 1;
  fixtureId: string;
  sourceHash: string;
  geometry: Record<string, GroundTruthExpectedNumberV1>;
  features: GroundTruthFeatureV1[];
  unknown: string[];
  review: {
    status: GroundTruthReviewStatus;
    reviewRevision: number;
    reviewer?: string;
    reason?: string;
  };
}

export interface GroundTruthValidationIssue {
  path: string;
  message: string;
}

export type GroundTruthValidationResult =
  | { ok: true; value: CadGroundTruthV1; issues: [] }
  | { ok: false; issues: GroundTruthValidationIssue[] };

const SHA256 = /^[a-f0-9]{64}$/;
const PROVENANCE = new Set<GroundTruthProvenance>(['source-declared', 'kernel-measured', 'derived-deterministic', 'reviewed-inferred', 'unknown']);
const REVIEW = new Set<GroundTruthReviewStatus>(['draft', 'in_review', 'approved', 'rejected']);
const IMPORTANCE = new Set<GroundTruthFeatureImportance>(['functional', 'structural', 'reference', 'decorative']);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function finiteJson(value: unknown): value is GroundTruthJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteJson);
  return record(value) && Object.values(value).every(finiteJson);
}

function validateRefs(value: unknown, path: string, issue: (path: string, message: string) => void): void {
  if (!Array.isArray(value)) { issue(path, 'Expected an array of evidence references.'); return; }
  const seen = new Set<string>();
  value.forEach((ref, index) => {
    if (!nonEmpty(ref)) issue(`${path}[${index}]`, 'Expected a non-empty evidence reference.');
    else if (seen.has(ref)) issue(`${path}[${index}]`, 'Evidence references must be unique within a record.');
    else seen.add(ref);
  });
}

function validateKpiApproval(
  item: Record<string, unknown>,
  path: string,
  reviewStatus: unknown,
  issue: (path: string, message: string) => void,
): void {
  if ('kpiEligible' in item && typeof item.kpiEligible !== 'boolean') issue(`${path}.kpiEligible`, 'Expected a boolean when present.');
  if ('inferenceApproved' in item && typeof item.inferenceApproved !== 'boolean') issue(`${path}.inferenceApproved`, 'Expected a boolean when present.');
  if (item.kpiEligible === true && reviewStatus !== 'approved') issue(`${path}.kpiEligible`, 'KPI eligibility requires an approved fixture review.');
  if (item.kpiEligible === true && item.provenance === 'unknown') issue(`${path}.kpiEligible`, 'Unknown values cannot be KPI eligible.');
  if (item.kpiEligible === true && item.provenance === 'reviewed-inferred' && item.inferenceApproved !== true) {
    issue(`${path}.kpiEligible`, 'Reviewed-inferred KPI values require explicit inferenceApproved=true.');
  }
}

export function isGroundTruthKpiEligible(
  item: Pick<GroundTruthExpectedNumberV1, 'provenance' | 'kpiEligible' | 'inferenceApproved'>,
  reviewStatus: GroundTruthReviewStatus,
): boolean {
  if (item.kpiEligible !== true || reviewStatus !== 'approved' || item.provenance === 'unknown') return false;
  return item.provenance !== 'reviewed-inferred' || item.inferenceApproved === true;
}

export function validateCadGroundTruthV1(value: unknown): GroundTruthValidationResult {
  const issues: GroundTruthValidationIssue[] = [];
  const issue = (path: string, message: string) => issues.push({ path, message });
  if (!record(value)) return { ok: false, issues: [{ path: '$', message: 'Expected an object.' }] };
  if (value.groundTruthVersion !== 1) issue('groundTruthVersion', 'Expected groundTruthVersion 1.');
  if (!nonEmpty(value.fixtureId)) issue('fixtureId', 'Expected a non-empty fixture id.');
  if (typeof value.sourceHash !== 'string' || !SHA256.test(value.sourceHash)) issue('sourceHash', 'Expected a lowercase SHA-256 hex digest.');

  const review = value.review;
  const reviewStatus = record(review) ? review.status : undefined;
  if (!record(review)) issue('review', 'Expected an object.');
  else {
    if (!REVIEW.has(review.status as GroundTruthReviewStatus)) issue('review.status', 'Unsupported review status.');
    if (!Number.isSafeInteger(review.reviewRevision) || (review.reviewRevision as number) < 1) issue('review.reviewRevision', 'Expected a positive safe integer.');
    if ('reviewer' in review && !nonEmpty(review.reviewer)) issue('review.reviewer', 'Expected a non-empty string when present.');
    if ('reason' in review && !nonEmpty(review.reason)) issue('review.reason', 'Expected a non-empty string when present.');
  }

  if (!record(value.geometry)) issue('geometry', 'Expected an object of named geometry expectations.');
  else for (const [name, raw] of Object.entries(value.geometry)) {
    const path = `geometry.${name}`;
    if (!nonEmpty(name)) issue('geometry', 'Geometry expectation names must be non-empty.');
    if (!record(raw)) { issue(path, 'Expected an object.'); continue; }
    if (typeof raw.value !== 'number' || !Number.isFinite(raw.value)) issue(`${path}.value`, 'Expected a finite number.');
    if (!PROVENANCE.has(raw.provenance as GroundTruthProvenance)) issue(`${path}.provenance`, 'Unsupported provenance.');
    if (!nonEmpty(raw.tolerancePolicy)) issue(`${path}.tolerancePolicy`, 'Expected a named tolerance policy.');
    if ('evidenceRefs' in raw) validateRefs(raw.evidenceRefs, `${path}.evidenceRefs`, issue);
    validateKpiApproval(raw, path, reviewStatus, issue);
  }

  if (!Array.isArray(value.features)) issue('features', 'Expected an array.');
  else {
    const ids = new Set<string>();
    value.features.forEach((raw, index) => {
      const path = `features[${index}]`;
      if (!record(raw)) { issue(path, 'Expected an object.'); return; }
      if (!nonEmpty(raw.id)) issue(`${path}.id`, 'Expected a non-empty feature id.');
      else if (ids.has(raw.id)) issue(`${path}.id`, 'Feature ids must be unique.');
      else ids.add(raw.id);
      if (!nonEmpty(raw.kind)) issue(`${path}.kind`, 'Expected a non-empty feature kind.');
      if (!record(raw.parameters) || !finiteJson(raw.parameters)) issue(`${path}.parameters`, 'Expected finite JSON values; NaN and Infinity are forbidden.');
      if (!IMPORTANCE.has(raw.importance as GroundTruthFeatureImportance)) issue(`${path}.importance`, 'Unsupported feature importance.');
      if (!PROVENANCE.has(raw.provenance as GroundTruthProvenance)) issue(`${path}.provenance`, 'Unsupported provenance.');
      validateRefs(raw.evidenceRefs, `${path}.evidenceRefs`, issue);
      validateKpiApproval(raw, path, reviewStatus, issue);
    });
  }

  if (!Array.isArray(value.unknown)) issue('unknown', 'Expected an array.');
  else {
    const seen = new Set<string>();
    value.unknown.forEach((entry, index) => {
      if (!nonEmpty(entry)) issue(`unknown[${index}]`, 'Expected a non-empty unknown label.');
      else if (seen.has(entry)) issue(`unknown[${index}]`, 'Unknown labels must be unique.');
      else seen.add(entry);
    });
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: value as unknown as CadGroundTruthV1, issues: [] };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!record(value)) return value;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) output[key] = canonicalize(value[key]);
  }
  return output;
}

export function serializeCadGroundTruthCanonical(value: CadGroundTruthV1): string {
  const checked = validateCadGroundTruthV1(value);
  if (!checked.ok) throw new TypeError(`Invalid CadGroundTruthV1: ${checked.issues.map(item => `${item.path}: ${item.message}`).join('; ')}`);
  return JSON.stringify(canonicalize(checked.value));
}

export function hashCadGroundTruthCanonical(value: CadGroundTruthV1): string {
  return createHash('sha256').update(serializeCadGroundTruthCanonical(value)).digest('hex');
}
