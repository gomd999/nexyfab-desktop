/**
 * brep-step endpoint — lossless STEP export of a live agent B-rep handle.
 * Mirrors brep-mesh's registry-mock pattern: stub getShape/exportOcctStep over a
 * tiny in-memory registry so the route logic is exercised without WASM.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/auth-middleware', () => ({
  getAuthUser: vi.fn(async () => ({ userId: 'test-user', email: 'test@x.com', orgIds: [] })),
}));

vi.mock('../../../../[lang]/shape-generator/features/occtEngine', () => {
  const registry = new Map<string, unknown>();
  return {
    getShape: (h: string | null | undefined) => (h ? registry.get(h) ?? null : null),
    exportOcctStep: async (h: string | null | undefined) => {
      const s = h ? registry.get(h) : null;
      if (!s) return null;
      const shape = s as { blobSTEP?: () => { text: () => Promise<string> } };
      if (typeof shape.blobSTEP !== 'function') return null;
      return shape.blobSTEP().text();
    },
    __register: (handle: string, shape: unknown) => registry.set(handle, shape),
    __reset: () => registry.clear(),
  };
});

import * as engine from '../../../../[lang]/shape-generator/features/occtEngine';

const mod = engine as unknown as {
  __register: (h: string, s: unknown) => void;
  __reset: () => void;
};

const STEP_TEXT = 'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;';
function brepShape(step = STEP_TEXT) {
  return { blobSTEP: () => ({ text: async () => step }) };
}

describe('GET /api/nexyfab/scad-agent/brep-step', () => {
  beforeEach(() => mod.__reset());

  async function GET(query: string) {
    const { GET: handler } = await import('../brep-step/route');
    const req = new Request(`http://test/api/nexyfab/scad-agent/brep-step?${query}`);
    return handler(req);
  }

  it('rejects missing handle (400)', async () => {
    const res = await GET('');
    expect(res.status).toBe(400);
    expect((await res.json()).ok).toBe(false);
  });

  it('returns 404 for an unknown handle', async () => {
    const res = await GET('handle=occt:999');
    expect(res.status).toBe(404);
  });

  it('returns 422 when the handle has no B-rep (not STEP-exportable)', async () => {
    mod.__register('occt:mesh-only', { mesh: () => ({ vertices: [], triangles: [] }) });
    const res = await GET('handle=occt:mesh-only');
    expect(res.status).toBe(422);
  });

  it('exports STEP for a live B-rep handle', async () => {
    mod.__register('occt:solid', brepShape());
    const res = await GET('handle=occt:solid');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.handle).toBe('occt:solid');
    expect(body.step.startsWith('ISO-10303-21')).toBe(true);
    expect(body.bytes).toBe(STEP_TEXT.length);
  });

  it('URL-encoded handle round-trips', async () => {
    mod.__register('occt:1', brepShape());
    const res = await GET('handle=occt%3A1');
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.handle).toBe('occt:1');
  });

  it('returns 500 if STEP export throws', async () => {
    mod.__register('occt:boom', { blobSTEP: () => { throw new Error('OCCT crash'); } });
    const res = await GET('handle=occt:boom');
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain('OCCT crash');
  });
});
