/**
 * X1 — brep-mesh endpoint integration tests.
 *
 * The endpoint reads from the OCCT shape registry, so we register
 * stub shapes through occtEngine.registerShape(). The shapes only need
 * to satisfy the MeshShape interface — `mesh()` returning vertices and
 * triangles is enough for the route to succeed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// P2 — auth was added in Round 14; tests stub it as authenticated so
// the existing OCCT-registry behavior coverage stays intact.
vi.mock('@/lib/auth-middleware', () => ({
  getAuthUser: vi.fn(async () => ({ userId: 'test-user', email: 'test@x.com', orgIds: [] })),
}));

// occtEngine is heavy (loads replicad WASM); we mock it to a tiny
// in-memory registry for the test. The route imports getShape from
// the engine — replacing it isolates the route logic from WASM init.
vi.mock('../../../../[lang]/shape-generator/features/occtEngine', () => {
  const registry = new Map<string, unknown>();
  return {
    getShape: (h: string | null | undefined) => (h ? registry.get(h) ?? null : null),
    __register: (handle: string, shape: unknown) => registry.set(handle, shape),
    __reset: () => registry.clear(),
  };
});

import * as engine from '../../../../[lang]/shape-generator/features/occtEngine';
import { issueBrepHandleAccessToken } from '@/lib/ai/scad-agent/brepHandleAccessToken';

const mod = engine as unknown as {
  __register: (h: string, s: unknown) => void;
  __reset: () => void;
};

describe('GET /api/nexyfab/scad-agent/brep-mesh', () => {
  beforeEach(() => {
    mod.__reset();
    process.env.SCAD_AGENT_HANDLE_TOKEN_SECRET = 'brep-route-test-secret-0123456789';
  });
  afterEach(() => { delete process.env.SCAD_AGENT_HANDLE_TOKEN_SECRET; });

  async function GET(query: string, authorized = true) {
    const { GET: handler } = await import('../brep-mesh/route');
    const params = new URLSearchParams(query);
    const handle = params.get('handle');
    const headers = new Headers();
    if (authorized && handle) headers.set('x-nexyfab-brep-capability', issueBrepHandleAccessToken({ userId: 'test-user', handle }) ?? '');
    const req = new Request(`http://test/api/nexyfab/scad-agent/brep-mesh?${params.toString()}`, { headers });
    return handler(req);
  }

  it('rejects missing handle', async () => {
    const res = await GET('');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it('returns 404 for unknown handle', async () => {
    const res = await GET('handle=occt:999');
    expect(res.status).toBe(404);
  });

  it('holds a raw or missing capability instead of authorizing by handle alone', async () => {
    const res = await GET('handle=occt:999', false);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ status: 'HOLD', releaseReady: false });
  });

  it('returns 422 when handle has no mesh()', async () => {
    mod.__register('occt:no-mesh', { someOtherProp: 1 });
    const res = await GET('handle=occt:no-mesh');
    expect(res.status).toBe(422);
  });

  it('tessellates and returns mesh data', async () => {
    const meshFn = vi.fn(() => ({
      vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      triangles: [0, 1, 2],
    }));
    mod.__register('occt:tri', { mesh: meshFn });

    const res = await GET('handle=occt:tri');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.handle).toBe('occt:tri');
    expect(body.vertices).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(body.triangles).toEqual([0, 1, 2]);
    expect(meshFn).toHaveBeenCalledWith({ tolerance: 0.1, angularTolerance: 0.2 });
  });

  it('honors tolerance query param', async () => {
    const meshFn = vi.fn(() => ({ vertices: [], triangles: [] }));
    mod.__register('occt:t', { mesh: meshFn });
    await GET('handle=occt:t&tolerance=0.05');
    expect(meshFn).toHaveBeenCalledWith({ tolerance: 0.05, angularTolerance: 0.2 });
  });

  it('includes bbox when shape exposes boundingBox()', async () => {
    mod.__register('occt:bb', {
      mesh: () => ({ vertices: [], triangles: [] }),
      boundingBox: () => ({ min: [-5, -5, 0], max: [5, 5, 10] }),
    });
    const res = await GET('handle=occt:bb');
    const body = await res.json();
    expect(body.bbox).toEqual({ min: [-5, -5, 0], max: [5, 5, 10] });
  });

  it('returns null bbox if boundingBox throws', async () => {
    mod.__register('occt:bbthrow', {
      mesh: () => ({ vertices: [], triangles: [] }),
      boundingBox: () => { throw new Error('no bbox'); },
    });
    const res = await GET('handle=occt:bbthrow');
    const body = await res.json();
    expect(body.bbox).toBeNull();
  });

  it('returns 500 with error message if mesh() throws', async () => {
    mod.__register('occt:meshfail', {
      mesh: () => { throw new Error('OCCT crash'); },
    });
    const res = await GET('handle=occt:meshfail');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('OCCT crash');
  });

  it('URL-encoded handle round-trips correctly', async () => {
    mod.__register('occt:1', { mesh: () => ({ vertices: [1], triangles: [] }) });
    const res = await GET('handle=occt%3A1');
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.handle).toBe('occt:1');
  });
});
