import type { DesignDomainId, DomainRequiredInput } from './domainProfile';
import { getDomainProfile } from './domainProfileRegistry';
import { recommendDesignDomains, type DomainRecommendation } from './domainPromptClassifier';
import { getDomainCapability, normalizeDesignDomainId, supportsExactExecution, supportsRelease } from './domainCapabilityRegistry';

export { recommendDesignDomains } from './domainPromptClassifier';
export type { DomainRecommendation } from './domainPromptClassifier';

export type DesignMaturityStage = 'concept' | 'exact' | 'release';
export interface ProvidedDomainInput { value: unknown; authoritative: boolean; sourceRef: string }
export interface DomainDesignRequest {
  prompt: string;
  stage: DesignMaturityStage;
  selectedDomains?: readonly DesignDomainId[];
  inputs?: Partial<Record<DesignDomainId, Record<string, ProvidedDomainInput>>>;
}
export interface DomainSubplan {
  domain: DesignDomainId;
  schema: string;
  missingInputs: DomainRequiredInput[];
  validators: readonly string[];
  deliverables: readonly string[];
  guidedTools: readonly string[];
  expertTools: readonly string[];
}
export type DomainDesignStatus = 'domain_confirmation_required' | 'authoritative_input_required' | 'implementation_unavailable' | 'ready_for_concept' | 'ready_for_exact' | 'ready_for_release_review';
export interface DomainDesignPlan {
  status: DomainDesignStatus;
  domains: DesignDomainId[];
  recommendations: DomainRecommendation[];
  confirmationRequired: boolean;
  subplans: DomainSubplan[];
  federationSuggestions: { sourceDomain: DesignDomainId; targetDomain: DesignDomainId; relation: 'FOLLOWS_TERRAIN' | 'OCCUPIES_SPACE' | 'REFERENCES_MODEL' }[];
  warnings: string[];
}

const STAGE_ORDER: Record<DesignMaturityStage, number> = { concept: 0, exact: 1, release: 2 };

function appliesAtStage(input: DomainRequiredInput, requested: DesignMaturityStage): boolean {
  return STAGE_ORDER[input.requiredFor] <= STAGE_ORDER[requested];
}

function isAuthoritative(input: ProvidedDomainInput | undefined): boolean {
  return input !== undefined && input.value !== undefined && input.value !== null
    && input.authoritative === true && typeof input.sourceRef === 'string'
    && Boolean(input.sourceRef.trim());
}

function federationSuggestions(domains: readonly DesignDomainId[]): DomainDesignPlan['federationSuggestions'] {
  const active = new Set(domains), suggestions: DomainDesignPlan['federationSuggestions'] = [];
  if (active.has('civil') && active.has('landscape')) suggestions.push({ sourceDomain: 'landscape', targetDomain: 'civil', relation: 'FOLLOWS_TERRAIN' });
  if (active.has('building') && active.has('interior')) suggestions.push({ sourceDomain: 'interior', targetDomain: 'building', relation: 'OCCUPIES_SPACE' });
  if (active.has('civil') && active.has('building')) suggestions.push({ sourceDomain: 'building', targetDomain: 'civil', relation: 'REFERENCES_MODEL' });
  return suggestions;
}

/** Plans generation but never invents authoritative engineering input or silently crosses a maturity gate. */
export function planDomainDesign(request: DomainDesignRequest): DomainDesignPlan {
  const prompt = request.prompt.trim(), recommendations = recommendDesignDomains(prompt);
  const requestedDomains = request.selectedDomains ?? [];
  const explicitlySelected = requestedDomains.length > 0;
  const top = recommendations[0], second = recommendations[1];
  const unambiguous = Boolean(top && top.score >= 0.67 && top.score - (second?.score ?? 0) >= 0.34);
  const selectedDomains = explicitlySelected ? requestedDomains.map(domain => normalizeDesignDomainId(domain)) : [];
  const unknownSelectedDomains = explicitlySelected
    ? requestedDomains.filter((domain, index) => selectedDomains[index] === undefined).map(String)
    : [];
  const domains = explicitlySelected
    ? [...new Set(selectedDomains.filter((domain): domain is DesignDomainId => domain !== undefined))]
    : unambiguous && top ? [top.domain] : recommendations.filter(item => item.score >= 0.25).map(item => item.domain);
  const confirmationRequired = !explicitlySelected && !unambiguous;
  const warnings: string[] = [];
  if (!prompt) warnings.push('Design request is empty.');
  if (!recommendations.length) warnings.push('No domain could be inferred; choose a design domain explicitly.');
  if (confirmationRequired && recommendations.length > 1) warnings.push('Multiple design domains are plausible; confirm the intended domains before generation.');
  if (unknownSelectedDomains.length) warnings.push(`Unsupported design domain selection: ${unknownSelectedDomains.join(', ')}.`);
  const subplans = domains.map(domain => {
    const profile = getDomainProfile(domain), providedInputs = request.inputs as Record<string, Record<string, ProvidedDomainInput>> | undefined;
    const supplied = providedInputs?.[domain] ?? (domain === 'building' ? providedInputs?.architecture : undefined) ?? {};
    const missingInputs = profile.requiredInputs.filter(input => appliesAtStage(input, request.stage) && !isAuthoritative(supplied[input.key]));
    return { domain, schema: profile.documentSchemas[0]!, missingInputs, validators: profile.validators, deliverables: profile.deliverables, guidedTools: profile.manualTools.guided, expertTools: profile.manualTools.expert };
  });
  const missing = subplans.flatMap(item => item.missingInputs);
  const exactUnavailable = request.stage === 'exact' ? domains.filter(domain => !supportsExactExecution(getDomainCapability(domain))) : [];
  const releaseUnavailable = request.stage === 'release' ? domains.filter(domain => !supportsRelease(getDomainCapability(domain))) : [];
  if (exactUnavailable.length) warnings.push(`Exact execution is unavailable for: ${exactUnavailable.join(', ')}.`);
  if (releaseUnavailable.length) warnings.push(`Release readiness is unavailable for: ${releaseUnavailable.join(', ')}.`);
  const status: DomainDesignStatus = confirmationRequired || domains.length === 0
    ? 'domain_confirmation_required'
    : missing.length
      ? 'authoritative_input_required'
      : request.stage === 'release'
        ? releaseUnavailable.length ? 'implementation_unavailable' : 'ready_for_release_review'
        : request.stage === 'exact'
          ? exactUnavailable.length ? 'implementation_unavailable' : 'ready_for_exact'
          : 'ready_for_concept';
  if (missing.length) warnings.push(`${missing.length} authoritative input(s) are missing; output must remain below the requested maturity stage.`);
  return { status, domains, recommendations, confirmationRequired, subplans, federationSuggestions: federationSuggestions(domains), warnings };
}
