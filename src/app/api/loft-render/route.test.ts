/**
 * /api/loft-render — request validation tests.
 *
 * Mirror of /api/revolve-render/route.test.ts. Covers validation paths +
 * pipeline-error response. Full openscad render path is covered by the
 * openscad-render module tests.
 */
import { describe, it, expect } from 'vitest';
import { POST } from './route';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/loft-render', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const rectSketch = {
  points: [
    { id: 'p1', x: 0, y: 0 },
    { id: 'p2', x: 10, y: 0 },
    { id: 'p3', x: 10, y: 10 },
    { id: 'p4', x: 0, y: 10 },
  ],
  lines: [
    { id: 'l1', p1: 'p1', p2: 'p2' },
    { id: 'l2', p1: 'p2', p2: 'p3' },
    { id: 'l3', p1: 'p3', p2: 'p4' },
    { id: 'l4', p1: 'p4', p2: 'p1' },
  ],
};

function twoRectSections() {
  return [
    { sketch: rectSketch, z: 0 },
    { sketch: rectSketch, z: 10 },
  ];
}

describe('POST /api/loft-render — validation', () => {
  it('rejects malformed JSON body', async () => {
    const r = await POST(new Request('http://localhost/api/loft-render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    }) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.ok).toBe(false);
    expect(data.code).toBe('BAD_REQUEST');
  });

  it('rejects body missing sections', async () => {
    const r = await POST(makeReq({}) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
    expect(data.message).toMatch(/2 sections/);
  });

  it('rejects body with <2 sections', async () => {
    const r = await POST(makeReq({ sections: [{ sketch: rectSketch, z: 0 }] }) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
  });

  it('rejects body with too many sections', async () => {
    const sections = Array.from({ length: 40 }, (_, i) => ({ sketch: rectSketch, z: i }));
    const r = await POST(makeReq({ sections }) as never);
    expect(r.status).toBe(413);
    const data = await r.json();
    expect(data.code).toBe('TOO_LARGE');
  });

  it('rejects section missing sketch', async () => {
    const r = await POST(
      makeReq({
        sections: [{ z: 0 }, { sketch: rectSketch, z: 10 }],
      }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
  });

  it('rejects section with empty sketch', async () => {
    const r = await POST(
      makeReq({
        sections: [
          { sketch: { points: [], lines: [] }, z: 0 },
          { sketch: rectSketch, z: 10 },
        ],
      }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('EMPTY_SKETCH');
  });

  it('rejects section with too many points', async () => {
    const points = Array.from({ length: 5001 }, (_, i) => ({ id: `p${i}`, x: i, y: 0 }));
    const r = await POST(
      makeReq({
        sections: [
          { sketch: { points, lines: [] }, z: 0 },
          { sketch: rectSketch, z: 10 },
        ],
      }) as never,
    );
    expect(r.status).toBe(413);
    const data = await r.json();
    expect(data.code).toBe('TOO_LARGE');
  });

  it('rejects non-finite z', async () => {
    const r = await POST(
      makeReq({
        sections: [
          { sketch: rectSketch, z: 0 },
          { sketch: rectSketch, z: 'not-a-number' },
        ],
      }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
    expect(data.message).toMatch(/z/);
  });

  it('rejects non-monotonic z order', async () => {
    const r = await POST(
      makeReq({
        sections: [
          { sketch: rectSketch, z: 10 },
          { sketch: rectSketch, z: 5 },
        ],
      }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
    expect(data.message).toMatch(/monotonically/);
  });

  it('rejects invalid mode value', async () => {
    const r = await POST(
      makeReq({ sections: twoRectSections(), mode: 'bogus' }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.message).toMatch(/mode/i);
  });

  it('rejects sketch with no closed loop (pipeline error)', async () => {
    const openSketch = {
      points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }],
      lines: [{ id: 'l1', p1: 'p1', p2: 'p2' }],
    };
    const r = await POST(
      makeReq({
        sections: [
          { sketch: openSketch, z: 0 },
          { sketch: openSketch, z: 10 },
        ],
      }) as never,
    );
    expect(r.status).toBe(422);
    const data = await r.json();
    expect(data.code).toBe('PIPELINE_ERROR');
  });

  it('rejects mismatched point counts between sections (pipeline error)', async () => {
    const triangleSketch = {
      points: [
        { id: 't1', x: 0, y: 0 },
        { id: 't2', x: 10, y: 0 },
        { id: 't3', x: 5, y: 8 },
      ],
      lines: [
        { id: 'tl1', p1: 't1', p2: 't2' },
        { id: 'tl2', p1: 't2', p2: 't3' },
        { id: 'tl3', p1: 't3', p2: 't1' },
      ],
    };
    const r = await POST(
      makeReq({
        sections: [
          { sketch: rectSketch, z: 0 },
          { sketch: triangleSketch, z: 10 },
        ],
      }) as never,
    );
    expect(r.status).toBe(422);
    const data = await r.json();
    expect(data.code).toBe('PIPELINE_ERROR');
    expect(data.message).toMatch(/point count/i);
  });

  it('valid loft reaches the render step (openscad CLI not available → ENOENT 503)', async () => {
    const r = await POST(
      makeReq({ sections: twoRectSections() }) as never,
    );
    // In CI / production with the binary present: 200 + pngs[].
    // In local dev without it: 503 with code=ENOENT.
    if (r.status === 200) {
      const data = await r.json();
      expect(data.ok).toBe(true);
      expect(data.scad).toContain('skin');
      expect(Array.isArray(data.pngs)).toBe(true);
    } else {
      expect(r.status).toBe(503);
      const data = await r.json();
      expect(data.code).toBe('ENOENT');
    }
  });
});
