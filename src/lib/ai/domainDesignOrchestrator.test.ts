import { describe, expect, it } from 'vitest';
import { DESIGN_DOMAIN_IDS, type DesignDomainId } from './domainProfile';
import { getDomainProfile } from './domainProfileRegistry';
import { getDomainCapability, normalizeDesignDomainId, parseDomainCapability } from './domainCapabilityRegistry';
import { planDomainDesign, recommendDesignDomains, type ProvidedDomainInput } from './domainDesignOrchestrator';

const source = (value: unknown): ProvidedDomainInput => ({ value, authoritative: true, sourceRef: 'user://confirmed' });
const completeInputs = (domain: DesignDomainId): Record<string, ProvidedDomainInput> => Object.fromEntries(
  getDomainProfile(domain).requiredInputs.map(input => [input.key, source(`${domain}:${input.key}`)]),
);

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
  it('holds exact execution when every civil input is confirmed but the domain is not implemented', () => {
    const result = planDomainDesign({ prompt: '도로', selectedDomains: ['civil'], stage: 'exact', inputs: { civil: { crs_survey: source({ epsg: 5186 }), existing_surface: source('surface-1'), design_criteria: source('criteria-1') } } });
    expect(result.status).toBe('implementation_unavailable');
    expect(result.subplans[0]!.missingInputs).toEqual([]);
    expect(result.warnings).toContain('Exact execution is unavailable for: civil.');
  });
  it('keeps exact readiness bounded to the canonical implementation state for every domain', () => {
    for (const domain of DESIGN_DOMAIN_IDS) {
      const result = planDomainDesign({ prompt: domain, selectedDomains: [domain], stage: 'exact', inputs: { [domain]: completeInputs(domain) } });
      expect(result.subplans[0]!.missingInputs, domain).toEqual([]);
      expect(result.status, domain).toBe(domain === 'mechanical' ? 'ready_for_exact' : 'implementation_unavailable');
    }
  });
  it('preserves concept planning for preview-only domains', () => {
    for (const domain of DESIGN_DOMAIN_IDS.filter(domain => domain !== 'mechanical')) {
      const result = planDomainDesign({ prompt: domain, selectedDomains: [domain], stage: 'concept', inputs: { [domain]: completeInputs(domain) } });
      expect(result.status, domain).toBe('ready_for_concept');
    }
  });
  it('keeps release readiness fail-closed for every currently registered domain', () => {
    for (const domain of DESIGN_DOMAIN_IDS) {
      const result = planDomainDesign({ prompt: domain, selectedDomains: [domain], stage: 'release', inputs: { [domain]: completeInputs(domain) } });
      expect(result.subplans[0]!.missingInputs, domain).toEqual([]);
      expect(result.status, domain).toBe('implementation_unavailable');
    }
  });
  it('normalizes architecture to building without upgrading its implementation state', () => {
    expect(normalizeDesignDomainId('architecture')).toBe('building');
    expect(getDomainCapability('building')).toMatchObject({ domain: 'building', exactExecutionState: 'NOT_IMPLEMENTED' });
    const result = planDomainDesign({
      prompt: 'architecture',
      selectedDomains: ['architecture' as unknown as DesignDomainId],
      stage: 'exact',
      inputs: { architecture: completeInputs('building') } as unknown as Record<DesignDomainId, Record<string, ProvidedDomainInput>>,
    });
    expect(result.domains).toEqual(['building']);
    expect(result.status).toBe('implementation_unavailable');
  });
  it('fails closed for unknown or malformed capability state', () => {
    expect(normalizeDesignDomainId('unknown-domain')).toBeUndefined();
    expect(normalizeDesignDomainId('toString')).toBeUndefined();
    const valid = {
      schema: 'nexyfab.cad-domain.v1',
      id: 'civil',
      contractVersion: 'nexyfab.cad-contract.v1',
      authoringState: 'PREVIEW',
      exactExecutionState: 'NOT_IMPLEMENTED',
      releaseState: 'BLOCKED',
    };
    expect(parseDomainCapability({ ...valid, schema: 'made-up' }, 'civil')).toBeUndefined();
    expect(parseDomainCapability({ ...valid, contractVersion: 'made-up' }, 'civil')).toBeUndefined();
    expect(parseDomainCapability({ ...valid, exactExecutionState: 'READY' }, 'civil')).toBeUndefined();
    expect(parseDomainCapability({ ...valid, releaseState: undefined }, 'civil')).toBeUndefined();
  });
  it('treats malformed authoritative input as missing instead of throwing', () => {
    const inputs = completeInputs('mechanical');
    inputs.material_process = { value: 'steel', authoritative: true, sourceRef: null as unknown as string };
    expect(() => planDomainDesign({ prompt: 'mechanical', selectedDomains: ['mechanical'], stage: 'exact', inputs: { mechanical: inputs } })).not.toThrow();
    expect(planDomainDesign({ prompt: 'mechanical', selectedDomains: ['mechanical'], stage: 'exact', inputs: { mechanical: inputs } }).status).toBe('authoritative_input_required');
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
