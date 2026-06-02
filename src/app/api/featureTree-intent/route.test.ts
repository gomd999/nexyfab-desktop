/**
 * /api/featureTree-intent — pipeline tests for Phase 3.AI.API.
 *
 * Coverage matrix:
 *   - regex hit short-circuits before any LLM call (call counter == 0)
 *   - regex miss + no env + no injection → source:'fallback', intent:null
 *   - injected LLM returns valid PlanIntent JSON → source:'llm'
 *   - injected LLM returns "null" sentinel / invalid JSON / wrong kind → fallback
 *   - injected LLM throws or times out → fallback (never 5xx)
 *   - empty/whitespace text → 400
 *   - text > 1000 chars → 413
 *   - malformed JSON body → 400
 *   - each PlanIntent kind round-trips through LLM validation
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST, handleFeatureTreeIntent } from './route';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/featureTree-intent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Ensure env-var detection in tests is deterministic — clear any keys that
// may have leaked in from the shell before each test, restore after.
const ENV_KEYS = [
  'NEXYFAB_ANTHROPIC_KEY',
  'ANTHROPIC_API_KEY',
  'NEXYFAB_OPENAI_KEY',
  'OPENAI_API_KEY',
];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('POST /api/featureTree-intent — regex path', () => {
  it('hits regex for "box 50x50x30 with fillet 5"', async () => {
    const r = await POST(
      makeReq({ text: 'box 50x50x30 with fillet 5' }) as never,
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.ok).toBe(true);
    expect(data.source).toBe('regex');
    expect(data.intent.kind).toBe('create_box_with_fillet');
    expect(data.intent.size).toEqual({ x: 50, y: 50, z: 30 });
    expect(data.intent.filletRadius).toBe(5);
  });

  it('hits regex for "cylinder r 10 h 20"', async () => {
    const r = await POST(makeReq({ text: 'cylinder r 10 h 20' }) as never);
    const data = await r.json();
    expect(data.source).toBe('regex');
    expect(data.intent.kind).toBe('create_cylinder');
    expect(data.intent.radius).toBe(10);
    expect(data.intent.height).toBe(20);
  });

  it('regex path does NOT invoke the LLM fetcher', async () => {
    const fetcher = vi.fn();
    const res = await handleFeatureTreeIntent(
      { text: 'create a box 100x100x20 with hole diameter 10' },
      { llmFetcher: fetcher },
    );
    expect(res.status).toBe(200);
    expect(res.payload.ok).toBe(true);
    expect(res.payload.ok && res.payload.source).toBe('regex');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('POST /api/featureTree-intent — LLM fallback path', () => {
  it('regex miss + no env + no injection → source:"fallback", intent:null', async () => {
    const r = await POST(
      makeReq({ text: 'create a magical floating bridge' }) as never,
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.ok).toBe(true);
    expect(data.intent).toBeNull();
    expect(data.source).toBe('fallback');
  });

  it('LLM returns valid create_cylinder JSON → source:"llm"', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      kind: 'create_cylinder',
      radius: 25,
      height: 60,
    });
    const res = await handleFeatureTreeIntent(
      { text: 'a tall narrow column' },
      { llmFetcher: fetcher },
    );
    expect(res.payload.ok).toBe(true);
    if (!res.payload.ok) throw new Error('expected ok');
    expect(res.payload.source).toBe('llm');
    expect(res.payload.intent?.kind).toBe('create_cylinder');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('LLM returns invalid JSON shape (no kind) → source:"fallback"', async () => {
    const fetcher = vi.fn().mockResolvedValue({ foo: 'bar' });
    const res = await handleFeatureTreeIntent(
      { text: 'do something weird' },
      { llmFetcher: fetcher },
    );
    expect(res.payload.ok).toBe(true);
    if (!res.payload.ok) throw new Error('expected ok');
    expect(res.payload.source).toBe('fallback');
    expect(res.payload.intent).toBeNull();
  });

  it('LLM returns kind not in INTENT_KINDS → source:"fallback"', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      kind: 'create_torus',
      radius: 10,
    });
    const res = await handleFeatureTreeIntent(
      { text: 'make a donut' },
      { llmFetcher: fetcher },
    );
    expect(res.payload.ok).toBe(true);
    if (!res.payload.ok) throw new Error('expected ok');
    expect(res.payload.source).toBe('fallback');
  });

  it('LLM returns "null" (cannot understand) → source:"fallback"', async () => {
    const fetcher = vi.fn().mockResolvedValue(null);
    const res = await handleFeatureTreeIntent(
      { text: 'gibberish prompt that LLM punts on' },
      { llmFetcher: fetcher },
    );
    expect(res.payload.ok).toBe(true);
    if (!res.payload.ok) throw new Error('expected ok');
    expect(res.payload.source).toBe('fallback');
    expect(res.payload.intent).toBeNull();
  });

  it('LLM throws → source:"fallback" (never 5xx)', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network down'));
    const res = await handleFeatureTreeIntent(
      { text: 'arbitrary unparseable input' },
      { llmFetcher: fetcher },
    );
    expect(res.status).toBe(200);
    expect(res.payload.ok).toBe(true);
    if (!res.payload.ok) throw new Error('expected ok');
    expect(res.payload.source).toBe('fallback');
  });

  it('LLM honors abort signal (would time out in prod) → source:"fallback"', async () => {
    // Simulates the abort behaviour without waiting the full 10s production
    // window: fetcher aborts itself immediately, exactly how a timed-out
    // AbortSignal would surface to the underlying fetch().
    const fetcher = vi.fn().mockImplementation(
      (_text: string, _signal: AbortSignal) => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      },
    );
    const res = await handleFeatureTreeIntent(
      { text: 'never-resolves prompt' },
      { llmFetcher: fetcher },
    );
    expect(res.payload.ok).toBe(true);
    if (!res.payload.ok) throw new Error('expected ok');
    expect(res.payload.source).toBe('fallback');
    expect(fetcher).toHaveBeenCalledTimes(1);
    // Verify a real AbortSignal was passed (timeout enforcement seam).
    const signal = fetcher.mock.calls[0]![1];
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('LLM round-trips create_box_with_holes payload', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      kind: 'create_box_with_holes',
      size: { x: 80, y: 40, z: 10 },
      holes: [
        { x: 20, y: 20, diameter: 5 },
        { x: 60, y: 20, diameter: 5 },
      ],
    });
    const res = await handleFeatureTreeIntent(
      { text: 'rectangular base plate with two mounting holes' },
      { llmFetcher: fetcher },
    );
    expect(res.payload.ok).toBe(true);
    if (!res.payload.ok) throw new Error('expected ok');
    expect(res.payload.source).toBe('llm');
    if (res.payload.intent?.kind !== 'create_box_with_holes')
      throw new Error('expected create_box_with_holes');
    expect(res.payload.intent.holes).toHaveLength(2);
  });

  it('LLM round-trips add_fillet_to_last', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      kind: 'add_fillet_to_last',
      radius: 3,
    });
    const res = await handleFeatureTreeIntent(
      { text: 'soften the edges a little' },
      { llmFetcher: fetcher },
    );
    expect(res.payload.ok).toBe(true);
    if (!res.payload.ok) throw new Error('expected ok');
    expect(res.payload.source).toBe('llm');
    expect(res.payload.intent?.kind).toBe('add_fillet_to_last');
  });

  it('LLM round-trips create_assembly_stack with default spacing', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      kind: 'create_assembly_stack',
      partCount: 4,
      // spacing omitted — handler defaults to 10
    });
    const res = await handleFeatureTreeIntent(
      { text: 'four stacked plates' },
      { llmFetcher: fetcher },
    );
    expect(res.payload.ok).toBe(true);
    if (!res.payload.ok) throw new Error('expected ok');
    expect(res.payload.source).toBe('llm');
    if (res.payload.intent?.kind !== 'create_assembly_stack')
      throw new Error('expected create_assembly_stack');
    expect(res.payload.intent.partCount).toBe(4);
    expect(res.payload.intent.spacing).toBe(10);
  });
});

describe('POST /api/featureTree-intent — validation errors', () => {
  it('empty text → 400 BAD_REQUEST', async () => {
    const r = await POST(makeReq({ text: '' }) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.ok).toBe(false);
    expect(data.code).toBe('BAD_REQUEST');
  });

  it('whitespace-only text → 400 BAD_REQUEST', async () => {
    const r = await POST(makeReq({ text: '   \n\t  ' }) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
  });

  it('missing text field → 400 BAD_REQUEST', async () => {
    const r = await POST(makeReq({}) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
  });

  it('text > 1000 chars → 413 PAYLOAD_TOO_LARGE', async () => {
    const big = 'a'.repeat(1001);
    const r = await POST(makeReq({ text: big }) as never);
    expect(r.status).toBe(413);
    const data = await r.json();
    expect(data.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('text == 1000 chars → accepted (regex miss → fallback)', async () => {
    const big = 'b'.repeat(1000);
    const r = await POST(makeReq({ text: big }) as never);
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.ok).toBe(true);
    expect(data.source).toBe('fallback');
  });

  it('malformed JSON body → 400 BAD_REQUEST', async () => {
    const r = await POST(
      new Request('http://localhost/api/featureTree-intent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.ok).toBe(false);
    expect(data.code).toBe('BAD_REQUEST');
  });
});

describe('POST /api/featureTree-intent — env-var resolution', () => {
  it('regex miss + ANTHROPIC_API_KEY set + no injected fetcher → attempts LLM (anthropic)', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    // Stub global fetch to fail fast — we only need to prove the env-driven
    // bridge was attempted (and that handler falls back gracefully).
    const realFetch = globalThis.fetch;
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        new Response('boom', { status: 500 }),
      );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const r = await POST(
        makeReq({ text: 'a fanciful nonexistent shape' }) as never,
      );
      const data = await r.json();
      expect(data.ok).toBe(true);
      expect(data.source).toBe('fallback');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const url = fetchSpy.mock.calls[0]![0];
      expect(String(url)).toContain('anthropic.com');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('NEXYFAB_ANTHROPIC_KEY preferred over ANTHROPIC_API_KEY', async () => {
    process.env.NEXYFAB_ANTHROPIC_KEY = 'nexyfab-key';
    process.env.ANTHROPIC_API_KEY = 'fallback-key';
    const realFetch = globalThis.fetch;
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      await POST(makeReq({ text: 'arbitrary new shape concept' }) as never);
      const headers = fetchSpy.mock.calls[0]![1] as RequestInit;
      const apiKey = (headers.headers as Record<string, string>)['x-api-key'];
      expect(apiKey).toBe('nexyfab-key');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('OpenAI selected when only OpenAI keys present', async () => {
    process.env.NEXYFAB_OPENAI_KEY = 'openai-test-key';
    const realFetch = globalThis.fetch;
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      await POST(makeReq({ text: 'arbitrary new shape concept' }) as never);
      const url = fetchSpy.mock.calls[0]![0];
      expect(String(url)).toContain('openai.com');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
