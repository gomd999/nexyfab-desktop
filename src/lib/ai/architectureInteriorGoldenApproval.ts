import { createHash, createPublicKey, verify } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import type { ArchitectureInteriorHoldoutApproval } from './architectureInteriorGoldenScenarios';

export const ARCHITECTURE_INTERIOR_GOLDEN_APPROVAL_SCHEMA = 'nexyfab.architecture-interior-golden-holdout-approval.v2' as const;
export const ARCHITECTURE_INTERIOR_GOLDEN_APPROVAL_DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
export const ARCHITECTURE_INTERIOR_GOLDEN_APPROVAL_DEFAULT_MAX_AGE_MS = 31 * 24 * 60 * 60 * 1000;

const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export interface ArchitectureInteriorGoldenTrustedReviewer {
  publicKeyPem: string;
  roles?: readonly string[];
}

export type ArchitectureInteriorGoldenTrustedReviewers = Readonly<Record<string, ArchitectureInteriorGoldenTrustedReviewer>>;

export interface ArchitectureInteriorGoldenApprovalReceipt {
  schema: typeof ARCHITECTURE_INTERIOR_GOLDEN_APPROVAL_SCHEMA;
  receiptId: string;
  reviewerId: string;
  role: 'independent-reviewer';
  scenarioId: string;
  sourceHashes: Readonly<Record<string, string>>;
  suiteHash: string;
  releaseHash: string;
  approved: true;
  issuedAt: string;
  expiresAt: string;
  publicKeyPem: string;
  signatureBase64: string;
}

export interface ResolveArchitectureInteriorGoldenApprovalReceiptInput {
  approval: ArchitectureInteriorHoldoutApproval;
  approvedRoots?: readonly string[];
  maxBytes?: number;
}

export interface ResolveArchitectureInteriorGoldenApprovalReceiptSuccess {
  ok: true;
  bytes: Uint8Array;
  realPath?: string;
}

export interface ResolveArchitectureInteriorGoldenApprovalReceiptFailure {
  ok: false;
  issues: string[];
}

export type ResolveArchitectureInteriorGoldenApprovalReceiptResult =
  | ResolveArchitectureInteriorGoldenApprovalReceiptSuccess
  | ResolveArchitectureInteriorGoldenApprovalReceiptFailure;

export interface VerifyArchitectureInteriorGoldenApprovalInput {
  approval: ArchitectureInteriorHoldoutApproval;
  scenarioId: string;
  sourceHashes: Readonly<Record<string, string>>;
  suiteHash: string;
  releaseHash: string;
  trustedReviewers?: ArchitectureInteriorGoldenTrustedReviewers;
  approvedRoots?: readonly string[];
  now?: Date | number;
  maxAgeMs?: number;
  maxBytes?: number;
}

export interface VerifiedArchitectureInteriorGoldenApproval {
  ok: true;
  reviewerId: string;
  receiptHash: string;
  keyFingerprintSha256: string;
  receipt: ArchitectureInteriorGoldenApprovalReceipt;
}

export interface InvalidArchitectureInteriorGoldenApproval {
  ok: false;
  issues: string[];
}

export type VerifyArchitectureInteriorGoldenApprovalResult =
  | VerifiedArchitectureInteriorGoldenApproval
  | InvalidArchitectureInteriorGoldenApproval;

export interface VerifyArchitectureInteriorGoldenApprovalsInput {
  approvals: readonly ArchitectureInteriorHoldoutApproval[];
  scenarioId: string;
  sourceHashes: Readonly<Record<string, string>>;
  suiteHash?: string;
  releaseHash?: string;
  trustedReviewers?: ArchitectureInteriorGoldenTrustedReviewers;
  approvedRoots?: readonly string[];
  now?: Date | number;
  maxAgeMs?: number;
  maxBytes?: number;
  requiredReviewers?: number;
}

export interface VerifyArchitectureInteriorGoldenApprovalsSuccess {
  ok: true;
  approvals: VerifiedArchitectureInteriorGoldenApproval[];
}

export interface VerifyArchitectureInteriorGoldenApprovalsFailure {
  ok: false;
  issues: string[];
}

export type VerifyArchitectureInteriorGoldenApprovalsResult =
  | VerifyArchitectureInteriorGoldenApprovalsSuccess
  | VerifyArchitectureInteriorGoldenApprovalsFailure;

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function comparablePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function hasTraversalSegment(value: string): boolean {
  return value.split(/[\\/]+/u).some(segment => segment === '..');
}

