import type { DesignDomainId, DomainRequiredInput } from './domainProfile';
import { getDomainProfile } from './domainProfileRegistry';
import {
  planDomainDesign,
  type DesignMaturityStage,
  type DomainDesignPlan,
  type ProvidedDomainInput,
} from './domainDesignOrchestrator';

export type GuidedInputProvenance = 'user_confirmed' | 'imported_authority' | 'assumed' | 'missing';

export interface GuidedBriefValue {
  value?: unknown;
  provenance: GuidedInputProvenance;
  sourceRef?: string;
}

export type GuidedBriefInputs = Partial<Record<DesignDomainId, Record<string, GuidedBriefValue>>>;

export interface GuidedDesignBrief {
  prompt: string;
  requestedStage: DesignMaturityStage;
  plan: DomainDesignPlan;
  inputs: GuidedBriefInputs;
  questions: Array<{ domain: DesignDomainId; input: DomainRequiredInput; question: string }>;
  canGenerateConcept: boolean;
  canEnterExactCad: boolean;
  canRequestReleaseReview: boolean;
}

export const GUIDED_REQUIREMENT_GATE_SCHEMA = 'nexyfab.guided-requirement-gate.v1' as const;
export type GuidedRequirementValueState = 'AUTHORITATIVE' | 'ASSUMED' | 'MISSING' | 'CONFLICT';

export interface GuidedRequirementGateItem {
  domain: DesignDomainId;
  lockObjectId: string;
  key: string;
  label: string;
  state: GuidedRequirementValueState;
  value?: unknown;
  sourceRef?: string;
}

export interface GuidedRequirementGate {
  schema: typeof GUIDED_REQUIREMENT_GATE_SCHEMA;
  requestedStage: DesignMaturityStage;
  items: GuidedRequirementGateItem[];
  issues: string[];
  ready: boolean;
  nextInput?: { domain: DesignDomainId; key: string; label: string; reason: Exclude<GuidedRequirementValueState, 'AUTHORITATIVE'> };
}

const CREATE_PATTERN = /\b(create|design|make|generate|build|new)\b|설계|만들|생성|제작|구성해|作成|設計|创建|设计|crear|diseñ|إنشاء|تصميم/i;
const EDIT_PATTERN = /\b(change|edit|modify|move|resize|replace|add|remove|fillet|chamfer|hole|undo)\b|변경|수정|이동|교체|추가|삭제|필렛|모따기|구멍|되돌|変更|編集|修改|移动|cambiar|editar|mover|تعديل|نقل/i;
const RELEASE_PATTERN = /\b(release|production|manufactur(?:e|ing)|certif(?:y|ication)|shop drawing|final approval)\b|양산|제조 승인|출시|인증|제작도|최종 승인|製造|量産|生产|制造|producción|fabricación|إنتاج|تصنيع/i;
const EXACT_PATTERN = /\b(exact|precision|tolerance|step|iges|gdt|gd&t|machining|cnc|fabrication)\b|정밀|공차|가공|도면|절삭|精密|公差|加工|精确|公差|mecanizado|tolerancia|دقيق|تفاوت/i;

const COORDINATE_PATTERN = /\b(epsg|crs|datum|benchmark|survey control)\b|좌표|기준점|측량 기준|座標|坐标|coordenad|مرجع الإحداثيات/i;
const DIMENSION_PATTERN = /(?:\d+(?:\.\d+)?\s*(?:mm|cm|m|in|inch|°))|(?:[⌀ØR]\s*\d)|(?:\d+\s*[x×]\s*\d+)/i;
const MATERIAL_PATTERN = /\b(aluminum|aluminium|steel|stainless|plastic|abs|pla|nylon|titanium|wood|concrete|cnc|milled|printed|casting|sheet metal)\b|알루미늄|강철|스테인리스|플라스틱|나일론|목재|콘크리트|가공|주조|판금|材料|材质|material|مادة/i;
const LOAD_PATTERN = /\b(load|force|torque|rpm|cycle|duty|motion|speed|pressure)\b|하중|힘|토크|회전수|수명|동작|속도|압력|荷重|载荷|carga|torque|حمل|عزم/i;
const FIELD_PATTERN = /\b(field measur|as-built|site measur|existing drawing|host revision)\b|실측|현장 치수|준공도|기존 도면|호스트 리비전|现场测量|medición|قياس ميداني/i;

