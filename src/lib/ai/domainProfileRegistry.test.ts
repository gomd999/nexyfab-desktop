import { describe, expect, it } from 'vitest';
import { COMMON_DOMAIN_EVIDENCE_AXES, DESIGN_DOMAIN_IDS } from './domainProfile';
import { DOMAIN_PROFILES, getDomainProfile, validateDomainProfileRegistry } from './domainProfileRegistry';

describe('domain profile registry', () => {
  it('registers exactly five complete profiles with every common contract', () => {
    expect(Object.keys(DOMAIN_PROFILES).sort()).toEqual([...DESIGN_DOMAIN_IDS].sort());
    expect(validateDomainProfileRegistry()).toEqual([]);
    for (const domain of DESIGN_DOMAIN_IDS) {
      const profile = getDomainProfile(domain);
      expect(profile.requiredInputs.every(input => input.authoritative)).toBe(true);
      expect(profile.evidenceAxes).toEqual(expect.arrayContaining([...COMMON_DOMAIN_EVIDENCE_AXES]));
      expect(profile.manualTools.guided.length).toBeGreaterThan(0);
      expect(profile.manualTools.standard.length).toBeGreaterThan(0);
      expect(profile.manualTools.expert.length).toBeGreaterThan(0);
    }
  });

  it('keeps mechanical release semantics out of the four non-product profiles', () => {
    const mechanicalOnly = ['part_definitions', 'occurrences', 'body_membership', 'joints', 'motion', 'tolerance', 'step_roundtrip'];
    for (const domain of DESIGN_DOMAIN_IDS.filter(value => value !== 'mechanical')) {
      expect(DOMAIN_PROFILES[domain].evidenceAxes.filter(axis => mechanicalOnly.includes(axis))).toEqual([]);
    }
  });

  it('groups building/interior and civil/landscape without collapsing their contracts', () => {
    expect(DOMAIN_PROFILES.building.family).toBe(DOMAIN_PROFILES.interior.family);
    expect(DOMAIN_PROFILES.civil.family).toBe(DOMAIN_PROFILES.landscape.family);
    expect(DOMAIN_PROFILES.building.objectVocabulary).not.toEqual(DOMAIN_PROFILES.interior.objectVocabulary);
    expect(DOMAIN_PROFILES.civil.evidenceAxes).not.toEqual(DOMAIN_PROFILES.landscape.evidenceAxes);
  });
});
