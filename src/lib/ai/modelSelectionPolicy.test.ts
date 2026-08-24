import { describe, expect, it } from 'vitest';
import { selectCodegenModel } from './modelSelectionPolicy';

describe('model selection policy', () => {
  it('selects deterministically and records an entitlement fallback', () => {
    const request = { mode: 'auto' as const, plan: 'free' as const };
    const first = selectCodegenModel(request);
    const second = selectCodegenModel(request);

    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('expected selection');
    expect(first.receipt).toEqual(second.receipt);
    expect(first.receipt.selectedModelId).toBe('gpt-luna');
    expect(first.receipt.policy).toEqual({
      conceptOnly: true,
      copyrightSafe: true,
      exactGeometryAuthority: false,
    });
    expect(first.receipt.fallback).toMatchObject({ applied: true, toModelId: 'gpt-luna' });
    expect(first.receipt.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelId: 'qwen-3.7-max', code: 'plan_locked' }),
    ]));
  });

  it('uses vision and task constraints before ranking', () => {
    const result = selectCodegenModel({
      mode: 'balanced', plan: 'pro', task: { kind: 'image-to-cad', requiresVision: true },
      input: { kind: 'image' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected selection');
    expect(result.model.id).toBe('qwen-3.7-plus');
    expect(result.receipt.requiredCapabilities).toContain('vision');
    expect(result.receipt.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelId: 'qwen-3.7-max', code: 'vision_required' }),
    ]));
  });

  it('keeps simple execution on the Luna path in auto mode', () => {
    const result = selectCodegenModel({ mode: 'auto', plan: 'enterprise', task: 'simple-execution' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected selection');
    expect(result.model.id).toBe('gpt-luna');
    expect(result.receipt.fallback.applied).toBe(false);
  });

  it('fails closed for manual, locked, or unsupported requests', () => {
    const manual = selectCodegenModel({ mode: 'manual', plan: 'free', modelId: 'deepseek-pro' });
    expect(manual.ok).toBe(false);
    expect(manual.receipt.status).toBe('blocked');
    expect(manual.receipt.fallback.applied).toBe(false);

    const unsupported = selectCodegenModel({ mode: 'manual', plan: 'enterprise', modelId: 'gpt-luna', capabilities: ['precision-intent'] });
    expect(unsupported.ok).toBe(false);
    expect(unsupported.receipt.reason).toBe('capability_required');
  });

  it('treats an explicit non-manual ID as a preference and never bypasses plan checks', () => {
    const result = selectCodegenModel({ mode: 'auto', plan: 'free', modelId: 'gpt-terra' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected selection');
    expect(result.model.id).toBe('gpt-luna');
    expect(result.receipt.fallback).toMatchObject({ fromModelId: 'gpt-terra', toModelId: 'gpt-luna' });
  });
});
