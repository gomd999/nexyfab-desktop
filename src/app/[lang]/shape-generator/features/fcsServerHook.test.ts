/**
 * Server-fallback hook tests for fillet / chamfer / shell. Mirrors the
 * boolean coverage (PR #19) — verifies the helper integration but
 * doesn't exercise the underlying OCCT/mesh paths (those have their
 * own dedicated tests).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { applyFilletAsyncWithServer } from './fillet';
import { applyChamferAsyncWithServer } from './chamfer';
import { applyShellAsyncWithServer } from './shell';

const ORIGINAL_FETCH = globalThis.fetch;

function bigHostGeometry(): THREE.BufferGeometry {
  // 100×100×100 = 1e6 mm³ — meets shouldUseServerForHost threshold.
  return new THREE.BoxGeometry(100, 100, 100);
}

function smallHostGeometry(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(10, 10, 10);
}

function okResponse(op: string): Response {
  const asciiStl = new TextEncoder().encode('solid empty\nendsolid empty\n');
  // 3-step mock: op POST → r2-fetch sign → R2 GET
  return new Response(
    JSON.stringify({
      stlR2Key: `occt-ops/u1/${op}/x.stl`,
      stepR2Key: `occt-ops/u1/${op}/x.step`,
      meta: { volume: 1e6, surface: 6e4, bbox: { min: [0,0,0], max: [10,10,10] }, triangles: 0, manifold: true },
      elapsedMs: 100,
      requestId: 'r',
    }),
    { status: 201 },
  );
}

function mockHappyPath(op: string): ReturnType<typeof vi.fn> {
  const asciiStl = new TextEncoder().encode('solid empty\nendsolid empty\n');
  return vi.fn().mockImplementation((url: string) => {
    if (typeof url === 'string' && url.endsWith(`/occt/op/${op}`)) {
      return Promise.resolve(okResponse(op));
    }
    if (typeof url === 'string' && url.includes('/api/nexyfab/r2-fetch')) {
      return Promise.resolve(new Response(
        JSON.stringify({ signedUrl: 'https://r2.example/x', expiresInSeconds: 300 }),
        { status: 200 },
      ));
    }
    if (typeof url === 'string' && url.includes('r2.example')) {
      return Promise.resolve(new Response(asciiStl, { status: 200 }));
    }
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

// ─── fillet ─────────────────────────────────────────────────────────────────

describe('applyFilletAsyncWithServer', () => {
  it('takes server path with large host + jwt', async () => {
    const fetchMock = mockHappyPath('fillet');
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const geo = bigHostGeometry();
    const out = await applyFilletAsyncWithServer(
      geo, { radius: 3, segments: 3, engine: 1 },
      undefined,
      { jwtToken: 'jwt', baseUrl: 'https://worker.example' },
    );
    expect(out.userData.serverStepR2Key).toBe('occt-ops/u1/fillet/x.step');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('skips server when no jwtToken (no fetch)', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    // No serverOpts → no server fetch. The local path will then run
    // (which may fail without a real OCCT in tests). We catch any
    // failure to keep the assertion focused on "no server fetch".
    try {
      await applyFilletAsyncWithServer(
        smallHostGeometry(), { radius: 1, segments: 3, engine: 0 },
      );
    } catch { /* local path may fail in tests, irrelevant here */ }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses sourceR2Key when geometry has serverStepR2Key', async () => {
    const fetchMock = mockHappyPath('fillet');
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const geo = bigHostGeometry();
    geo.userData.serverStepR2Key = 'occt-ops/u1/boolean/prev.step';
    await applyFilletAsyncWithServer(
      geo, { radius: 3, segments: 3, engine: 1 },
      undefined,
      { jwtToken: 'jwt', baseUrl: 'https://worker.example' },
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.params.sourceR2Key).toBe('occt-ops/u1/boolean/prev.step');
    expect(body.params.host).toBeUndefined();
  });
});

// ─── chamfer ────────────────────────────────────────────────────────────────

describe('applyChamferAsyncWithServer', () => {
  it('takes server path with large host + jwt', async () => {
    const fetchMock = mockHappyPath('chamfer');
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const out = await applyChamferAsyncWithServer(
      bigHostGeometry(), { distance: 2, engine: 1 },
      undefined,
      { jwtToken: 'jwt', baseUrl: 'https://worker.example' },
    );
    expect(out.userData.serverStepR2Key).toBe('occt-ops/u1/chamfer/x.step');
  });
});

// ─── shell ──────────────────────────────────────────────────────────────────

describe('applyShellAsyncWithServer', () => {
  it('maps numeric openFace → worker enum string', async () => {
    const fetchMock = mockHappyPath('shell');
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await applyShellAsyncWithServer(
      bigHostGeometry(),
      { wallThickness: 2, openFace: 2, engine: 1 }, // 2 → 'front'
      undefined,
      { jwtToken: 'jwt', baseUrl: 'https://worker.example' },
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.params.openFace).toBe('front');
    expect(body.params.thickness).toBe(2);
  });

  it('defaults to top when openFace is undefined', async () => {
    const fetchMock = mockHappyPath('shell');
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await applyShellAsyncWithServer(
      bigHostGeometry(),
      { wallThickness: 2, engine: 1 },
      undefined,
      { jwtToken: 'jwt', baseUrl: 'https://worker.example' },
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.params.openFace).toBe('top');
  });
});
