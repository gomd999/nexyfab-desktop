import { serverEvidenceSha256 } from './serverEvidence';

export const AI_DESIGN_KNOWLEDGE_SOURCE_SCHEMA = 'nexyfab.ai-design-knowledge-source.v1' as const;
export const AI_DESIGN_CONCEPT_CARD_SCHEMA = 'nexyfab.ai-design-concept-card.v1' as const;
export const AI_DESIGN_ENGINEERING_RULE_DSL_SCHEMA = 'nexyfab.ai-design-engineering-rule-dsl.v1' as const;
export const AI_DESIGN_KNOWLEDGE_RETRIEVAL_RECEIPT_SCHEMA = 'nexyfab.ai-design-knowledge-retrieval-receipt.v1' as const;

export const AI_DESIGN_KNOWLEDGE_RIGHTS = ['owned', 'licensed', 'public_domain', 'permissioned', 'unknown', 'restricted'] as const;
export type AiDesignKnowledgeRights = (typeof AI_DESIGN_KNOWLEDGE_RIGHTS)[number];
export const AI_DESIGN_KNOWLEDGE_USES = ['human_reference', 'concept_extraction', 'retrieval', 'rule_derivation', 'output_derivation'] as const;
export type AiDesignKnowledgeUse = (typeof AI_DESIGN_KNOWLEDGE_USES)[number];

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const UNIT = /^(1|m|mm|cm|kg|g|s|A|K|mol|cd|N|Pa|MPa|GPa|J|W|Hz|rad|deg|m\/s|m\/s2|kg\/m3|W\/mK)$/;
const MAX_TEXT = 4_000;
const MAX_LIST = 256;

export interface AiDesignKnowledgeSourceV1 {
  schema: typeof AI_DESIGN_KNOWLEDGE_SOURCE_SCHEMA;
  sourceId: string;
  version: number;
  sourceKind: 'manual' | 'standard' | 'internal_rule' | 'research' | 'catalog' | 'synthetic';
  title: string;
  contentHash: string;
  rights: AiDesignKnowledgeRights;
  allowedUses: readonly AiDesignKnowledgeUse[];
  rightsReference: string | null;
  rightsReferenceHash: string | null;
  effectiveAt: string;
  expiresAt: string | null;
  tenantId: string | null;
  projectId: string | null;
  containsProprietaryGeometry: boolean;
  containsPersonalData: boolean;
  rawContentAvailableToModel: false;
  approvedBy: string | null;
  approvedAt: string | null;
  recordDigest: string;
}

export interface AiDesignConceptCardV1 {
  schema: typeof AI_DESIGN_CONCEPT_CARD_SCHEMA;
  cardId: string;
  version: number;
  edition: string;
  title: string;
  independentSummary: string;
  principles: readonly string[];
  assumptions: readonly string[];
  appliesWhen: readonly string[];
  forbiddenWhen: readonly string[];
  tags: readonly string[];
  jurisdictions: readonly string[];
  formulae: readonly { formulaId: string; expression: string; outputUnit: string; variables: readonly { key: string; unit: string }[] }[];
  unitSystem: 'native_si';
  sourceBindings: readonly { sourceId: string; sourceVersion: number; sourceContentHash: string; sourceRecordDigest: string }[];
  approval: { status: 'draft' | 'approved' | 'revoked'; approvedBy: string | null; approvedAt: string | null; reviewAt: string | null };
  independentAuthorshipAttestation: 'independently_authored_no_source_copy';
  sourceTextIncluded: false;
  sourceImagesIncluded: false;
  sourceGeometryIncluded: false;
  conceptOnly: true;
  exactAuthority: false;
  rightsDecisionDigest: string;
  cardDigest: string;
}

export type AiDesignRuleOperator = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte';
export interface AiDesignRuleClauseV1 { parameter: string; operator: AiDesignRuleOperator; value: string | number | boolean; unit: string; }
export interface AiDesignEngineeringRuleDslV1 {
  schema: typeof AI_DESIGN_ENGINEERING_RULE_DSL_SCHEMA;
  ruleId: string;
  version: number;
  conceptCardId: string;
  conceptCardDigest: string;
  when: readonly AiDesignRuleClauseV1[];
  require: readonly AiDesignRuleClauseV1[];
  severity: 'info' | 'warning' | 'blocking';
  rationale: string;
  approval: { approvedBy: string; approvedAt: string };
  goldenCases: readonly { caseId: string; parameters: Readonly<Record<string, { value: string | number | boolean; unit: string }>>; expectedStatus: 'PASS' | 'FAIL' | 'NEEDS_INPUT' | 'NOT_APPLICABLE' }[];
  executableCodeIncluded: false;
  exactAuthority: false;
  ruleDigest: string;
}

