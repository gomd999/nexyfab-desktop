import {
  canUseCodegenModel,
  CODEGEN_MODELS,
  findCodegenModel,
  modelTierForPlan,
  type AiAccessPlan,
  type CodegenModel,
} from './codegenModels';
import { modelCapabilities } from './modelCapabilities';

/** Selection is deliberately independent of provider credentials and runtime overrides. */
export type ModelSelectionMode = 'auto' | 'quality' | 'balanced' | 'fast' | 'manual';
export type ModelSelectionRisk = 'low' | 'medium' | 'high' | 'critical';
export type ModelSelectionInputKind = 'text' | 'structured' | 'image' | 'mixed';
/** AI-side planning capabilities; geometry execution remains Precision CAD-owned. */
export type ModelSelectionCapability = 'vision' | 'reasoning' | 'precision-intent' | 'structured-output';

export interface ModelSelectionTask {
  kind?: string;
  complexity?: 'simple' | 'moderate' | 'complex';
  requiredCapabilities?: readonly ModelSelectionCapability[];
  requiresVision?: boolean;
}

export interface ModelSelectionInput {
  kind?: ModelSelectionInputKind;
  hasImage?: boolean;
  requiresVision?: boolean;
}

export interface ModelSelectionRiskInput {
  level?: ModelSelectionRisk;
  exactGeometry?: boolean;
  releaseImpact?: boolean;
}

export interface ModelSelectionConstraints {
  allowedModelIds?: readonly string[];
  excludedModelIds?: readonly string[];
  allowedProviders?: readonly CodegenModel['provider'][];
  requiredTier?: CodegenModel['tier'];
  requiredCapabilities?: readonly ModelSelectionCapability[];
  maxLatencyClass?: 'fast' | 'standard';
}

export interface ModelSelectionRequest {
  mode: ModelSelectionMode;
  plan?: AiAccessPlan | string | null;
  /** Stable public ID. In manual mode this is required. */
  modelId?: string | null;
  manualModelId?: string | null;
  task?: ModelSelectionTask | string;
  input?: ModelSelectionInput;
  risk?: ModelSelectionRisk | ModelSelectionRiskInput;
  capabilities?: readonly ModelSelectionCapability[];
  constraints?: ModelSelectionConstraints;
}

export type ModelSelectionDecisionCode =
  | 'selected'
  | 'preferred'
  | 'model_not_found'
  | 'plan_locked'
  | 'excluded'
  | 'provider_not_allowed'
  | 'tier_not_allowed'
  | 'vision_required'
  | 'capability_required'
  | 'risk_too_high'
  | 'latency_too_slow'
  | 'manual_model_required'
  | 'no_candidate';

export interface ModelSelectionCandidateDecision {
  modelId: string;
  accepted: boolean;
  code: ModelSelectionDecisionCode;
  detail?: string;
}

export interface ModelSelectionFallback {
  applied: boolean;
  fromModelId: string | null;
  toModelId: string | null;
  reason: string | null;
}

/** Serializable evidence of every policy decision. It contains no runtime model override. */
export interface ModelSelectionReceipt {
  schema: 'nexyfab.model-selection-receipt.v1';
  policy: {
    conceptOnly: true;
    copyrightSafe: true;
    exactGeometryAuthority: false;
  };
  mode: ModelSelectionMode;
  plan: AiAccessPlan;
  requestedModelId: string | null;
  selectedModelId: string | null;
  status: 'selected' | 'blocked';
  task: string | null;
  inputKind: ModelSelectionInputKind;
  risk: ModelSelectionRisk;
  requiredCapabilities: readonly ModelSelectionCapability[];
  decisions: readonly ModelSelectionCandidateDecision[];
  fallback: ModelSelectionFallback;
  reason: string | null;
}

export type ModelSelectionResult =
  | { ok: true; model: CodegenModel; receipt: ModelSelectionReceipt }
  | { ok: false; model: null; receipt: ModelSelectionReceipt };

