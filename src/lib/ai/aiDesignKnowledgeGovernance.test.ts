import { describe, expect, it } from 'vitest';
import {
  InMemoryAiDesignConceptCardStore,
  InMemoryAiDesignKnowledgeRetrievalReceiptStore,
  InMemoryAiDesignKnowledgeSourceRegistry,
  createAiDesignConceptCard,
  createAiDesignEngineeringRuleDsl,
  createAiDesignKnowledgeSource,
  decideAiDesignKnowledgeUse,
  evaluateAiDesignEngineeringRuleDsl,
  retrieveApprovedAiDesignConceptCards,
  validateAiDesignEngineeringRuleDsl,
  validateAiDesignKnowledgeRetrievalReceipt,
} from './aiDesignKnowledgeGovernance';

const hash = (character: string) => character.repeat(64);

function source(overrides: Partial<Parameters<typeof createAiDesignKnowledgeSource>[0]> = {}) {
  return createAiDesignKnowledgeSource({
    sourceId: 'source-owned-1', version: 1, sourceKind: 'internal_rule', title: 'Internal independently authored engineering principles', contentHash: hash('a'),
    rights: 'owned', allowedUses: ['human_reference', 'concept_extraction', 'retrieval', 'rule_derivation', 'output_derivation'],
    rightsReference: null, rightsReferenceHash: null, effectiveAt: '2026-01-01T00:00:00.000Z', expiresAt: null,
    tenantId: 'tenant-1', projectId: null, containsProprietaryGeometry: false, containsPersonalData: false,
    approvedBy: 'engineer-1', approvedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  });
}

function card(boundSource = source()) {
  return createAiDesignConceptCard({
    cardId: 'card-clearance', version: 1, title: 'Service clearance principle',
    edition: 'independent-2026', jurisdictions: ['project-specific'],
    formulae: [{ formulaId: 'clearance-margin', expression: 'required_clearance - available_clearance', outputUnit: 'mm', variables: [{ key: 'required-clearance', unit: 'mm' }, { key: 'available-clearance', unit: 'mm' }] }],
    independentSummary: 'Maintain a declared access envelope around serviceable components.',
    principles: ['Service access is represented as an explicit spatial constraint.'], assumptions: ['The maintenance path is known.'],
    appliesWhen: ['A component requires scheduled access.'], forbiddenWhen: ['The access envelope conflicts with a safety barrier.'], tags: ['mechanical', 'clearance', 'service'],
    sources: [boundSource], approval: { status: 'approved', approvedBy: 'engineer-2', approvedAt: '2026-02-01T00:00:00.000Z', reviewAt: '2027-02-01T00:00:00.000Z' },
    context: { tenantId: 'tenant-1', projectId: 'project-1', now: new Date('2026-02-01T00:00:00.000Z') },
  });
}