export interface AiDesignKnowledgeRetrievalReceiptV1 {
  schema: typeof AI_DESIGN_KNOWLEDGE_RETRIEVAL_RECEIPT_SCHEMA;
  receiptId: string;
  projectId: string;
  sessionId: string;
  queryDigest: string;
  requestedUses: readonly AiDesignKnowledgeUse[];
  cardResults: readonly { cardId: string; cardDigest: string; score: number; sourceRecordDigests: readonly string[] }[];
  deniedSourceIds: readonly string[];
  rightsDecisionDigest: string;
  createdAt: string;
  rawSourceContentIncluded: false;
  conceptOnly: true;
  exactAuthority: false;
  receiptDigest: string;
}

export interface AiDesignKnowledgeRightsDecision {
  sourceId: string;
  sourceVersion: number;
  requestedUse: AiDesignKnowledgeUse;
  allowed: boolean;
  reason: string;
  decisionDigest: string;
}

function validTimestamp(value: string | null): boolean { return value === null || Number.isFinite(Date.parse(value)); }
function unique<T>(values: readonly T[]): T[] { return [...new Set(values)]; }
function boundedText(value: unknown, required = true): value is string { return typeof value === 'string' && value.length <= MAX_TEXT && (!required || !!value.trim()); }
function validList(value: unknown, required = false): value is string[] { return Array.isArray(value) && value.length <= MAX_LIST && (!required || value.length > 0) && value.every(item => boundedText(item)); }
function without<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> { const copy = { ...value }; delete copy[key]; return copy; }

export function createAiDesignKnowledgeSource(input: Omit<AiDesignKnowledgeSourceV1, 'schema' | 'rawContentAvailableToModel' | 'recordDigest'>): AiDesignKnowledgeSourceV1 {
  const base = {
    schema: AI_DESIGN_KNOWLEDGE_SOURCE_SCHEMA,
    ...structuredClone(input),
    allowedUses: unique(input.allowedUses).sort(),
    rawContentAvailableToModel: false as const,
  };
  const record = Object.freeze({ ...base, recordDigest: serverEvidenceSha256(base) });
  const issues = validateAiDesignKnowledgeSource(record);
  if (issues.length) throw new Error(`AI_DESIGN_KNOWLEDGE_SOURCE_INVALID:${issues.join(',')}`);
  return record;
}

