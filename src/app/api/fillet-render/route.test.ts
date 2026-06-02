/**
 * /api/fillet-render — request validation tests (Phase 2.2).
 *
 * Mirror of /api/shell-render/route.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { POST } from './route';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/fillet-render', {
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

describe('POST /api/fillet-render — validation', () => {
  it('rejects malformed JSON body', async () => {
    const r = await POST(
      new Request('http://localhost/api/fillet-render', {
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
    const r = await POST(makeReq({ depth: 20, radius: 1 }) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
  });

  it('rejects body with non-positive depth', async () => {
    const r = await POST(makeReq({ sketch: rectSketch, depth: 0, radius: 1 }) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.message).toMatch(/depth/);
  });

  it('rejects body with missing/zero radius', async () => {
    const r = await POST(makeReq({ sketch: rectSketch, depth: 20 }) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.message).toMatch(/radius/);
  });

  it('rejects unknown edgeSelection', async () => {
    const r = await POST(
      makeReq({
        sketch: rectSketch,
        depth: 20,
        radius: 1,
        edgeSelection: 'middle',
      }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.message).toMatch(/edgeSelection/);
  });

  it('rejects radius ≥ depth/3 when edgeSelection touches top/bottom', async () => {
    // depth=10 → depth/3 ≈ 3.33; radius 4 + 'all' must fail.
    const r = await POST(
      makeReq({ sketch: rectSketch, depth: 10, radius: 4, edgeSelection: 'all' }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.message).toMatch(/depth\/3/);
  });

  it('allows radius ≥ depth/3 when edgeSelection is vertical only', async () => {
    // depth=10, radius 4, 'vertical' bypasses the depth/3 gate; pipeline
    // may still bounce off ENOENT (no openscad binary) but should pass
    // validation (not return 400).
    const r = await POST(
      makeReq({
        sketch: rectSketch,
        depth: 10,
        radius: 4,
        edgeSelection: 'vertical',
      }) as never,
    );
    expect(r.status).not.toBe(400);
  });

  it('rejects empty sketch (no points/lines)', async () => {
    const r = await POST(
      makeReq({ sketch: { points: [], lines: [] }, depth: 20, radius: 1 }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('EMPTY_SKETCH');
  });

  it('rejects sketch with too many points', async () => {
    const points = Array.from({ length: 5001 }, (_, i) => ({ id: `p${i}`, x: i, y: 0 }));
    const r = await POST(
      makeReq({ sketch: { points, lines: [] }, depth: 20, radius: 1 }) as never,
    );
    expect(r.status).toBe(413);
    const data = await r.json();
    expect(data.code).toBe('TOO_LARGE');
  });

  it('accepts triangle profile (Phase 2 N-vertex polygon)', async () => {
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
      makeReq({ sketch: triangleSketch, depth: 20, radius: 0.3, edgeSelection: 'vertical' }) as never,
    );
    // Pipeline validation should pass; we may bounce at render with ENOENT.
    expect(r.status).not.toBe(400);
    expect(r.status).not.toBe(422);
  });

  it('rejects concave profile via pipeline error (Phase 2 requires convex)', async () => {
    // Arrowhead "Pac-Man" style concave quad — convex polygon test will fail.
    const concaveSketch = {
      points: [
        { id: 'p1', x: 0, y: 0 },
        { id: 'p2', x: 10, y: 0 },
        { id: 'p3', x: 5, y: 3 },
        { id: 'p4', x: 10, y: 10 },
        { id: 'p5', x: 0, y: 10 },
      ],
      lines: [
        { id: 'l1', p1: 'p1', p2: 'p2' },
        { id: 'l2', p1: 'p2', p2: 'p3' },
        { id: 'l3', p1: 'p3', p2: 'p4' },
        { id: 'l4', p1: 'p4', p2: 'p5' },
        { id: 'l5', p1: 'p5', p2: 'p1' },
      ],
    };
    const r = await POST(
      makeReq({ sketch: concaveSketch, depth: 20, radius: 1, edgeSelection: 'vertical' }) as never,
    );
    expect(r.status).toBe(422);
    const data = await r.json();
    expect(data.code).toBe('PIPELINE_ERROR');
    expect(data.message).toMatch(/convex/i);
  });

  it('Phase 3: accepts vertexRadii body', async () => {
    const r = await POST(
      makeReq({
        sketch: rectSketch,
        depth: 20,
        radius: 1,
        edgeSelection: 'vertical',
        vertexRadii: [0.5, 1, 1.5, 1],
      }) as never,
    );
    expect(r.status).not.toBe(400);
    expect(r.status).not.toBe(422);
  });

  it('Phase 3: accepts edgeRadii body', async () => {
    const r = await POST(
      makeReq({
        sketch: rectSketch,
        depth: 20,
        radius: 2,
        edgeSelection: 'vertical',
        edgeRadii: [2, 2, 2, 2],
      }) as never,
    );
    expect(r.status).not.toBe(400);
    expect(r.status).not.toBe(422);
  });

  it('Phase 3: vertexRadii negative entry → 400 BAD_REQUEST', async () => {
    const r = await POST(
      makeReq({
        sketch: rectSketch,
        depth: 20,
        radius: 1,
        edgeSelection: 'vertical',
        vertexRadii: [1, -1, 1, 1],
      }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.message).toMatch(/vertexRadii\[1\]/);
  });

  it('Phase 3: vertexRadii length mismatch → 422 PIPELINE_ERROR', async () => {
    const r = await POST(
      makeReq({
        sketch: rectSketch,
        depth: 20,
        radius: 1,
        edgeSelection: 'vertical',
        vertexRadii: [1, 1], // wrong length
      }) as never,
    );
    expect(r.status).toBe(422);
    const data = await r.json();
    expect(data.message).toMatch(/vertexRadii length/);
  });

  it('Phase 3: variable max(vertexRadii) ≥ depth/3 → 400 with effective max', async () => {
    const r = await POST(
      makeReq({
        sketch: rectSketch,
        depth: 10,
        radius: 1,
        edgeSelection: 'all',
        vertexRadii: [1, 1, 4, 1], // max=4 ≥ 10/3
      }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.message).toMatch(/depth\/3/);
  });

  it('valid rect fillet reaches the render step (openscad CLI not available → ENOENT 503)', async () => {
    const r = await POST(
      makeReq({
        sketch: rectSketch,
        depth: 20,
        radius: 1,
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
