import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('drawing JSON Qwen routing', () => {
  it('routes governed qwen model IDs to the configured DashScope compatible endpoint', async () => {
    vi.stubEnv('QWEN_API_KEY', 'test-qwen-key');
    vi.stubEnv('QWEN_BASE_URL', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
      usage: { completion_tokens: 4, total_tokens: 12 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { callAiJson } = await import('./ai-json.mjs');
    const result = await callAiJson('return JSON', null, { models: ['qwen3.8-max'] });

    expect(result).toMatchObject({ data: { ok: true }, model: 'qwen3.8-max' });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-qwen-key');
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'qwen3.8-max',
      response_format: { type: 'json_object' },
    });
  });

  it('does not misroute qwen models through Gemini', async () => {
    vi.stubEnv('QWEN_API_KEY', 'test-qwen-key');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"provider":"qwen"}' }, finish_reason: 'stop' }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { callAiJson } = await import('./ai-json.mjs');
    await callAiJson('return JSON', null, { models: ['qwen3.7-plus'] });

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(String(calls[0]?.[0])).toContain('aliyuncs.com/compatible-mode/v1/chat/completions');
    expect(String(calls[0]?.[0])).not.toContain('generativelanguage.googleapis.com');
  });
});
