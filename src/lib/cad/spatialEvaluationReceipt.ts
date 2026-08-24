import { createHash } from 'node:crypto';
import { stableSpatialCadJson } from './spatialCadHash';

export const SPATIAL_EVALUATION_RECEIPT_SCHEMA = 'nexyfab.spatial-evaluation-receipt.v1' as const;
export const SPATIAL_DOMAINS = ['building', 'civil', 'landscape', 'interior'] as const;
export type SpatialDomain = (typeof SPATIAL_DOMAINS)[number];
export const EVALUATION_STATUSES = ['PASS', 'FAIL', 'NOT_RUN', 'HOLD', 'STALE'] as const;
export type EvaluationStatus = (typeof EVALUATION_STATUSES)[number];

export interface SpatialRevisionBinding { id: string; sha256: string }
export interface SpatialGateEvidence { status: EvaluationStatus; artifactSha256: string }
export interface SpatialEvaluationReceipt {
  schema: typeof SPATIAL_EVALUATION_RECEIPT_SCHEMA;
  domain: SpatialDomain;
  projectId: string;
  modelRevision: SpatialRevisionBinding;
  inputSha256s: string[];
  modelSha256: string;
  resultSha256: string;
  axis: string;
  checkId: string;
  status: EvaluationStatus;
  validator: { id: string; version: string };
  tolerance: { value: number; unit: string; coordinateFrameSha256: string };
  workerIdentity: string;
  reviewerIdentity: string | null;
  safetyGate: SpatialGateEvidence | null;
  authorityGate: SpatialGateEvidence | null;
  issuedAt: string;
  expiresAt: string | null;
  blockers: string[];
}

export interface SpatialEvaluationExpectations {
  projectId?: string;
  modelRevision?: SpatialRevisionBinding;
  inputSha256s?: string[];
  modelSha256?: string;
  coordinateFrameSha256?: string;
}
export interface SpatialEvaluationResult {
  valid: boolean;
  status: EvaluationStatus | null;
  blockers: string[];
  canonicalSha256?: string;
}

const SHA = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UNIT = /^[A-Za-z][A-Za-z0-9*/^._-]{0,31}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const MAX = 128;
const RECEIPT_KEYS = ['schema','domain','projectId','modelRevision','inputSha256s','modelSha256','resultSha256','axis','checkId','status','validator','tolerance','workerIdentity','reviewerIdentity','safetyGate','authorityGate','issuedAt','expiresAt','blockers'] as const;
const REVISION_KEYS = ['id','sha256'] as const;
const VALIDATOR_KEYS = ['id','version'] as const;
const TOLERANCE_KEYS = ['value','unit','coordinateFrameSha256'] as const;
const GATE_KEYS = ['status','artifactSha256'] as const;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => {
  const a = Object.keys(v).sort(); const b = [...keys].sort();
  return a.length === b.length && a.every((x, i) => x === b[i]);
};
const validTime = (v: unknown) => typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v));
const validSha = (v: unknown): v is string => typeof v === 'string' && SHA.test(v);
const validId = (v: unknown): v is string => typeof v === 'string' && ID.test(v);
const sameHashes = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export function validateSpatialEvaluationReceipt(input: unknown): string[] {
  const issues: string[] = [];
  if (!record(input) || !exact(input, RECEIPT_KEYS)) return ['receipt_keys_invalid'];
  const r = input as unknown as SpatialEvaluationReceipt;
  if (r.schema !== SPATIAL_EVALUATION_RECEIPT_SCHEMA) issues.push('schema_invalid');
  if (!(SPATIAL_DOMAINS as readonly string[]).includes(r.domain)) issues.push('domain_invalid');
  if (!validId(r.projectId)) issues.push('project_id_invalid');
  if (!record(r.modelRevision) || !exact(r.modelRevision, REVISION_KEYS)) issues.push('model_revision_invalid');
  else { if (!validId(r.modelRevision.id)) issues.push('model_revision_id_invalid'); if (!validSha(r.modelRevision.sha256)) issues.push('model_revision_hash_invalid'); }
  if (!Array.isArray(r.inputSha256s) || r.inputSha256s.length === 0 || r.inputSha256s.length > MAX || r.inputSha256s.some(v => !validSha(v))) issues.push('input_hashes_invalid');
  for (const [name, value] of [['model', r.modelSha256], ['result', r.resultSha256]] as const) if (!validSha(value)) issues.push(`${name}_hash_invalid`);
  for (const [name, value] of [['axis', r.axis], ['check_id', r.checkId], ['worker_identity', r.workerIdentity]] as const) if (!validId(value)) issues.push(`${name}_invalid`);
  if (!(EVALUATION_STATUSES as readonly string[]).includes(r.status)) issues.push('status_invalid');
  if (!record(r.validator) || !exact(r.validator, VALIDATOR_KEYS) || !validId(r.validator.id) || !validId(r.validator.version)) issues.push('validator_invalid');
  if (!record(r.tolerance) || !exact(r.tolerance, TOLERANCE_KEYS) || typeof r.tolerance.value !== 'number' || !Number.isFinite(r.tolerance.value) || r.tolerance.value < 0 || r.tolerance.value > 1e9 || typeof r.tolerance.unit !== 'string' || !UNIT.test(r.tolerance.unit) || !validSha(r.tolerance.coordinateFrameSha256)) issues.push('tolerance_invalid');
  if (r.reviewerIdentity !== null && !validId(r.reviewerIdentity)) issues.push('reviewer_identity_invalid');
  for (const [name, gate] of [['safety', r.safetyGate], ['authority', r.authorityGate]] as const) {
    if (gate !== null && (!record(gate) || !exact(gate, GATE_KEYS) || !(EVALUATION_STATUSES as readonly string[]).includes(gate.status) || !validSha(gate.artifactSha256))) issues.push(`${name}_gate_invalid`);
  }
  if (!validTime(r.issuedAt)) issues.push('issued_at_invalid');
  if (r.expiresAt !== null && !validTime(r.expiresAt)) issues.push('expires_at_invalid');
  const issuedMs = validTime(r.issuedAt) ? Date.parse(r.issuedAt) : NaN;
  const expiresMs = r.expiresAt !== null && validTime(r.expiresAt) ? Date.parse(r.expiresAt) : NaN;
  if (!Number.isNaN(issuedMs) && !Number.isNaN(expiresMs) && expiresMs <= issuedMs) issues.push('expiry_not_after_issue');
  if (!Array.isArray(r.blockers) || r.blockers.length > MAX || r.blockers.some(v => typeof v !== 'string' || v.length === 0 || v.length > 256)) issues.push('blockers_invalid');
  return [...new Set(issues)];
}

