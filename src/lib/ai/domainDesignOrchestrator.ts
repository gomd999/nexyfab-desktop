import { DESIGN_DOMAIN_IDS, type DesignDomainId, type DomainRequiredInput } from './domainProfile';
import { getDomainProfile } from './domainProfileRegistry';

export type DesignMaturityStage = 'concept' | 'exact' | 'release';
export interface ProvidedDomainInput { value: unknown; authoritative: boolean; sourceRef: string }
export interface DomainDesignRequest {
  prompt: string;
  stage: DesignMaturityStage;
  selectedDomains?: readonly DesignDomainId[];
  inputs?: Partial<Record<DesignDomainId, Record<string, ProvidedDomainInput>>>;
}
export interface DomainRecommendation { domain: DesignDomainId; score: number; reasons: string[] }
export interface DomainSubplan {
  domain: DesignDomainId;
  schema: string;
  missingInputs: DomainRequiredInput[];
  validators: readonly string[];
  deliverables: readonly string[];
  guidedTools: readonly string[];
  expertTools: readonly string[];
}
export type DomainDesignStatus = 'domain_confirmation_required' | 'authoritative_input_required' | 'ready_for_concept' | 'ready_for_exact' | 'ready_for_release_review';
export interface DomainDesignPlan {
  status: DomainDesignStatus;
  domains: DesignDomainId[];
  recommendations: DomainRecommendation[];
  confirmationRequired: boolean;
  subplans: DomainSubplan[];
  federationSuggestions: { sourceDomain: DesignDomainId; targetDomain: DesignDomainId; relation: 'FOLLOWS_TERRAIN' | 'OCCUPIES_SPACE' | 'REFERENCES_MODEL' }[];
  warnings: string[];
}

const KEYWORDS: Record<DesignDomainId, readonly string[]> = {
  mechanical: ['기계', '제품', '부품', '조립', '기어', '브래킷', '축', '베어링', '공차', '가공', 'mechanical', 'product', 'part', 'assembly', 'gear', 'bracket', 'bearing'],
  building: ['건축', '건물', '층', '벽', '문', '창호', '지붕', '피난', 'bim', 'building', 'architecture', 'storey', 'wall', 'roof', 'egress'],
  civil: ['토목', '도로', '교량', '선형', '측량', '종단', '횡단', '배수', '코리더', 'civil', 'road', 'bridge', 'alignment', 'survey', 'drainage', 'corridor'],
  landscape: ['조경', '식재', '수목', '관수', '정원', '광장', '토양', 'landscape', 'planting', 'tree', 'irrigation', 'garden', 'soil'],
  interior: ['인테리어', '실내', '가구', '마감', '천장', '조명', '밀워크', 'interior', 'furniture', 'finish', 'ceiling', 'lighting', 'millwork'],
};
const STAGE_ORDER: Record<DesignMaturityStage, number> = { concept: 0, exact: 1, release: 2 };

export function recommendDesignDomains(prompt: string): DomainRecommendation[] {
  const normalized = prompt.toLocaleLowerCase();
  const raw = DESIGN_DOMAIN_IDS.map(domain => {
    const reasons = KEYWORDS[domain].filter(keyword => normalized.includes(keyword));
    return { domain, matches: reasons.length, reasons };
  });
  const total = raw.reduce((sum, item) => sum + item.matches, 0);
  return raw
    .filter(item => item.matches > 0)
    .map(item => ({ domain: item.domain, score: total ? item.matches / total : 0, reasons: item.reasons }))
    .sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain));
}

function appliesAtStage(input: DomainRequiredInput, requested: DesignMaturityStage): boolean {
  return STAGE_ORDER[input.requiredFor] <= STAGE_ORDER[requested];
}

function isAuthoritative(input: ProvidedDomainInput | undefined): boolean {
  return input !== undefined && input.value !== undefined && input.value !== null && input.authoritative === true && Boolean(input.sourceRef.trim());
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
  const explicitlySelected = request.selectedDomains !== undefined && request.selectedDomains.length > 0;
  const top = recommendations[0], second = recommendations[1];
  const unambiguous = Boolean(top && top.score >= 0.67 && top.score - (second?.score ?? 0) >= 0.34);
  const domains = explicitlySelected ? [...new Set(request.selectedDomains)] : unambiguous && top ? [top.domain] : recommendations.filter(item => item.score >= 0.25).map(item => item.domain);
  const confirmationRequired = !explicitlySelected && !unambiguous;
  const warnings: string[] = [];
  if (!prompt) warnings.push('Design request is empty.');
  if (!recommendations.length) warnings.push('No domain could be inferred; choose a design domain explicitly.');
  if (confirmationRequired && recommendations.length > 1) warnings.push('Multiple design domains are plausible; confirm the intended domains before generation.');
  const subplans = domains.map(domain => {
    const profile = getDomainProfile(domain), supplied = request.inputs?.[domain] ?? {};
    const missingInputs = profile.requiredInputs.filter(input => appliesAtStage(input, request.stage) && !isAuthoritative(supplied[input.key]));
    return { domain, schema: profile.documentSchemas[0]!, missingInputs, validators: profile.validators, deliverables: profile.deliverables, guidedTools: profile.manualTools.guided, expertTools: profile.manualTools.expert };
  });
  const missing = subplans.flatMap(item => item.missingInputs);
  const status: DomainDesignStatus = confirmationRequired || domains.length === 0
    ? 'domain_confirmation_required'
    : missing.length
      ? 'authoritative_input_required'
      : request.stage === 'release'
        ? 'ready_for_release_review'
        : request.stage === 'exact'
          ? 'ready_for_exact'
          : 'ready_for_concept';
  if (missing.length) warnings.push(`${missing.length} authoritative input(s) are missing; output must remain below the requested maturity stage.`);
  return { status, domains, recommendations, confirmationRequired, subplans, federationSuggestions: federationSuggestions(domains), warnings };
}
