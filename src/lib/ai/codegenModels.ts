import type { ProviderName } from './types';
import { aiModelBetaAccessEnabled } from './aiModelBetaAccess';

export type AiModelTier = 'free' | 'pro' | 'enterprise';
export type AiAccessPlan = 'free' | 'pro' | 'team' | 'enterprise';

/**
 * Public, client-safe model catalog. `model` is the deployment default only;
 * server-side admin settings may map the stable `id` to another provider model
 * identifier without exposing credentials or mutable configuration.
 */
export interface CodegenModel {
  id: string;
  label: string;
  provider: ProviderName;
  model: string;
  tier: AiModelTier;
  note: string;
  vision?: boolean;
  recommended?: boolean;
  availability?: 'preview';
}

/**
 * Product entitlement matrix requested for NexyFab. `team` inherits Pro
 * models; Enterprise alone receives the Enterprise catalog.
 */
export const CODEGEN_MODELS: readonly CodegenModel[] = [
  {
    id: 'gpt-luna',
    label: 'GPT-5.6 Luna',
    provider: 'openai',
    model: 'gpt-5.6-luna',
    tier: 'free',
    note: 'Free · 빠른 설계 · 이미지 자동 분석',
    vision: true,
    recommended: true,
  },
  {
    id: 'qwen-3.7-plus',
    label: 'Qwen 3.7 Plus',
    provider: 'qwen',
    model: 'qwen3.7-plus',
    tier: 'pro',
    note: 'Pro · 빠른 반복 설계',
    vision: true,
  },
  {
    id: 'qwen-3.7-max',
    label: 'Qwen 3.7 Max',
    provider: 'qwen',
    model: 'qwen3.7-max',
    tier: 'pro',
    note: 'Pro · 복잡 형상 추론',
  },
  {
    id: 'deepseek-pro',
    label: 'DeepSeek Pro',
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    tier: 'pro',
    note: 'Pro · 정밀 설계 추론',
    recommended: true,
  },
  {
    id: 'qwen-3.8-max',
    label: 'Qwen 3.8 Max',
    provider: 'qwen',
    model: 'qwen3.8-max',
    tier: 'enterprise',
    note: 'Enterprise · 고난도 멀티모달 설계 추론',
    vision: true,
  },
  {
    id: 'gpt-terra',
    label: 'GPT-5.6 Terra',
    provider: 'openai',
    model: 'gpt-5.6-terra',
    tier: 'enterprise',
    note: 'Enterprise · 고난도 정밀 설계',
    vision: true,
    recommended: true,
  },
] as const;

export const DEFAULT_CODEGEN_MODEL = 'gpt-luna';
export const VISION_CODEGEN_MODEL = 'gpt-luna';

const TIER_RANK: Record<AiModelTier, number> = { free: 0, pro: 1, enterprise: 2 };

export function modelTierForPlan(plan: string | null | undefined): AiModelTier {
  if (plan === 'enterprise') return 'enterprise';
  if (plan === 'pro' || plan === 'team') return 'pro';
  return 'free';
}

export function canUseCodegenModel(
  model: CodegenModel,
  plan: string | null | undefined,
  betaAccess = aiModelBetaAccessEnabled(),
): boolean {
  if (betaAccess) return true;
  return TIER_RANK[modelTierForPlan(plan)] >= TIER_RANK[model.tier];
}

export function defaultCodegenModelForPlan(plan: string | null | undefined): string {
  const tier = modelTierForPlan(plan);
  if (tier === 'enterprise') return 'gpt-terra';
  if (tier === 'pro') return 'deepseek-pro';
  return DEFAULT_CODEGEN_MODEL;
}

export function findCodegenModel(id: string | null | undefined): CodegenModel | undefined {
  return CODEGEN_MODELS.find(model => model.id === id);
}

export type CodegenModelAuthorization =
  | { ok: true; model: CodegenModel }
  | { ok: false; code: 'MODEL_NOT_FOUND' | 'MODEL_PLAN_LOCKED'; requestedId: string; requiredTier?: AiModelTier };

/** Server-side allowlist + entitlement check. Never accept a raw model ID. */
export function authorizeCodegenModel(
  id: string | null | undefined,
  plan: string | null | undefined,
  betaAccess = aiModelBetaAccessEnabled(),
): CodegenModelAuthorization {
  const requestedId = id?.trim() || defaultCodegenModelForPlan(plan);
  const model = findCodegenModel(requestedId);
  if (!model) return { ok: false, code: 'MODEL_NOT_FOUND', requestedId };
  if (!canUseCodegenModel(model, plan, betaAccess)) {
    return { ok: false, code: 'MODEL_PLAN_LOCKED', requestedId, requiredTier: model.tier };
  }
  return { ok: true, model };
}

/**
 * Backward-compatible resolver for internal callers. API routes handling a
 * client-selected ID must call `authorizeCodegenModel` first.
 */
export function resolveCodegenModel(
  id?: string,
  plan: string = 'free',
): { preferProvider: ProviderName; model: string; id: string; tier: AiModelTier } {
  const auth = authorizeCodegenModel(id, plan);
  const selected = auth.ok
    ? auth.model
    : findCodegenModel(defaultCodegenModelForPlan(plan))!;
  return {
    preferProvider: selected.provider,
    model: selected.model,
    id: selected.id,
    tier: selected.tier,
  };
}
