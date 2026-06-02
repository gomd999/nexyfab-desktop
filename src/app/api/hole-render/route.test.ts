/**
 * /api/hole-render — request validation tests.
 *
 * Mirror of /api/sweep-render/route.test.ts. Covers validation paths +
 * pipeline-error response. Full openscad render path is covered by the
 * openscad-render module tests.
 */
import { describe, it, expect } from 'vitest';
import { POST } from './route';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/hole-render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const rectSketch = {
  points: [
    { id: 'p1', x: 0, y: 0 },
    { id: 'p2', x: 20, y: 0 },
    { id: 'p3', x: 20, y: 10 },
    { id: 'p4', x: 0, y: 10 },
    { id: 'h1', x: 5, y: 5 },
  ],
  lines: [
    { id: 'l1', p1: 'p1', p2: 'p2' },
    { id: 'l2', p1: 'p2', p2: 'p3' },
    { id: 'l3', p1: 'p3', p2: 'p4' },
    { id: 'l4', p1: 'p4', p2: 'p1' },
  ],
};

const validHole = {
  pointId: 'h1',
  holeType: 'drilled',
  diameter: 4,
  depth: 8,
};

describe('POST /api/hole-render — validation', () => {
  it('rejects malformed JSON body', async () => {
    const r = await POST(new Request('http://localhost/api/hole-render', {
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
    const r = await POST(makeReq({ extrudeDepth: 10, holes: [validHole] }) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
    expect(data.message).toMatch(/sketch/i);
  });

  it('rejects missing extrudeDepth', async () => {
    const r = await POST(makeReq({ sketch: rectSketch, holes: [validHole] }) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
    expect(data.message).toMatch(/extrudeDepth/i);
  });

  it('rejects non-positive extrudeDepth', async () => {
    const r = await POST(
      makeReq({ sketch: rectSketch, extrudeDepth: -1, holes: [validHole] }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
    expect(data.message).toMatch(/positive/i);
  });

  it('rejects missing / empty holes array', async () => {
    const r1 = await POST(makeReq({ sketch: rectSketch, extrudeDepth: 10 }) as never);
    expect(r1.status).toBe(400);
    expect((await r1.json()).message).toMatch(/holes/i);
    const r2 = await POST(makeReq({ sketch: rectSketch, extrudeDepth: 10, holes: [] }) as never);
    expect(r2.status).toBe(400);
    expect((await r2.json()).message).toMatch(/at least 1/i);
  });

  it('rejects unknown holeType', async () => {
    const r = await POST(
      makeReq({
        sketch: rectSketch,
        extrudeDepth: 10,
        holes: [{ ...validHole, holeType: 'tapped' }],
      }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.message).toMatch(/holeType/i);
  });

  it('rejects non-positive diameter / depth', async () => {
    const r = await POST(
      makeReq({
        sketch: rectSketch,
        extrudeDepth: 10,
        holes: [{ ...validHole, diameter: -1 }],
      }) as never,
    );
    expect(r.status).toBe(400);
    expect((await r.json()).message).toMatch(/diameter/i);
  });

  it('rejects counterbore without required cbore params', async () => {
    const r = await POST(
      makeReq({
        sketch: rectSketch,
        extrudeDepth: 10,
        holes: [{ ...validHole, holeType: 'counterbore' }], // cbore params missing
      }) as never,
    );
    expect(r.status).toBe(400);
    expect((await r.json()).message).toMatch(/counterbore/i);
  });

  it('rejects empty sketch', async () => {
    const r = await POST(
      makeReq({ sketch: { points: [], lines: [] }, extrudeDepth: 10, holes: [validHole] }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('EMPTY_SKETCH');
  });

  it('rejects too many holes (>200)', async () => {
    const holes = Array.from({ length: 201 }, () => ({ ...validHole }));
    const r = await POST(
      makeReq({ sketch: rectSketch, extrudeDepth: 10, holes }) as never,
    );
    expect(r.status).toBe(413);
    expect((await r.json()).code).toBe('TOO_LARGE');
  });

  it('valid request reaches the render step (openscad CLI not available → ENOENT 503)', async () => {
    const r = await POST(
      makeReq({ sketch: rectSketch, extrudeDepth: 10, holes: [validHole] }) as never,
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
