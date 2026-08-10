import { describe, expect, it } from 'vitest';
import { DESIGN_DOMAIN_IDS } from './domainProfile';
import { designDomainFromSlug, getDomainUserJourney, precisionCadHref } from './domainUserJourney';

describe('five-domain user journey', () => {
  it('keeps one understandable process while preserving domain-specific inputs, checks and outputs', () => {
    for (const domain of DESIGN_DOMAIN_IDS) {
      const journey = getDomainUserJourney(domain, 'ko');
      expect(journey.stages.map(stage => stage.id)).toEqual(['requirements', 'ai_build', 'manual_refine', 'precision_verify', 'deliver']);
      expect(journey.exactInputs.length).toBeGreaterThanOrEqual(3);
      expect(journey.validations.length).toBeGreaterThanOrEqual(3);
      expect(journey.deliverables.length).toBeGreaterThanOrEqual(3);
    }
    expect(new Set(DESIGN_DOMAIN_IDS.map(domain => getDomainUserJourney(domain, 'ko').focus)).size).toBe(5);
  });

  it('maps design slugs and builds a server-gate-safe, context-preserving precision CAD link', () => {
    expect(designDomainFromSlug('mech')).toBe('mechanical');
    expect(designDomainFromSlug('rack')).toBe('mechanical');
    expect(designDomainFromSlug('bridge')).toBe('civil');
    expect(designDomainFromSlug('interior')).toBe('interior');
    const href = precisionCadHref('ko', 'interior');
    expect(href).toContain('expert=1');
    expect(href).toContain('domain=interior');
    expect(href).toContain('workMode=precision_cad');
  });
});