function authoritative(value: unknown, sourceRef: string): GuidedBriefValue {
  return { value, provenance: 'user_confirmed', sourceRef };
}

function asProvided(value: GuidedBriefValue | undefined): ProvidedDomainInput | undefined {
  if (!value || value.value === undefined || value.value === null) return undefined;
  const trusted = value.provenance === 'user_confirmed' || value.provenance === 'imported_authority';
  if (!trusted || !value.sourceRef?.trim()) return undefined;
  return { value: value.value, authoritative: true, sourceRef: value.sourceRef };
}

function toOrchestratorInputs(inputs: GuidedBriefInputs): Partial<Record<DesignDomainId, Record<string, ProvidedDomainInput>>> {
  const result: Partial<Record<DesignDomainId, Record<string, ProvidedDomainInput>>> = {};
  for (const [domain, values] of Object.entries(inputs) as Array<[DesignDomainId, Record<string, GuidedBriefValue>]>) {
    const accepted: Record<string, ProvidedDomainInput> = {};
    for (const [key, value] of Object.entries(values)) {
      const provided = asProvided(value);
      if (provided) accepted[key] = provided;
    }
    result[domain] = accepted;
  }
  return result;
}

function questionFor(input: DomainRequiredInput): string {
  return `Please provide ${input.label}. If it is unknown, you may record an assumption, but it cannot be used as exact or release evidence.`;
}

const STAGE_ORDER: Record<DesignMaturityStage, number> = { concept: 0, exact: 1, release: 2 };
const CONFLICT_SENSITIVE_INPUTS = new Set(['critical_dimensions', 'material_process', 'loads_motion']);
const UNRESOLVED_CHOICE = /\b(?:or|either)\b|또는|혹은|아니면|または|いずれか|或者|还是|o bien|(?:^|\s)o(?:\s|$)|أو/i;
const EXPLICITLY_UNMANUFACTURABLE = /\b(?:unmanufacturable|manufacturing impossible|cannot be manufactured|non-manufacturable)\b|제조\s*불가|가공\s*불가|제작\s*불가/i;
const NON_POSITIVE_DIMENSION = /(?:^|[^\d.])(?:0(?:\.0+)?)\s*(?:mm|cm|m|in|inch)(?:\b|[^a-z])/i;

function appliesAtStage(input: DomainRequiredInput, stage: DesignMaturityStage): boolean {
  return STAGE_ORDER[input.requiredFor] <= STAGE_ORDER[stage];
}

/** Exact/release input must resolve alternatives rather than silently choosing one. */
export function hasUnresolvedGuidedInputConflict(key: string, value: unknown): boolean {
  if (!CONFLICT_SENSITIVE_INPUTS.has(key) || typeof value !== 'string') return false;
  const normalized = value.trim();
  if (UNRESOLVED_CHOICE.test(normalized) || EXPLICITLY_UNMANUFACTURABLE.test(normalized)) return true;
  return key === 'critical_dimensions' && NON_POSITIVE_DIMENSION.test(normalized);
}

function requirementState(key: string, value: GuidedBriefValue | undefined): GuidedRequirementValueState {
  if (!value || value.value === undefined || value.value === null || value.provenance === 'missing') return 'MISSING';
  if (value.provenance === 'assumed') return 'ASSUMED';
  if (!value.sourceRef?.trim()) return 'MISSING';
  if (hasUnresolvedGuidedInputConflict(key, value.value)) return 'CONFLICT';
  return 'AUTHORITATIVE';
}

