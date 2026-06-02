/**
 * /api/shell-render — request validation tests (Phase 2.4).
 *
 * Mirror of /api/sweep-render/route.test.ts. Covers validation paths
 * + pipeline-error response. Full openscad render path is covered by
 * the openscad-render module tests.
 */
import { describe, it, expect } from 'vitest';
import { POST } from './route';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/shell-render', {
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

describe('POST /api/shell-render — validation', () => {
  it('rejects malformed JSON body', async () => {
    const r = await POST(
      new Request('http://localhost/api/shell-render', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.ok).toBe(false);
    expect(data.code).toBe('BAD_REQUEST');
  });

  it('rejects body missing sketch', async () => {
    const r = await POST(makeReq({ depth: 20, thickness: 1 }) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
  });

  it('rejects body with non-positive depth', async () => {
    const r = await POST(makeReq({ sketch: rectSketch, depth: 0, thickness: 1 }) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
    expect(data.message).toMatch(/depth/);
  });

  it('rejects body with missing/zero thickness', async () => {
    const r = await POST(makeReq({ sketch: rectSketch, depth: 20 }) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
    expect(data.message).toMatch(/thickness/);
  });

  it('rejects thickness ≥ depth/3 (safety guard)', async () => {
    // depth=10 → depth/3 ≈ 3.33; thickness 4 must fail.
    const r = await POST(
      makeReq({ sketch: rectSketch, depth: 10, thickness: 4 }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
    expect(data.message).toMatch(/depth\/3/);
  });

  it('rejects empty sketch (no points/lines)', async () => {
    const r = await POST(
      makeReq({ sketch: { points: [], lines: [] }, depth: 20, thickness: 1 }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('EMPTY_SKETCH');
  });

  it('rejects sketch with too many points', async () => {
    const points = Array.from({ length: 5001 }, (_, i) => ({ id: `p${i}`, x: i, y: 0 }));
    const r = await POST(
      makeReq({ sketch: { points, lines: [] }, depth: 20, thickness: 1 }) as never,
    );
    expect(r.status).toBe(413);
    const data = await r.json();
    expect(data.code).toBe('TOO_LARGE');
  });

  it('rejects depth exceeding cap', async () => {
    const r = await POST(
      makeReq({ sketch: rectSketch, depth: 999999, thickness: 1 }) as never,
    );
    expect(r.status).toBe(400);
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
      makeReq({ sketch: triangleSketch, depth: 20, thickness: 1 }) as never,
    );
    expect(r.status).toBe(422);
    const data = await r.json();
    expect(data.code).toBe('PIPELINE_ERROR');
    expect(data.message).toMatch(/(Phase 1|rectangle|4 corners)/i);
  });

  it('valid rect shell reaches the render step (openscad CLI not available → ENOENT 503)', async () => {
    // No openscad binary in vitest env → renderScadToPng returns ENOENT.
    // Verifies the full pipeline ran through validation + shellFromSketch
    // + attempted CLI call before bouncing off the missing binary.
    const r = await POST(
      makeReq({
        sketch: rectSketch,
        depth: 20,
        thickness: 1,
        openTop: true,
      }) as never,
    );
    // In CI / production with the binary present: 200 + pngs[].
    // In local dev without it: 503 with code=ENOENT.
    if (r.status === 200) {
      const data = await r.json();
      expect(data.ok).toBe(true);
      expect(data.scad).toContain('difference()');
      expect(Array.isArray(data.pngs)).toBe(true);
    } else {
      expect(r.status).toBe(503);
      const data = await r.json();
      expect(data.code).toBe('ENOENT');
    }
  });
});
