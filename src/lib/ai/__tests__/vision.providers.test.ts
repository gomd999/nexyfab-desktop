/**
 * Vision provider auto-selection + adapter dispatch (V3).
 *
 * We don't hit any real LLM here — `fetch` is stubbed per provider so we
 * verify the request shape (URL, headers, body envelope) each adapter
 * emits. That's the contract that breaks silently if a vendor changes
 * their API.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isVisionAvailable, visionCompletion, VisionNotConfiguredError } from '../vision';

const OG_ENV = { ...process.env };

function clearVisionEnv() {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.LOCAL_VISION_BASE_URL;
  delete process.env.LOCAL_VISION_MODEL;
  delete process.env.LOCAL_VISION_API_KEY;
  delete process.env.QWEN_API_KEY;
  delete process.env.DASHSCOPE_API_KEY;
  delete process.env.QWEN_BASE_URL;
}

function pngStub(): Uint8Array {
  // Tiny 1x1 PNG header bytes — content doesn't matter, base64 length does.
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function fetchOk(body: unknown) {
  return vi.fn(async (_url: string | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

beforeEach(() => {
  clearVisionEnv();
});

afterEach(() => {
  vi.useRealTimers();
  Object.assign(process.env, OG_ENV);
  vi.unstubAllGlobals();
});

describe('isVisionAvailable', () => {
  it('false when no provider keys set', () => {
    expect(isVisionAvailable()).toBe(false);
  });

  it('true when any supported provider key is set', () => {
    process.env.ANTHROPIC_API_KEY = 'k'; expect(isVisionAvailable()).toBe(true);
    clearVisionEnv();
    process.env.OPENAI_API_KEY = 'k'; expect(isVisionAvailable()).toBe(true);
    clearVisionEnv();
    process.env.GEMINI_API_KEY = 'k'; expect(isVisionAvailable()).toBe(true);
    clearVisionEnv();
    process.env.GOOGLE_API_KEY = 'k'; expect(isVisionAvailable()).toBe(true);
    clearVisionEnv();
    process.env.QWEN_API_KEY = 'k'; expect(isVisionAvailable()).toBe(true);
    clearVisionEnv();
    process.env.LOCAL_VISION_BASE_URL = 'http://localhost:11434/v1'; expect(isVisionAvailable()).toBe(true);
  });
});

describe('visionCompletion auto-select priority', () => {
  it('throws VisionNotConfiguredError when no provider available', async () => {
    await expect(visionCompletion({
      prompt: 'desc', images: [{ bytes: pngStub() }],
    })).rejects.toBeInstanceOf(VisionNotConfiguredError);
  });

  it('OpenAI Luna wins when multiple keys are present', async () => {
    process.env.ANTHROPIC_API_KEY = 'a';
    process.env.OPENAI_API_KEY = 'b';
    process.env.GEMINI_API_KEY = 'c';
    process.env.LOCAL_VISION_BASE_URL = 'http://localhost:11434/v1';
    const fetchSpy = fetchOk({
      choices: [{ message: { content: 'luna reply' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    vi.stubGlobal('fetch', fetchSpy);

    const r = await visionCompletion({ prompt: 'p', images: [{ bytes: pngStub() }] });
    expect(r.provider).toBe('openai');
    expect(r.model).toBe('gpt-5.6-luna');
    expect(fetchSpy.mock.calls[0][0]).toContain('api.openai.com');
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe('gpt-5.6-luna');
    expect(body.max_completion_tokens).toBe(600);
  });

  it('OpenAI Luna wins over Gemini / Local', async () => {
    process.env.GEMINI_API_KEY = 'g';
    process.env.OPENAI_API_KEY = 'o';
    process.env.LOCAL_VISION_BASE_URL = 'http://localhost:11434/v1';
    const fetchSpy = fetchOk({
      choices: [{ message: { content: 'luna reply' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    vi.stubGlobal('fetch', fetchSpy);

    const r = await visionCompletion({ prompt: 'p', images: [{ bytes: pngStub() }] });
    expect(r.provider).toBe('openai');
    expect(r.text).toBe('luna reply');
    expect(fetchSpy.mock.calls[0][0]).toContain('api.openai.com');
  });

  it('OpenAI wins over Local when no Anthropic / Gemini', async () => {
    process.env.OPENAI_API_KEY = 'o';
    process.env.LOCAL_VISION_BASE_URL = 'http://localhost:11434/v1';
    const fetchSpy = fetchOk({
      choices: [{ message: { content: 'openai reply' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    vi.stubGlobal('fetch', fetchSpy);

    const r = await visionCompletion({ prompt: 'p', images: [{ bytes: pngStub() }] });
    expect(r.provider).toBe('openai');
    expect(fetchSpy.mock.calls[0][0]).toContain('api.openai.com');
  });

  it('Local is last-resort fallback', async () => {
    process.env.LOCAL_VISION_BASE_URL = 'http://localhost:11434/v1';
    const fetchSpy = fetchOk({
      choices: [{ message: { content: 'local reply' } }],
    });
    vi.stubGlobal('fetch', fetchSpy);

    const r = await visionCompletion({ prompt: 'p', images: [{ bytes: pngStub() }] });
    expect(r.provider).toBe('local');
    expect(fetchSpy.mock.calls[0][0]).toContain('localhost:11434/v1/chat/completions');
  });
});

describe('Adapter request shapes', () => {
  it('uses selected Qwen 3.8 Max native VL on the configured region endpoint', async () => {
    process.env.QWEN_API_KEY = 'q';
    process.env.QWEN_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
    process.env.OPENAI_API_KEY = 'o';
    const fetchSpy = fetchOk({
      choices: [{ message: { content: 'qwen vision' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 3 },
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await visionCompletion({
      prompt: 'analyze',
      images: [{ bytes: pngStub(), mimeType: 'image/png' }],
      selectedModel: { provider: 'qwen', model: 'qwen3.8-max' },
    });
    expect(result).toMatchObject({ provider: 'qwen', model: 'qwen3.8-max', visionAutoRouted: false });
    expect(fetchSpy.mock.calls[0][0]).toContain('dashscope-intl.aliyuncs.com');
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[1].content.some((part: { type: string }) => part.type === 'image_url')).toBe(true);
  });

  it('routes a selected text-only model visual stage to Luna', async () => {
    process.env.QWEN_API_KEY = 'q';
    process.env.OPENAI_API_KEY = 'o';
    const fetchSpy = fetchOk({ choices: [{ message: { content: 'luna vision' } }] });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await visionCompletion({
      prompt: 'analyze',
      images: [{ bytes: pngStub() }],
      selectedModel: { provider: 'qwen', model: 'qwen3.7-max' },
    });
    expect(result).toMatchObject({ provider: 'openai', model: 'gpt-5.6-luna', visionAutoRouted: true });
  });

  it('falls back to Luna only after a selected native VL model has transient failures', async () => {
    vi.useFakeTimers();
    process.env.QWEN_API_KEY = 'q';
    process.env.OPENAI_API_KEY = 'o';
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('dashscope')) {
        return new Response(JSON.stringify({ error: { message: 'temporarily unavailable' } }), { status: 503 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'luna fallback' } }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const pending = visionCompletion({
      prompt: 'analyze',
      images: [{ bytes: pngStub() }],
      selectedModel: { provider: 'qwen', model: 'qwen3.8-max' },
    });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({
      provider: 'openai',
      model: 'gpt-5.6-luna',
      visionAutoRouted: true,
      visionFallbackReason: 'selected_model_transient_failure',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it('Anthropic — sends image as base64 source block', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    const fetchSpy = fetchOk({ content: [{ type: 'text', text: 'ok' }] });
    vi.stubGlobal('fetch', fetchSpy);

    await visionCompletion({ prompt: 'analyze', images: [{ bytes: pngStub(), label: 'Iso' }] });
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0].role).toBe('user');
    const content = body.messages[0].content;
    expect(content[0]).toEqual({ type: 'text', text: 'Iso' });
    expect(content[1].type).toBe('image');
    expect(content[1].source.type).toBe('base64');
    expect(content[1].source.media_type).toBe('image/png');
  });

  it('Gemini — sends image as inline_data part', async () => {
    process.env.GEMINI_API_KEY = 'k';
    const fetchSpy = fetchOk({
      candidates: [{ content: { parts: [{ text: 'ok' }] } }],
    });
    vi.stubGlobal('fetch', fetchSpy);

    await visionCompletion({ prompt: 'analyze', images: [{ bytes: pngStub(), label: 'Iso' }] });
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('gemini-2.5-flash');
    expect(url).toContain('key=');
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.contents[0].role).toBe('user');
    const parts = body.contents[0].parts;
    expect(parts[0]).toEqual({ text: 'Iso' });
    expect(parts[1].inline_data.mime_type).toBe('image/png');
    expect(typeof parts[1].inline_data.data).toBe('string');
  });

  it('Local — sends image as data URI under image_url', async () => {
    process.env.LOCAL_VISION_BASE_URL = 'http://localhost:11434/v1';
    process.env.LOCAL_VISION_MODEL = 'llama3.2-vision';
    const fetchSpy = fetchOk({ choices: [{ message: { content: 'ok' } }] });
    vi.stubGlobal('fetch', fetchSpy);

    await visionCompletion({ prompt: 'analyze', images: [{ bytes: pngStub() }] });
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe('llama3.2-vision');
    const content = body.messages[0].content;
    const imgPart = content.find((c: { type: string }) => c.type === 'image_url');
    expect(imgPart.image_url.url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('Multiple images all attach in order', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    const fetchSpy = fetchOk({ content: [{ type: 'text', text: 'ok' }] });
    vi.stubGlobal('fetch', fetchSpy);

    await visionCompletion({
      prompt: 'compare',
      images: [
        { bytes: pngStub(), label: 'Front' },
        { bytes: pngStub(), label: 'Side' },
        { bytes: pngStub(), label: 'Top' },
      ],
    });
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const content = body.messages[0].content;
    // 3 (text+image) pairs + final prompt = 7 entries
    expect(content.length).toBe(7);
    expect(content[0].text).toBe('Front');
    expect(content[2].text).toBe('Side');
    expect(content[4].text).toBe('Top');
  });

  it('Rejects empty images array', async () => {
    await expect(visionCompletion({ prompt: 'p', images: [] })).rejects.toThrow(/at least one image/i);
  });

  it('Rejects > 8 images for cost guard', async () => {
    const many = Array.from({ length: 9 }, () => ({ bytes: pngStub() }));
    await expect(visionCompletion({ prompt: 'p', images: many })).rejects.toThrow(/max 8/);
  });
});

describe('Explicit provider override', () => {
  it('honors provider:gemini even when Anthropic key is also set', async () => {
    process.env.ANTHROPIC_API_KEY = 'a';
    process.env.GEMINI_API_KEY = 'g';
    const fetchSpy = fetchOk({
      candidates: [{ content: { parts: [{ text: 'forced gemini' }] } }],
    });
    vi.stubGlobal('fetch', fetchSpy);

    const r = await visionCompletion({
      prompt: 'p', images: [{ bytes: pngStub() }],
      provider: 'gemini',
    });
    expect(r.provider).toBe('gemini');
  });
});
