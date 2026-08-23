import { describe, it, expect, vi } from 'vitest';
import { classifyAiError, recordPromptCall } from '../telemetry';
import { AiNotConfiguredError, AiProviderError } from '../types';

// Mock recordUsageEvent so we can assert it was called with the right shape
// without writing to a real DB.
vi.mock('@/lib/plan-guard', () => ({
  recordUsageEvent: vi.fn(),
}));

describe('classifyAiError', () => {
  it('classifies AiNotConfiguredError', () => {
    expect(classifyAiError(new AiNotConfiguredError())).toBe('AiNotConfiguredError');
  });

  it('classifies AiProviderError', () => {
    expect(classifyAiError(new AiProviderError('deepseek', 502, 'bad gateway'))).toBe('AiProviderError');
  });

  it('classifies timeout errors', () => {
    expect(classifyAiError(new Error('Request timed out'))).toBe('timeout');
  });

  it('classifies abort errors', () => {
    expect(classifyAiError(new Error('aborted by signal'))).toBe('aborted');
  });

  it('falls back for plain errors', () => {
    expect(classifyAiError(new Error('something happened'))).toBe('error');
  });

  it('handles non-Error inputs', () => {
    expect(classifyAiError(null)).toBe('unknown');
    expect(classifyAiError(undefined)).toBe('unknown');
    expect(classifyAiError(42)).toBe('unknown');
    expect(classifyAiError('string')).toBe('unknown');
  });
});

describe('recordPromptCall', () => {
  it('forwards userId and metadata to recordUsageEvent', async () => {
    const mod = await import('@/lib/plan-guard');
    const spy = mod.recordUsageEvent as unknown as ReturnType<typeof vi.fn>;
    spy.mockClear();

    recordPromptCall({
      userId: 'u-123',
      orgId: 'org-123',
      promptId: 'shape-chat',
      promptVersion: '1.0.0',
      provider: 'deepseek',
      model: 'deepseek-chat',
      latencyMs: 1250,
      promptTokens: 800,
      completionTokens: 400,
      success: true,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('u-123', 'prompt_call', expect.objectContaining({
      promptId: 'shape-chat',
      promptVersion: '1.0.0',
      provider: 'deepseek',
      model: 'deepseek-chat',
      latencyMs: 1250,
      promptTokens: 800,
      completionTokens: 400,
      success: true,
    }), 'org-123');
  });

  it('uses anon bucket when userId omitted', async () => {
    const mod = await import('@/lib/plan-guard');
    const spy = mod.recordUsageEvent as unknown as ReturnType<typeof vi.fn>;
    spy.mockClear();

    recordPromptCall({
      promptId: 'scad-intent-from-nl',
      promptVersion: '1.1.0',
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      latencyMs: 800,
      success: true,
    });

    expect(spy).toHaveBeenCalledWith('anon', 'prompt_call', expect.any(Object), undefined);
  });

  it('records errorClass on failure', async () => {
    const mod = await import('@/lib/plan-guard');
    const spy = mod.recordUsageEvent as unknown as ReturnType<typeof vi.fn>;
    spy.mockClear();

    recordPromptCall({
      userId: 'u-456',
      promptId: 'shape-chat',
      promptVersion: '1.0.0',
      provider: 'deepseek',
      model: 'unknown',
      latencyMs: 0,
      success: false,
      errorClass: 'AiProviderError',
    });

    expect(spy).toHaveBeenCalledWith('u-456', 'prompt_call', expect.objectContaining({
      success: false,
      errorClass: 'AiProviderError',
    }), undefined);
  });

  it('omits optional fields when not provided', async () => {
    const mod = await import('@/lib/plan-guard');
    const spy = mod.recordUsageEvent as unknown as ReturnType<typeof vi.fn>;
    spy.mockClear();

    recordPromptCall({
      promptId: 'compose',
      promptVersion: '1.0.0',
      provider: 'openai',
      model: 'gpt-4o-mini',
      latencyMs: 600,
      success: true,
    });

    const metadata = spy.mock.calls[0][2] as Record<string, unknown>;
    expect(metadata).not.toHaveProperty('promptTokens');
    expect(metadata).not.toHaveProperty('completionTokens');
    expect(metadata).not.toHaveProperty('errorClass');
  });

  it('records provider input-cache counters without prompt content', async () => {
    const mod = await import('@/lib/plan-guard');
    const spy = mod.recordUsageEvent as unknown as ReturnType<typeof vi.fn>;
    spy.mockClear();

    recordPromptCall({
      userId: 'u-cache',
      promptId: 'cad-feature-program',
      promptVersion: '1.0.0',
      provider: 'openai',
      model: 'gpt-5.6-luna',
      latencyMs: 450,
      promptTokens: 1600,
      completionTokens: 300,
      cachedPromptTokens: 1200,
      cacheWriteTokens: 0,
      cacheMissTokens: 400,
      cacheProfile: 'openai-explicit',
      success: true,
    });

    expect(spy).toHaveBeenCalledWith('u-cache', 'prompt_call', expect.objectContaining({
      cachedPromptTokens: 1200,
      cacheWriteTokens: 0,
      cacheMissTokens: 400,
      cacheProfile: 'openai-explicit',
    }), undefined);
  });
});
