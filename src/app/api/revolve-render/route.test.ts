/**
 * /api/revolve-render — request validation tests.
 *
 * Mirror of /api/extrude-render/route.test.ts. Covers validation paths
 * + pipeline-error response. Full openscad render path is covered by
 * the openscad-render module tests.
 */
import { describe, it, expect } from 'vitest';
import { POST } from './route';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/revolve-render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const rectSketch = {
  points: [
    { id: 'p1', x: 5, y: 0 },
    { id: 'p2', x: 20, y: 0 },
    { id: 'p3', x: 20, y: 10 },
    { id: 'p4', x: 5, y: 10 },
  ],
  lines: [
    { id: 'l1', p1: 'p1', p2: 'p2' },
    { id: 'l2', p1: 'p2', p2: 'p3' },
    { id: 'l3', p1: 'p3', p2: 'p4' },
    { id: 'l4', p1: 'p4', p2: 'p1' },
  ],
};
const yAxis = { a: { x: 0, y: 0 }, b: { x: 0, y: 10 } };

describe('POST /api/revolve-render — validation', () => {
  it('rejects malformed JSON body', async () => {
    const r = await POST(new Request('http://localhost/api/revolve-render', {
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
    const r = await POST(makeReq({ axis: yAxis }) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
  });

  it('rejects body missing axis', async () => {
    const r = await POST(makeReq({ sketch: rectSketch }) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
    expect(data.message).toMatch(/axis/i);
  });

  it('rejects axis with coincident points', async () => {
    const r = await POST(
      makeReq({
        sketch: rectSketch,
        axis: { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
      }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
    expect(data.message).toMatch(/coincident/i);
  });

  it('rejects axis with non-finite coordinates', async () => {
    const r = await POST(
      makeReq({
        sketch: rectSketch,
        axis: { a: { x: 0, y: 0 }, b: { x: 'foo', y: 1 } },
      }) as never,
    );
    expect(r.status).toBe(400);
  });

  it('rejects empty sketch', async () => {
    const r = await POST(
      makeReq({ sketch: { points: [], lines: [] }, axis: yAxis }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('EMPTY_SKETCH');
  });

  it('rejects sketch with too many points', async () => {
    const points = Array.from({ length: 5001 }, (_, i) => ({ id: `p${i}`, x: i, y: 0 }));
    const r = await POST(makeReq({ sketch: { points, lines: [] }, axis: yAxis }) as never);
    expect(r.status).toBe(413);
    const data = await r.json();
    expect(data.code).toBe('TOO_LARGE');
  });

  it('rejects angleDegrees out of range', async () => {
    const r1 = await POST(makeReq({ sketch: rectSketch, axis: yAxis, angleDegrees: 0 }) as never);
    expect(r1.status).toBe(400);
    const r2 = await POST(makeReq({ sketch: rectSketch, axis: yAxis, angleDegrees: 400 }) as never);
    expect(r2.status).toBe(400);
  });

  it('rejects invalid mode value', async () => {
    const r = await POST(
      makeReq({ sketch: rectSketch, axis: yAxis, mode: 'bogus' }) as never,
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
        axis: yAxis,
      }) as never,
    );
    expect(r.status).toBe(422);
    const data = await r.json();
    expect(data.code).toBe('PIPELINE_ERROR');
  });

  it('rejects profile that straddles the axis (pipeline error)', async () => {
    const r = await POST(
      makeReq({
        sketch: {
          points: [
            { id: 'p1', x: -5, y: 0 }, { id: 'p2', x: 5, y: 0 },
            { id: 'p3', x: 5, y: 10 }, { id: 'p4', x: -5, y: 10 },
          ],
          lines: [
            { id: 'l1', p1: 'p1', p2: 'p2' },
            { id: 'l2', p1: 'p2', p2: 'p3' },
            { id: 'l3', p1: 'p3', p2: 'p4' },
            { id: 'l4', p1: 'p4', p2: 'p1' },
          ],
        },
        axis: yAxis,
      }) as never,
    );
    expect(r.status).toBe(422);
    const data = await r.json();
    expect(data.code).toBe('PIPELINE_ERROR');
    expect(data.message).toMatch(/straddles/i);
  });

  it('valid revolve reaches the render step (openscad CLI not available → ENOENT 503)', async () => {
    const r = await POST(
      makeReq({ sketch: rectSketch, axis: yAxis, angleDegrees: 360 }) as never,
    );
    // In CI / production with the binary present: 200 + pngs[].
    // In local dev without it: 503 with code=ENOENT.
    if (r.status === 200) {
      const data = await r.json();
      expect(data.ok).toBe(true);
      expect(data.scad).toContain('rotate_extrude(');
      expect(Array.isArray(data.pngs)).toBe(true);
    } else {
      expect(r.status).toBe(503);
      const data = await r.json();
      expect(data.code).toBe('ENOENT');
    }
  });
});
