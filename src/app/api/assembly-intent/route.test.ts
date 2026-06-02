/**
 * /api/assembly-intent — pipeline tests.
 *
 * Coverage matrix:
 *   - regex hit short-circuits before any LLM call (call counter == 0)
 *   - regex miss + no env + no injection → source:'fallback', intent:unparsed
 *   - injected LLM returns valid AssemblyPlan JSON → source:'llm'
 *   - injected LLM returns invalid shape / unknown kind / wrong field types → fallback
 *   - injected LLM throws / aborts → fallback (never 5xx)
 *   - empty / whitespace / missing text → 400
 *   - text > 1000 chars → 413
 *   - malformed JSON body → 400
 *   - each AssemblyPlan kind round-trips through LLM validation
 *   - env-var resolution prefers NEXYFAB_ANTHROPIC_KEY over ANTHROPIC_API_KEY
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST, handleAssemblyIntent } from './route';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/assembly-intent', {
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

describe('POST /api/assembly-intent — regex path', () => {
  it('regex hit for "stacked 3" → source=regex', async () => {
    const r = await POST(makeReq({ text: '3 stacked' }) as never);
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.ok).toBe(true);
    expect(data.source).toBe('regex');
    expect(data.intent).toEqual({ kind: 'stacked', count: 3 });
  });

  it('regex hit for "2 x 3 grid" → source=regex', async () => {
    const r = await POST(makeReq({ text: '2 x 3 grid' }) as never);
    const data = await r.json();
    expect(data.source).toBe('regex');
    expect(data.intent).toEqual({ kind: 'grid', rows: 2, cols: 3 });
  });

  it('regex hit for "ring of 8 radius 25"', async () => {
    const r = await POST(makeReq({ text: 'ring of 8 radius 25' }) as never);
    const data = await r.json();
    expect(data.source).toBe('regex');
    expect(data.intent).toEqual({ kind: 'ring', count: 8, radius: 25 });
  });

  it('regex hit for "pair concentric"', async () => {
    const r = await POST(makeReq({ text: 'pair concentric' }) as never);
    const data = await r.json();
    expect(data.source).toBe('regex');
    expect(data.intent).toEqual({ kind: 'pair', mate: 'concentric' });
  });

  it('regex path does NOT invoke the LLM fetcher', async () => {
    const fetcher = vi.fn();
    const res = await handleAssemblyIntent(
      { text: '5 stacked plates' },
      { llmFetcher: fetcher },
    );
    expect(res.status).toBe(200);
    expect(res.payload.ok).toBe(true);
    expect(res.payload.ok && res.payload.source).toBe('regex');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('POST /api/assembly-intent — LLM fallback path', () => {
  it('regex miss + no env + no injection → source=fallback, intent.unparsed', async () => {
    const r = await POST(
      makeReq({ text: 'two shafts joined at the end' }) as never,
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.ok).toBe(true);
    expect(data.source).toBe('fallback');
    expect(data.intent).toEqual({ kind: 'unparsed' });
  });

  it('LLM returns valid stacked JSON → source=llm', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      kind: 'stacked',
      count: 7,
      spacing: 12,
    });
    const res = await handleAssemblyIntent(
      { text: 'seven plates on top of each other' },
      { llmFetcher: fetcher },
    );
    expect(res.payload.ok).toBe(true);
    if (!res.payload.ok) throw new Error('expected ok');
    expect(res.payload.source).toBe('llm');
    expect(res.payload.intent).toEqual({
      kind: 'stacked',
      count: 7,
      spacing: 12,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('LLM round-trips grid kind', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      kind: 'grid',
      rows: 4,
      cols: 5,
      spacing: 20,
    });
    const res = await handleAssemblyIntent(
      { text: 'four by five array of bolts spaced 20mm' },
      { llmFetcher: fetcher },
    );
    if (!res.payload.ok) throw new Error('expected ok');
    expect(res.payload.source).toBe('llm');
    expect(res.payload.intent).toEqual({
      kind: 'grid',
      rows: 4,
      cols: 5,
      spacing: 20,
    });
  });

  it('LLM round-trips ring kind', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      kind: 'ring',
      count: 6,
      radius: 30,
    });
    const res = await handleAssemblyIntent(
      { text: 'six bolts around a 30mm circle' },
      { llmFetcher: fetcher },
    );
    if (!res.payload.ok) throw new Error('expected ok');
    expect(res.payload.source).toBe('llm');
    expect(res.payload.intent).toEqual({
      kind: 'ring',
      count: 6,
      radius: 30,
    });
  });

  it('LLM round-trips pair kind', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      kind: 'pair',
      mate: 'hinge',
    });
    const res = await handleAssemblyIntent(
      { text: 'hinge two parts together' },
      { llmFetcher: fetcher },
    );
    if (!res.payload.ok) throw new Error('expected ok');
    expect(res.payload.source).toBe('llm');
    expect(res.payload.intent).toEqual({ kind: 'pair', mate: 'hinge' });
  });

  it('LLM returns no-kind JSON → source=fallback', async () => {
    const fetcher = vi.fn().mockResolvedValue({ foo: 'bar' });
    const res = await handleAssemblyIntent(
      { text: 'do something weird' },
      { llmFetcher: fetcher },
    );
    if (!res.payload.ok) throw new Error('expected ok');
    expect(res.payload.source).toBe('fallback');
    expect(res.payload.intent).toEqual({ kind: 'unparsed' });
  });

  it('LLM returns unknown kind → source=fallback', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      kind: 'spiral',
      count: 4,
    });
    const res = await handleAssemblyIntent(
      { text: 'arrange in a spiral' },
      { llmFetcher: fetcher },
    );
    if (!res.payload.ok) throw new Error('expected ok');
    expect(res.payload.source).toBe('fallback');
  });

  it('LLM returns pair with unknown mate → source=fallback', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      kind: 'pair',
      mate: 'distance',
    });
    const res = await handleAssemblyIntent(
      { text: 'pair distance constraint' },
      { llmFetcher: fetcher },
    );
    if (!res.payload.ok) throw new Error('expected ok');
    expect(res.payload.source).toBe('fallback');
  });

  it('LLM returns "null" sentinel → source=fallback', async () => {
    const fetcher = vi.fn().mockResolvedValue(null);
    const res = await handleAssemblyIntent(
      { text: 'gibberish prompt LLM punts on' },
      { llmFetcher: fetcher },
    );
    if (!res.payload.ok) throw new Error('expected ok');
    expect(res.payload.source).toBe('fallback');
    expect(res.payload.intent).toEqual({ kind: 'unparsed' });
  });

  it('LLM throws → source=fallback (never 5xx)', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('network down'));
    const res = await handleAssemblyIntent(
      { text: 'arbitrary unparseable assembly input' },
      { llmFetcher: fetcher },
    );
    expect(res.status).toBe(200);
    if (!res.payload.ok) throw new Error('expected ok');
    expect(res.payload.source).toBe('fallback');
  });

  it('LLM aborts (simulated timeout) → source=fallback + real AbortSignal passed', async () => {
    const fetcher = vi
      .fn()
      .mockImplementation((_text: string, _signal: AbortSignal) => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      });
    const res = await handleAssemblyIntent(
      { text: 'never-resolves prompt' },
      { llmFetcher: fetcher },
    );
    if (!res.payload.ok) throw new Error('expected ok');
    expect(res.payload.source).toBe('fallback');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const signal = fetcher.mock.calls[0]![1];
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('LLM stacked with count=0 (invalid) → source=fallback', async () => {
    const fetcher = vi.fn().mockResolvedValue({ kind: 'stacked', count: 0 });
    const res = await handleAssemblyIntent(
      { text: 'no parts please' },
      { llmFetcher: fetcher },
    );
    if (!res.payload.ok) throw new Error('expected ok');
    expect(res.payload.source).toBe('fallback');
  });
});

describe('POST /api/assembly-intent — validation errors', () => {
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

  it('malformed JSON body → 400 BAD_REQUEST', async () => {
    const r = await POST(
      new Request('http://localhost/api/assembly-intent', {
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

describe('POST /api/assembly-intent — env-var resolution', () => {
  it('NEXYFAB_ANTHROPIC_KEY preferred over ANTHROPIC_API_KEY', async () => {
    process.env.NEXYFAB_ANTHROPIC_KEY = 'nexyfab-key';
    process.env.ANTHROPIC_API_KEY = 'fallback-key';
    const realFetch = globalThis.fetch;
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      await POST(makeReq({ text: 'arbitrary new assembly concept' }) as never);
      const headers = fetchSpy.mock.calls[0]![1] as RequestInit;
      const apiKey = (headers.headers as Record<string, string>)['x-api-key'];
      expect(apiKey).toBe('nexyfab-key');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
