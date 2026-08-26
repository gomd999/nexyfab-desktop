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
    expect(findCodegenModel('deepseek-pro')).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
    });
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

    expect(canUseCodegenModel(luna, 'free', false)).toBe(true);
    expect(canUseCodegenModel(pro, 'free', false)).toBe(false);
    expect(canUseCodegenModel(pro, 'team', false)).toBe(true);
    expect(canUseCodegenModel(enterprise, 'pro', false)).toBe(false);
    expect(canUseCodegenModel(enterprise, 'enterprise', false)).toBe(true);
  });

  it('unlocks the governed catalog for a no-payment beta without accepting raw model IDs', () => {
    const enterprise = findCodegenModel('gpt-terra')!;
    expect(canUseCodegenModel(enterprise, 'free', true)).toBe(true);
    expect(authorizeCodegenModel('qwen-3.7-max', 'free', true)).toMatchObject({
      ok: true,
      model: { id: 'qwen-3.7-max', provider: 'qwen' },
    });
    expect(authorizeCodegenModel('raw-provider-model', 'free', true)).toMatchObject({
      ok: false,
      code: 'MODEL_NOT_FOUND',
    });
  });

  it('returns explicit locked and unknown-model decisions for API routes', () => {
    expect(authorizeCodegenModel('gpt-terra', 'free', false)).toMatchObject({
      ok: false,
      code: 'MODEL_PLAN_LOCKED',
      requiredTier: 'enterprise',
    });
    expect(authorizeCodegenModel('raw-provider-model', 'enterprise', false)).toMatchObject({
      ok: false,
      code: 'MODEL_NOT_FOUND',
    });
  });
});