function requirementLockObjectId(domain: DesignDomainId, prompt: string): string {
  let hash = 2166136261;
  for (let index = 0; index < prompt.length; index += 1) {
    hash ^= prompt.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${domain}:brief-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function buildGuidedRequirementGate(brief: GuidedDesignBrief): GuidedRequirementGate {
  const items = brief.plan.domains.flatMap(domain => getDomainProfile(domain).requiredInputs
    .filter(input => appliesAtStage(input, brief.requestedStage))
    .map(input => {
      const value = brief.inputs[domain]?.[input.key];
      return {
        domain,
        lockObjectId: requirementLockObjectId(domain, brief.prompt),
        key: input.key,
        label: input.label,
        state: requirementState(input.key, value),
        ...(value?.value !== undefined ? { value: value.value } : {}),
        ...(value?.sourceRef ? { sourceRef: value.sourceRef } : {}),
      } satisfies GuidedRequirementGateItem;
    }));
  const issues = items.filter(item => item.state !== 'AUTHORITATIVE').map(item =>
    `${item.state === 'CONFLICT' ? 'conflicting' : item.state === 'ASSUMED' ? 'assumed' : 'missing'}_authoritative_input:${item.domain}.${item.key}`);
  const next = items.find(item => item.state !== 'AUTHORITATIVE');
  return {
    schema: GUIDED_REQUIREMENT_GATE_SCHEMA,
    requestedStage: brief.requestedStage,
    items,
    issues,
    ready: issues.length === 0,
    ...(next ? { nextInput: { domain: next.domain, key: next.key, label: next.label, reason: next.state as Exclude<GuidedRequirementValueState, 'AUTHORITATIVE'> } } : {}),
  };
}

/** Recomputes the aggregate instead of trusting a serialized `ready: true`. */
export function validateGuidedRequirementGate(gate: GuidedRequirementGate): string[] {
  if (gate.schema !== GUIDED_REQUIREMENT_GATE_SCHEMA || !Array.isArray(gate.items) || !Array.isArray(gate.issues)) {
    return ['invalid_guided_requirement_gate'];
  }
  if (!['concept', 'exact', 'release'].includes(gate.requestedStage) || gate.items.length === 0) {
    return ['invalid_guided_requirement_gate'];
  }
  const seen = new Set<string>();
  const derived = gate.items.flatMap(item => {
    const identity = `${item.domain}:${item.key}`;
    if (!item.domain || !item.lockObjectId?.trim() || !item.key?.trim() || !item.label?.trim()
      || !['AUTHORITATIVE', 'ASSUMED', 'MISSING', 'CONFLICT'].includes(item.state)) return ['invalid_guided_requirement_item'];
    if (seen.has(identity)) return ['duplicate_guided_requirement_item'];
    seen.add(identity);
    return item.state === 'AUTHORITATIVE' && item.sourceRef?.trim()
      ? []
      : [`${item.state === 'CONFLICT' ? 'conflicting' : item.state === 'ASSUMED' ? 'assumed' : 'missing'}_authoritative_input:${item.domain}.${item.key}`];
  });
  if (gate.ready !== (derived.length === 0)) derived.push('forged_guided_requirement_aggregate');
  if (derived.some(issue => !gate.issues.includes(issue))) derived.push('incomplete_guided_requirement_issues');
  return [...new Set(derived)];
}

export function inferRequestedMaturity(prompt: string): DesignMaturityStage {
  if (RELEASE_PATTERN.test(prompt)) return 'release';
  if (EXACT_PATTERN.test(prompt)) return 'exact';
  return 'concept';
}

/** A narrow detector keeps ordinary feature edits out of the new-design intake. */
export function isNewDesignPrompt(prompt: string): boolean {
  return CREATE_PATTERN.test(prompt) && !EDIT_PATTERN.test(prompt);
}

/**
 * Seed only facts that are explicit in the user's own prompt. Broad intent may
 * satisfy a requirements/program field; governed coordinates, dimensions,
 * materials and loads require matching evidence in the text.
 */
export function seedGuidedBriefInputs(prompt: string, domain: DesignDomainId): GuidedBriefInputs {
  const values: Record<string, GuidedBriefValue> = {};
  const sourceRef = 'chat://initial-request';
  if (domain === 'mechanical') {
    values.functional_requirements = authoritative(prompt, sourceRef);
    if (DIMENSION_PATTERN.test(prompt)) values.critical_dimensions = authoritative(prompt, sourceRef);
    if (MATERIAL_PATTERN.test(prompt)) values.material_process = authoritative(prompt, sourceRef);
    if (LOAD_PATTERN.test(prompt)) values.loads_motion = authoritative(prompt, sourceRef);
  } else if (domain === 'building') {
    values.program_storeys = authoritative(prompt, sourceRef);
    if (COORDINATE_PATTERN.test(prompt)) values.site_coordinate = authoritative(prompt, sourceRef);
  } else if (domain === 'civil') {
    if (COORDINATE_PATTERN.test(prompt)) values.crs_survey = authoritative(prompt, sourceRef);
    values.design_criteria = authoritative(prompt, sourceRef);
  } else if (domain === 'landscape') {
    values.site_existing = authoritative(prompt, sourceRef);
  } else {
    values.space_users = authoritative(prompt, sourceRef);
    if (FIELD_PATTERN.test(prompt)) values.field_measurement = authoritative(prompt, sourceRef);
  }
  return { [domain]: values };
}

export function buildGuidedDesignBrief(input: {
  prompt: string;
  requestedStage: DesignMaturityStage;
  selectedDomains: readonly DesignDomainId[];
  inputs?: GuidedBriefInputs;
}): GuidedDesignBrief {
  const inputs = input.inputs ?? {};
  const plan = planDomainDesign({
    prompt: input.prompt,
    stage: input.requestedStage,
    selectedDomains: input.selectedDomains,
    inputs: toOrchestratorInputs(inputs),
  });
  const missingQuestions = plan.subplans.flatMap(subplan => subplan.missingInputs.map(required => ({
    domain: subplan.domain,
    input: required,
    question: questionFor(required),
  })));
  const conflictQuestions = plan.domains.flatMap(domain => getDomainProfile(domain).requiredInputs
    .filter(required => appliesAtStage(required, input.requestedStage)
      && hasUnresolvedGuidedInputConflict(required.key, inputs[domain]?.[required.key]?.value))
    .map(required => ({
      domain,
      input: required,
      question: `Confirm one value for ${required.label}; unresolved alternatives cannot enter exact CAD.`,
    })));
  const conflictKeys = new Set(conflictQuestions.map(item => `${item.domain}:${item.input.key}`));
  // Resolve an ambiguity in the field just answered before moving on.
  const questions = [...conflictQuestions, ...missingQuestions.filter(item => !conflictKeys.has(`${item.domain}:${item.input.key}`))];
  const conceptPlan = planDomainDesign({
    prompt: input.prompt,
    stage: 'concept',
    selectedDomains: input.selectedDomains,
    inputs: toOrchestratorInputs(inputs),
  });
  const conceptHasConflict = plan.domains.some(domain => getDomainProfile(domain).requiredInputs
    .filter(required => appliesAtStage(required, 'concept'))
    .some(required => hasUnresolvedGuidedInputConflict(required.key, inputs[domain]?.[required.key]?.value)));
  return {
    prompt: input.prompt,
    requestedStage: input.requestedStage,
    plan,
    inputs,
    questions,
    canGenerateConcept: conceptPlan.status === 'ready_for_concept' && !conceptHasConflict,
    canEnterExactCad: input.requestedStage !== 'concept' && plan.status === 'ready_for_exact' && questions.length === 0,
    canRequestReleaseReview: plan.status === 'ready_for_release_review' && questions.length === 0,
  };
}

export function answerGuidedBriefQuestion(
  brief: GuidedDesignBrief,
  question: GuidedDesignBrief['questions'][number],
  answer: string,
  provenance: Exclude<GuidedInputProvenance, 'missing'> = 'user_confirmed',
): GuidedDesignBrief {
  const profile = getDomainProfile(question.domain);
  if (!profile.requiredInputs.some(item => item.key === question.input.key)) return brief;
  const domainValues = { ...(brief.inputs[question.domain] ?? {}) };
  domainValues[question.input.key] = {
    value: answer.trim(),
    provenance,
    sourceRef: provenance === 'assumed' ? `assumption://${question.input.key}` : `chat://confirmed/${question.input.key}`,
  };
  return buildGuidedDesignBrief({
    prompt: brief.prompt,
    requestedStage: brief.requestedStage,
    selectedDomains: brief.plan.domains,
    inputs: { ...brief.inputs, [question.domain]: domainValues },
  });
}

export function composeGuidedDesignPrompt(brief: GuidedDesignBrief): string {
  const facts = Object.entries(brief.inputs).flatMap(([domain, values]) =>
    Object.entries(values ?? {}).filter(([, value]) => value.value !== undefined).map(([key, value]) =>
      `- ${domain}.${key} [${value.provenance}]: ${String(value.value)}`));
  return [brief.prompt, '', `Requested maturity: ${brief.requestedStage}`, 'Confirmed design brief:', ...facts].join('\n');
}