export function validateAiDesignKnowledgeSource(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['knowledge_source_not_object'];
  const source = value as AiDesignKnowledgeSourceV1;
  const issues: string[] = [];
  if (source.schema !== AI_DESIGN_KNOWLEDGE_SOURCE_SCHEMA || !ID.test(source.sourceId ?? '') || !Number.isSafeInteger(source.version) || source.version < 1 || !['manual', 'standard', 'internal_rule', 'research', 'catalog', 'synthetic'].includes(source.sourceKind) || !boundedText(source.title) || !SHA256.test(source.contentHash ?? '')) issues.push('knowledge_source_binding_invalid');
  if (!AI_DESIGN_KNOWLEDGE_RIGHTS.includes(source.rights) || !Array.isArray(source.allowedUses) || source.allowedUses.length > AI_DESIGN_KNOWLEDGE_USES.length || source.allowedUses.some(item => !AI_DESIGN_KNOWLEDGE_USES.includes(item)) || new Set(source.allowedUses).size !== source.allowedUses.length) issues.push('knowledge_source_rights_invalid');
  if (['unknown', 'restricted'].includes(source.rights) && source.allowedUses.length > 0) issues.push('knowledge_source_fail_closed_required');
  if (['licensed', 'permissioned'].includes(source.rights) && (!boundedText(source.rightsReference) || !SHA256.test(source.rightsReferenceHash ?? ''))) issues.push('knowledge_source_rights_reference_required');
  if ((source.rightsReference === null) !== (source.rightsReferenceHash === null)) issues.push('knowledge_source_rights_reference_invalid');
  if (!validTimestamp(source.effectiveAt) || !validTimestamp(source.expiresAt) || (source.expiresAt !== null && Date.parse(source.expiresAt) <= Date.parse(source.effectiveAt))) issues.push('knowledge_source_time_invalid');
  if ((source.tenantId !== null && !ID.test(source.tenantId)) || (source.projectId !== null && !ID.test(source.projectId))) issues.push('knowledge_source_scope_invalid');
  if (typeof source.containsProprietaryGeometry !== 'boolean' || typeof source.containsPersonalData !== 'boolean' || source.rawContentAvailableToModel !== false) issues.push('knowledge_source_content_policy_invalid');
  if ((source.approvedBy === null) !== (source.approvedAt === null) || (source.approvedBy !== null && (!ID.test(source.approvedBy) || !validTimestamp(source.approvedAt)))) issues.push('knowledge_source_approval_invalid');
  if (!SHA256.test(source.recordDigest ?? '')) issues.push('knowledge_source_digest_invalid');
  if (issues.length === 0 && source.recordDigest !== serverEvidenceSha256(without(source, 'recordDigest'))) issues.push('knowledge_source_digest_mismatch');
  return [...new Set(issues)];
}

export function decideAiDesignKnowledgeUse(source: AiDesignKnowledgeSourceV1, requestedUse: AiDesignKnowledgeUse, context: { tenantId?: string; projectId?: string; now?: Date } = {}): AiDesignKnowledgeRightsDecision {
  const validation = validateAiDesignKnowledgeSource(source);
  const now = context.now ?? new Date();
  let reason = 'allowed_by_source_policy';
  let allowed = validation.length === 0;
  if (!allowed) reason = 'source_record_invalid';
  else if (['unknown', 'restricted'].includes(source.rights)) { allowed = false; reason = 'rights_fail_closed'; }
  else if (!source.allowedUses.includes(requestedUse)) { allowed = false; reason = 'use_not_permitted'; }
  else if (!source.approvedBy || !source.approvedAt) { allowed = false; reason = 'human_approval_required'; }
  else if (source.expiresAt !== null && now.getTime() >= Date.parse(source.expiresAt)) { allowed = false; reason = 'rights_expired'; }
  else if (source.tenantId !== null && source.tenantId !== context.tenantId) { allowed = false; reason = 'tenant_scope_mismatch'; }
  else if (source.projectId !== null && source.projectId !== context.projectId) { allowed = false; reason = 'project_scope_mismatch'; }
  else if (source.containsPersonalData && requestedUse !== 'human_reference') { allowed = false; reason = 'personal_data_model_use_forbidden'; }
  const material = { sourceId: source.sourceId, sourceVersion: source.version, sourceRecordDigest: source.recordDigest, requestedUse, allowed, reason, tenantId: context.tenantId ?? null, projectId: context.projectId ?? null, evaluatedAt: now.toISOString() };
  return { sourceId: source.sourceId, sourceVersion: source.version, requestedUse, allowed, reason, decisionDigest: serverEvidenceSha256(material) };
}

export class InMemoryAiDesignKnowledgeSourceRegistry {
  private readonly sources = new Map<string, AiDesignKnowledgeSourceV1>();
  constructor(private readonly mode: 'reference' | 'commercial' = 'reference') {}
  private ensure() { if (this.mode === 'commercial') throw new Error('AI_DESIGN_KNOWLEDGE_POSTGRES_REQUIRED'); }
  append(source: AiDesignKnowledgeSourceV1): { ok: true } | { ok: false; issues: readonly string[] } {
    this.ensure(); const issues = validateAiDesignKnowledgeSource(source); if (issues.length) return { ok: false, issues };
    const key = `${source.sourceId}:v${source.version}`; const prior = this.sources.get(key);
    if (prior) return prior.recordDigest === source.recordDigest ? { ok: true } : { ok: false, issues: ['knowledge_source_overwrite_forbidden'] };
    this.sources.set(key, structuredClone(source)); return { ok: true };
  }
  get(sourceId: string, version: number): AiDesignKnowledgeSourceV1 | undefined { this.ensure(); const value = this.sources.get(`${sourceId}:v${version}`); return value ? structuredClone(value) : undefined; }
  list(): AiDesignKnowledgeSourceV1[] { this.ensure(); return [...this.sources.values()].map(item => structuredClone(item)); }
}

