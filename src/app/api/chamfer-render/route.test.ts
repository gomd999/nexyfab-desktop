/**
 * /api/chamfer-render — request validation tests (Phase 2.2).
 *
 * Mirror of /api/fillet-render/route.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { POST } from './route';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/chamfer-render', {
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

describe('POST /api/chamfer-render — validation', () => {
  it('rejects malformed JSON body', async () => {
    const r = await POST(
      new Request('http://localhost/api/chamfer-render', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
  });

  it('rejects body missing sketch', async () => {
    const r = await POST(makeReq({ depth: 20, distance: 1 }) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
  });

  it('rejects body with non-positive depth', async () => {
    const r = await POST(makeReq({ sketch: rectSketch, depth: 0, distance: 1 }) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.message).toMatch(/depth/);
  });

  it('rejects body with missing/zero distance', async () => {
    const r = await POST(makeReq({ sketch: rectSketch, depth: 20 }) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.message).toMatch(/distance/);
  });

  it('rejects unknown edgeSelection', async () => {
    const r = await POST(
      makeReq({
        sketch: rectSketch,
        depth: 20,
        distance: 1,
        edgeSelection: 'middle',
      }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.message).toMatch(/edgeSelection/);
  });

  it('rejects distance ≥ depth/3 when edgeSelection touches top/bottom', async () => {
    const r = await POST(
      makeReq({
        sketch: rectSketch,
        depth: 10,
        distance: 4,
        edgeSelection: 'all',
      }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.message).toMatch(/depth\/3/);
  });

  it('allows distance ≥ depth/3 when edgeSelection is vertical only', async () => {
    const r = await POST(
      makeReq({
        sketch: rectSketch,
        depth: 10,
        distance: 4,
        edgeSelection: 'vertical',
      }) as never,
    );
    expect(r.status).not.toBe(400);
  });

  it('rejects empty sketch (no points/lines)', async () => {
    const r = await POST(
      makeReq({ sketch: { points: [], lines: [] }, depth: 20, distance: 1 }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('EMPTY_SKETCH');
  });

  it('rejects sketch with too many points', async () => {
    const points = Array.from({ length: 5001 }, (_, i) => ({ id: `p${i}`, x: i, y: 0 }));
    const r = await POST(
      makeReq({ sketch: { points, lines: [] }, depth: 20, distance: 1 }) as never,
    );
    expect(r.status).toBe(413);
    const data = await r.json();
    expect(data.code).toBe('TOO_LARGE');
  });

  it('rejects non-rect profile via pipeline error (Phase 1)', async () => {
    const triangleSketch = {
      points: [
        { id: 'p1', x: 0, y: 0 },
        { id: 'p2', x: 10, y: 0 },
        { id: 'p3', x: 5, y: 5 },
      ],
      lines: [
        { id: 'l1', p1: 'p1', p2: 'p2' },
        { id: 'l2', p1: 'p2', p2: 'p3' },
        { id: 'l3', p1: 'p3', p2: 'p1' },
      ],
    };
    const r = await POST(
      makeReq({ sketch: triangleSketch, depth: 20, distance: 1 }) as never,
    );
    expect(r.status).toBe(422);
    const data = await r.json();
    expect(data.code).toBe('PIPELINE_ERROR');
    expect(data.message).toMatch(/(Phase 1|rectangle|4 corners)/i);
  });

  it('valid rect chamfer reaches the render step (openscad CLI not available → ENOENT 503)', async () => {
    const r = await POST(
      makeReq({
        sketch: rectSketch,
        depth: 20,
        distance: 1,
        edgeSelection: 'all',
      }) as never,
    );
    if (r.status === 200) {
      const data = await r.json();
      expect(data.ok).toBe(true);
      expect(data.scad).toContain('minkowski()');
      expect(Array.isArray(data.pngs)).toBe(true);
    } else {
      expect(r.status).toBe(503);
      const data = await r.json();
      expect(data.code).toBe('ENOENT');
    }
  });
});
