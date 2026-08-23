import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatCompletionRequest } from '../types';
import { buildQwenChatBody, normalizeQwenBaseUrl } from './qwen';
import { buildAnthropicMessagesBody } from './anthropic';
import { buildDeepSeekChatBody } from './deepseek';
import { buildOpenRouterChatBody } from './openrouter';
import { geminiProvider } from './gemini';

function request(user = 'Create a bracket.'): ChatCompletionRequest {
  return {
    task: 'cad-plan',
    messages: [
      { role: 'system', content: 'Stable NexyFab engineering contract.' },
      { role: 'user', content: user },
    ],
    maxTokens: 900,
    temperature: 0.1,
  };
}

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
  vi.unstubAllGlobals();
});

describe('provider-native prompt cache contracts', () => {
  it('marks only a sufficiently long stable Qwen system prefix', () => {
    const stablePrefix = `Stable NexyFab engineering contract. ${'x'.repeat(4_100)}`;
    const req = request();
    req.messages[0] = { role: 'system', content: stablePrefix };
    const body = buildQwenChatBody(req, 'qwen3.7-plus') as { messages: Array<Record<string, unknown>> };
    expect(body.messages[0]).toEqual({
      role: 'system',
      content: [{ type: 'text', text: stablePrefix, cache_control: { type: 'ephemeral' } }],
    });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Create a bracket.' });
  });

  it('leaves a short Qwen prefix to provider automatic caching', () => {
    const req = request();
    const body = buildQwenChatBody(req, 'qwen3.7-plus') as { messages: Array<Record<string, unknown>> };
    expect(body.messages).toEqual(req.messages);
  });

  it('does not attach unsupported explicit markers to DashScope-hosted DeepSeek V4', () => {
    const req = request();
    req.messages[0] = { role: 'system', content: `Stable contract ${'x'.repeat(4_100)}` };
    const body = buildQwenChatBody(req, 'deepseek-v4-pro') as { messages: Array<Record<string, unknown>> };
    expect(body.messages).toEqual(req.messages);
  });

  it('accepts official China and Singapore Qwen endpoints and rejects arbitrary hosts', () => {
    expect(normalizeQwenBaseUrl('https://dashscope.aliyuncs.com/compatible-mode/v1/'))
      .toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
    expect(normalizeQwenBaseUrl('https://dashscope-intl.aliyuncs.com/compatible-mode/v1'))
      .toBe('https://dashscope-intl.aliyuncs.com/compatible-mode/v1');
    expect(() => normalizeQwenBaseUrl('https://example.com/v1')).toThrow(/official HTTPS/i);
  });

  it('keeps Claude dynamic messages outside the explicit system breakpoint', () => {
    const body = buildAnthropicMessagesBody(request(), 'claude-sonnet-4-6') as { system: unknown[]; messages: unknown[] };
    expect(body.system).toEqual([{
      type: 'text', text: 'Stable NexyFab engineering contract.', cache_control: { type: 'ephemeral' },
    }]);
    expect(body.messages).toEqual([{ role: 'user', content: 'Create a bracket.' }]);
  });

  it('preserves DeepSeek prefix order for its automatic cache', () => {
    const body = buildDeepSeekChatBody(request(), 'deepseek-chat') as { messages: unknown[] };
    expect(body.messages).toEqual(request().messages);
  });

  it('adds OpenRouter explicit markers only for documented model families', () => {
    const claude = buildOpenRouterChatBody(request(), 'anthropic/claude-sonnet-4.6') as { messages: Array<Record<string, unknown>> };
    const glm = buildOpenRouterChatBody(request(), 'z-ai/glm-5.2') as { messages: Array<Record<string, unknown>> };
    expect(Array.isArray(claude.messages[0].content)).toBe(true);
    expect(glm.messages[0]).toEqual(request().messages[0]);
  });

  it('creates and uses a Gemini cachedContents resource for a long stable prefix', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      calls.push({ url, body });
      if (url.includes('/cachedContents?')) {
        return new Response(JSON.stringify({
          name: 'cachedContents/nexyfab-test',
          expireTime: new Date(Date.now() + 3_000_000).toISOString(),
          usageMetadata: { totalTokenCount: 2200 },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 2300, candidatesTokenCount: 20, cachedContentTokenCount: 2200 },
      }), { status: 200 });
    }));

    const result = await geminiProvider.complete({
      ...request(),
      model: 'gemini-2.5-pro',
      messages: [
        { role: 'system', content: `Stable CAD corpus ${'x'.repeat(9_000)}` },
        { role: 'user', content: 'Create a bracket.' },
      ],
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain('/cachedContents?');
    expect(calls[1].body).toMatchObject({ cachedContent: 'cachedContents/nexyfab-test' });
    expect(calls[1].body).not.toHaveProperty('systemInstruction');
    expect(result).toMatchObject({
      cacheProfile: 'gemini-explicit', cachedPromptTokens: 2200, cacheWriteTokens: 2200, cacheMissTokens: 100,
    });
  });
});
