import { describe, expect, it } from 'vitest';
import {
  CODEGEN_MODELS,
  authorizeCodegenModel,
  canUseCodegenModel,
  defaultCodegenModelForPlan,
  findCodegenModel,
} from './codegenModels';

describe('NexyFab AI model entitlements', () => {
  it('exposes the requested six-model tier catalog', () => {
    expect(CODEGEN_MODELS.map(model => [model.id, model.tier])).toEqual([
      ['gpt-luna', 'free'],
      ['qwen-3.7-plus', 'pro'],
      ['qwen-3.7-max', 'pro'],
      ['deepseek-pro', 'pro'],
      ['qwen-3.8-max', 'enterprise'],
      ['gpt-terra', 'enterprise'],
    ]);
  });

  it('uses Luna, DeepSeek Pro, and Terra as safe tier defaults', () => {
    expect(defaultCodegenModelForPlan('free')).toBe('gpt-luna');
    expect(defaultCodegenModelForPlan('pro')).toBe('deepseek-pro');
    expect(defaultCodegenModelForPlan('team')).toBe('deepseek-pro');
    expect(defaultCodegenModelForPlan('enterprise')).toBe('gpt-terra');
  });

  it('lets higher tiers use lower-tier models but blocks upward access', () => {
    const luna = findCodegenModel('gpt-luna')!;
    const pro = findCodegenModel('deepseek-pro')!;
    const enterprise = findCodegenModel('gpt-terra')!;

    expect(canUseCodegenModel(luna, 'free')).toBe(true);
    expect(canUseCodegenModel(pro, 'free')).toBe(false);
    expect(canUseCodegenModel(pro, 'team')).toBe(true);
    expect(canUseCodegenModel(enterprise, 'pro')).toBe(false);
    expect(canUseCodegenModel(enterprise, 'enterprise')).toBe(true);
  });

  it('returns explicit locked and unknown-model decisions for API routes', () => {
    expect(authorizeCodegenModel('gpt-terra', 'free')).toMatchObject({
      ok: false,
      code: 'MODEL_PLAN_LOCKED',
      requiredTier: 'enterprise',
    });
    expect(authorizeCodegenModel('raw-provider-model', 'enterprise')).toMatchObject({
      ok: false,
      code: 'MODEL_NOT_FOUND',
    });
  });
});