interface PolicyScore {
  quality: number;
  speed: number;
  risk: number;
  capabilities: readonly ModelSelectionCapability[];
}

/** Stable policy metadata. Never use provider deployment names as policy inputs. */
const POLICY_SCORE: Readonly<Record<string, PolicyScore>> = {
  'gpt-luna': { quality: 65, speed: 100, risk: 55, capabilities: ['vision', 'structured-output'] },
  'qwen-3.7-plus': { quality: 72, speed: 86, risk: 65, capabilities: ['vision', 'structured-output'] },
  'qwen-3.7-max': { quality: 82, speed: 72, risk: 76, capabilities: ['reasoning', 'structured-output'] },
  'deepseek-pro': { quality: 90, speed: 65, risk: 88, capabilities: ['reasoning', 'precision-intent', 'structured-output'] },
  'qwen-3.8-max': { quality: 96, speed: 54, risk: 94, capabilities: ['vision', 'reasoning', 'precision-intent', 'structured-output'] },
  'gpt-terra': { quality: 100, speed: 48, risk: 100, capabilities: ['vision', 'reasoning', 'precision-intent', 'structured-output'] },
};

const VALID_PLANS: readonly AiAccessPlan[] = ['free', 'pro', 'team', 'enterprise'];
const VALID_RISKS: readonly ModelSelectionRisk[] = ['low', 'medium', 'high', 'critical'];
function cleanId(value: string | null | undefined): string | null {
  const id = typeof value === 'string' ? value.trim() : '';
  return id || null;
}

function taskKind(task: ModelSelectionRequest['task']): string | null {
  if (typeof task === 'string') return task.trim().toLowerCase() || null;
  return task?.kind?.trim().toLowerCase() || null;
}

function normalizePlan(plan: ModelSelectionRequest['plan']): AiAccessPlan | null {
  if (plan === undefined || plan === null || plan === '') return 'free';
  return VALID_PLANS.includes(plan as AiAccessPlan) ? plan as AiAccessPlan : null;
}

function normalizeRisk(request: ModelSelectionRequest): ModelSelectionRisk {
  const value = typeof request.risk === 'string' ? request.risk : request.risk?.level;
  if (value && VALID_RISKS.includes(value)) return value;
  const task = typeof request.task === 'object' ? request.task : undefined;
  if (request.risk && typeof request.risk === 'object' && (request.risk.exactGeometry || request.risk.releaseImpact)) return 'high';
  if (task?.complexity === 'complex' || task?.kind?.toLowerCase().includes('exact')) return 'high';
  return 'medium';
}

function requiredCapabilities(request: ModelSelectionRequest): ModelSelectionCapability[] {
  const values: ModelSelectionCapability[] = [
    ...(request.capabilities ?? []),
    ...(request.constraints?.requiredCapabilities ?? []),
    ...(typeof request.task === 'object' ? request.task.requiredCapabilities ?? [] : []),
  ];
  const task = taskKind(request.task) ?? '';
  const input = request.input;
  if (request.input?.requiresVision || input?.hasImage || input?.kind === 'image' || input?.kind === 'mixed' || (typeof request.task === 'object' && request.task.requiresVision)) values.push('vision');
  if (task.includes('exact') || task.includes('geometry') || task.includes('precision')) values.push('precision-intent');
  if (task.includes('reason') || task.includes('analysis')) values.push('reasoning');
  // Keep malformed values in the receipt and let capability checking reject
  // them. Dropping one here would turn an invalid requirement into a silent
  // fallback to a different model.
  return [...new Set(values)];
}

function inputKind(request: ModelSelectionRequest): ModelSelectionInputKind {
  if (request.input?.kind) return request.input.kind;
  if (request.input?.hasImage || request.input?.requiresVision) return 'image';
  return 'text';
}

function scoreFor(model: CodegenModel): PolicyScore {
  const policy = POLICY_SCORE[model.id];
  if (policy) return policy;
  return { quality: 0, speed: 0, risk: 0, capabilities: [] };
}

