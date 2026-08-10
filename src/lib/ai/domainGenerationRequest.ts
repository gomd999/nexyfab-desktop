import type { DesignDomainId } from './domainProfile';

export const GENERATION_DOMAIN_IDS = [
  'mech',
  'building',
  'civil',
  'landscape',
  'interior',
] as const;

export type GenerationDomainId = (typeof GENERATION_DOMAIN_IDS)[number];

const UI_TO_GENERATION: Record<DesignDomainId, GenerationDomainId> = {
  mechanical: 'mech',
  building: 'building',
  civil: 'civil',
  landscape: 'landscape',
  interior: 'interior',
};

export function generationDomainFor(domain: DesignDomainId): GenerationDomainId {
  return UI_TO_GENERATION[domain];
}

/** Civil workspace owns both general civil and bridge template families. */
export function templateDomainsFor(domain: GenerationDomainId): readonly string[] {
  return domain === 'civil' ? ['civil', 'bridge'] : [domain];
}

export function isTemplateDomainAllowed(requested: GenerationDomainId, templateDomain: string): boolean {
  return templateDomainsFor(requested).includes(templateDomain);
}

export function normalizeGenerationDomain(value: unknown): GenerationDomainId | null {
  if (value === 'mechanical') return 'mech';
  return typeof value === 'string' && GENERATION_DOMAIN_IDS.includes(value as GenerationDomainId)
    ? value as GenerationDomainId
    : null;
}

export function scopeDomainDescription(description: string, domain: GenerationDomainId | null): string {
  if (!domain) return description;
  const templateFamilies = templateDomainsFor(domain).join(' or ');
  return [
    `[Required design domain: ${domain}]`,
    `Use only ${templateFamilies} template families and domain-appropriate objects, units, roles, and validation.`,
    'Do not silently reinterpret this request as a different design domain.',
    `User description: ${description}`,
  ].join('\n');
}
