/** Common, fail-closed maturity contract for discipline design products. */
export const DOMAIN_PRODUCT_STATE_SCHEMA = 'nexyfab.domain-product-state.v1' as const;

export const PRODUCT_STATES = ['CONCEPT', 'DESIGN_CANDIDATE', 'DOMAIN_VERIFIED', 'DELIVERY_CANDIDATE', 'PRODUCT_QUALIFIED'] as const;
export type DomainProductState = typeof PRODUCT_STATES[number];
export type EvidenceStatus = 'PASS' | 'FAIL' | 'HOLD' | 'NOT_RUN' | 'STALE';
export type EvidenceSource = 'AI' | 'PRECISION' | 'INDEPENDENT' | 'EXTERNAL' | 'FIELD';
export type ProductStateActor = 'AI_DESIGN' | 'PRECISION_CAD' | 'GOVERNED_RELEASE';

export const REQUIRED_EVIDENCE = {
  DESIGN_CANDIDATE: ['structuredIntent', 'candidateAcceptance'],
  DOMAIN_VERIFIED: ['precisionExact', 'domainValidation'],
  DELIVERY_CANDIDATE: ['deliverableManifest', 'independentRoundtrip'],
  PRODUCT_QUALIFIED: ['externalAuthority', 'independentReview', 'pilotEvidence'],
} as const;
export type ProductEvidenceKey = typeof REQUIRED_EVIDENCE[keyof typeof REQUIRED_EVIDENCE][number];

export interface ProductEvidence {
  status: EvidenceStatus;
  source: EvidenceSource;
  evidenceId: string;
}

export interface DomainProductStateRecord {
  schema: typeof DOMAIN_PRODUCT_STATE_SCHEMA;
  state: DomainProductState;
  revision: number;
  invalidated: boolean;
  blockers: string[];
}

export type TransitionResult =
  | { ok: true; record: DomainProductStateRecord }
  | { ok: false; record: DomainProductStateRecord; blockers: string[] };

const MAX_BLOCKERS = 64;
const MAX_EVIDENCE_ID = 256;
const MAX_REASON = 256;
const BAD_STATUSES = new Set<EvidenceStatus>(['FAIL', 'HOLD', 'NOT_RUN', 'STALE']);
const STATE_INDEX = new Map(PRODUCT_STATES.map((state, index) => [state, index]));
const ALL_KEYS = new Set(Object.values(REQUIRED_EVIDENCE).flat());

function unique(values: string[]): string[] {
  return [...new Set(values)].slice(0, MAX_BLOCKERS);
}

function validRecord(record: DomainProductStateRecord): string[] {
  const blockers: string[] = [];
  if (!record || typeof record !== 'object') return ['state_invalid'];
  if (record.schema !== DOMAIN_PRODUCT_STATE_SCHEMA) blockers.push('schema_invalid');
  if (!PRODUCT_STATES.includes(record.state)) blockers.push('state_invalid');
  if (!Number.isSafeInteger(record.revision) || record.revision < 0) blockers.push('revision_invalid');
  if (typeof record.invalidated !== 'boolean') blockers.push('invalidated_invalid');
  if (!Array.isArray(record.blockers) || record.blockers.length > MAX_BLOCKERS || record.blockers.some(value => typeof value !== 'string' || value.length > MAX_REASON)) blockers.push('blockers_invalid');
  return blockers;
}

function validEvidence(evidence: Partial<Record<ProductEvidenceKey, ProductEvidence>> | undefined): string[] {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return ['evidence_missing'];
  const blockers: string[] = [];
  for (const key of Object.keys(evidence)) {
    if (!ALL_KEYS.has(key as ProductEvidenceKey)) blockers.push(`evidence_unknown_key:${key}`);
  }
  for (const [key, item] of Object.entries(evidence)) {
    if (!item || typeof item !== 'object') { blockers.push(`${key}_invalid`); continue; }
    if (!['PASS', 'FAIL', 'HOLD', 'NOT_RUN', 'STALE'].includes(item.status)) blockers.push(`${key}_status_invalid`);
    if (!['AI', 'PRECISION', 'INDEPENDENT', 'EXTERNAL', 'FIELD'].includes(item.source)) blockers.push(`${key}_source_invalid`);
    if (typeof item.evidenceId !== 'string' || item.evidenceId.trim().length === 0 || item.evidenceId.length > MAX_EVIDENCE_ID) blockers.push(`${key}_evidence_id_invalid`);
  }
  return blockers;
}

