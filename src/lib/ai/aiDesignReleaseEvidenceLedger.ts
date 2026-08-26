import { createHash } from 'node:crypto';

export const AI_DESIGN_RELEASE_EVIDENCE_SCHEMA = 'nexyfab.ai-design-release-evidence.v1' as const;
export const AI_DESIGN_RELEASE_EVIDENCE_LEDGER_SCHEMA = 'nexyfab.ai-design-release-evidence-ledger.v1' as const;
export const AI_DESIGN_RELEASE_DOMAINS = ['mechanical', 'architecture', 'interior', 'civil', 'landscape'] as const;
export const AI_DESIGN_RELEASE_EVIDENCE_TARGETS = {
  independent_case: 20,
  deterministic_campaign: 3,
  expert_review: 2,
  physical_pilot: 3,
} as const;

export type AiDesignReleaseDomain = (typeof AI_DESIGN_RELEASE_DOMAINS)[number];
export type AiDesignReleaseEvidenceKind = keyof typeof AI_DESIGN_RELEASE_EVIDENCE_TARGETS;
export type AiDesignReleaseEvidenceRights = 'synthetic' | 'owned' | 'licensed' | 'permissioned' | 'public_domain';

export interface AiDesignReleaseEvidenceInputV1 {
  evidenceId: string;
  domain: AiDesignReleaseDomain;
  kind: AiDesignReleaseEvidenceKind;
  result: 'PASS' | 'FAIL';
  externallyVerified: boolean;
  independentOfImplementationTeam: boolean;
  rights: AiDesignReleaseEvidenceRights;
  rightsReceiptDigest: string;
  artifactDigest: string;
  attestationDigest: string;
  independentlyWrittenSummary: string;
  createdAt: string;
}

export interface AiDesignReleaseEvidenceV1 extends AiDesignReleaseEvidenceInputV1 {
  schema: typeof AI_DESIGN_RELEASE_EVIDENCE_SCHEMA;
  evidenceDigest: string;
  sourceContentIncluded: false;
  proprietaryGeometryIncluded: false;
  aiConceptOnly: true;
  exactCadVerifiedByAi: false;
  manufacturingReleaseReady: false;
}