export function createAiDesignConceptCard(input: {
  cardId: string; version: number; title: string; independentSummary: string;
  principles: readonly string[]; assumptions: readonly string[]; appliesWhen: readonly string[]; forbiddenWhen: readonly string[]; tags: readonly string[];
  edition?: string; jurisdictions?: readonly string[];
  formulae?: readonly { formulaId: string; expression: string; outputUnit: string; variables: readonly { key: string; unit: string }[] }[];
  sources: readonly AiDesignKnowledgeSourceV1[];
  approval: AiDesignConceptCardV1['approval'];
  context?: { tenantId?: string; projectId?: string; now?: Date };
}): AiDesignConceptCardV1 {
  if (input.sources.length < 1 || input.sources.length > MAX_LIST) throw new Error('AI_DESIGN_CONCEPT_CARD_SOURCE_COUNT_INVALID');
  const decisions = input.sources.flatMap(source => ['concept_extraction', 'retrieval'].map(requestedUse => decideAiDesignKnowledgeUse(source, requestedUse as AiDesignKnowledgeUse, input.context)));
  if (decisions.some(item => !item.allowed)) throw new Error(`AI_DESIGN_CONCEPT_CARD_RIGHTS_DENIED:${decisions.filter(item => !item.allowed).map(item => `${item.sourceId}:${item.reason}`).join(',')}`);
  const base = {
    schema: AI_DESIGN_CONCEPT_CARD_SCHEMA,
    cardId: input.cardId, version: input.version, edition: input.edition ?? `independent-v${input.version}`, title: input.title, independentSummary: input.independentSummary,
    principles: unique(input.principles), assumptions: unique(input.assumptions), appliesWhen: unique(input.appliesWhen), forbiddenWhen: unique(input.forbiddenWhen), tags: unique(input.tags).sort(),
    jurisdictions: unique(input.jurisdictions ?? ['unspecified']).sort(), formulae: structuredClone(input.formulae ?? []),
    unitSystem: 'native_si' as const,
    sourceBindings: input.sources.map(source => ({ sourceId: source.sourceId, sourceVersion: source.version, sourceContentHash: source.contentHash, sourceRecordDigest: source.recordDigest })).sort((a, b) => `${a.sourceId}:${a.sourceVersion}`.localeCompare(`${b.sourceId}:${b.sourceVersion}`)),
    approval: structuredClone(input.approval),
    independentAuthorshipAttestation: 'independently_authored_no_source_copy' as const,
    sourceTextIncluded: false as const, sourceImagesIncluded: false as const, sourceGeometryIncluded: false as const,
    conceptOnly: true as const, exactAuthority: false as const,
    rightsDecisionDigest: serverEvidenceSha256(decisions),
  };
  const card = Object.freeze({ ...base, cardDigest: serverEvidenceSha256(base) });
  const issues = validateAiDesignConceptCard(card);
  if (issues.length) throw new Error(`AI_DESIGN_CONCEPT_CARD_INVALID:${issues.join(',')}`);
  return card;
}

