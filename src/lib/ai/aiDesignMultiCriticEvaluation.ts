import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { assessAiDesignCandidateQuality, type AiDesignCandidateQualityInput } from './aiDesignCandidateQuality';
import { serverEvidenceSha256 } from './serverEvidence';

export const AI_DESIGN_MULTI_CRITIC_BUNDLE_SCHEMA = 'nexyfab.ai-design-multi-critic-bundle.v1' as const;
export const AI_DESIGN_CRITIC_RECEIPT_SCHEMA = 'nexyfab.ai-design-critic-receipt.v1' as const;

export const AI_DESIGN_CRITIC_KINDS = [
  'authority_guard',
  'intent_traceability',
  'assembly_integrity',
  'interface_completeness',
  'cross_domain_consistency',
  'candidate_diversity',
  'change_safety',
] as const;

export type AiDesignCriticKind = (typeof AI_DESIGN_CRITIC_KINDS)[number];
export type AiDesignCriticStatus = 'PASS' | 'FAIL' | 'NOT_RUN';

export interface AiDesignCriticSubjectV1 {
  projectId: string;
  sessionId: string;
  runId: string;
  candidateId: string;
  candidateManifestDigest: string;
  checkpointDigest: string;
  intentNodeIds: readonly string[];
  parameterIds: readonly string[];
  featureIds: readonly string[];
  candidateSet: readonly AiDesignCandidateQualityInput[];
  structure: null | {
    digest: string;
    productRootCount: number;
    componentCount: number;
    interfaceCount: number;
    orphanCount: number;
    cycleCount: number;
    unresolvedInterfaceCount: number;
  };
  crossDomain: null | {
    digest: string;
    domainCount: number;
    constraintCount: number;
    conflictCount: number;
    unresolvedCount: number;
  };
  changeImpact: null | {
    digest: string;
    affectedArtifactCount: number;
    requiredReverificationCount: number;
    unsafePassCount: number;
  };
  claimedExactVerificationStatus: 'NOT_RUN';
  claimedManufacturingReleaseReady: false;
}

export interface AiDesignCriticResultV1 {
  critic: AiDesignCriticKind;
  status: AiDesignCriticStatus;
  summary: string;
  codes: readonly string[];
  checkedAt: string;
  /** A critic PASS is conceptual evidence only. */
  evidenceScope: 'concept';
  exactGeometryAuthority: false;
}

export interface AiDesignCriticReceiptV1 extends AiDesignCriticResultV1 {
  schema: typeof AI_DESIGN_CRITIC_RECEIPT_SCHEMA;
  receiptId: string;
  projectId: string;
  sessionId: string;
  runId: string;
  candidateId: string;
  candidateManifestDigest: string;
  checkpointDigest: string;
  inputDigest: string;
  outputDigest: string;
  producer: 'ai-design-multi-critic-v1';
  expiresAt: string;
  signature: string;
}

export interface AiDesignMultiCriticBundleV1 {
  schema: typeof AI_DESIGN_MULTI_CRITIC_BUNDLE_SCHEMA;
  bundleId: string;
  projectId: string;
  sessionId: string;
  runId: string;
  candidateId: string;
  candidateManifestDigest: string;
  checkpointDigest: string;
  status: 'PASS' | 'FAIL' | 'INCOMPLETE';
  conceptReviewReady: boolean;
  receipts: readonly AiDesignCriticReceiptV1[];
  failedCritics: readonly AiDesignCriticKind[];
  pendingCritics: readonly AiDesignCriticKind[];
  bundleDigest: string;
  engineeringVerified: false;
  manufacturingReleaseReady: false;
}

export interface AiDesignCriticContext {
  subject: Readonly<AiDesignCriticSubjectV1>;
  now: Date;
}

export type AiDesignCritic = (context: AiDesignCriticContext) => Promise<Omit<AiDesignCriticResultV1, 'checkedAt'>>;