export interface AiDesignReleaseReadinessV1 {
  schema: typeof AI_DESIGN_RELEASE_EVIDENCE_LEDGER_SCHEMA;
  ledgerDigest: string;
  governedRolloutStatus: 'HOLD' | 'ELIGIBLE_FOR_HUMAN_RELEASE_REVIEW';
  domains: Readonly<Record<AiDesignReleaseDomain, {
    status: 'HOLD' | 'TARGET_MET';
    counts: Readonly<Record<AiDesignReleaseEvidenceKind, number>>;
    missing: Readonly<Record<AiDesignReleaseEvidenceKind, number>>;
  }>>;
  authority: {
    evidenceGateOnly: true;
    exactCadVerifiedByAi: false;
    manufacturingReleaseReady: false;
    humanReleaseDecisionRequired: true;
  };
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const HASH = /^[a-f0-9]{64}$/;

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`;
}

function digest(value: unknown): string {
  return createHash('sha256').update(stable(value), 'utf8').digest('hex');
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}

function evidenceMaterial(value: Omit<AiDesignReleaseEvidenceV1, 'evidenceDigest'> | AiDesignReleaseEvidenceV1): unknown {
  const { evidenceDigest: _evidenceDigest, ...material } = value as AiDesignReleaseEvidenceV1;
  return material;
}

export function validateAiDesignReleaseEvidence(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['release_evidence_not_object'];
  const item = value as Partial<AiDesignReleaseEvidenceV1>;
  const issues: string[] = [];
  if (item.schema !== AI_DESIGN_RELEASE_EVIDENCE_SCHEMA || !ID.test(item.evidenceId ?? '') || !AI_DESIGN_RELEASE_DOMAINS.includes(item.domain as AiDesignReleaseDomain)
    || !Object.hasOwn(AI_DESIGN_RELEASE_EVIDENCE_TARGETS, item.kind ?? '') || !['PASS', 'FAIL'].includes(item.result ?? '')) issues.push('release_evidence_identity_invalid');
  if (![item.rightsReceiptDigest, item.artifactDigest, item.attestationDigest, item.evidenceDigest].every(value => HASH.test(value ?? ''))) issues.push('release_evidence_digest_invalid');
  if (!['synthetic', 'owned', 'licensed', 'permissioned', 'public_domain'].includes(item.rights ?? '')) issues.push('release_evidence_rights_invalid');
  if (item.kind === 'deterministic_campaign' && item.rights !== 'synthetic') issues.push('release_evidence_campaign_must_be_synthetic');
  if (item.kind !== 'deterministic_campaign' && item.rights === 'synthetic') issues.push('release_evidence_external_kind_must_not_be_synthetic');
  if (['independent_case', 'expert_review'].includes(item.kind ?? '') && item.independentOfImplementationTeam !== true) issues.push('release_evidence_independence_required');
  if (typeof item.independentlyWrittenSummary !== 'string' || !item.independentlyWrittenSummary.trim() || item.independentlyWrittenSummary.length > 1_000) issues.push('release_evidence_summary_invalid');
  if (!item.createdAt || !Number.isFinite(Date.parse(item.createdAt))) issues.push('release_evidence_timestamp_invalid');
  if (item.sourceContentIncluded !== false || item.proprietaryGeometryIncluded !== false || item.aiConceptOnly !== true
    || item.exactCadVerifiedByAi !== false || item.manufacturingReleaseReady !== false) issues.push('release_evidence_authority_invalid');
  if (issues.length === 0 && item.evidenceDigest !== digest(evidenceMaterial(item as AiDesignReleaseEvidenceV1))) issues.push('release_evidence_digest_mismatch');
  return [...new Set(issues)];
}

/** Creates a metadata-only evidence entry. Raw cases, manuals and geometry are deliberately excluded. */
export function createAiDesignReleaseEvidence(
  input: AiDesignReleaseEvidenceInputV1,
  options: { trustedServer: true },
): AiDesignReleaseEvidenceV1 {
  if (options.trustedServer !== true) throw new Error('AI_DESIGN_RELEASE_EVIDENCE_TRUSTED_SERVER_REQUIRED');
  const value = {
    schema: AI_DESIGN_RELEASE_EVIDENCE_SCHEMA,
    ...structuredClone(input),
    evidenceDigest: '',
    sourceContentIncluded: false as const,
    proprietaryGeometryIncluded: false as const,
    aiConceptOnly: true as const,
    exactCadVerifiedByAi: false as const,
    manufacturingReleaseReady: false as const,
  };
  value.evidenceDigest = digest(evidenceMaterial(value as AiDesignReleaseEvidenceV1));
  const issues = validateAiDesignReleaseEvidence(value);
  if (issues.length) throw new Error(`AI_DESIGN_RELEASE_EVIDENCE_INVALID:${issues.join(',')}`);
  return freeze(value as AiDesignReleaseEvidenceV1);
}

export interface AiDesignReleaseEvidenceLedger {
  appendImmutable(entry: AiDesignReleaseEvidenceV1): Promise<void>;
  list(): readonly AiDesignReleaseEvidenceV1[];
  readiness(): AiDesignReleaseReadinessV1;
}

/** Reference append-only ledger; production deployments must inject a durable implementation. */
export class InMemoryAiDesignReleaseEvidenceLedger implements AiDesignReleaseEvidenceLedger {
  readonly #entries = new Map<string, AiDesignReleaseEvidenceV1>();

  constructor(options: { commercialDeployment?: boolean } = {}) {
    if (options.commercialDeployment) throw new Error('AI_DESIGN_RELEASE_EVIDENCE_POSTGRES_REQUIRED');
  }

  async appendImmutable(entry: AiDesignReleaseEvidenceV1): Promise<void> {
    const issues = validateAiDesignReleaseEvidence(entry);
    if (issues.length) throw new Error(`AI_DESIGN_RELEASE_EVIDENCE_INVALID:${issues.join(',')}`);
    const existing = this.#entries.get(entry.evidenceId);
    if (existing && existing.evidenceDigest !== entry.evidenceDigest) throw new Error('AI_DESIGN_RELEASE_EVIDENCE_IMMUTABILITY_CONFLICT');
    if (!existing) this.#entries.set(entry.evidenceId, freeze(structuredClone(entry)));
  }

  list(): readonly AiDesignReleaseEvidenceV1[] {
    return Object.freeze([...this.#entries.values()].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)));
  }

  readiness(): AiDesignReleaseReadinessV1 {
    const entries = this.list();
    const domains = Object.fromEntries(AI_DESIGN_RELEASE_DOMAINS.map(domain => {
      const accepted = entries.filter(entry => entry.domain === domain && entry.result === 'PASS' && entry.externallyVerified);
      const counts = Object.fromEntries(Object.keys(AI_DESIGN_RELEASE_EVIDENCE_TARGETS).map(kind => [kind, accepted.filter(entry => entry.kind === kind).length])) as Record<AiDesignReleaseEvidenceKind, number>;
      const missing = Object.fromEntries(Object.entries(AI_DESIGN_RELEASE_EVIDENCE_TARGETS).map(([kind, target]) => [kind, Math.max(0, target - counts[kind as AiDesignReleaseEvidenceKind])])) as Record<AiDesignReleaseEvidenceKind, number>;
      return [domain, { status: Object.values(missing).every(value => value === 0) ? 'TARGET_MET' as const : 'HOLD' as const, counts: freeze(counts), missing: freeze(missing) }];
    })) as Record<AiDesignReleaseDomain, AiDesignReleaseReadinessV1['domains'][AiDesignReleaseDomain]>;
    const targetMet = Object.values(domains).every(domain => domain.status === 'TARGET_MET');
    const ledgerDigest = digest(entries.map(entry => ({ evidenceId: entry.evidenceId, evidenceDigest: entry.evidenceDigest })));
    return freeze({
      schema: AI_DESIGN_RELEASE_EVIDENCE_LEDGER_SCHEMA,
      ledgerDigest,
      governedRolloutStatus: targetMet ? 'ELIGIBLE_FOR_HUMAN_RELEASE_REVIEW' : 'HOLD',
      domains,
      authority: { evidenceGateOnly: true, exactCadVerifiedByAi: false, manufacturingReleaseReady: false, humanReleaseDecisionRequired: true },
    });
  }
}
