/**
 * /api/sweep-render — request validation tests.
 *
 * Mirror of /api/revolve-render/route.test.ts. Covers validation paths
 * + pipeline-error response. Full openscad render path is covered by
 * the openscad-render module tests.
 */
import { describe, it, expect } from 'vitest';
import { POST } from './route';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/sweep-render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const rectSketch = {
  points: [
    { id: 'p1', x: 0, y: 0 },
    { id: 'p2', x: 10, y: 0 },
    { id: 'p3', x: 10, y: 5 },
    { id: 'p4', x: 0, y: 5 },
  ],
  lines: [
    { id: 'l1', p1: 'p1', p2: 'p2' },
    { id: 'l2', p1: 'p2', p2: 'p3' },
    { id: 'l3', p1: 'p3', p2: 'p4' },
    { id: 'l4', p1: 'p4', p2: 'p1' },
  ],
};
const straightZ = [
  { x: 0, y: 0, z: 0 },
  { x: 0, y: 0, z: 50 },
];

describe('POST /api/sweep-render — validation', () => {
  it('rejects malformed JSON body', async () => {
    const r = await POST(new Request('http://localhost/api/sweep-render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    }) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.ok).toBe(false);
    expect(data.code).toBe('BAD_REQUEST');
  });

  it('rejects body missing sketch', async () => {
    const r = await POST(makeReq({ path: straightZ }) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
  });

  it('rejects body missing path', async () => {
    const r = await POST(makeReq({ sketch: rectSketch }) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
    expect(data.message).toMatch(/path/i);
  });

  it('rejects path with fewer than 2 points', async () => {
    const r = await POST(
      makeReq({ sketch: rectSketch, path: [{ x: 0, y: 0, z: 0 }] }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
    expect(data.message).toMatch(/at least 2/i);
  });

  it('rejects path with zero-length segments', async () => {
    const r = await POST(
      makeReq({
        sketch: rectSketch,
        path: [
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 0 },
        ],
      }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
    expect(data.message).toMatch(/zero-length/i);
  });

  it('rejects path with non-finite coordinates', async () => {
    const r = await POST(
      makeReq({
        sketch: rectSketch,
        path: [
          { x: 0, y: 0, z: 0 },
          { x: 'oops', y: 0, z: 10 },
        ],
      }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
    expect(data.message).toMatch(/finite/i);
  });

  it('rejects empty sketch', async () => {
    const r = await POST(
      makeReq({ sketch: { points: [], lines: [] }, path: straightZ }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('EMPTY_SKETCH');
  });

  it('rejects sketch with too many points', async () => {
    const points = Array.from({ length: 5001 }, (_, i) => ({ id: `p${i}`, x: i, y: 0 }));
    const r = await POST(makeReq({ sketch: { points, lines: [] }, path: straightZ }) as never);
    expect(r.status).toBe(413);
    const data = await r.json();
    expect(data.code).toBe('TOO_LARGE');
  });

  it('rejects sketch with too many lines', async () => {
    const lines = Array.from({ length: 5001 }, (_, i) => ({ id: `l${i}`, p1: 'p1', p2: 'p1' }));
    const r = await POST(makeReq({ sketch: { points: [], lines }, path: straightZ }) as never);
    expect(r.status).toBe(413);
    const data = await r.json();
    expect(data.code).toBe('TOO_LARGE');
  });

  it('rejects path with too many points', async () => {
    const path = Array.from({ length: 1001 }, (_, i) => ({ x: 0, y: 0, z: i }));
    const r = await POST(makeReq({ sketch: rectSketch, path }) as never);
    expect(r.status).toBe(413);
    const data = await r.json();
    expect(data.code).toBe('TOO_LARGE');
  });

  it('rejects invalid mode value', async () => {
    const r = await POST(
      makeReq({ sketch: rectSketch, path: straightZ, mode: 'bogus' }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.message).toMatch(/mode/i);
  });

  it('rejects sketch with no closed loop (pipeline error)', async () => {
    const r = await POST(
      makeReq({
        sketch: {
          points: [{ id: 'p1', x: 5, y: 0 }, { id: 'p2', x: 10, y: 0 }],
          lines: [{ id: 'l1', p1: 'p1', p2: 'p2' }],
        },
        path: straightZ,
      }) as never,
    );
    expect(r.status).toBe(422);
    const data = await r.json();
    expect(data.code).toBe('PIPELINE_ERROR');
  });

  it('valid sweep reaches the render step (openscad CLI not available → ENOENT 503)', async () => {
    const r = await POST(
      makeReq({ sketch: rectSketch, path: straightZ }) as never,
    );
    // In CI / production with the binary present: 200 + pngs[].
    // In local dev without it: 503 with code=ENOENT.
    if (r.status === 200) {
      const data = await r.json();
      expect(data.ok).toBe(true);
      expect(data.scad).toContain('path_sweep');
      expect(Array.isArray(data.pngs)).toBe(true);
    } else {
      expect(r.status).toBe(503);
      const data = await r.json();
      expect(data.code).toBe('ENOENT');
    }
  });
});
