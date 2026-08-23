import { describe, expect, it } from 'vitest';
import { supportsNativeVision } from './modelCapabilities';

describe('modelCapabilities', () => {
  it('recognizes the documented Qwen native-VL deployments conservatively', () => {
    expect(supportsNativeVision('qwen', 'qwen3.8-max')).toBe(true);
    expect(supportsNativeVision('qwen', 'qwen3.8-max-preview')).toBe(true);
    expect(supportsNativeVision('qwen', 'qwen3.7-plus')).toBe(true);
    expect(supportsNativeVision('qwen', 'qwen3.7-max')).toBe(false);
    expect(supportsNativeVision('qwen', 'deepseek-v4-pro')).toBe(false);
  });

  it('recognizes the selected OpenAI multimodal family', () => {
    expect(supportsNativeVision('openai', 'gpt-5.6-luna')).toBe(true);
    expect(supportsNativeVision('openai', 'gpt-5.6-terra')).toBe(true);
  });
});
