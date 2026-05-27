/**
 * occt-server-client wrapper tests — pure HTTP boundary, no real WASM.
 * Validates request shape, response parsing, error mapping.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  serverBoolean,
  shouldUseServerBoolean,
  ServerOcctUnavailableError,
  SERVER_BOOLEAN_BBOX_VOLUME_THRESHOLD_MM3,
} from './occt-server-client';

// Reset fetch between tests so one mock doesn't bleed into the next.
const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  // Each test sets its own fetch mock.
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('shouldUseServerBoolean', () => {
  it('false for small geometry (< threshold)', () => {
    expect(shouldUseServerBoolean({
      host: { w: 10, h: 10, d: 10 }, // 1e3 mm³
      toolShape: 0, r: 1,
    })).toBe(false);
  });

  it('true when bbox volume crosses threshold', () => {
    // 100×100×100 = 1e6 — exactly at threshold, must return true.
    expect(shouldUseServerBoolean({
      host: { w: 100, h: 100, d: 100 },
      toolShape: 0, r: 5,
    })).toBe(true);
  });

  it('threshold sanity', () => {
    expect(SERVER_BOOLEAN_BBOX_VOLUME_THRESHOLD_MM3).toBe(1_000_000);
  });
});

describe('serverBoolean — request shape', () => {
  it('sends POST with bearer + JSON body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        stlR2Key: 'occt-ops/u1/boolean/t-x.stl',
        stepR2Key: 'occt-ops/u1/boolean/t-x.step',
        meta: { volume: 1000, surface: 600, bbox: { min: [0,0,0], max: [10,10,10] }, triangles: 12, manifold: true },
        elapsedMs: 250,
        requestId: 'req-1',
      }), { status: 201 }),
    );
    globalThis.fetch = fetchMock;

    const out = await serverBoolean(
      { host: { w: 100, h: 100, d: 100 }, toolShape: 0, r: 10 },
      { jwtToken: 'test-token', baseUrl: 'https://worker.example.com' },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://worker.example.com/occt/op/boolean');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-token');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.params.host).toEqual({ w: 100, h: 100, d: 100 });
    expect(body.params.toolShape).toBe(0);
    expect(body.params.r).toBe(10);

    expect(out.stlR2Key).toContain('boolean');
    expect(out.meta.triangles).toBe(12);
  });

  it('strips trailing slash on baseUrl', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        stlR2Key: 'k.stl', stepR2Key: 'k.step',
        meta: { volume: 0, surface: 0, bbox: { min: [0,0,0], max: [0,0,0] }, triangles: 0, manifold: false },
        elapsedMs: 0, requestId: 'r',
      }), { status: 201 }),
    );
    globalThis.fetch = fetchMock;

    await serverBoolean(
      { host: { w: 10, h: 10, d: 10 }, toolShape: 0, r: 1 },
      { jwtToken: 't', baseUrl: 'https://worker.example.com/' },
    );
    expect(fetchMock.mock.calls[0]![0]).toBe('https://worker.example.com/occt/op/boolean');
  });
});

describe('serverBoolean — error mapping', () => {
  it('throws ServerOcctUnavailableError when baseUrl missing', async () => {
    await expect(
      serverBoolean(
        { host: { w: 10, h: 10, d: 10 }, toolShape: 0, r: 1 },
        { jwtToken: 't', baseUrl: '' },
      ),
    ).rejects.toBeInstanceOf(ServerOcctUnavailableError);
  });

  it('throws when JWT missing', async () => {
    await expect(
      serverBoolean(
        { host: { w: 10, h: 10, d: 10 }, toolShape: 0, r: 1 },
        { jwtToken: '', baseUrl: 'https://worker.example.com' },
      ),
    ).rejects.toBeInstanceOf(ServerOcctUnavailableError);
  });

  it('400 → ServerOcctUnavailableError with status 400 (no retry)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid params: r out of range', requestId: 'r' }), { status: 400 }),
    );
    try {
      await serverBoolean(
        { host: { w: 10, h: 10, d: 10 }, toolShape: 0, r: 1 },
        { jwtToken: 't', baseUrl: 'https://w.x' },
      );
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ServerOcctUnavailableError);
      expect((e as ServerOcctUnavailableError).status).toBe(400);
    }
  });

  it('401 → status 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    try {
      await serverBoolean(
        { host: { w: 10, h: 10, d: 10 }, toolShape: 0, r: 1 },
        { jwtToken: 't', baseUrl: 'https://w.x' },
      );
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ServerOcctUnavailableError).status).toBe(401);
    }
  });

  it('501 → status 501 (server op not implemented)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'not implemented' }), { status: 501 }),
    );
    try {
      await serverBoolean(
        { host: { w: 10, h: 10, d: 10 }, toolShape: 0, r: 1 },
        { jwtToken: 't', baseUrl: 'https://w.x' },
      );
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ServerOcctUnavailableError).status).toBe(501);
    }
  });

  it('500 → generic server error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'OCCT kernel crashed' }), { status: 500 }),
    );
    try {
      await serverBoolean(
        { host: { w: 10, h: 10, d: 10 }, toolShape: 0, r: 1 },
        { jwtToken: 't', baseUrl: 'https://w.x' },
      );
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ServerOcctUnavailableError).status).toBe(500);
      expect((e as Error).message).toContain('OCCT kernel crashed');
    }
  });

  it('network error → wraps as ServerOcctUnavailableError', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fetch failed'));
    try {
      await serverBoolean(
        { host: { w: 10, h: 10, d: 10 }, toolShape: 0, r: 1 },
        { jwtToken: 't', baseUrl: 'https://w.x' },
      );
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ServerOcctUnavailableError);
      expect((e as Error).message).toContain('fetch failed');
    }
  });
});