function supportsCapability(model: CodegenModel, capability: ModelSelectionCapability): boolean {
  if (capability === 'vision') return model.vision === true || modelCapabilities(model.provider, model.model).vision;
  return scoreFor(model).capabilities.includes(capability);
}

function policyPrimary(mode: ModelSelectionMode, risk: ModelSelectionRisk, task: string | null = null): string | null {
  if (mode === 'auto' && (task === 'simple' || task === 'simple-execution' || task === 'simple_execution' || task === 'execution')) return 'gpt-luna';
  if (mode === 'fast') return 'gpt-luna';
  if (mode === 'quality') return 'gpt-terra';
  if (mode === 'balanced') return risk === 'high' || risk === 'critical' ? 'deepseek-pro' : 'qwen-3.7-max';
  if (risk === 'critical') return 'gpt-terra';
  if (risk === 'high') return 'deepseek-pro';
  if (risk === 'low') return 'gpt-luna';
  return 'qwen-3.7-max';
}

function sortCandidates(models: CodegenModel[], mode: ModelSelectionMode, risk: ModelSelectionRisk, task: string | null = null): CodegenModel[] {
  const primary = policyPrimary(mode, risk, task);
  const rank = (model: CodegenModel): number => {
    const score = scoreFor(model);
    if (mode === 'fast') return score.speed;
    if (mode === 'quality') return score.quality;
    if (mode === 'balanced') return score.quality * 0.55 + score.speed * 0.25 + score.risk * 0.2;
    const riskWeight = risk === 'critical' ? 0.5 : risk === 'high' ? 0.35 : 0.2;
    return score.quality * 0.45 + score.speed * 0.35 + score.risk * riskWeight;
  };
  return [...models].sort((a, b) => {
    if (a.id === primary) return -1;
    if (b.id === primary) return 1;
    const scoreDiff = rank(b) - rank(a);
    return scoreDiff || a.id.localeCompare(b.id);
  });
}

function decision(modelId: string, accepted: boolean, code: ModelSelectionDecisionCode, detail?: string): ModelSelectionCandidateDecision {
  return detail ? { modelId, accepted, code, detail } : { modelId, accepted, code };
}

/**
 * Selects a catalog model using only serializable inputs. A rejected request is
 * never silently changed to Luna: callers must inspect `receipt.status`.
 */
