import { describe, expect, it } from 'vitest';
import { planDomainDesign, recommendDesignDomains, type ProvidedDomainInput } from './domainDesignOrchestrator';

const source = (value: unknown): ProvidedDomainInput => ({ value, authoritative: true, sourceRef: 'user://confirmed' });

describe('domain design orchestrator', () => {
  it('selects an unambiguous mechanical request without applying building rules', () => {
    const result = planDomainDesign({ prompt: '기어와 베어링을 포함한 기계 조립 제품', stage: 'concept' });
    expect(result.domains).toEqual(['mechanical']);
    expect(result.confirmationRequired).toBe(false);
    expect(result.subplans[0]!.validators).toContain('assembly-dof');
    expect(result.subplans[0]!.validators).not.toContain('egress');
  });
  it('requires confirmation for a multi-domain site and building request', () => {
    const result = planDomainDesign({ prompt: '토목 도로와 조경 식재, 건축 건물을 함께 설계', stage: 'concept' });
    expect(result.status).toBe('domain_confirmation_required');
    expect(result.domains).toEqual(expect.arrayContaining(['civil', 'landscape', 'building']));
  });
  it('fails closed when authoritative exact inputs or provenance are missing', () => {
    const result = planDomainDesign({ prompt: '도로 선형과 배수 설계', selectedDomains: ['civil'], stage: 'exact', inputs: { civil: { crs_survey: source({ epsg: 5186 }) } } });
    expect(result.status).toBe('authoritative_input_required');
    expect(result.subplans[0]!.missingInputs.map(item => item.key)).toEqual(expect.arrayContaining(['existing_surface', 'design_criteria']));
  });
  it('allows an exact plan only after every applicable input is confirmed', () => {
    const result = planDomainDesign({ prompt: '도로', selectedDomains: ['civil'], stage: 'exact', inputs: { civil: { crs_survey: source({ epsg: 5186 }), existing_surface: source('surface-1'), design_criteria: source('criteria-1') } } });
    expect(result.status).toBe('ready_for_exact');
    expect(result.subplans[0]!.missingInputs).toEqual([]);
  });
  it('suggests explicit federated links instead of merging domain documents', () => {
    const result = planDomainDesign({ prompt: 'site', selectedDomains: ['civil', 'landscape', 'building', 'interior'], stage: 'concept' });
    expect(result.federationSuggestions.map(item => item.relation)).toEqual(expect.arrayContaining(['FOLLOWS_TERRAIN', 'OCCUPIES_SPACE', 'REFERENCES_MODEL']));
  });
  it('returns no recommendation for an unknown request', () => {
    expect(recommendDesignDomains('무언가 만들어줘')).toEqual([]);
    expect(planDomainDesign({ prompt: '무언가 만들어줘', stage: 'concept' }).status).toBe('domain_confirmation_required');
  });
});
