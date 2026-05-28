/**
 * Tests for the W16 server-OCCT hook in applyBooleanAsync. Pure HTTP
 * boundary — fetch is mocked, no real worker reached. Verifies:
 *
 *   - Server path fires when serverOpts.jwtToken is set AND
 *     shouldUseServerBoolean(params) is true.
 *   - serverStepR2Key is stashed on the result geometry's userData.
 *   - 5xx / network errors fall back through to the worker/sync chain.
 *   - 400 errors propagate (params are bad — local would also fail).
 *   - Box tool (toolShape=0) skips the server entirely (no equivalent).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { applyBooleanAsync } from './boolean';

// Minimal 100×100×100 box geometry — large enough to trip
// shouldUseServerBoolean's volume threshold.
function bigHostGeometry(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(100, 100, 100);
}

function smallHostGeometry(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(10, 10, 10);
}

const baseParams = {
  operation: 1,    // subtract
  toolShape: 1,    // cylinder (maps to server toolShape=0)
  toolWidth: 20,   // diameter → radius 10
  toolHeight: 50,
  toolDepth: 50,
  posX: 0, posY: 0, posZ: 0,
  rotX: 0, rotY: 0, rotZ: 0,
  engine: 1,
};

const ORIGINAL_FETCH = globalThis.fetch;

function mockServerOk(): ReturnType<typeof vi.fn> {
  const stl = new Uint8Array(84); // minimal binary STL header + 0 tris
  stl[80] = 0; stl[81] = 0; stl[82] = 0; stl[83] = 0;
  // Trigger ASCII STL path so parseSTL emits a valid (empty) geometry.
  const ascii = 'solid empty\nendsolid empty\n';
  const asciiBuf = new TextEncoder().encode(ascii);

  return vi.fn().mockImplementation((url: string) => {
    if (typeof url === 'string' && url.endsWith('/occt/op/boolean')) {
      return Promise.resolve(new Response(
        JSON.stringify({
          stlR2Key: 'occt-ops/u1/boolean/abc.stl',
          stepR2Key: 'occt-ops/u1/boolean/abc.step',
          meta: { volume: 1e6, surface: 6e4, bbox: { min: [0,0,0], max: [10,10,10] }, triangles: 0, manifold: true },
          elapsedMs: 200,
          requestId: 'req-1',
        }),
        { status: 201 },
      ));
    }
    if (typeof url === 'string' && url.includes('/api/nexyfab/r2-fetch')) {
      return Promise.resolve(new Response(
        JSON.stringify({ signedUrl: 'https://r2.example/signed', expiresInSeconds: 300 }),
        { status: 200 },
      ));
    }
    if (typeof url === 'string' && url.includes('r2.example')) {
      return Promise.resolve(new Response(asciiBuf, { status: 200 }));
    }
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
}

beforeEach(() => {
  // each test installs its own
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('applyBooleanAsync — W16 server hook', () => {
  it('takes the server path when conditions are met', async () => {
    const fetchMock = mockServerOk();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const geo = bigHostGeometry();
    const result = await applyBooleanAsync(
      geo, baseParams, undefined,
      { jwtToken: 'jwt', baseUrl: 'https://worker.example' },
    );
    expect(result).toBeDefined();
    expect(result.userData.serverStepR2Key).toBe('occt-ops/u1/boolean/abc.step');
    // 3 fetches: worker op + r2-fetch sign + signed-url GET.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('skips server when no jwtToken provided', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    // No server opts → must NOT call fetch (worker fallback is sync
    // applyBooleanSync since no workerPerformCSG either).
    await applyBooleanAsync(bigHostGeometry(), baseParams);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips server for box tool (no server equivalent)', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const params = { ...baseParams, toolShape: 0 }; // box
    await applyBooleanAsync(
      bigHostGeometry(), params, undefined,
      { jwtToken: 'jwt', baseUrl: 'https://worker.example' },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips server below volume threshold (uses local sync)', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    // 10×10×10 = 1e3 mm³, well below 1e6 threshold. Use a small tool
    // that actually intersects so the local sync path produces a
    // non-empty result. The assertion under test is "fetch not called"
    // — the geometry shape doesn't matter.
    const params = { ...baseParams, toolWidth: 4, toolHeight: 10 };
    await applyBooleanAsync(
      smallHostGeometry(), params, undefined,
      { jwtToken: 'jwt', baseUrl: 'https://worker.example' },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forceServer=true bypasses the volume heuristic', async () => {
    const fetchMock = mockServerOk();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await applyBooleanAsync(
      smallHostGeometry(), baseParams, undefined,
      { jwtToken: 'jwt', baseUrl: 'https://worker.example', forceServer: true },
    );
    expect(fetchMock).toHaveBeenCalled();
  });

  it('falls back to local on 5xx server error', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'kernel crash' }), { status: 500 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    // Should not throw — falls back to sync (which builds a tool geo
    // and runs three-bvh-csg locally; that returns a valid geometry).
    const result = await applyBooleanAsync(
      bigHostGeometry(), baseParams, undefined,
      { jwtToken: 'jwt', baseUrl: 'https://worker.example' },
    );
    expect(result).toBeDefined();
  });

  it('throws on 400 server error (bad params)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid params: r out of range' }), { status: 400 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(applyBooleanAsync(
      bigHostGeometry(), baseParams, undefined,
      { jwtToken: 'jwt', baseUrl: 'https://worker.example' },
    )).rejects.toThrow(/invalid params/);
  });

  it('uses toolSourceR2Key when geometry.userData has it (W17 shape-vs-shape)', async () => {
    const fetchMock = mockServerOk();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const geo = bigHostGeometry();
    geo.userData.toolSourceR2Key = 'occt-ops/u1/extrude/tool.step';

    await applyBooleanAsync(
      geo,
      // toolShape still 1 (cylinder) — toServerParams must IGNORE
      // the primitive fields when toolSourceR2Key is on userData.
      baseParams,
      undefined,
      { jwtToken: 'jwt', baseUrl: 'https://worker.example' },
    );

    const opCall = fetchMock.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).endsWith('/occt/op/boolean'),
    );
    expect(opCall).toBeDefined();
    const body = JSON.parse((opCall![1] as RequestInit).body as string);
    expect(body.params.toolSourceR2Key).toBe('occt-ops/u1/extrude/tool.step');
    expect(body.params.toolShape).toBeUndefined();
    expect(body.params.r).toBeUndefined();
  });

  it('toolSourceR2Key path goes to server even with tiny host', async () => {
    // shouldUseServerBoolean returns true when toolSourceR2Key is
    // set regardless of host size — host=1e3 mm³ still gets routed.
    const fetchMock = mockServerOk();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const geo = smallHostGeometry();
    geo.userData.toolSourceR2Key = 'occt-ops/u1/extrude/tool.step';

    await applyBooleanAsync(
      geo, baseParams, undefined,
      { jwtToken: 'jwt', baseUrl: 'https://worker.example' },
    );

    expect(fetchMock).toHaveBeenCalled();
  });

  it('skips server when engine=0 (mesh-csg explicitly chosen)', async () => {
    // Server is OCCT — routing engine=0 there would override the
    // user's explicit "I want mesh-csg" choice. W17 bug fix.
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const params = { ...baseParams, engine: 0 };
    await applyBooleanAsync(
      bigHostGeometry(), params, undefined,
      { jwtToken: 'jwt', baseUrl: 'https://worker.example' },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses server when engine=1 (OCCT explicitly chosen)', async () => {
    const fetchMock = mockServerOk();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const params = { ...baseParams, engine: 1 };
    await applyBooleanAsync(
      bigHostGeometry(), params, undefined,
      { jwtToken: 'jwt', baseUrl: 'https://worker.example' },
    );
    expect(fetchMock).toHaveBeenCalled();
  });

  it('uses sourceR2Key when geometry.userData has serverStepR2Key (chained boolean)', async () => {
    // Previous server op stashed its STEP key. The next boolean
    // should chain via sourceR2Key, not round-trip through mesh bbox.
    // Pre-fix W17 toServerParams always emitted host:{w,h,d} regardless.
    const fetchMock = mockServerOk();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const geo = bigHostGeometry();
    geo.userData.serverStepR2Key = 'occt-ops/u1/extrude/prev.step';
    await applyBooleanAsync(
      geo, baseParams, undefined,
      { jwtToken: 'jwt', baseUrl: 'https://worker.example' },
    );
    const opCall = fetchMock.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).endsWith('/occt/op/boolean'),
    );
    expect(opCall).toBeDefined();
    const body = JSON.parse((opCall![1] as RequestInit).body as string);
    expect(body.params.sourceR2Key).toBe('occt-ops/u1/extrude/prev.step');
    expect(body.params.host).toBeUndefined();
  });

  it('chained host AND chained tool together → both R2 keys in body', async () => {
    const fetchMock = mockServerOk();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const geo = bigHostGeometry();
    geo.userData.serverStepR2Key = 'occt-ops/u1/extrude/host.step';
    geo.userData.toolSourceR2Key = 'occt-ops/u1/extrude/tool.step';
    await applyBooleanAsync(
      geo, baseParams, undefined,
      { jwtToken: 'jwt', baseUrl: 'https://worker.example' },
    );
    const opCall = fetchMock.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).endsWith('/occt/op/boolean'),
    );
    const body = JSON.parse((opCall![1] as RequestInit).body as string);
    expect(body.params.sourceR2Key).toBe('occt-ops/u1/extrude/host.step');
    expect(body.params.toolSourceR2Key).toBe('occt-ops/u1/extrude/tool.step');
    expect(body.params.host).toBeUndefined();
    expect(body.params.toolShape).toBeUndefined();
  });
});
