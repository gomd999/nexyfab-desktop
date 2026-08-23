/**
 * /api/extrude-render — request validation tests.
 *
 * Skips actual openscad CLI invocation (that requires the binary) — these
 * tests cover the request-validation paths + pipeline-error response.
 * Full render path is covered by the openscad-render module tests.
 */
import { describe, it, expect } from 'vitest';
import { POST } from './route';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/extrude-render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/extrude-render - bounded JSON ingress', () => {
  it('rejects a declared body beyond the geometry envelope', async () => {
    const r = await POST(new Request('http://localhost/api/extrude-render', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(4 * 1024 * 1024 + 1) },
      body: '{}',
    }) as never);
    expect(r.status).toBe(413);
    await expect(r.json()).resolves.toMatchObject({ ok: false, code: 'TOO_LARGE' });
  });
});

describe('POST /api/extrude-render — validation', () => {
  it('rejects malformed JSON body', async () => {
    const r = await POST(new Request('http://localhost/api/extrude-render', {
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
    const r = await POST(makeReq({ depth: 5 }) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
  });

  it('rejects body with non-positive depth', async () => {
    const r = await POST(
      makeReq({ sketch: { points: [{ id: 'p1', x: 0, y: 0 }], lines: [] }, depth: 0 }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
  });

  it('rejects empty sketch (no points/lines)', async () => {
    const r = await POST(
      makeReq({ sketch: { points: [], lines: [] }, depth: 5 }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('EMPTY_SKETCH');
  });

  it('rejects sketch with too many points', async () => {
    const points = Array.from({ length: 5001 }, (_, i) => ({ id: `p${i}`, x: i, y: 0 }));
    const r = await POST(makeReq({ sketch: { points, lines: [] }, depth: 5 }) as never);
    expect(r.status).toBe(413);
    const data = await r.json();
    expect(data.code).toBe('TOO_LARGE');
  });

  it('rejects sketch with no closed loop (pipeline error)', async () => {
    const r = await POST(
      makeReq({
        sketch: {
          points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }],
          lines: [{ id: 'l1', p1: 'p1', p2: 'p2' }],
        },
        depth: 5,
      }) as never,
    );
    expect(r.status).toBe(422);
    const data = await r.json();
    expect(data.code).toBe('PIPELINE_ERROR');
    expect(data.message).toMatch(/dangling/i);
  });

  it('rejects depth exceeding cap', async () => {
    const r = await POST(
      makeReq({ sketch: { points: [{ id: 'p', x: 0, y: 0 }], lines: [] }, depth: 999999 }) as never,
    );
    expect(r.status).toBe(400);
  });

  it('valid rect sketch reaches the render step (openscad CLI not available → ENOENT 503)', async () => {
    // No openscad binary in vitest env → renderScadToPng returns ENOENT.
    // Verifies the full pipeline ran through validation + extrudeFromSketch
    // + attempted CLI call before bouncing off the missing binary.
    const r = await POST(
      makeReq({
        sketch: {
          points: [
            { id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 },
            { id: 'p3', x: 10, y: 5 }, { id: 'p4', x: 0, y: 5 },
          ],
          lines: [
            { id: 'l1', p1: 'p1', p2: 'p2' },
            { id: 'l2', p1: 'p2', p2: 'p3' },
            { id: 'l3', p1: 'p3', p2: 'p4' },
            { id: 'l4', p1: 'p4', p2: 'p1' },
          ],
        },
        depth: 7,
      }) as never,
    );
    // In CI / production with the binary present: 200 + pngs[].
    // In local dev without it: 503 with code=ENOENT.
    if (r.status === 200) {
      const data = await r.json();
      expect(data.ok).toBe(true);
      expect(data.scad).toContain('linear_extrude(height=7');
      expect(Array.isArray(data.pngs)).toBe(true);
    } else {
      expect(r.status).toBe(503);
      const data = await r.json();
      expect(data.code).toBe('ENOENT');
    }
  });
});
