import {
  AUTHORITY_DOMAINS,
  hashDomainAuthorityManifest,
  type AuthorityDomain,
  type DomainAuthorityManifest,
} from './domainAuthorityManifest';
import {
  canonicalDomainDeliverableManifestHash,
  type DomainDeliverableManifest,
} from './domainDeliverableManifest';
import {
  evaluateDomainProductReceipt,
  hashDomainProductReceipt,
  type DomainProductReceipt,
  type DomainProductReceiptEvaluation,
} from './domainProductReceipt';

/**
 * A view-only state.  This adapter is deliberately narrower than the
 * qualification builders: it is safe to use at a UI boundary and cannot
 * promote a product by trusting a status supplied by a caller.
 */
export type DomainProductQualificationViewState = 'NOT_RUN' | 'HOLD' | 'PASS' | 'STALE' | 'INVALID';

export type DomainProductQualificationViewBlockerCode =
  | 'INPUT_INVALID'
  | 'RECEIPT_INVALID'
  | 'EVALUATION_NOT_RUN'
  | 'EVALUATION_MISMATCH'
  | 'PROJECT_MISMATCH'
  | 'DOMAIN_MISMATCH'
  | 'REVISION_INVALID'
  | 'REVISION_ID_MISMATCH'
  | 'REVISION_SEQUENCE_MISMATCH'
  | 'REVISION_CONTENT_HASH_MISMATCH'
  | 'AUTHORITY_MANIFEST_NOT_RUN'
  | 'AUTHORITY_MANIFEST_INVALID'
  | 'AUTHORITY_MANIFEST_HASH_MISMATCH'
  | 'DELIVERABLE_MANIFEST_NOT_RUN'
  | 'DELIVERABLE_MANIFEST_INVALID'
  | 'DELIVERABLE_MANIFEST_HASH_MISMATCH'
  | 'EVIDENCE_NOT_CURRENT'
  | 'QUALIFICATION_INCOMPLETE';

export interface DomainProductQualificationViewBlocker {
  readonly code: DomainProductQualificationViewBlockerCode;
  /** Only bounded, non-sensitive display data is exposed. */
  readonly data?: Readonly<Record<string, string | number>>;
}

export interface QualificationViewRevision {
  readonly id: string;
  readonly sequence: number;
  readonly contentSha256: string;
}

export interface DomainProductQualificationViewInput {
  readonly receipt: unknown;
  readonly evaluation?: unknown;
  readonly authorityManifest?: unknown;
  readonly deliverableManifest?: unknown;
  readonly projectId: string;
  readonly domain: AuthorityDomain;
  /** Revision attached to the receipt by the caller, including its CAS sequence. */
  readonly receiptRevision: QualificationViewRevision;
  /** Current canonical project revision which the view is allowed to display. */
  readonly currentRevision: QualificationViewRevision;
  readonly authorityManifestSha256: string;
  readonly deliverableManifestSha256: string;
}

export interface DomainProductQualificationView {
  readonly status: DomainProductQualificationViewState;
  readonly blockers: readonly DomainProductQualificationViewBlocker[];
  readonly projectId?: string;
  readonly domain?: AuthorityDomain;
  readonly receiptSha256?: string;
  readonly authorityManifestSha256?: string;
  readonly deliverableManifestSha256?: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_NODES = 4096;
const MAX_DEPTH = 32;
const MAX_STRING = 1_000_000;
const INPUT_KEYS = [
  'receipt', 'evaluation', 'authorityManifest', 'deliverableManifest', 'projectId', 'domain',
  'receiptRevision', 'currentRevision', 'authorityManifestSha256', 'deliverableManifestSha256',
] as const;
const EVALUATION_KEYS = ['structurallyValid', 'status', 'eligibleState', 'blockers', 'canonicalSha256'] as const;

type RecordValue = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value);
const isPlainRecord = (value: unknown): value is RecordValue => {
  if (!isRecord(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
};
const exactKeys = (value: RecordValue, expected: readonly string[]): boolean => {
  try {
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
  } catch {
    return false;
  }
};

/**
 * Produces a bounded data-only snapshot before any domain evaluator sees the
 * value.  In particular, accessors, proxies, cycles and executable class
 * instances cannot reach the canonical receipt evaluator.
 */
function snapshot(value: unknown, seen: Set<object>, budget: { nodes: number }, depth = 0): unknown {
  if (depth > MAX_DEPTH || budget.nodes++ > MAX_NODES) throw new Error('snapshot_limit');
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > MAX_STRING) throw new Error('snapshot_string_limit');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('snapshot_number_invalid');
    return value;
  }
  if (typeof value !== 'object') throw new Error('snapshot_type_invalid');
  if (seen.has(value)) throw new Error('snapshot_cycle');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_NODES) throw new Error('snapshot_array_limit');
      const result: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !('value' in descriptor)) throw new Error('snapshot_accessor');
        result.push(snapshot(descriptor.value, seen, budget, depth + 1));
      }
      return result;
    }
    if (!isPlainRecord(value)) throw new Error('snapshot_object_invalid');
    const result: RecordValue = {};
    const keys = Object.keys(value);
    if (keys.length > MAX_NODES) throw new Error('snapshot_object_limit');
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) throw new Error('snapshot_accessor');
      result[key] = snapshot(descriptor.value, seen, budget, depth + 1);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function dataSnapshot(value: unknown): unknown {
  return snapshot(value, new Set<object>(), { nodes: 0 });
}

