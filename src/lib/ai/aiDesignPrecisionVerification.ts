import { createHmac, timingSafeEqual } from 'node:crypto';
import { serverEvidenceSha256 } from './serverEvidence';

export const AI_DESIGN_PRECISION_REQUEST_SCHEMA = 'nexyfab.ai-design-precision-verification-request.v1' as const;
export const AI_DESIGN_PRECISION_RECEIPT_SCHEMA = 'nexyfab.ai-design-precision-verification-receipt.v1' as const;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_SCOPE = 1_024;

export type AiDesignPrecisionScopeKind = 'structure_node' | 'interface' | 'partition' | 'gauge';
export interface AiDesignPrecisionScopeV1 { kind: AiDesignPrecisionScopeKind; id: string; }

export interface AiDesignPrecisionVerificationRequestV1 {
  schema: typeof AI_DESIGN_PRECISION_REQUEST_SCHEMA;
  requestId: string;
  projectId: string;
  sessionId: string;
  runtimeRevision: number;
  complexRevision: number;
  productStructureDigest: string | null;
  crossDomainContentHash: string | null;
  scopes: readonly AiDesignPrecisionScopeV1[];
  requestedAt: string;
  expiresAt: string;
  exactAuthority: false;
  manufacturingAuthority: false;
  requestDigest: string;
}

export interface AiDesignPrecisionScopeResultV1 extends AiDesignPrecisionScopeV1 {
  status: 'PASS' | 'FAIL';
  exactArtifactDigest: string | null;
  codes: readonly string[];
}

export interface AiDesignPrecisionVerificationReceiptV1 {
  schema: typeof AI_DESIGN_PRECISION_RECEIPT_SCHEMA;
  receiptId: string;
  requestId: string;
  requestDigest: string;
  projectId: string;
  sessionId: string;
  runtimeRevision: number;
  complexRevision: number;
  productStructureDigest: string | null;
  crossDomainContentHash: string | null;
  status: 'PASS' | 'FAIL';
  scopeResults: readonly AiDesignPrecisionScopeResultV1[];
  issuer: { keyId: string; system: 'precision-cad' };
  issuedAt: string;
  expiresAt: string;
  manufacturingReleaseReady: false;
  receiptDigest: string;
  signature: string;
}

export interface AiDesignPrecisionReceiptVerification {
  ok: boolean;
  status: 'PASS' | 'FAIL' | 'STALE';
  issues: readonly string[];
  receiptDigest: string | null;
}

