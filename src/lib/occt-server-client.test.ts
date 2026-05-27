/**
 * occt-server-client wrapper tests — pure HTTP boundary, no real WASM.
 * Validates request shape, response parsing, error mapping.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  serverBoolean,
  serverFillet,
  serverChamfer,
  serverShell,
  serverMirror,
  serverPattern,
  serverExtrude,
  serverRevolve,
  serverSweep,
  serverLoft,
  shouldUseServerBoolean,
  ServerOcctUnavailableError,
  SERVER_BOOLEAN_BBOX_VOLUME_THRESHOLD_MM3,
  fetchR2Bytes,
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

  it('sourceR2Key (chained input) → always true (unknown size)', () => {
    // Per W16 D1-2 — when the host comes from R2, we don't know its
    // bbox until the worker imports it. Default to server-side to
    // avoid the worst case where a huge imported shape blocks the tab.
    expect(shouldUseServerBoolean({
      sourceR2Key: 'occt-ops/u1/extrude/abc.step',
      toolShape: 0, r: 1,
    })).toBe(true);
  });

  it('toolSourceR2Key (W17 shape-vs-shape) → always true', () => {
    // Only the server has the kernel to do shape-vs-shape boolean —
    // primitive tool paths can't match an imported shape.
    expect(shouldUseServerBoolean({
      host: { w: 10, h: 10, d: 10 },
      toolSourceR2Key: 'occt-ops/u1/extrude/tool.step',
    })).toBe(true);
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

describe('fetchR2Bytes', () => {
  it('two-step: signs via main app, then fetches bytes from signedUrl', async () => {
    const stlBytes = new Uint8Array([0x73, 0x6f, 0x6c, 0x69, 0x64]); // "solid"
    const fetchMock = vi.fn()
      // 1st call — sign endpoint
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ signedUrl: 'https://r2.example/sig?x=1', expiresInSeconds: 300 }),
        { status: 200 },
      ))
      // 2nd call — direct R2 fetch
      .mockResolvedValueOnce(new Response(stlBytes.buffer, { status: 200 }));
    globalThis.fetch = fetchMock;

    const buf = await fetchR2Bytes('occt-ops/u1/boolean/x.stl', {
      jwtToken: 't', baseUrl: 'https://app.example',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstCall = fetchMock.mock.calls[0]!;
    expect(firstCall[0]).toBe('https://app.example/api/nexyfab/r2-fetch?key=occt-ops%2Fu1%2Fboolean%2Fx.stl');
    const firstHeaders = (firstCall[1] as RequestInit).headers as Record<string, string>;
    expect(firstHeaders['Authorization']).toBe('Bearer t');

    const secondCall = fetchMock.mock.calls[1]!;
    expect(secondCall[0]).toBe('https://r2.example/sig?x=1');
    // No auth header on R2 — the URL is already signed.
    expect((secondCall[1] as RequestInit | undefined)?.headers).toBeUndefined();

    expect(new Uint8Array(buf)).toEqual(stlBytes);
  });

  it('sign failure (403) maps to ServerOcctUnavailableError 403', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    );
    try {
      await fetchR2Bytes('occt-ops/other-user/x.stl', { jwtToken: 't', baseUrl: 'https://a' });
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ServerOcctUnavailableError);
      expect((e as ServerOcctUnavailableError).status).toBe(403);
    }
  });

  it('missing JWT → ServerOcctUnavailableError without making a request', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    await expect(
      fetchR2Bytes('occt-ops/u1/x.stl', { jwtToken: '', baseUrl: 'https://a' }),
    ).rejects.toBeInstanceOf(ServerOcctUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── W16: new op wrappers + chained input ──────────────────────────────────

const okResponse = (op: string): Response => new Response(
  JSON.stringify({
    stlR2Key: `occt-ops/u1/${op}/x.stl`,
    stepR2Key: `occt-ops/u1/${op}/x.step`,
    meta: { volume: 100, surface: 60, bbox: { min: [0,0,0], max: [10,10,10] }, triangles: 12, manifold: true },
    elapsedMs: 100,
    requestId: 'r',
  }),
  { status: 201 },
);

describe('serverBoolean — W16 chained input', () => {
  it('accepts sourceR2Key in body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('boolean'));
    globalThis.fetch = fetchMock;
    await serverBoolean(
      { sourceR2Key: 'occt-ops/u1/extrude/abc.step', toolShape: 0, r: 5 },
      { jwtToken: 't', baseUrl: 'https://w.x' },
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.params.sourceR2Key).toBe('occt-ops/u1/extrude/abc.step');
    expect(body.params.host).toBeUndefined();
  });
});

describe('serverBoolean — W17 shape-vs-shape (toolSourceR2Key)', () => {
  it('plumbs toolSourceR2Key through in the POST body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('boolean'));
    globalThis.fetch = fetchMock;
    await serverBoolean(
      {
        host: { w: 100, h: 100, d: 100 },
        toolSourceR2Key: 'occt-ops/u1/extrude/tool.step',
        type: 'cut',
      },
      { jwtToken: 't', baseUrl: 'https://w.x' },
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.params.toolSourceR2Key).toBe('occt-ops/u1/extrude/tool.step');
    // Caller chose R2 tool — primitive fields should NOT be set (the
    // worker rejects both-set with 400).
    expect(body.params.toolShape).toBeUndefined();
    expect(body.params.r).toBeUndefined();
  });

  it('full shape-vs-shape (host R2 + tool R2)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('boolean'));
    globalThis.fetch = fetchMock;
    await serverBoolean(
      {
        sourceR2Key: 'occt-ops/u1/extrude/host.step',
        toolSourceR2Key: 'occt-ops/u1/extrude/tool.step',
        type: 'cut',
      },
      { jwtToken: 't', baseUrl: 'https://w.x' },
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.params.sourceR2Key).toBeDefined();
    expect(body.params.toolSourceR2Key).toBeDefined();
    expect(body.params.host).toBeUndefined();
    expect(body.params.toolShape).toBeUndefined();
  });
});

describe('serverFillet', () => {
  it('POSTs to /occt/op/fillet with radius', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('fillet'));
    globalThis.fetch = fetchMock;
    const out = await serverFillet(
      { host: { w: 50, h: 50, d: 50 }, radius: 3, edges: 'vertical' },
      { jwtToken: 't', baseUrl: 'https://w.x' },
    );
    expect(fetchMock.mock.calls[0]![0]).toBe('https://w.x/occt/op/fillet');
    expect(out.stlR2Key).toContain('fillet');
  });
});

describe('serverChamfer', () => {
  it('POSTs to /occt/op/chamfer with distance', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('chamfer'));
    globalThis.fetch = fetchMock;
    const out = await serverChamfer(
      { sourceR2Key: 'occt-ops/u1/fillet/a.step', distance: 2 },
      { jwtToken: 't', baseUrl: 'https://w.x' },
    );
    expect(fetchMock.mock.calls[0]![0]).toBe('https://w.x/occt/op/chamfer');
    expect(out.stepR2Key).toContain('chamfer');
  });
});

describe('serverShell', () => {
  it('POSTs to /occt/op/shell with thickness', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('shell'));
    globalThis.fetch = fetchMock;
    await serverShell(
      { host: { w: 50, h: 50, d: 50 }, thickness: 2, openFace: 'top' },
      { jwtToken: 't', baseUrl: 'https://w.x' },
    );
    expect(fetchMock.mock.calls[0]![0]).toBe('https://w.x/occt/op/shell');
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.params.openFace).toBe('top');
  });
});

describe('serverMirror', () => {
  it('POSTs to /occt/op/mirror with plane', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('mirror'));
    globalThis.fetch = fetchMock;
    await serverMirror(
      { host: { w: 10, h: 10, d: 10 }, plane: 'XY' },
      { jwtToken: 't', baseUrl: 'https://w.x' },
    );
    expect(fetchMock.mock.calls[0]![0]).toBe('https://w.x/occt/op/mirror');
  });
});

describe('serverPattern', () => {
  it('POSTs linear pattern with count + spacing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('pattern'));
    globalThis.fetch = fetchMock;
    await serverPattern(
      { kind: 'linear', host: { w: 10, h: 10, d: 10 }, count: 4, spacing: 20, axis: 'X' },
      { jwtToken: 't', baseUrl: 'https://w.x' },
    );
    expect(fetchMock.mock.calls[0]![0]).toBe('https://w.x/occt/op/pattern');
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.params.kind).toBe('linear');
    expect(body.params.count).toBe(4);
  });

  it('POSTs circular pattern with totalAngleDeg', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('pattern'));
    globalThis.fetch = fetchMock;
    await serverPattern(
      { kind: 'circular', sourceR2Key: 'occt-ops/u1/extrude/x.step', count: 6, totalAngleDeg: 360, axis: 'Z' },
      { jwtToken: 't', baseUrl: 'https://w.x' },
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.params.kind).toBe('circular');
    expect(body.params.sourceR2Key).toBeDefined();
  });
});

describe('serverExtrude', () => {
  it('POSTs to /occt/op/extrude with rectangle profile', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('extrude'));
    globalThis.fetch = fetchMock;
    await serverExtrude(
      {
        profile: { kind: 'rectangle', width: 20, height2D: 10 },
        height: 5,
      },
      { jwtToken: 't', baseUrl: 'https://w.x' },
    );
    expect(fetchMock.mock.calls[0]![0]).toBe('https://w.x/occt/op/extrude');
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.params.profile.kind).toBe('rectangle');
    expect(body.params.height).toBe(5);
  });

  it('accepts svgPath profile with tolerance', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('extrude'));
    globalThis.fetch = fetchMock;
    await serverExtrude(
      {
        profile: { kind: 'svgPath', d: 'M 0,0 L 10,0 L 10,5 Z', tolerance: 0.05 },
        height: 3,
        plane: 'YZ',
      },
      { jwtToken: 't', baseUrl: 'https://w.x' },
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.params.profile.tolerance).toBe(0.05);
    expect(body.params.plane).toBe('YZ');
  });
});

describe('serverRevolve', () => {
  it('POSTs to /occt/op/revolve with circle profile and axis', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('revolve'));
    globalThis.fetch = fetchMock;
    await serverRevolve(
      {
        profile: { kind: 'circle', radius: 5 },
        axis: 'Y',
        angle: 360,
      },
      { jwtToken: 't', baseUrl: 'https://w.x' },
    );
    expect(fetchMock.mock.calls[0]![0]).toBe('https://w.x/occt/op/revolve');
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.params.axis).toBe('Y');
    expect(body.params.angle).toBe(360);
  });
});

describe('serverSweep', () => {
  it('POSTs to /occt/op/sweep with profile + path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('sweep'));
    globalThis.fetch = fetchMock;
    await serverSweep(
      {
        profile: { kind: 'circle', radius: 2 },
        path: [[0, 0, 0], [10, 0, 0], [10, 10, 0]],
      },
      { jwtToken: 't', baseUrl: 'https://w.x' },
    );
    expect(fetchMock.mock.calls[0]![0]).toBe('https://w.x/occt/op/sweep');
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.params.path).toHaveLength(3);
  });
});

describe('serverLoft', () => {
  it('POSTs to /occt/op/loft with ≥ 2 sections', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('loft'));
    globalThis.fetch = fetchMock;
    await serverLoft(
      {
        sections: [
          { profile: { kind: 'circle', radius: 5 }, offset: 0 },
          { profile: { kind: 'circle', radius: 3 }, offset: 10 },
        ],
      },
      { jwtToken: 't', baseUrl: 'https://w.x' },
    );
    expect(fetchMock.mock.calls[0]![0]).toBe('https://w.x/occt/op/loft');
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.params.sections).toHaveLength(2);
  });
});

describe('error mapping is shared across all ops', () => {
  it('serverFillet — 400 maps to ServerOcctUnavailableError status 400', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid params: radius out of range', requestId: 'r' }), { status: 400 }),
    );
    try {
      await serverFillet(
        { host: { w: 10, h: 10, d: 10 }, radius: 100 },
        { jwtToken: 't', baseUrl: 'https://w.x' },
      );
      throw new Error('expected throw');
    } catch (e) {
      expect((e as ServerOcctUnavailableError).status).toBe(400);
    }
  });

  it('serverPattern — network error wraps cleanly', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fetch failed'));
    try {
      await serverPattern(
        { kind: 'linear', host: { w: 10, h: 10, d: 10 }, count: 2, spacing: 10, axis: 'X' },
        { jwtToken: 't', baseUrl: 'https://w.x' },
      );
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ServerOcctUnavailableError);
    }
  });
});