function issue(issues: string[], value: string): void {
  if (!issues.includes(value)) issues.push(value);
}

function readReceiptPath(receiptPath: string, roots: readonly string[], maxBytes: number, issues: string[]): ResolveArchitectureInteriorGoldenApprovalReceiptSuccess | null {
  if (!receiptPath.trim() || receiptPath.includes('\0') || hasTraversalSegment(receiptPath)) {
    issue(issues, 'receipt_path_invalid');
    return null;
  }
  if (!Array.isArray(roots) || roots.length === 0) {
    issue(issues, 'approved_roots_required_for_receipt');
    return null;
  }
  if (roots.length > 32) {
    issue(issues, 'approved_roots_limit_exceeded');
    return null;
  }
  for (const requestedRoot of roots) {
    if (typeof requestedRoot !== 'string' || !requestedRoot.trim()) continue;
    const root = path.resolve(requestedRoot);
    try {
      const rootStat = lstatSync(root);
      if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) continue;
      const realRoot = realpathSync.native(root);
      if (comparablePath(realRoot) !== comparablePath(root)) continue;
      const candidate = path.isAbsolute(receiptPath) ? path.resolve(receiptPath) : path.resolve(realRoot, receiptPath);
      if (!isWithin(realRoot, candidate)) continue;
      const relative = path.relative(realRoot, candidate);
      let current = realRoot;
      for (const segment of relative ? relative.split(path.sep) : []) {
        current = path.join(current, segment);
        const listed = lstatSync(current);
        if (listed.isSymbolicLink() || comparablePath(realpathSync.native(current)) !== comparablePath(current)) throw new Error('symlink');
      }
      const listed = lstatSync(candidate);
      if (!listed.isFile()) continue;
      const realPath = realpathSync.native(candidate);
      if (!isWithin(realRoot, realPath) || statSync(candidate).size > maxBytes) {
        issue(issues, 'receipt_path_outside_root_or_size');
        return null;
      }
      const bytes = readFileSync(candidate);
      const after = lstatSync(candidate);
      if (after.isSymbolicLink() || !after.isFile() || after.size !== bytes.byteLength || comparablePath(realpathSync.native(candidate)) !== comparablePath(realPath) || bytes.byteLength > maxBytes) {
        issue(issues, 'receipt_changed_during_read');
        return null;
      }
      return { ok: true, bytes: new Uint8Array(bytes), realPath };
    } catch {
      // Continue to the next approved root. A missing path must not be turned
      // into evidence by a caller-controlled fallback.
    }
  }
  issue(issues, 'receipt_not_found_or_outside_root');
  return null;
}

export function resolveArchitectureInteriorGoldenApprovalReceipt(
  input: ResolveArchitectureInteriorGoldenApprovalReceiptInput,
): ResolveArchitectureInteriorGoldenApprovalReceiptResult {
  const maxBytes = input?.maxBytes ?? ARCHITECTURE_INTERIOR_GOLDEN_APPROVAL_DEFAULT_MAX_BYTES;
  const approval = input?.approval;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) return { ok: false, issues: ['max_bytes_invalid'] };
  if (!approval || typeof approval !== 'object') return { ok: false, issues: ['approval_required'] };
  const bytes = approval.receiptBytes;
  const receiptPath = approval.receiptPath;
  if (bytes !== undefined && receiptPath !== undefined) return { ok: false, issues: ['receipt_bytes_and_path_ambiguous'] };
  if (bytes !== undefined) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > maxBytes) return { ok: false, issues: ['receipt_bytes_invalid'] };
    return { ok: true, bytes: new Uint8Array(bytes) };
  }
  if (typeof receiptPath !== 'string') return { ok: false, issues: ['receipt_bytes_required'] };
  const issues: string[] = [];
  const resolved = readReceiptPath(receiptPath, input.approvedRoots ?? [], maxBytes, issues);
  return resolved ?? { ok: false, issues };
}

function trustedReviewersFromEnvironment(): ArchitectureInteriorGoldenTrustedReviewers | undefined {
  const raw = process.env.NEXYFAB_ARCHITECTURE_INTERIOR_GOLDEN_REVIEWER_KEYS ?? process.env.NEXYFAB_CAD_REVIEWER_KEYS;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as ArchitectureInteriorGoldenTrustedReviewers : undefined;
  } catch {
    return undefined;
  }
}