export function validateAiDesignConceptCard(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['concept_card_not_object'];
  const card = value as AiDesignConceptCardV1; const issues: string[] = [];
  if (card.schema !== AI_DESIGN_CONCEPT_CARD_SCHEMA || !ID.test(card.cardId ?? '') || !Number.isSafeInteger(card.version) || card.version < 1 || !boundedText(card.edition) || !boundedText(card.title) || !boundedText(card.independentSummary)) issues.push('concept_card_binding_invalid');
  if (!validList(card.principles, true) || !validList(card.assumptions) || !validList(card.appliesWhen, true) || !validList(card.forbiddenWhen) || !Array.isArray(card.tags) || card.tags.length > MAX_LIST || card.tags.some(item => !ID.test(item))
    || !Array.isArray(card.jurisdictions) || card.jurisdictions.length < 1 || card.jurisdictions.length > MAX_LIST || card.jurisdictions.some(item => !ID.test(item))
    || !Array.isArray(card.formulae) || card.formulae.length > MAX_LIST || card.formulae.some(formula => !ID.test(formula.formulaId ?? '') || !boundedText(formula.expression) || !/^[A-Za-z0-9_+\-*/(). ]+$/.test(formula.expression) || !UNIT.test(formula.outputUnit ?? '') || !Array.isArray(formula.variables) || formula.variables.length > MAX_LIST || formula.variables.some((variable: { key: string; unit: string }) => !ID.test(variable.key ?? '') || !UNIT.test(variable.unit ?? '')))) issues.push('concept_card_content_invalid');
  if (!Array.isArray(card.sourceBindings) || card.sourceBindings.length < 1 || card.sourceBindings.length > MAX_LIST || card.sourceBindings.some(item => !ID.test(item.sourceId) || !Number.isSafeInteger(item.sourceVersion) || item.sourceVersion < 1 || !SHA256.test(item.sourceContentHash) || !SHA256.test(item.sourceRecordDigest))) issues.push('concept_card_sources_invalid');
  if (!card.approval || !['draft', 'approved', 'revoked'].includes(card.approval.status) || (card.approval.status === 'approved' && (!card.approval.approvedBy || !card.approval.approvedAt)) || (card.approval.approvedBy !== null && !ID.test(card.approval.approvedBy)) || !validTimestamp(card.approval.approvedAt) || !validTimestamp(card.approval.reviewAt)) issues.push('concept_card_approval_invalid');
  if (card.unitSystem !== 'native_si' || card.independentAuthorshipAttestation !== 'independently_authored_no_source_copy' || card.sourceTextIncluded !== false || card.sourceImagesIncluded !== false || card.sourceGeometryIncluded !== false || card.conceptOnly !== true || card.exactAuthority !== false) issues.push('concept_card_safety_boundary_invalid');
  if (!SHA256.test(card.rightsDecisionDigest ?? '') || !SHA256.test(card.cardDigest ?? '')) issues.push('concept_card_digest_invalid');
  if (issues.length === 0 && card.cardDigest !== serverEvidenceSha256(without(card, 'cardDigest'))) issues.push('concept_card_digest_mismatch');
  return [...new Set(issues)];
}

export class InMemoryAiDesignConceptCardStore {
  private readonly cards = new Map<string, AiDesignConceptCardV1>();
  append(card: AiDesignConceptCardV1): { ok: true } | { ok: false; issues: readonly string[] } { const issues = validateAiDesignConceptCard(card); if (issues.length) return { ok: false, issues }; const key = `${card.cardId}:v${card.version}`; const prior = this.cards.get(key); if (prior) return prior.cardDigest === card.cardDigest ? { ok: true } : { ok: false, issues: ['concept_card_overwrite_forbidden'] }; this.cards.set(key, structuredClone(card)); return { ok: true }; }
  listApproved(now = new Date()): AiDesignConceptCardV1[] { return [...this.cards.values()].filter(card => card.approval.status === 'approved' && (card.approval.reviewAt === null || now.getTime() < Date.parse(card.approval.reviewAt))).map(item => structuredClone(item)); }
}

function validClause(clause: AiDesignRuleClauseV1): boolean { return !!clause && ID.test(clause.parameter ?? '') && ['eq', 'neq', 'lt', 'lte', 'gt', 'gte'].includes(clause.operator) && (typeof clause.value === 'boolean' || typeof clause.value === 'string' && clause.value.length <= 1_000 || typeof clause.value === 'number' && Number.isFinite(clause.value)) && UNIT.test(clause.unit ?? ''); }
function validGoldenParameters(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>); if (entries.length > MAX_LIST) return false;
  return entries.every(([key, parameter]) => {
    if (!ID.test(key) || !parameter || typeof parameter !== 'object' || Array.isArray(parameter)) return false;
    const record = parameter as Record<string, unknown>;
    return Object.keys(record).every(field => ['value', 'unit'].includes(field)) && UNIT.test(String(record.unit ?? ''))
      && (typeof record.value === 'boolean' || typeof record.value === 'string' && record.value.length <= 1_000 || typeof record.value === 'number' && Number.isFinite(record.value));
  });
}