function blocker(code: DomainProductQualificationViewBlockerCode, data?: Record<string, string | number>): DomainProductQualificationViewBlocker {
  return data ? { code, data: Object.freeze({ ...data }) } : { code };
}

function uniqueBlockers(items: DomainProductQualificationViewBlocker[]): DomainProductQualificationViewBlocker[] {
  const result: DomainProductQualificationViewBlocker[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = `${item.code}:${JSON.stringify(item.data ?? {})}`;
    if (!seen.has(key)) { seen.add(key); result.push(item); }
  }
  return result;
}

function revisionValid(value: unknown): value is QualificationViewRevision {
  if (!isPlainRecord(value) || !exactKeys(value, ['id', 'sequence', 'contentSha256'])) return false;
  return typeof value.id === 'string' && ID.test(value.id)
    && typeof value.sequence === 'number' && Number.isSafeInteger(value.sequence) && value.sequence >= 0
    && typeof value.contentSha256 === 'string' && SHA256.test(value.contentSha256);
}

function mapEvaluationBlockers(evaluation: DomainProductReceiptEvaluation): DomainProductQualificationViewBlocker[] {
  // Do not expose evaluator strings.  A stale marker is useful in a view,
  // while every other unqualified condition is intentionally a generic code.
  if (evaluation.blockers.some(value => /^(?:validation_axis_stale|campaign_stale|review_stale|pilot_stale|authority_revision_mismatch|deliverable_revision_mismatch)(?::|$)/.test(value))) {
    return [blocker('EVIDENCE_NOT_CURRENT')];
  }
  return evaluation.blockers.length ? [blocker('QUALIFICATION_INCOMPLETE')] : [];
}

function invalid(blockers: DomainProductQualificationViewBlocker[]): DomainProductQualificationView {
  return { status: 'INVALID', blockers: uniqueBlockers(blockers) };
}

/**
 * Derives a stable display contract from a receipt.  The supplied evaluation
 * is only an attestation candidate: PASS is possible only after the receipt,
 * manifests, revision triplet and recomputed evaluator all agree.
 */