function parseReceipt(bytes: Uint8Array): { receipt?: ArchitectureInteriorGoldenApprovalReceipt; issues: string[] } {
  const issues: string[] = [];
  let text: string;
  let value: unknown;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    value = JSON.parse(text) as unknown;
  } catch {
    return { issues: ['receipt_json_invalid'] };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || stableJson(value) !== text) {
    issue(issues, 'receipt_non_canonical');
  }
  const expectedKeys = ['approved', 'expiresAt', 'issuedAt', 'publicKeyPem', 'receiptId', 'releaseHash', 'reviewerId', 'role', 'scenarioId', 'schema', 'signatureBase64', 'sourceHashes', 'suiteHash'];
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('\0') !== expectedKeys.join('\0')) issue(issues, 'receipt_shape_invalid');
  return { receipt: value as ArchitectureInteriorGoldenApprovalReceipt, issues };
}

function signaturePayload(receipt: ArchitectureInteriorGoldenApprovalReceipt): string {
  const { signatureBase64: _signature, ...unsigned } = receipt;
  return stableJson(unsigned);
}

export function architectureInteriorGoldenApprovalPayload(receipt: Omit<ArchitectureInteriorGoldenApprovalReceipt, 'signatureBase64'>): string {
  return stableJson(receipt);
}

/** Encode a signed receipt exactly as the verifier expects it on disk. */
export function encodeArchitectureInteriorGoldenApprovalReceipt(receipt: ArchitectureInteriorGoldenApprovalReceipt): Uint8Array {
  return new TextEncoder().encode(stableJson(receipt));
}

function fingerprint(publicKeyPem: string): string | null {
  try {
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') return null;
    return hashBytes(new Uint8Array(key.export({ type: 'spki', format: 'der' })));
  } catch {
    return null;
  }
}

function nowMs(value: Date | number | undefined): number {
  return value instanceof Date ? value.getTime() : value ?? Date.now();
}

export function verifyArchitectureInteriorGoldenApproval(input: VerifyArchitectureInteriorGoldenApprovalInput): VerifyArchitectureInteriorGoldenApprovalResult {
  const approval = input?.approval;
  const issues: string[] = [];
  if (!approval || typeof approval !== 'object' || approval.approved !== true || !SAFE_ID.test(approval.reviewerId ?? '') || !SHA256.test(approval.approvalReceiptHash ?? '')) issue(issues, 'approval_metadata_invalid');
  if (!SAFE_ID.test(input?.scenarioId ?? '') || !SHA256.test(input?.suiteHash ?? '') || !SHA256.test(input?.releaseHash ?? '')) issue(issues, 'approval_binding_context_invalid');
  const expectedSourceIds = Object.keys(input?.sourceHashes ?? {}).sort();
  if (!expectedSourceIds.length || expectedSourceIds.some(id => !SAFE_ID.test(id) || !SHA256.test(input.sourceHashes[id] ?? ''))) issue(issues, 'source_hash_context_invalid');
  const resolved = resolveArchitectureInteriorGoldenApprovalReceipt({ approval, approvedRoots: input?.approvedRoots, maxBytes: input?.maxBytes });
  if (!resolved.ok) issues.push(...resolved.issues);
  if (issues.length || !resolved.ok) return { ok: false, issues: [...new Set(issues)] };
  const receiptHash = hashBytes(resolved.bytes);
  if (receiptHash !== approval.approvalReceiptHash) issue(issues, 'receipt_hash_mismatch');
  const parsed = parseReceipt(resolved.bytes);
  issues.push(...parsed.issues);
  const receipt = parsed.receipt;
  if (!receipt) return { ok: false, issues: [...new Set(issues)] };
  if (receipt.schema !== ARCHITECTURE_INTERIOR_GOLDEN_APPROVAL_SCHEMA || !SAFE_ID.test(receipt.receiptId ?? '') || receipt.reviewerId !== approval.reviewerId || receipt.role !== 'independent-reviewer' || receipt.scenarioId !== input.scenarioId || receipt.approved !== true) issue(issues, 'receipt_identity_or_binding_invalid');
  const actualSourceIds = Object.keys(receipt.sourceHashes ?? {}).sort();
  if (actualSourceIds.join('\0') !== expectedSourceIds.join('\0') || actualSourceIds.some(id => receipt.sourceHashes[id] !== input.sourceHashes[id])) issue(issues, 'receipt_source_binding_invalid');
  if (receipt.suiteHash !== input.suiteHash || receipt.releaseHash !== input.releaseHash) issue(issues, 'receipt_suite_or_release_binding_invalid');
  const issued = Date.parse(receipt.issuedAt ?? ''), expires = Date.parse(receipt.expiresAt ?? ''), current = nowMs(input.now);
  const maxAgeMs = input.maxAgeMs ?? ARCHITECTURE_INTERIOR_GOLDEN_APPROVAL_DEFAULT_MAX_AGE_MS;
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0 || !Number.isFinite(current) || !Number.isFinite(issued) || !Number.isFinite(expires) || issued > current || expires <= current || expires <= issued || expires - issued > maxAgeMs) issue(issues, 'receipt_stale_or_freshness_invalid');
  const trusted = input.trustedReviewers ?? trustedReviewersFromEnvironment();
  const registration = trusted?.[receipt.reviewerId];
  if (!registration || !Array.isArray(registration.roles) || !registration.roles.includes('independent-reviewer')) issue(issues, 'reviewer_not_trusted_or_role_invalid');
  const actualFingerprint = fingerprint(receipt.publicKeyPem ?? '');
  const registeredFingerprint = fingerprint(registration?.publicKeyPem ?? '');
  if (!actualFingerprint || !registeredFingerprint || actualFingerprint !== registeredFingerprint) issue(issues, 'reviewer_key_invalid');
  try {
    if (!actualFingerprint || !verify(null, Buffer.from(signaturePayload(receipt), 'utf8'), createPublicKey(registration!.publicKeyPem), Buffer.from(receipt.signatureBase64 ?? '', 'base64'))) issue(issues, 'receipt_signature_invalid');
  } catch {
    issue(issues, 'receipt_signature_invalid');
  }
  return issues.length ? { ok: false, issues: [...new Set(issues)] } : { ok: true, reviewerId: receipt.reviewerId, receiptHash, keyFingerprintSha256: actualFingerprint!, receipt };
}

