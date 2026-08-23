import type { ProviderName } from './types';

export interface AiModelCapabilities {
  vision: boolean;
  source: 'catalog' | 'provider-family' | 'unknown';
}

/**
 * Runtime capability lookup. Keep this conservative: a false negative falls
 * back to Luna, while a false positive sends an image to a text-only model.
 */
export function modelCapabilities(provider: ProviderName, model: string): AiModelCapabilities {
  const id = model.trim().toLowerCase();

  if (provider === 'openai') {
    const vision = /^gpt-5(?:\.|-|$)/.test(id) || /^gpt-4(?:o|\.|-|$)/.test(id) || /^o[134](?:-|$)/.test(id);
    return { vision, source: vision ? 'provider-family' : 'unknown' };
  }

  if (provider === 'qwen') {
    // Alibaba Model Studio documents native vision for Qwen 3.8 Max and
    // Qwen 3.7 Plus. Qwen 3.7 Max and hosted DeepSeek models remain text-only
    // here until their exact deployment IDs advertise vision support.
    const vision = /^(?:qwen3\.8-max(?:-preview)?|qwen3\.7-plus|qwen3\.6-plus)(?:-|$)/.test(id)
      || /(?:^|-)vl(?:-|$)/.test(id);
    return { vision, source: vision ? 'catalog' : 'unknown' };
  }

  if (provider === 'anthropic') {
    const vision = /^claude-(?:3|4)/.test(id);
    return { vision, source: vision ? 'provider-family' : 'unknown' };
  }

  if (provider === 'gemini') return { vision: true, source: 'provider-family' };
  if (provider === 'local') {
    const vision = /(?:llava|vision|qwen.*vl|vlm)/.test(id);
    return { vision, source: vision ? 'provider-family' : 'unknown' };
  }

  return { vision: false, source: 'unknown' };
}

export function supportsNativeVision(provider: ProviderName, model: string): boolean {
  return modelCapabilities(provider, model).vision;
}