export function evaluateDomainProductQualificationView(input: unknown): DomainProductQualificationView {
  let value: RecordValue;
  try {
    const copied = dataSnapshot(input);
    if (!isPlainRecord(copied) || !exactKeys(copied, INPUT_KEYS)) return invalid([blocker('INPUT_INVALID')]);
    value = copied;
  } catch {
    return invalid([blocker('INPUT_INVALID')]);
  }

  if (value.receipt === undefined || value.receipt === null || value.evaluation === undefined || value.evaluation === null) {
    return { status: 'NOT_RUN', blockers: [blocker('EVALUATION_NOT_RUN')] };
  }
  const projectId = typeof value.projectId === 'string' ? value.projectId : undefined;
  const domain = AUTHORITY_DOMAINS.includes(value.domain as AuthorityDomain) ? value.domain as AuthorityDomain : undefined;
  const common: DomainProductQualificationView = {
    status: 'HOLD', blockers: [],
    ...(projectId !== undefined ? { projectId } : {}),
    ...(domain !== undefined ? { domain } : {}),
  };
  const blockers: DomainProductQualificationViewBlocker[] = [];
  if (typeof value.projectId !== 'string' || !ID.test(value.projectId)) blockers.push(blocker('INPUT_INVALID'));
  if (!AUTHORITY_DOMAINS.includes(value.domain as AuthorityDomain)) blockers.push(blocker('INPUT_INVALID'));
  if (!revisionValid(value.receiptRevision) || !revisionValid(value.currentRevision)) blockers.push(blocker('REVISION_INVALID'));
  if (typeof value.authorityManifestSha256 !== 'string' || !SHA256.test(value.authorityManifestSha256)) blockers.push(blocker('AUTHORITY_MANIFEST_HASH_MISMATCH'));
  if (typeof value.deliverableManifestSha256 !== 'string' || !SHA256.test(value.deliverableManifestSha256)) blockers.push(blocker('DELIVERABLE_MANIFEST_HASH_MISMATCH'));
  if (blockers.length) return { ...common, status: 'INVALID', blockers: uniqueBlockers(blockers) };

  const receipt = value.receipt as DomainProductReceipt;
  const receiptRevision = value.receiptRevision as QualificationViewRevision;
  const currentRevision = value.currentRevision as QualificationViewRevision;
  const authorityManifestSha256 = value.authorityManifestSha256 as string;
  const deliverableManifestSha256 = value.deliverableManifestSha256 as string;
  if (!isPlainRecord(receipt) || !isPlainRecord(receipt.projectRevision)) {
    return { ...common, status: 'INVALID', blockers: [blocker('RECEIPT_INVALID')] };
  }
  if (receipt.projectId !== value.projectId) blockers.push(blocker('PROJECT_MISMATCH'));
  if (receipt.domain !== value.domain) blockers.push(blocker('DOMAIN_MISMATCH'));
  if (receipt.projectRevision.id !== receiptRevision.id) blockers.push(blocker('REVISION_ID_MISMATCH'));
  if (receipt.projectRevision.sha256 !== receiptRevision.contentSha256) blockers.push(blocker('REVISION_CONTENT_HASH_MISMATCH'));
  if (currentRevision.id !== receiptRevision.id) blockers.push(blocker('REVISION_ID_MISMATCH'));
  if (currentRevision.sequence !== receiptRevision.sequence) blockers.push(blocker('REVISION_SEQUENCE_MISMATCH'));
  if (currentRevision.contentSha256 !== receiptRevision.contentSha256) blockers.push(blocker('REVISION_CONTENT_HASH_MISMATCH'));
  if (blockers.length) return { ...common, status: 'STALE', blockers: uniqueBlockers(blockers) };

  let evaluation: DomainProductReceiptEvaluation;
  let receiptSha256: string;
  try {
    const authority = value.authorityManifest === undefined ? undefined : value.authorityManifest as DomainAuthorityManifest;
    const deliverable = value.deliverableManifest === undefined ? undefined : value.deliverableManifest as DomainDeliverableManifest;
    evaluation = evaluateDomainProductReceipt(receipt, { authorityManifest: authority, deliverableManifest: deliverable });
    receiptSha256 = hashDomainProductReceipt(receipt);
    if (authority) {
      const hash = (() => { try { return hashDomainAuthorityManifest(authority); } catch { return null; } })();
      if (!hash) blockers.push(blocker('AUTHORITY_MANIFEST_INVALID'));
      else if (hash !== value.authorityManifestSha256 || receipt.authorityManifestSha256 !== hash) blockers.push(blocker('AUTHORITY_MANIFEST_HASH_MISMATCH'));
    } else blockers.push(blocker('AUTHORITY_MANIFEST_NOT_RUN'));
    if (deliverable) {
      const hash = (() => { try { return canonicalDomainDeliverableManifestHash(deliverable); } catch { return null; } })();
      if (!hash) blockers.push(blocker('DELIVERABLE_MANIFEST_INVALID'));
      else if (hash !== value.deliverableManifestSha256 || receipt.deliverableManifestSha256 !== hash) blockers.push(blocker('DELIVERABLE_MANIFEST_HASH_MISMATCH'));
    } else blockers.push(blocker('DELIVERABLE_MANIFEST_NOT_RUN'));
  } catch {
    return { ...common, status: 'INVALID', blockers: [blocker('RECEIPT_INVALID')] };
  }

  const candidate = value.evaluation as RecordValue;
  if (!isPlainRecord(candidate) || !exactKeys(candidate, EVALUATION_KEYS)
    || candidate.structurallyValid !== evaluation.structurallyValid
    || candidate.status !== evaluation.status
    || candidate.eligibleState !== evaluation.eligibleState
    || candidate.canonicalSha256 !== evaluation.canonicalSha256) {
    blockers.push(blocker('EVALUATION_MISMATCH'));
  }
  if (!evaluation.structurallyValid) blockers.push(blocker('RECEIPT_INVALID'));
  if (evaluation.status === 'PASS' && evaluation.eligibleState === 'PRODUCT_QUALIFIED' && !evaluation.blockers.length && !blockers.length) {
    return {
      status: 'PASS', blockers: [], projectId: projectId!, domain: domain!,
      receiptSha256, authorityManifestSha256, deliverableManifestSha256,
    };
  }
  const mapped = [...blockers, ...mapEvaluationBlockers(evaluation)];
  const stale = mapped.some(item => item.code === 'PROJECT_MISMATCH'
    || item.code === 'DOMAIN_MISMATCH'
    || item.code === 'REVISION_ID_MISMATCH'
    || item.code === 'REVISION_SEQUENCE_MISMATCH'
    || item.code === 'REVISION_CONTENT_HASH_MISMATCH'
    || item.code === 'EVIDENCE_NOT_CURRENT');
  return {
    status: stale ? 'STALE' : evaluation.status === 'PASS' && evaluation.eligibleState === 'PRODUCT_QUALIFIED' ? 'HOLD' : 'HOLD',
    blockers: uniqueBlockers(mapped), projectId: projectId!, domain: domain!,
    receiptSha256, authorityManifestSha256, deliverableManifestSha256,
  };
}