export interface AiDesignMultiCriticOptions {
  signingSecret: string;
  critics?: Readonly<Partial<Record<AiDesignCriticKind, AiDesignCritic>>>;
  now?: () => Date;
  timeoutMs?: number;
  ttlMs?: number;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CODE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_IDS = 1_000;
const MAX_CANDIDATES = 12;
const MIN_SECRET_BYTES = 32;
const MAX_TTL_MS = 60 * 60_000;
const REQUIRED_FOR_CONCEPT_REVIEW = new Set<AiDesignCriticKind>(['authority_guard', 'intent_traceability', 'candidate_diversity']);

function nonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateSubject(subject: AiDesignCriticSubjectV1): void {
  const ids = [subject.projectId, subject.sessionId, subject.runId, subject.candidateId];
  if (ids.some(value => !ID.test(value))) throw new Error('AI_DESIGN_CRITIC_SCOPE_INVALID');
  if (![subject.candidateManifestDigest, subject.checkpointDigest].every(value => SHA256.test(value))) throw new Error('AI_DESIGN_CRITIC_DIGEST_INVALID');
  for (const values of [subject.intentNodeIds, subject.parameterIds, subject.featureIds]) {
    if (values.length > MAX_IDS || values.some(value => !ID.test(value))) throw new Error('AI_DESIGN_CRITIC_DEPENDENCIES_INVALID');
  }
  if (subject.candidateSet.length > MAX_CANDIDATES) throw new Error('AI_DESIGN_CRITIC_CANDIDATES_TOO_LARGE');
  for (const candidate of subject.candidateSet) {
    if (!ID.test(candidate.id) || candidate.title.length > 240 || candidate.summary.length > 4_000
      || candidate.parameterKeys.length > MAX_IDS || candidate.featureKeys.length > MAX_IDS) {
      throw new Error('AI_DESIGN_CRITIC_CANDIDATE_INVALID');
    }
  }
  const structures = [
    subject.structure && [subject.structure.productRootCount, subject.structure.componentCount, subject.structure.interfaceCount, subject.structure.orphanCount, subject.structure.cycleCount, subject.structure.unresolvedInterfaceCount],
    subject.crossDomain && [subject.crossDomain.domainCount, subject.crossDomain.constraintCount, subject.crossDomain.conflictCount, subject.crossDomain.unresolvedCount],
    subject.changeImpact && [subject.changeImpact.affectedArtifactCount, subject.changeImpact.requiredReverificationCount, subject.changeImpact.unsafePassCount],
  ].filter((value): value is number[] => value !== null);
  if (structures.some(values => values.some(value => !nonNegativeInteger(value)))) throw new Error('AI_DESIGN_CRITIC_COUNT_INVALID');
  for (const digest of [subject.structure?.digest, subject.crossDomain?.digest, subject.changeImpact?.digest]) {
    if (digest !== undefined && !SHA256.test(digest)) throw new Error('AI_DESIGN_CRITIC_SIDECAR_DIGEST_INVALID');
  }
  if (subject.claimedExactVerificationStatus !== 'NOT_RUN' || subject.claimedManufacturingReleaseReady !== false) {
    throw new Error('AI_DESIGN_CRITIC_AUTHORITY_ESCALATION_FORBIDDEN');
  }
}

function result(critic: AiDesignCriticKind, status: AiDesignCriticStatus, summary: string, codes: readonly string[]): Omit<AiDesignCriticResultV1, 'checkedAt'> {
  return { critic, status, summary, codes, evidenceScope: 'concept', exactGeometryAuthority: false };
}

export const BUILT_IN_AI_DESIGN_CRITICS: Readonly<Record<AiDesignCriticKind, AiDesignCritic>> = {
  authority_guard: async ({ subject }) => result(
    'authority_guard',
    subject.claimedExactVerificationStatus === 'NOT_RUN' && subject.claimedManufacturingReleaseReady === false ? 'PASS' : 'FAIL',
    'Authority claims are bounded to concept review.',
    ['concept_scope_only', 'exact_verification_not_run', 'manufacturing_release_false'],
  ),
  intent_traceability: async ({ subject }) => result(
    'intent_traceability',
    subject.intentNodeIds.length > 0 ? 'PASS' : 'FAIL',
    subject.intentNodeIds.length > 0 ? 'The concept has explicit intent dependencies.' : 'No intent dependency is bound to the concept.',
    [subject.intentNodeIds.length > 0 ? 'intent_traceability_present' : 'intent_traceability_missing'],
  ),
  assembly_integrity: async ({ subject }) => {
    if (!subject.structure) return result('assembly_integrity', 'NOT_RUN', 'No product-structure sidecar was supplied.', ['product_structure_not_supplied']);
    const passed = subject.structure.productRootCount === 1 && subject.structure.componentCount > 0
      && subject.structure.orphanCount === 0 && subject.structure.cycleCount === 0;
    return result('assembly_integrity', passed ? 'PASS' : 'FAIL', passed ? 'The conceptual assembly hierarchy is structurally connected.' : 'The conceptual assembly hierarchy has root, orphan, or cycle defects.', [passed ? 'assembly_structure_connected' : 'assembly_structure_invalid']);
  },
  interface_completeness: async ({ subject }) => {
    if (!subject.structure) return result('interface_completeness', 'NOT_RUN', 'No assembly-interface sidecar was supplied.', ['assembly_interfaces_not_supplied']);
    const expected = subject.structure.componentCount > 1;
    const passed = (!expected || subject.structure.interfaceCount > 0) && subject.structure.unresolvedInterfaceCount === 0;
    return result('interface_completeness', passed ? 'PASS' : 'FAIL', passed ? 'Required conceptual interfaces are declared.' : 'One or more conceptual assembly interfaces are missing or unresolved.', [passed ? 'concept_interfaces_declared' : 'concept_interfaces_incomplete']);
  },
  cross_domain_consistency: async ({ subject }) => {
    if (!subject.crossDomain || subject.crossDomain.domainCount < 2) return result('cross_domain_consistency', 'NOT_RUN', 'The concept does not yet have a multi-domain constraint sidecar.', ['cross_domain_constraints_not_supplied']);
    const passed = subject.crossDomain.constraintCount > 0 && subject.crossDomain.conflictCount === 0 && subject.crossDomain.unresolvedCount === 0;
    return result('cross_domain_consistency', passed ? 'PASS' : 'FAIL', passed ? 'Declared cross-domain concept constraints are internally resolved.' : 'Cross-domain concept constraints remain missing, conflicting, or unresolved.', [passed ? 'cross_domain_constraints_resolved' : 'cross_domain_constraints_unresolved']);
  },
  candidate_diversity: async ({ subject }) => {
    const quality = assessAiDesignCandidateQuality(subject.candidateSet);
    return result('candidate_diversity', quality.conceptPublishable ? 'PASS' : 'FAIL', quality.conceptPublishable ? 'The comparison set contains distinct editable concepts.' : 'The comparison set does not meet the deterministic diversity gate.', quality.conceptPublishable ? ['candidate_set_diverse'] : quality.issues);
  },
  change_safety: async ({ subject }) => {
    if (!subject.changeImpact) return result('change_safety', 'NOT_RUN', 'No change-impact sidecar was supplied.', ['change_impact_not_supplied']);
    const passed = subject.changeImpact.unsafePassCount === 0
      && (subject.changeImpact.affectedArtifactCount === 0 || subject.changeImpact.requiredReverificationCount > 0);
    return result('change_safety', passed ? 'PASS' : 'FAIL', passed ? 'Affected artifacts retain explicit pending reverification.' : 'A changed artifact bypassed reverification or claimed an unsafe PASS.', [passed ? 'reverification_preserved' : 'unsafe_change_evidence']);
  },
};

function unsigned(receipt: AiDesignCriticReceiptV1): Omit<AiDesignCriticReceiptV1, 'signature'> {
  const { signature: _signature, ...value } = receipt;
  return value;
}

function sign(value: Omit<AiDesignCriticReceiptV1, 'signature'>, secret: string): string {
  return createHmac('sha256', secret).update(serverEvidenceSha256(value)).digest('hex');
}

function validateResult(value: Omit<AiDesignCriticResultV1, 'checkedAt'>, expected: AiDesignCriticKind): void {
  if (value.critic !== expected || !AI_DESIGN_CRITIC_KINDS.includes(value.critic)) throw new Error('AI_DESIGN_CRITIC_RESULT_KIND_INVALID');
  if (!['PASS', 'FAIL', 'NOT_RUN'].includes(value.status) || !value.summary.trim() || value.summary.length > 1_000) throw new Error('AI_DESIGN_CRITIC_RESULT_INVALID');
  if (value.codes.length > 32 || value.codes.some(code => !CODE.test(code))) throw new Error('AI_DESIGN_CRITIC_CODES_INVALID');
  if (value.evidenceScope !== 'concept' || value.exactGeometryAuthority !== false) throw new Error('AI_DESIGN_CRITIC_AUTHORITY_INVALID');
}

async function runWithTimeout(critic: AiDesignCritic, context: AiDesignCriticContext, timeoutMs: number): Promise<Omit<AiDesignCriticResultV1, 'checkedAt'>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      critic(context),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('AI_DESIGN_CRITIC_TIMEOUT')), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Runs independent, bounded critics and HMAC-binds every conceptual result. */
export async function evaluateAiDesignCandidateWithCritics(
  subject: AiDesignCriticSubjectV1,
  options: AiDesignMultiCriticOptions,
): Promise<AiDesignMultiCriticBundleV1> {
  validateSubject(subject);
  if (Buffer.byteLength(options.signingSecret, 'utf8') < MIN_SECRET_BYTES) throw new Error('AI_DESIGN_CRITIC_SIGNING_SECRET_WEAK');
  const now = options.now?.() ?? new Date();
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 10_000, 1), 60_000);
  const ttlMs = Math.min(Math.max(options.ttlMs ?? 10 * 60_000, 1), MAX_TTL_MS);
  const inputDigest = serverEvidenceSha256(subject);
  const configured = { ...BUILT_IN_AI_DESIGN_CRITICS, ...(options.critics ?? {}) };
  const raw = await Promise.all(AI_DESIGN_CRITIC_KINDS.map(async criticKind => {
    try {
      const value = await runWithTimeout(configured[criticKind], { subject: structuredClone(subject), now }, timeoutMs);
      validateResult(value, criticKind);
      return value;
    } catch (error) {
      const timeout = error instanceof Error && error.message === 'AI_DESIGN_CRITIC_TIMEOUT';
      return result(criticKind, 'FAIL', timeout ? 'The critic timed out.' : 'The critic failed closed.', [timeout ? 'critic_timeout' : 'critic_execution_failed']);
    }
  }));
  const receipts = raw.map(value => {
    const checkedAt = now.toISOString();
    const outputDigest = serverEvidenceSha256(value);
    const base: Omit<AiDesignCriticReceiptV1, 'signature'> = {
      schema: AI_DESIGN_CRITIC_RECEIPT_SCHEMA,
      receiptId: `ai-critic:${serverEvidenceSha256({ inputDigest, critic: value.critic, outputDigest, checkedAt }).slice(0, 48)}`,
      projectId: subject.projectId,
      sessionId: subject.sessionId,
      runId: subject.runId,
      candidateId: subject.candidateId,
      candidateManifestDigest: subject.candidateManifestDigest,
      checkpointDigest: subject.checkpointDigest,
      inputDigest,
      outputDigest,
      producer: 'ai-design-multi-critic-v1',
      ...value,
      checkedAt,
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    };
    return Object.freeze({ ...base, signature: sign(base, options.signingSecret) });
  });
  const failedCritics = receipts.filter(item => item.status === 'FAIL').map(item => item.critic);
  const pendingCritics = receipts.filter(item => item.status === 'NOT_RUN').map(item => item.critic);
  const conceptReviewReady = failedCritics.length === 0
    && receipts.filter(item => REQUIRED_FOR_CONCEPT_REVIEW.has(item.critic)).every(item => item.status === 'PASS');
  const status: AiDesignMultiCriticBundleV1['status'] = failedCritics.length ? 'FAIL' : pendingCritics.length ? 'INCOMPLETE' : 'PASS';
  const material = {
    projectId: subject.projectId, sessionId: subject.sessionId, runId: subject.runId,
    candidateId: subject.candidateId, candidateManifestDigest: subject.candidateManifestDigest,
    checkpointDigest: subject.checkpointDigest, status, conceptReviewReady,
    receiptIds: receipts.map(item => item.receiptId), receiptDigests: receipts.map(item => serverEvidenceSha256(item)),
    failedCritics, pendingCritics, engineeringVerified: false as const, manufacturingReleaseReady: false as const,
  };
  const bundleDigest = serverEvidenceSha256(material);
  return Object.freeze({
    schema: AI_DESIGN_MULTI_CRITIC_BUNDLE_SCHEMA,
    bundleId: `ai-critic-bundle:${bundleDigest.slice(0, 48)}`,
    ...material,
    receipts,
    bundleDigest,
  });
}