export function verifyArchitectureInteriorGoldenApprovals(input: VerifyArchitectureInteriorGoldenApprovalsInput): VerifyArchitectureInteriorGoldenApprovalsResult {
  const required = input.requiredReviewers ?? 2;
  const approvals = input?.approvals;
  if (!Number.isSafeInteger(required) || required < 2 || required > 16) return { ok: false, issues: ['independent_reviewer_policy_invalid'] };
  if (Array.isArray(approvals) && approvals.length > 16) return { ok: false, issues: ['independent_reviewers_limit_exceeded'] };
  if (!Array.isArray(approvals) || approvals.length < required) return { ok: false, issues: ['independent_reviewers_required'] };
  if (!SHA256.test(input.suiteHash ?? '') || !SHA256.test(input.releaseHash ?? '')) return { ok: false, issues: ['approval_binding_context_invalid'] };
  const verified: VerifiedArchitectureInteriorGoldenApproval[] = [];
  const issues: string[] = [];
  const reviewerIds = new Set<string>();
  const fingerprints = new Set<string>();
  for (const approval of approvals) {
    const result = verifyArchitectureInteriorGoldenApproval({ ...input, approval, suiteHash: input.suiteHash!, releaseHash: input.releaseHash! });
    if (!result.ok) { issues.push(...result.issues.map(issueValue => `approval:${approval?.reviewerId ?? 'unknown'}:${issueValue}`)); continue; }
    if (reviewerIds.has(result.reviewerId) || fingerprints.has(result.keyFingerprintSha256)) issues.push(`approval:${result.reviewerId}:reviewer_not_distinct`);
    reviewerIds.add(result.reviewerId);
    fingerprints.add(result.keyFingerprintSha256);
    verified.push(result);
  }
  if (verified.length < required) issues.push('independent_reviewers_verified_insufficient');
  return issues.length ? { ok: false, issues: [...new Set(issues)] } : { ok: true, approvals: verified };
}

// Naming aliases keep the verifier usable by callers that refer to the
// approval as a holdout approval rather than a golden-campaign approval.
export const resolveArchitectureInteriorHoldoutApprovalReceipt = resolveArchitectureInteriorGoldenApprovalReceipt;
export const verifyArchitectureInteriorHoldoutApproval = verifyArchitectureInteriorGoldenApproval;
export const verifyArchitectureInteriorHoldoutApprovals = verifyArchitectureInteriorGoldenApprovals;
