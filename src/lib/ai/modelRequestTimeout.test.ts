import { describe, expect, it } from 'vitest';
import { selectedModelTimeoutMs } from './modelRequestTimeout';

describe('selectedModelTimeoutMs', () => {
  it('allows slower governed reasoning providers to finish', () => {
    expect(selectedModelTimeoutMs('qwen')).toBe(90_000);
    expect(selectedModelTimeoutMs('deepseek')).toBe(60_000);
    expect(selectedModelTimeoutMs('openai')).toBe(30_000);
  });
});
