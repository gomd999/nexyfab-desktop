import { describe, expect, it } from 'vitest';
import { createDomainProductState, downgradeDomainProductState, invalidateDomainProductState, transitionDomainProductState } from './domainProductState';

const e = (source: 'AI' | 'PRECISION' | 'INDEPENDENT' | 'EXTERNAL' | 'FIELD', id: string) => ({ status: 'PASS' as const, source, evidenceId: id });

describe('domain product maturity state', () => {
  it('promotes only through the governed sequence', () => {
    let state = createDomainProductState();
    const candidate = transitionDomainProductState(state, 'DESIGN_CANDIDATE', { structuredIntent: e('AI', 'ai-1'), candidateAcceptance: e('PRECISION', 'review-1') }, 'PRECISION_CAD');
    expect(candidate.ok).toBe(true); state = candidate.record;
    const verified = transitionDomainProductState(state, 'DOMAIN_VERIFIED', { precisionExact: e('PRECISION', 'exact-1'), domainValidation: e('PRECISION', 'validation-1') });
    expect(verified.ok).toBe(true);
  });

  it('fails closed for missing, bad, stale and unknown evidence', () => {
    const result = transitionDomainProductState(createDomainProductState(), 'DESIGN_CANDIDATE', { structuredIntent: { ...e('AI', 'x'), status: 'STALE' }, extra: e('AI', 'x') } as never, 'PRECISION_CAD');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.blockers).toEqual(expect.arrayContaining(['structuredIntent_stale', 'candidateAcceptance_not_run', 'evidence_unknown_key:extra']));
  });

  it('enforces AI authority and supports invalidation/downgrade', () => {
    const initial = createDomainProductState();
    const blocked = transitionDomainProductState(initial, 'DOMAIN_VERIFIED', { precisionExact: e('PRECISION', 'x'), domainValidation: e('PRECISION', 'y') }, 'AI_DESIGN');
    if (!blocked.ok) expect(blocked.blockers).toContain('ai_authority_boundary');
    const invalid = invalidateDomainProductState(initial, 'geometry changed');
    expect(invalid.invalidated).toBe(true);
    expect(downgradeDomainProductState({ ...invalid, state: 'DELIVERY_CANDIDATE' }, 'DOMAIN_VERIFIED', 'recheck required').state).toBe('DOMAIN_VERIFIED');
  });
});