export function createDomainProductState(): DomainProductStateRecord {
  return { schema: DOMAIN_PRODUCT_STATE_SCHEMA, state: 'CONCEPT', revision: 0, invalidated: false, blockers: [] };
}

export function transitionDomainProductState(
  current: DomainProductStateRecord,
  target: DomainProductState,
  evidence: Partial<Record<ProductEvidenceKey, ProductEvidence>>,
  actor: ProductStateActor = 'PRECISION_CAD',
): TransitionResult {
  const base = { ...current, blockers: [...(current?.blockers ?? [])] };
  const blockers = [...validRecord(current), ...validEvidence(evidence)];
  const currentIndex = STATE_INDEX.get(current?.state);
  const targetIndex = STATE_INDEX.get(target);
  if (currentIndex === undefined || targetIndex === undefined) blockers.push('state_invalid');
  else if (targetIndex !== currentIndex + 1) blockers.push(targetIndex <= currentIndex ? 'promotion_not_sequential' : 'required_previous_state');
  const requiredActor: Partial<Record<DomainProductState, ProductStateActor>> = {
    DESIGN_CANDIDATE: 'PRECISION_CAD',
    DOMAIN_VERIFIED: 'PRECISION_CAD',
    DELIVERY_CANDIDATE: 'PRECISION_CAD',
    PRODUCT_QUALIFIED: 'GOVERNED_RELEASE',
  };
  if (requiredActor[target] !== actor) blockers.push(actor === 'AI_DESIGN' ? 'ai_authority_boundary' : 'actor_not_authorized');
  if (current?.invalidated) blockers.push('state_invalidated');
  if (targetIndex !== undefined && targetIndex >= 1) {
    const targetEvidence = target === 'CONCEPT' ? [] : REQUIRED_EVIDENCE[target];
    for (const key of targetEvidence) {
      const item = evidence?.[key];
      if (!item) { blockers.push(`${key}_not_run`); continue; }
      if (BAD_STATUSES.has(item.status)) blockers.push(`${key}_${item.status.toLowerCase()}`);
      if (item.status !== 'PASS') continue;
      const allowed: EvidenceSource[] = key === 'structuredIntent' ? ['AI', 'PRECISION']
        : key === 'candidateAcceptance' || key === 'precisionExact' || key === 'domainValidation' || key === 'deliverableManifest' ? ['PRECISION']
          : key === 'independentRoundtrip' || key === 'independentReview' ? ['INDEPENDENT']
            : key === 'externalAuthority' ? ['EXTERNAL'] : ['FIELD'];
      if (!allowed.includes(item.source)) blockers.push(`${key}_source_not_authorized`);
    }
  }
  const uniqueBlockers = unique(blockers);
  if (uniqueBlockers.length) return { ok: false, record: { ...base, blockers: uniqueBlockers }, blockers: uniqueBlockers };
  return { ok: true, record: { ...base, state: target, revision: current.revision + 1, invalidated: false, blockers: [] } };
}

export function downgradeDomainProductState(current: DomainProductStateRecord, target: DomainProductState, reason: string): DomainProductStateRecord {
  if (validRecord(current).length > 0 || !PRODUCT_STATES.includes(target) || STATE_INDEX.get(target)! >= STATE_INDEX.get(current.state)! || typeof reason !== 'string' || reason.trim().length === 0 || reason.length > MAX_REASON) return { ...current, blockers: unique(['downgrade_invalid', ...(current?.blockers ?? [])]) };
  return { ...current, state: target, revision: current.revision + 1, invalidated: false, blockers: unique([`downgraded:${reason}`]) };
}

export function invalidateDomainProductState(current: DomainProductStateRecord, reason: string): DomainProductStateRecord {
  if (validRecord(current).length > 0) return { ...current, blockers: unique(['invalidation_invalid', ...(current?.blockers ?? [])]) };
  const safeReason = typeof reason === 'string' && reason.trim().length > 0 && reason.length <= MAX_REASON ? reason : 'invalidated';
  return { ...current, revision: current.revision + 1, invalidated: true, blockers: unique([`invalidated:${safeReason}`]) };
}
