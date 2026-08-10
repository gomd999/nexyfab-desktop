import { describe, expect, it } from 'vitest';
import {
  generationDomainFor,
  isTemplateDomainAllowed,
  normalizeGenerationDomain,
  scopeDomainDescription,
  templateDomainsFor,
} from './domainGenerationRequest';

describe('domain generation request', () => {
  it('maps every workspace domain to the deterministic assembly engine', () => {
    expect(generationDomainFor('mechanical')).toBe('mech');
    expect(generationDomainFor('building')).toBe('building');
    expect(generationDomainFor('civil')).toBe('civil');
    expect(generationDomainFor('landscape')).toBe('landscape');
    expect(generationDomainFor('interior')).toBe('interior');
  });

  it('rejects unknown domains and accepts the public mechanical alias', () => {
    expect(normalizeGenerationDomain('mechanical')).toBe('mech');
    expect(normalizeGenerationDomain('aerospace')).toBeNull();
    expect(normalizeGenerationDomain(undefined)).toBeNull();
  });

  it('treats bridges as civil infrastructure without opening other domains', () => {
    expect(templateDomainsFor('civil')).toEqual(['civil', 'bridge']);
    expect(isTemplateDomainAllowed('civil', 'bridge')).toBe(true);
    expect(isTemplateDomainAllowed('civil', 'building')).toBe(false);
  });

  it('makes the selected domain an explicit non-silent generation constraint', () => {
    const prompt = scopeDomainDescription('Create a retaining wall', 'civil');
    expect(prompt).toContain('Required design domain: civil');
    expect(prompt).toContain('Do not silently reinterpret');
    expect(prompt).toContain('Create a retaining wall');
  });
});
