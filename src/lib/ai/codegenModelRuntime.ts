import 'server-only';

import { getSetting } from '@/lib/admin-settings';
import {
  authorizeCodegenModel,
  type AiModelTier,
  type CodegenModel,
} from './codegenModels';

const MODEL_SETTING_KEYS: Record<string, string> = {
  'gpt-luna': 'ai.model.gpt_luna',
  'qwen-3.7-plus': 'ai.model.qwen_3_7_plus',
  'qwen-3.7-max': 'ai.model.qwen_3_7_max',
  'deepseek-pro': 'ai.model.deepseek_pro',
  'qwen-3.8-max': 'ai.model.qwen_3_8_max',
  'gpt-terra': 'ai.model.gpt_terra',
};

export type RuntimeCodegenResolution =
  | {
      ok: true;
      catalog: CodegenModel;
      provider: CodegenModel['provider'];
      model: string;
      cacheProfile: 'openai-explicit' | 'qwen-explicit' | 'provider-default';
    }
  | {
      ok: false;
      code: 'MODEL_NOT_FOUND' | 'MODEL_PLAN_LOCKED';
      requestedId: string;
      requiredTier?: AiModelTier;
    };

/** Resolve a stable public model slug into an operator-controlled runtime ID. */
export async function resolveRuntimeCodegenModel(
  id: string | null | undefined,
  plan: string | null | undefined,
): Promise<RuntimeCodegenResolution> {
  const authorized = authorizeCodegenModel(id, plan);
  if (!authorized.ok) return authorized;

  const settingKey = MODEL_SETTING_KEYS[authorized.model.id];
  const override = settingKey ? (await getSetting(settingKey))?.trim() : null;
  const runtimeModel = override || authorized.model.model;
  return {
    ok: true,
    catalog: authorized.model,
    provider: authorized.model.provider,
    model: runtimeModel,
    // The provider adapter decides per request whether the stable prefix is
    // long enough for paid explicit-cache creation; selection alone cannot.
    cacheProfile: 'provider-default',
  };
}