export function createAiDesignEngineeringRuleDsl(input: Omit<AiDesignEngineeringRuleDslV1, 'schema' | 'executableCodeIncluded' | 'exactAuthority' | 'ruleDigest'>, card: AiDesignConceptCardV1): AiDesignEngineeringRuleDslV1 {
  const cardIssues = validateAiDesignConceptCard(card);
  if (cardIssues.length || card.approval.status !== 'approved' || input.conceptCardId !== card.cardId || input.conceptCardDigest !== card.cardDigest) throw new Error('AI_DESIGN_RULE_APPROVED_CONCEPT_CARD_REQUIRED');
  const base = { schema: AI_DESIGN_ENGINEERING_RULE_DSL_SCHEMA, ...structuredClone(input), executableCodeIncluded: false as const, exactAuthority: false as const };
  const rule = Object.freeze({ ...base, ruleDigest: serverEvidenceSha256(base) });
  const issues = validateAiDesignEngineeringRuleDsl(rule);
  if (issues.length) throw new Error(`AI_DESIGN_ENGINEERING_RULE_INVALID:${issues.join(',')}`);
  for (const golden of rule.goldenCases) {
    const actual = evaluateAiDesignEngineeringRuleDsl(rule, golden.parameters).status;
    if (actual !== golden.expectedStatus) throw new Error(`AI_DESIGN_ENGINEERING_RULE_GOLDEN_CASE_FAILED:${golden.caseId}`);
  }
  return rule;
}

export function validateAiDesignEngineeringRuleDsl(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['engineering_rule_not_object'];
  const rule = value as AiDesignEngineeringRuleDslV1; const issues: string[] = [];
  if (rule.schema !== AI_DESIGN_ENGINEERING_RULE_DSL_SCHEMA || !ID.test(rule.ruleId ?? '') || !Number.isSafeInteger(rule.version) || rule.version < 1 || !ID.test(rule.conceptCardId ?? '') || !SHA256.test(rule.conceptCardDigest ?? '')) issues.push('engineering_rule_binding_invalid');
  if (!Array.isArray(rule.when) || rule.when.length > MAX_LIST || rule.when.some(item => !validClause(item)) || !Array.isArray(rule.require) || rule.require.length < 1 || rule.require.length > MAX_LIST || rule.require.some(item => !validClause(item))) issues.push('engineering_rule_clause_invalid');
  if (!['info', 'warning', 'blocking'].includes(rule.severity) || !boundedText(rule.rationale) || !rule.approval || !ID.test(rule.approval.approvedBy ?? '') || !validTimestamp(rule.approval.approvedAt)
    || !Array.isArray(rule.goldenCases) || rule.goldenCases.length < 1 || rule.goldenCases.length > MAX_LIST
    || rule.goldenCases.some(item => !ID.test(item.caseId ?? '') || !['PASS', 'FAIL', 'NEEDS_INPUT', 'NOT_APPLICABLE'].includes(item.expectedStatus) || !validGoldenParameters(item.parameters))
    || rule.executableCodeIncluded !== false || rule.exactAuthority !== false) issues.push('engineering_rule_authority_invalid');
  if (!SHA256.test(rule.ruleDigest ?? '')) issues.push('engineering_rule_digest_invalid');
  if (issues.length === 0 && rule.ruleDigest !== serverEvidenceSha256(without(rule, 'ruleDigest'))) issues.push('engineering_rule_digest_mismatch');
  return [...new Set(issues)];
}

function compare(actual: unknown, clause: AiDesignRuleClauseV1): boolean | null {
  if (typeof actual !== typeof clause.value) return null;
  if (clause.operator === 'eq') return actual === clause.value;
  if (clause.operator === 'neq') return actual !== clause.value;
  if (typeof actual !== 'number' || typeof clause.value !== 'number') return null;
  if (clause.operator === 'lt') return actual < clause.value;
  if (clause.operator === 'lte') return actual <= clause.value;
  if (clause.operator === 'gt') return actual > clause.value;
  return actual >= clause.value;
}