export function canonicalSpatialEvaluationReceiptJson(receipt: SpatialEvaluationReceipt): string {
  const issues = validateSpatialEvaluationReceipt(receipt);
  if (issues.length) throw new Error(`invalid_spatial_evaluation_receipt:${issues.join(',')}`);
  return stableSpatialCadJson(receipt);
}

export function hashSpatialEvaluationReceipt(receipt: SpatialEvaluationReceipt): string {
  return createHash('sha256').update(canonicalSpatialEvaluationReceiptJson(receipt), 'utf8').digest('hex');
}

export function evaluateSpatialEvaluationReceipt(input: unknown, expected: SpatialEvaluationExpectations = {}, now = new Date()): SpatialEvaluationResult {
  const issues = validateSpatialEvaluationReceipt(input);
  if (issues.length) return { valid: false, status: null, blockers: issues };
  const r = input as SpatialEvaluationReceipt;
  const blockers = [...r.blockers];
  if (expected.projectId !== undefined && expected.projectId !== r.projectId) blockers.push('project_mismatch');
  if (expected.modelRevision && (expected.modelRevision.id !== r.modelRevision.id || expected.modelRevision.sha256 !== r.modelRevision.sha256)) blockers.push('model_revision_stale');
  if (expected.inputSha256s && !sameHashes(expected.inputSha256s, r.inputSha256s)) blockers.push('input_hashes_stale');
  if (expected.modelSha256 !== undefined && expected.modelSha256 !== r.modelSha256) blockers.push('model_hash_stale');
  if (expected.coordinateFrameSha256 !== undefined && expected.coordinateFrameSha256 !== r.tolerance.coordinateFrameSha256) blockers.push('coordinate_frame_stale');
  if (r.expiresAt && Date.parse(r.expiresAt) <= now.getTime()) blockers.push('expired');
  if (r.status === 'PASS' && r.reviewerIdentity === null) blockers.push('reviewer_not_run');
  if (r.status === 'PASS' && (!r.safetyGate || r.safetyGate.status !== 'PASS')) blockers.push('safety_gate_not_pass');
  if (r.status === 'PASS' && (!r.authorityGate || r.authorityGate.status !== 'PASS')) blockers.push('authority_gate_not_pass');
  if (r.status !== 'PASS' && blockers.length === 0) blockers.push(`status_${r.status.toLowerCase()}_reason_required`);
  const status: EvaluationStatus = blockers.some(v => v === 'model_revision_stale' || v === 'input_hashes_stale' || v === 'model_hash_stale' || v === 'coordinate_frame_stale' || v === 'expired' || v === 'project_mismatch') ? 'STALE' : (r.status === 'PASS' && blockers.length ? 'HOLD' : r.status);
  return { valid: true, status, blockers: [...new Set(blockers)], canonicalSha256: hashSpatialEvaluationReceipt(r) };
}