export function selectCodegenModel(request: ModelSelectionRequest): ModelSelectionResult {
  const mode = request.mode;
  const plan = normalizePlan(request.plan);
  const requestedModelId = cleanId(request.modelId ?? request.manualModelId);
  const risk = normalizeRisk(request);
  const required = requiredCapabilities(request);
  const kind = taskKind(request.task);
  const baseReceipt = (overrides: Partial<ModelSelectionReceipt>): ModelSelectionReceipt => ({
    schema: 'nexyfab.model-selection-receipt.v1',
    policy: { conceptOnly: true, copyrightSafe: true, exactGeometryAuthority: false },
    mode, plan: plan ?? 'free', requestedModelId,
    selectedModelId: null, status: 'blocked', task: kind, inputKind: inputKind(request), risk,
    requiredCapabilities: required, decisions: [], fallback: { applied: false, fromModelId: requestedModelId, toModelId: null, reason: null }, reason: null,
    ...overrides,
  });
  if (!VALID_RISKS.includes(risk) || !['auto', 'quality', 'balanced', 'fast', 'manual'].includes(mode)) {
    return { ok: false, model: null, receipt: baseReceipt({ reason: 'invalid_policy_input' }) };
  }
  if (!plan) return { ok: false, model: null, receipt: baseReceipt({ reason: 'invalid_plan' }) };
  if (mode === 'manual' && !requestedModelId) {
    return { ok: false, model: null, receipt: baseReceipt({ decisions: [{ modelId: '', accepted: false, code: 'manual_model_required' }], reason: 'manual_model_required' }) };
  }
  if (mode === 'manual') {
    const model = findCodegenModel(requestedModelId);
    if (!model) return { ok: false, model: null, receipt: baseReceipt({ decisions: [decision(requestedModelId!, false, 'model_not_found')], reason: 'manual_model_not_found' }) };
    const checks = checkCandidate(model, request, plan, risk, required);
    if (checks.length) return { ok: false, model: null, receipt: baseReceipt({ decisions: checks, reason: checks[0]!.code }) };
    const receipt = baseReceipt({ selectedModelId: model.id, status: 'selected', decisions: [decision(model.id, true, 'selected')], reason: null });
    return { ok: true, model, receipt };
  }

  const models = sortCandidates([...CODEGEN_MODELS], mode, risk, kind);
  // A public ID supplied outside manual mode is a preference, never an
  // implicit entitlement bypass. It remains visible as an explicit fallback
  // if plan/capability/risk checks reject it.
  if (requestedModelId) {
    const preferred = models.find(model => model.id === requestedModelId);
    if (preferred) models.splice(models.indexOf(preferred), 1), models.unshift(preferred);
  }
  const decisions: ModelSelectionCandidateDecision[] = [];
  const eligible: CodegenModel[] = [];
  for (const model of models) {
    const checks = checkCandidate(model, request, plan, risk, required);
    if (checks.length) decisions.push(...checks);
    else { decisions.push(decision(model.id, true, 'selected')); eligible.push(model); }
  }
  const selected = eligible[0];
  if (!selected) return { ok: false, model: null, receipt: baseReceipt({ decisions, reason: 'no_candidate' }) };
  const primary = requestedModelId ?? policyPrimary(mode, risk, kind);
  const fallbackApplied = Boolean(primary && selected.id !== primary);
  const receipt = baseReceipt({
    selectedModelId: selected.id, status: 'selected', decisions,
    fallback: { applied: fallbackApplied, fromModelId: primary, toModelId: fallbackApplied ? selected.id : null, reason: fallbackApplied ? 'preferred_model_did_not_meet_constraints' : null },
    reason: null,
  });
  return { ok: true, model: selected, receipt };
}

function checkCandidate(model: CodegenModel, request: ModelSelectionRequest, plan: AiAccessPlan, risk: ModelSelectionRisk, required: readonly ModelSelectionCapability[]): ModelSelectionCandidateDecision[] {
  const constraints = request.constraints;
  if (!canUseCodegenModel(model, plan)) return [decision(model.id, false, 'plan_locked', `requires_${model.tier}`)];
  if (constraints?.allowedModelIds && !constraints.allowedModelIds.includes(model.id)) return [decision(model.id, false, 'excluded')];
  if (constraints?.excludedModelIds?.includes(model.id)) return [decision(model.id, false, 'excluded')];
  if (constraints?.allowedProviders && !constraints.allowedProviders.includes(model.provider)) return [decision(model.id, false, 'provider_not_allowed')];
  if (constraints?.requiredTier && model.tier !== constraints.requiredTier) return [decision(model.id, false, 'tier_not_allowed')];
  const policy = scoreFor(model);
  if (constraints?.maxLatencyClass === 'fast' && policy.speed < 75) return [decision(model.id, false, 'latency_too_slow')];
  const minimumRisk = risk === 'critical' ? 95 : risk === 'high' ? 80 : risk === 'medium' ? 50 : 0;
  if (policy.risk < minimumRisk) return [decision(model.id, false, 'risk_too_high')];
  for (const capability of required) {
    if (!supportsCapability(model, capability)) return [decision(model.id, false, capability === 'vision' ? 'vision_required' : 'capability_required', capability)];
  }
  return [];
}

/** Alias kept intentionally short for policy call sites. */
export const selectModel = selectCodegenModel;

/** Public catalog IDs only; useful for client pickers without exposing deployment IDs. */
export function publicModelIds(): readonly string[] {
  return CODEGEN_MODELS.map(model => model.id);
}

/** Expose the entitlement tier without exposing any provider/runtime setting. */
export function selectionTierForPlan(plan: string | null | undefined): CodegenModel['tier'] {
  return modelTierForPlan(plan);
}