export function evaluateAiDesignEngineeringRuleDsl(rule: AiDesignEngineeringRuleDslV1, parameters: Readonly<Record<string, { value: string | number | boolean; unit: string }>>) {
  const issues = validateAiDesignEngineeringRuleDsl(rule); if (issues.length) throw new Error(`AI_DESIGN_ENGINEERING_RULE_INVALID:${issues.join(',')}`);
  const evaluateClause = (clause: AiDesignRuleClauseV1): boolean | null => { const parameter = parameters[clause.parameter]; if (!parameter || parameter.unit !== clause.unit) return null; return compare(parameter.value, clause); };
  const when = rule.when.map(evaluateClause);
  if (when.some(value => value === null)) return { status: 'NEEDS_INPUT' as const, failedParameters: rule.when.filter((_, index) => when[index] === null).map(item => item.parameter), exactAuthority: false as const };
  if (when.some(value => value === false)) return { status: 'NOT_APPLICABLE' as const, failedParameters: [], exactAuthority: false as const };
  const required = rule.require.map(evaluateClause);
  if (required.some(value => value === null)) return { status: 'NEEDS_INPUT' as const, failedParameters: rule.require.filter((_, index) => required[index] === null).map(item => item.parameter), exactAuthority: false as const };
  const failedParameters = rule.require.filter((_, index) => required[index] === false).map(item => item.parameter);
  return { status: failedParameters.length ? 'FAIL' as const : 'PASS' as const, failedParameters, exactAuthority: false as const };
}