function timestamp(value: string): boolean { return Number.isFinite(Date.parse(value)); }
function scopeKey(value: AiDesignPrecisionScopeV1): string { return `${value.kind}:${value.id}`; }
function uniqueScopes(values: readonly AiDesignPrecisionScopeV1[]): boolean { return new Set(values.map(scopeKey)).size === values.length; }
function validScope(value: AiDesignPrecisionScopeV1): boolean { return !!value && ['structure_node', 'interface', 'partition', 'gauge'].includes(value.kind) && ID.test(value.id ?? ''); }
function signatureFor(digest: string, secret: string): string { return createHmac('sha256', secret).update(digest, 'utf8').digest('hex'); }
function safeEqual(left: string, right: string): boolean { if (!SHA256.test(left) || !SHA256.test(right)) return false; return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex')); }

function requestMaterial(value: Omit<AiDesignPrecisionVerificationRequestV1, 'requestDigest'> | AiDesignPrecisionVerificationRequestV1) {
  const { requestDigest: _requestDigest, ...rest } = value as AiDesignPrecisionVerificationRequestV1;
  return rest;
}

function receiptMaterial(value: Omit<AiDesignPrecisionVerificationReceiptV1, 'receiptDigest' | 'signature'> | AiDesignPrecisionVerificationReceiptV1) {
  const { receiptDigest: _receiptDigest, signature: _signature, ...rest } = value as AiDesignPrecisionVerificationReceiptV1;
  return rest;
}

export function createAiDesignPrecisionVerificationRequest(input: {
  requestId: string;
  projectId: string;
  sessionId: string;
  runtimeRevision: number;
  complexRevision: number;
  productStructureDigest: string | null;
  crossDomainContentHash: string | null;
  scopes: readonly AiDesignPrecisionScopeV1[];
  requestedAt?: string;
  expiresAt?: string;
}): AiDesignPrecisionVerificationRequestV1 {
  const requestedAt = input.requestedAt ?? new Date().toISOString();
  const expiresAt = input.expiresAt ?? new Date(Date.parse(requestedAt) + 60 * 60_000).toISOString();
  const base = {
    schema: AI_DESIGN_PRECISION_REQUEST_SCHEMA,
    ...structuredClone(input),
    scopes: [...input.scopes].sort((a, b) => scopeKey(a).localeCompare(scopeKey(b))),
    requestedAt,
    expiresAt,
    exactAuthority: false as const,
    manufacturingAuthority: false as const,
  };
  const request = Object.freeze({ ...base, requestDigest: serverEvidenceSha256(base) });
  const issues = validateAiDesignPrecisionVerificationRequest(request);
  if (issues.length) throw new Error(`AI_DESIGN_PRECISION_REQUEST_INVALID:${issues.join(',')}`);
  return request;
}

export function validateAiDesignPrecisionVerificationRequest(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['precision_request_not_object'];
  const request = value as AiDesignPrecisionVerificationRequestV1;
  const issues: string[] = [];
  if (request.schema !== AI_DESIGN_PRECISION_REQUEST_SCHEMA || !ID.test(request.requestId ?? '') || !ID.test(request.projectId ?? '') || !ID.test(request.sessionId ?? '')) issues.push('precision_request_binding_invalid');
  if (!Number.isSafeInteger(request.runtimeRevision) || request.runtimeRevision < 0 || !Number.isSafeInteger(request.complexRevision) || request.complexRevision < 0) issues.push('precision_request_revision_invalid');
  if ((request.productStructureDigest !== null && !SHA256.test(request.productStructureDigest ?? '')) || (request.crossDomainContentHash !== null && !SHA256.test(request.crossDomainContentHash ?? ''))) issues.push('precision_request_content_binding_invalid');
  if (!Array.isArray(request.scopes) || request.scopes.length < 1 || request.scopes.length > MAX_SCOPE || !uniqueScopes(request.scopes) || request.scopes.some(item => !validScope(item))) issues.push('precision_request_scope_invalid');
  if (!timestamp(request.requestedAt) || !timestamp(request.expiresAt) || Date.parse(request.expiresAt) <= Date.parse(request.requestedAt)) issues.push('precision_request_time_invalid');
  if (request.exactAuthority !== false || request.manufacturingAuthority !== false || !SHA256.test(request.requestDigest ?? '')) issues.push('precision_request_authority_invalid');
  if (issues.length === 0 && request.requestDigest !== serverEvidenceSha256(requestMaterial(request))) issues.push('precision_request_digest_mismatch');
  return [...new Set(issues)];
}

export function issueAiDesignPrecisionVerificationReceipt(input: {
  receiptId: string;
  request: AiDesignPrecisionVerificationRequestV1;
  status: 'PASS' | 'FAIL';
  scopeResults: readonly AiDesignPrecisionScopeResultV1[];
  keyId: string;
  issuedAt?: string;
  expiresAt?: string;
}, signingSecret: string): AiDesignPrecisionVerificationReceiptV1 {
  if (Buffer.byteLength(signingSecret, 'utf8') < 32) throw new Error('AI_DESIGN_PRECISION_SIGNING_SECRET_REQUIRED');
  const requestIssues = validateAiDesignPrecisionVerificationRequest(input.request);
  if (requestIssues.length) throw new Error(`AI_DESIGN_PRECISION_REQUEST_INVALID:${requestIssues.join(',')}`);
  const issuedAt = input.issuedAt ?? new Date().toISOString();
  const expiresAt = input.expiresAt ?? new Date(Math.min(Date.parse(input.request.expiresAt), Date.parse(issuedAt) + 60 * 60_000)).toISOString();
  const base = {
    schema: AI_DESIGN_PRECISION_RECEIPT_SCHEMA,
    receiptId: input.receiptId,
    requestId: input.request.requestId,
    requestDigest: input.request.requestDigest,
    projectId: input.request.projectId,
    sessionId: input.request.sessionId,
    runtimeRevision: input.request.runtimeRevision,
    complexRevision: input.request.complexRevision,
    productStructureDigest: input.request.productStructureDigest,
    crossDomainContentHash: input.request.crossDomainContentHash,
    status: input.status,
    scopeResults: [...input.scopeResults].sort((a, b) => scopeKey(a).localeCompare(scopeKey(b))),
    issuer: { keyId: input.keyId, system: 'precision-cad' as const },
    issuedAt,
    expiresAt,
    manufacturingReleaseReady: false as const,
  };
  const receiptDigest = serverEvidenceSha256(base);
  return Object.freeze({ ...base, receiptDigest, signature: signatureFor(receiptDigest, signingSecret) });
}

export function verifyAiDesignPrecisionVerificationReceipt(
  receipt: AiDesignPrecisionVerificationReceiptV1,
  request: AiDesignPrecisionVerificationRequestV1,
  context: { signingSecret: string; now?: Date; expectedRuntimeRevision: number; expectedComplexRevision: number },
): AiDesignPrecisionReceiptVerification {
  const issues: string[] = [];
  const now = context.now ?? new Date();
  const requestIssues = validateAiDesignPrecisionVerificationRequest(request);
  if (requestIssues.length) issues.push(...requestIssues);
  if (!receipt || receipt.schema !== AI_DESIGN_PRECISION_RECEIPT_SCHEMA || !ID.test(receipt.receiptId ?? '') || !ID.test(receipt.requestId ?? '') || !ID.test(receipt.projectId ?? '') || !ID.test(receipt.sessionId ?? '')) issues.push('precision_receipt_binding_invalid');
  if (receipt.requestId !== request.requestId || receipt.requestDigest !== request.requestDigest || receipt.projectId !== request.projectId || receipt.sessionId !== request.sessionId) issues.push('precision_receipt_request_mismatch');
  if (receipt.runtimeRevision !== request.runtimeRevision || receipt.complexRevision !== request.complexRevision || receipt.runtimeRevision !== context.expectedRuntimeRevision || receipt.complexRevision !== context.expectedComplexRevision) issues.push('precision_receipt_revision_mismatch');
  if (receipt.productStructureDigest !== request.productStructureDigest || receipt.crossDomainContentHash !== request.crossDomainContentHash) issues.push('precision_receipt_content_mismatch');
  if (!['PASS', 'FAIL'].includes(receipt.status) || receipt.manufacturingReleaseReady !== false) issues.push('precision_receipt_authority_invalid');
  if (!receipt.issuer || receipt.issuer.system !== 'precision-cad' || !ID.test(receipt.issuer.keyId ?? '')) issues.push('precision_receipt_issuer_invalid');
  if (!timestamp(receipt.issuedAt) || !timestamp(receipt.expiresAt) || Date.parse(receipt.expiresAt) <= Date.parse(receipt.issuedAt) || now.getTime() > Date.parse(receipt.expiresAt)) issues.push('precision_receipt_expired');
  if (!Array.isArray(receipt.scopeResults) || receipt.scopeResults.length !== request.scopes.length || !uniqueScopes(receipt.scopeResults) || receipt.scopeResults.some(item => !validScope(item) || !['PASS', 'FAIL'].includes(item.status) || (item.exactArtifactDigest !== null && !SHA256.test(item.exactArtifactDigest ?? '')) || !Array.isArray(item.codes) || item.codes.length > 64 || item.codes.some((code: unknown) => typeof code !== 'string' || !ID.test(code)))) issues.push('precision_receipt_scope_invalid');
  const requested = new Set(request.scopes.map(scopeKey));
  if (Array.isArray(receipt.scopeResults) && receipt.scopeResults.some(item => !requested.has(scopeKey(item)))) issues.push('precision_receipt_scope_mismatch');
  if (receipt.status === 'PASS' && receipt.scopeResults?.some(item => item.status !== 'PASS' || !item.exactArtifactDigest)) issues.push('precision_receipt_pass_incomplete');
  const expectedDigest = serverEvidenceSha256(receiptMaterial(receipt));
  if (receipt.receiptDigest !== expectedDigest || !safeEqual(receipt.signature ?? '', signatureFor(expectedDigest, context.signingSecret))) issues.push('precision_receipt_signature_invalid');
  if (issues.length) return { ok: false, status: issues.includes('precision_receipt_expired') || issues.includes('precision_receipt_revision_mismatch') || issues.includes('precision_receipt_content_mismatch') ? 'STALE' : 'FAIL', issues: [...new Set(issues)], receiptDigest: SHA256.test(receipt?.receiptDigest ?? '') ? receipt.receiptDigest : null };
  return { ok: true, status: receipt.status, issues: [], receiptDigest: receipt.receiptDigest };
}