export function verifyAiDesignCriticReceipt(
  receipt: AiDesignCriticReceiptV1,
  secret: string,
  expected: Pick<AiDesignCriticSubjectV1, 'projectId' | 'sessionId' | 'runId' | 'candidateId' | 'candidateManifestDigest' | 'checkpointDigest'>,
  now = new Date(),
): readonly string[] {
  const issues: string[] = [];
  if (Buffer.byteLength(secret, 'utf8') < MIN_SECRET_BYTES) return ['AI_DESIGN_CRITIC_SIGNING_SECRET_REQUIRED'];
  if (receipt.schema !== AI_DESIGN_CRITIC_RECEIPT_SCHEMA || receipt.producer !== 'ai-design-multi-critic-v1') issues.push('AI_DESIGN_CRITIC_RECEIPT_SCHEMA_INVALID');
  for (const key of ['projectId', 'sessionId', 'runId', 'candidateId', 'candidateManifestDigest', 'checkpointDigest'] as const) {
    if (receipt[key] !== expected[key]) issues.push(`AI_DESIGN_CRITIC_RECEIPT_${key.toUpperCase()}_MISMATCH`);
  }
  if (!SHA256.test(receipt.inputDigest) || !SHA256.test(receipt.outputDigest)) issues.push('AI_DESIGN_CRITIC_RECEIPT_DIGEST_INVALID');
  if (receipt.evidenceScope !== 'concept' || receipt.exactGeometryAuthority !== false) issues.push('AI_DESIGN_CRITIC_RECEIPT_AUTHORITY_INVALID');
  const checkedAt = Date.parse(receipt.checkedAt), expiresAt = Date.parse(receipt.expiresAt);
  if (!Number.isFinite(checkedAt) || !Number.isFinite(expiresAt) || expiresAt <= now.getTime() || expiresAt <= checkedAt || expiresAt - checkedAt > MAX_TTL_MS) issues.push('AI_DESIGN_CRITIC_RECEIPT_EXPIRED');
  const expectedSignature = sign(unsigned(receipt), secret);
  if (!/^[a-f0-9]{64}$/.test(receipt.signature)) issues.push('AI_DESIGN_CRITIC_RECEIPT_SIGNATURE_INVALID');
  else {
    const actual = Buffer.from(receipt.signature, 'hex');
    const reference = Buffer.from(expectedSignature, 'hex');
    if (actual.length !== reference.length || !timingSafeEqual(actual, reference)) issues.push('AI_DESIGN_CRITIC_RECEIPT_SIGNATURE_INVALID');
  }
  return [...new Set(issues)].sort();
}