export function retrieveApprovedAiDesignConceptCards(input: {
  receiptId: string; projectId: string; sessionId: string; query: string; queryTags: readonly string[]; requestedUses?: readonly AiDesignKnowledgeUse[];
  cards: readonly AiDesignConceptCardV1[]; sources: readonly AiDesignKnowledgeSourceV1[];
  tenantId?: string; now?: Date; maxResults?: number;
}): { cards: readonly AiDesignConceptCardV1[]; receipt: AiDesignKnowledgeRetrievalReceiptV1 } {
  const now = input.now ?? new Date(); const requestedUses: AiDesignKnowledgeUse[] = unique<AiDesignKnowledgeUse>(input.requestedUses ?? ['retrieval']); const maxResults = Math.max(1, Math.min(input.maxResults ?? 8, 32));
  if (!ID.test(input.receiptId) || !ID.test(input.projectId) || !ID.test(input.sessionId) || !boundedText(input.query) || !Array.isArray(input.queryTags) || input.queryTags.some(item => !ID.test(item)) || requestedUses.some(item => !AI_DESIGN_KNOWLEDGE_USES.includes(item))) throw new Error('AI_DESIGN_KNOWLEDGE_QUERY_INVALID');
  const sourceByKey = new Map(input.sources.map(source => [`${source.sourceId}:v${source.version}`, source])); const decisions: AiDesignKnowledgeRightsDecision[] = []; const denied = new Set<string>();
  const allowedCards = input.cards.filter(card => {
    if (validateAiDesignConceptCard(card).length || card.approval.status !== 'approved' || card.approval.reviewAt !== null && now.getTime() >= Date.parse(card.approval.reviewAt)) return false;
    for (const binding of card.sourceBindings) {
      const source = sourceByKey.get(`${binding.sourceId}:v${binding.sourceVersion}`);
      if (!source || source.recordDigest !== binding.sourceRecordDigest || source.contentHash !== binding.sourceContentHash) { denied.add(binding.sourceId); return false; }
      for (const use of requestedUses) { const decision = decideAiDesignKnowledgeUse(source, use, { tenantId: input.tenantId, projectId: input.projectId, now }); decisions.push(decision); if (!decision.allowed) { denied.add(source.sourceId); return false; } }
    }
    return true;
  }).map(card => ({ card, score: card.tags.filter(tag => input.queryTags.includes(tag)).length / Math.max(1, new Set([...card.tags, ...input.queryTags]).size) }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.card.cardId.localeCompare(b.card.cardId)).slice(0, maxResults);
  const base = {
    schema: AI_DESIGN_KNOWLEDGE_RETRIEVAL_RECEIPT_SCHEMA,
    receiptId: input.receiptId, projectId: input.projectId, sessionId: input.sessionId, queryDigest: serverEvidenceSha256({ query: input.query, tags: [...input.queryTags].sort() }),
    requestedUses: [...requestedUses].sort(), cardResults: allowedCards.map(item => ({ cardId: item.card.cardId, cardDigest: item.card.cardDigest, score: item.score, sourceRecordDigests: item.card.sourceBindings.map(binding => binding.sourceRecordDigest).sort() })),
    deniedSourceIds: [...denied].sort(), rightsDecisionDigest: serverEvidenceSha256(decisions), createdAt: now.toISOString(), rawSourceContentIncluded: false as const, conceptOnly: true as const, exactAuthority: false as const,
  };
  const receipt = Object.freeze({ ...base, receiptDigest: serverEvidenceSha256(base) });
  const issues = validateAiDesignKnowledgeRetrievalReceipt(receipt);
  if (issues.length) throw new Error(`AI_DESIGN_KNOWLEDGE_RECEIPT_INVALID:${issues.join(',')}`);
  return { cards: allowedCards.map(item => structuredClone(item.card)), receipt };
}

export function validateAiDesignKnowledgeRetrievalReceipt(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['knowledge_receipt_not_object'];
  const receipt = value as AiDesignKnowledgeRetrievalReceiptV1; const issues: string[] = [];
  if (receipt.schema !== AI_DESIGN_KNOWLEDGE_RETRIEVAL_RECEIPT_SCHEMA || !ID.test(receipt.receiptId ?? '') || !ID.test(receipt.projectId ?? '') || !ID.test(receipt.sessionId ?? '') || !SHA256.test(receipt.queryDigest ?? '')) issues.push('knowledge_receipt_binding_invalid');
  if (!Array.isArray(receipt.requestedUses) || receipt.requestedUses.length < 1 || receipt.requestedUses.some(item => !AI_DESIGN_KNOWLEDGE_USES.includes(item))) issues.push('knowledge_receipt_use_invalid');
  if (!Array.isArray(receipt.cardResults) || receipt.cardResults.length > 32 || receipt.cardResults.some(item => !ID.test(item.cardId ?? '') || !SHA256.test(item.cardDigest ?? '') || !Number.isFinite(item.score) || item.score < 0 || item.score > 1 || !Array.isArray(item.sourceRecordDigests) || item.sourceRecordDigests.some((digest: unknown) => typeof digest !== 'string' || !SHA256.test(digest)))) issues.push('knowledge_receipt_result_invalid');
  if (!Array.isArray(receipt.deniedSourceIds) || receipt.deniedSourceIds.some(item => !ID.test(item)) || !SHA256.test(receipt.rightsDecisionDigest ?? '') || !validTimestamp(receipt.createdAt)) issues.push('knowledge_receipt_decision_invalid');
  if (receipt.rawSourceContentIncluded !== false || receipt.conceptOnly !== true || receipt.exactAuthority !== false || !SHA256.test(receipt.receiptDigest ?? '')) issues.push('knowledge_receipt_authority_invalid');
  if (issues.length === 0 && receipt.receiptDigest !== serverEvidenceSha256(without(receipt, 'receiptDigest'))) issues.push('knowledge_receipt_digest_mismatch');
  return [...new Set(issues)];
}

export class InMemoryAiDesignKnowledgeRetrievalReceiptStore {
  private readonly receipts = new Map<string, AiDesignKnowledgeRetrievalReceiptV1>();
  constructor(private readonly mode: 'reference' | 'commercial' = 'reference') {}
  append(receipt: AiDesignKnowledgeRetrievalReceiptV1): { ok: true } | { ok: false; issues: readonly string[] } {
    if (this.mode === 'commercial') throw new Error('AI_DESIGN_KNOWLEDGE_RECEIPT_POSTGRES_REQUIRED');
    const issues = validateAiDesignKnowledgeRetrievalReceipt(receipt); if (issues.length) return { ok: false, issues };
    const prior = this.receipts.get(receipt.receiptId); if (prior) return prior.receiptDigest === receipt.receiptDigest ? { ok: true } : { ok: false, issues: ['knowledge_receipt_overwrite_forbidden'] };
    this.receipts.set(receipt.receiptId, structuredClone(receipt)); return { ok: true };
  }
  get(receiptId: string): AiDesignKnowledgeRetrievalReceiptV1 | undefined { const value = this.receipts.get(receiptId); return value ? structuredClone(value) : undefined; }
}
