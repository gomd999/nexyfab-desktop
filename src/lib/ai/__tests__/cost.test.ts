import { describe, it, expect } from 'vitest';
import { estimateCostCents, isPriced } from '../cost';

describe('cost estimation', () => {
  it('priced provider/model pair returns positive cents', () => {
    // DeepSeek deepseek-chat: $0.14 in / $0.28 out per 1M tokens.
    // 1000 prompt + 500 completion = 0.000014 * 1000 + 0.000028 * 500
    //                              = 0.014 + 0.014 = 0.028 cents
    const cents = estimateCostCents('deepseek', 'deepseek-chat', 1000, 500);
    expect(cents).toBeGreaterThan(0);
    expect(cents).toBeLessThan(0.05);
  });

  it('zero tokens → zero cost', () => {
    expect(estimateCostCents('deepseek', 'deepseek-chat', 0, 0)).toBe(0);
    expect(estimateCostCents('deepseek', 'deepseek-chat', undefined, undefined)).toBe(0);
  });

  it('unknown provider/model → zero (graceful)', () => {
    expect(estimateCostCents('unknown-provider', 'foo', 1000, 1000)).toBe(0);
    expect(isPriced('unknown-provider', 'foo')).toBe(false);
  });

  it('isPriced reports true for known pairs', () => {
    expect(isPriced('deepseek', 'deepseek-chat')).toBe(true);
    expect(isPriced('openai', 'gpt-4o-mini')).toBe(true);
    expect(isPriced('anthropic', 'claude-haiku-4-5-20251001')).toBe(true);
  });

  it('case-insensitive provider/model lookup', () => {
    const a = estimateCostCents('DeepSeek', 'DeepSeek-Chat', 100_000, 50_000);
    const b = estimateCostCents('deepseek', 'deepseek-chat', 100_000, 50_000);
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
  });

  it('prefix match falls back for new model versions', () => {
    // gpt-4o-2025-XX should inherit gpt-4o pricing
    expect(isPriced('openai', 'gpt-4o-2025-12-31')).toBe(true);
    const future = estimateCostCents('openai', 'gpt-4o-2025-12-31', 1_000_000, 500_000);
    const known = estimateCostCents('openai', 'gpt-4o', 1_000_000, 500_000);
    expect(future).toBe(known);
  });

  it('local provider is free', () => {
    expect(estimateCostCents('local', 'llama3.1', 100_000, 100_000)).toBe(0);
  });

  it('larger calls scale linearly', () => {
    // Use big enough numbers that 2-decimal rounding doesn't break proportionality.
    const small = estimateCostCents('deepseek', 'deepseek-chat', 100_000, 50_000);
    const big = estimateCostCents('deepseek', 'deepseek-chat', 1_000_000, 500_000);
    expect(big).toBeCloseTo(small * 10, 1);
  });

  it('input vs output tokens priced differently', () => {
    // For OpenAI gpt-4o-mini: input $0.15 vs output $0.60. Output is 4x.
    const inputOnly = estimateCostCents('openai', 'gpt-4o-mini', 1_000_000, 0);
    const outputOnly = estimateCostCents('openai', 'gpt-4o-mini', 0, 1_000_000);
    expect(outputOnly).toBeGreaterThan(inputOnly * 3);
  });

  it('non-finite token counts are tolerated', () => {
    expect(estimateCostCents('deepseek', 'deepseek-chat', NaN, 500)).toBeGreaterThanOrEqual(0);
    expect(estimateCostCents('deepseek', 'deepseek-chat', 1000, Infinity)).toBeGreaterThanOrEqual(0);
  });
});