describe('rights-safe AI Design engineering knowledge', () => {
  it('fails closed for unknown, restricted, expired, unapproved and cross-tenant sources', () => {
    const unknown = source({ sourceId: 'source-unknown', rights: 'unknown', allowedUses: [], approvedBy: null, approvedAt: null });
    expect(decideAiDesignKnowledgeUse(unknown, 'retrieval', { tenantId: 'tenant-1', now: new Date('2026-02-01T00:00:00.000Z') })).toMatchObject({ allowed: false, reason: 'rights_fail_closed' });
    expect(decideAiDesignKnowledgeUse(source(), 'retrieval', { tenantId: 'tenant-2', now: new Date('2026-02-01T00:00:00.000Z') })).toMatchObject({ allowed: false, reason: 'tenant_scope_mismatch' });
    const expired = source({ sourceId: 'source-expired', expiresAt: '2026-01-15T00:00:00.000Z' });
    expect(decideAiDesignKnowledgeUse(expired, 'retrieval', { tenantId: 'tenant-1', now: new Date('2026-02-01T00:00:00.000Z') })).toMatchObject({ allowed: false, reason: 'rights_expired' });
    expect(() => createAiDesignConceptCard({ cardId: 'card-denied', version: 1, title: 'Denied', independentSummary: 'Independently written.', principles: ['One principle'], assumptions: [], appliesWhen: ['Always'], forbiddenWhen: [], tags: ['mechanical'], sources: [unknown], approval: { status: 'approved', approvedBy: 'engineer-1', approvedAt: '2026-02-01T00:00:00.000Z', reviewAt: null }, context: { tenantId: 'tenant-1', now: new Date('2026-02-01T00:00:00.000Z') } })).toThrow('AI_DESIGN_CONCEPT_CARD_RIGHTS_DENIED');
  });

  it('creates independently authored Concept Cards without embedding source content or authority', () => {
    const registry = new InMemoryAiDesignKnowledgeSourceRegistry(); const approvedSource = source();
    expect(registry.append(approvedSource)).toEqual({ ok: true }); expect(registry.append(approvedSource)).toEqual({ ok: true });
    const concept = card(approvedSource); const store = new InMemoryAiDesignConceptCardStore();
    expect(store.append(concept)).toEqual({ ok: true });
    expect(concept).toMatchObject({ edition: 'independent-2026', jurisdictions: ['project-specific'], formulae: [{ formulaId: 'clearance-margin', outputUnit: 'mm' }], sourceTextIncluded: false, sourceImagesIncluded: false, sourceGeometryIncluded: false, conceptOnly: true, exactAuthority: false, independentAuthorshipAttestation: 'independently_authored_no_source_copy' });
    expect(store.listApproved(new Date('2026-03-01T00:00:00.000Z'))).toHaveLength(1);
  });

  it('uses a declarative rule DSL and never executes generated TypeScript', () => {
    const concept = card();
    const rule = createAiDesignEngineeringRuleDsl({
      ruleId: 'rule-service-clearance', version: 1, conceptCardId: concept.cardId, conceptCardDigest: concept.cardDigest,
      when: [{ parameter: 'requires-service', operator: 'eq', value: true, unit: '1' }],
      require: [{ parameter: 'service-clearance', operator: 'gte', value: 100, unit: 'mm' }],
      severity: 'blocking', rationale: 'A declared service path requires an independently specified clearance.',
      approval: { approvedBy: 'engineer-3', approvedAt: '2026-02-02T00:00:00.000Z' },
      goldenCases: [
        { caseId: 'golden-pass', parameters: { 'requires-service': { value: true, unit: '1' }, 'service-clearance': { value: 120, unit: 'mm' } }, expectedStatus: 'PASS' },
        { caseId: 'golden-fail', parameters: { 'requires-service': { value: true, unit: '1' }, 'service-clearance': { value: 80, unit: 'mm' } }, expectedStatus: 'FAIL' },
      ],
    }, concept);
    expect(rule).toMatchObject({ executableCodeIncluded: false, exactAuthority: false });
    expect(evaluateAiDesignEngineeringRuleDsl(rule, { 'requires-service': { value: true, unit: '1' }, 'service-clearance': { value: 120, unit: 'mm' } })).toMatchObject({ status: 'PASS', exactAuthority: false });
    expect(evaluateAiDesignEngineeringRuleDsl(rule, { 'requires-service': { value: true, unit: '1' }, 'service-clearance': { value: 80, unit: 'mm' } })).toMatchObject({ status: 'FAIL', failedParameters: ['service-clearance'] });
    expect(evaluateAiDesignEngineeringRuleDsl(rule, { 'requires-service': { value: true, unit: '1' } })).toMatchObject({ status: 'NEEDS_INPUT' });
    expect(validateAiDesignEngineeringRuleDsl({ ...rule, when: [{ parameter: 'eval(code)', operator: 'eq', value: true, unit: '1' }] })).toContain('engineering_rule_clause_invalid');
  });

  it('returns only currently permitted cards with an immutable rights receipt', () => {
    const approvedSource = source(); const concept = card(approvedSource);
    const result = retrieveApprovedAiDesignConceptCards({
      receiptId: 'retrieval-1', projectId: 'project-1', sessionId: 'session-1', query: 'service clearance', queryTags: ['service', 'clearance'],
      cards: [concept], sources: [approvedSource], tenantId: 'tenant-1', now: new Date('2026-03-01T00:00:00.000Z'),
    });
    expect(result.cards.map(item => item.cardId)).toEqual(['card-clearance']);
    expect(result.receipt).toMatchObject({ rawSourceContentIncluded: false, conceptOnly: true, exactAuthority: false, cardResults: [{ cardId: 'card-clearance' }] });
    expect(validateAiDesignKnowledgeRetrievalReceipt(result.receipt)).toEqual([]);
    const store = new InMemoryAiDesignKnowledgeRetrievalReceiptStore();
    expect(store.append(result.receipt)).toEqual({ ok: true }); expect(store.append(result.receipt)).toEqual({ ok: true });
    expect(store.append({ ...result.receipt, queryDigest: hash('f') })).toEqual({ ok: false, issues: ['knowledge_receipt_digest_mismatch'] });
  });
});
