/**
 * /api/pattern-render — request validation tests.
 *
 * Mirror of /api/revolve-render/route.test.ts. Covers validation paths
 * for both `kind: 'linear'` and `kind: 'circular'` + pipeline-error
 * responses. Full openscad render path is covered by the openscad-render
 * module tests.
 */
import { describe, it, expect } from 'vitest';
import { POST } from './route';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/pattern-render', {
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

const linearBody = {
  kind: 'linear' as const,
  sketch: rectSketch,
  child: { depth: 5 },
  count: 4,
  direction: { x: 1, y: 0, z: 0 },
  spacing: 15,
};

const circularBody = {
  kind: 'circular' as const,
  sketch: rectSketch,
  child: { depth: 5 },
  count: 6,
  axisOrigin: { x: 0, y: 0, z: 0 },
  axisDirection: { x: 0, y: 0, z: 1 },
};

describe('POST /api/pattern-render — shared validation', () => {
  it('rejects malformed JSON body', async () => {
    const r = await POST(
      new Request('http://localhost/api/pattern-render', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
  });

  it('rejects body with missing/unknown kind', async () => {
    const r1 = await POST(makeReq({ sketch: rectSketch, child: { depth: 5 } }) as never);
    expect(r1.status).toBe(400);
    const r2 = await POST(makeReq({ ...linearBody, kind: 'bogus' }) as never);
    expect(r2.status).toBe(400);
  });

  it('rejects body missing sketch', async () => {
    const r = await POST(makeReq({ ...linearBody, sketch: undefined }) as never);
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('BAD_REQUEST');
  });

  it('rejects sketch with too many points', async () => {
    const points = Array.from({ length: 5001 }, (_, i) => ({ id: `p${i}`, x: i, y: 0 }));
    const r = await POST(
      makeReq({ ...linearBody, sketch: { points, lines: [] } }) as never,
    );
    expect(r.status).toBe(413);
    const data = await r.json();
    expect(data.code).toBe('TOO_LARGE');
  });

  it('rejects sketch with too many lines', async () => {
    const lines = Array.from({ length: 5001 }, (_, i) => ({
      id: `l${i}`, p1: 'p1', p2: 'p2',
    }));
    const r = await POST(
      makeReq({ ...linearBody, sketch: { points: rectSketch.points, lines } }) as never,
    );
    expect(r.status).toBe(413);
  });

  it('rejects empty sketch', async () => {
    const r = await POST(
      makeReq({ ...linearBody, sketch: { points: [], lines: [] } }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.code).toBe('EMPTY_SKETCH');
  });

  it('rejects missing/non-positive child.depth', async () => {
    const r1 = await POST(makeReq({ ...linearBody, child: { depth: 0 } }) as never);
    expect(r1.status).toBe(400);
    const r2 = await POST(makeReq({ ...linearBody, child: { depth: -1 } }) as never);
    expect(r2.status).toBe(400);
    const r3 = await POST(makeReq({ ...linearBody, child: {} }) as never);
    expect(r3.status).toBe(400);
  });

  it('rejects child.depth above MAX_DEPTH (10_000)', async () => {
    const r = await POST(makeReq({ ...linearBody, child: { depth: 10_001 } }) as never);
    expect(r.status).toBe(400);
  });
});

describe('POST /api/pattern-render — linear', () => {
  it('rejects count < 1, non-integer, > 100', async () => {
    const r1 = await POST(makeReq({ ...linearBody, count: 0 }) as never);
    expect(r1.status).toBe(400);
    const r2 = await POST(makeReq({ ...linearBody, count: 2.5 }) as never);
    expect(r2.status).toBe(400);
    const r3 = await POST(makeReq({ ...linearBody, count: 101 }) as never);
    expect(r3.status).toBe(400);
    const data = await r3.json();
    expect(data.message).toMatch(/count/i);
  });

  it('rejects non-positive spacing', async () => {
    const r1 = await POST(makeReq({ ...linearBody, spacing: 0 }) as never);
    expect(r1.status).toBe(400);
    const r2 = await POST(makeReq({ ...linearBody, spacing: -1 }) as never);
    expect(r2.status).toBe(400);
  });

  it('rejects missing / non-finite direction', async () => {
    const r1 = await POST(makeReq({ ...linearBody, direction: undefined }) as never);
    expect(r1.status).toBe(400);
    const r2 = await POST(
      makeReq({ ...linearBody, direction: { x: NaN, y: 0, z: 0 } }) as never,
    );
    expect(r2.status).toBe(400);
  });

  it('rejects zero-length direction', async () => {
    const r = await POST(
      makeReq({ ...linearBody, direction: { x: 0, y: 0, z: 0 } }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.message).toMatch(/zero-length/i);
  });

  it('reports PIPELINE_ERROR for sketch with no closed loop', async () => {
    const r = await POST(
      makeReq({
        ...linearBody,
        sketch: {
          points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }],
          lines: [{ id: 'l1', p1: 'p1', p2: 'p2' }],
        },
      }) as never,
    );
    expect(r.status).toBe(422);
    const data = await r.json();
    expect(data.code).toBe('PIPELINE_ERROR');
  });

  it('valid linear request reaches the render step (openscad CLI may be missing → ENOENT 503)', async () => {
    const r = await POST(makeReq(linearBody) as never);
    if (r.status === 200) {
      const data = await r.json();
      expect(data.ok).toBe(true);
      expect(data.scad).toContain('linear_extrude');
      expect(data.scad).toContain('module nexyfab_pattern_child');
      expect(Array.isArray(data.pngs)).toBe(true);
    } else {
      expect(r.status).toBe(503);
      const data = await r.json();
      expect(data.code).toBe('ENOENT');
    }
  });
});

describe('POST /api/pattern-render — circular', () => {
  it('rejects count < 2, non-integer, > 100', async () => {
    const r1 = await POST(makeReq({ ...circularBody, count: 1 }) as never);
    expect(r1.status).toBe(400);
    const r2 = await POST(makeReq({ ...circularBody, count: 2.5 }) as never);
    expect(r2.status).toBe(400);
    const r3 = await POST(makeReq({ ...circularBody, count: 101 }) as never);
    expect(r3.status).toBe(400);
  });

  it('rejects missing / non-finite axisOrigin', async () => {
    const r1 = await POST(makeReq({ ...circularBody, axisOrigin: undefined }) as never);
    expect(r1.status).toBe(400);
    const r2 = await POST(
      makeReq({ ...circularBody, axisOrigin: { x: 'foo', y: 0, z: 0 } }) as never,
    );
    expect(r2.status).toBe(400);
  });

  it('rejects missing / non-finite axisDirection', async () => {
    const r1 = await POST(makeReq({ ...circularBody, axisDirection: undefined }) as never);
    expect(r1.status).toBe(400);
    const r2 = await POST(
      makeReq({ ...circularBody, axisDirection: { x: 0, y: NaN, z: 1 } }) as never,
    );
    expect(r2.status).toBe(400);
  });

  it('rejects zero-length axisDirection', async () => {
    const r = await POST(
      makeReq({ ...circularBody, axisDirection: { x: 0, y: 0, z: 0 } }) as never,
    );
    expect(r.status).toBe(400);
    const data = await r.json();
    expect(data.message).toMatch(/zero-length/i);
  });

  it('rejects totalAngleDegrees out of (0, 360]', async () => {
    const r1 = await POST(makeReq({ ...circularBody, totalAngleDegrees: 0 }) as never);
    expect(r1.status).toBe(400);
    const r2 = await POST(makeReq({ ...circularBody, totalAngleDegrees: 400 }) as never);
    expect(r2.status).toBe(400);
  });

  it('default totalAngleDegrees = 360 when omitted', async () => {
    // Just check the request passes validation (it may 200 or ENOENT-503
    // depending on whether openscad is present in this environment).
    const r = await POST(makeReq(circularBody) as never);
    expect([200, 503]).toContain(r.status);
  });

  it('reports PIPELINE_ERROR for sketch with no closed loop', async () => {
    const r = await POST(
      makeReq({
        ...circularBody,
        sketch: {
          points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }],
          lines: [{ id: 'l1', p1: 'p1', p2: 'p2' }],
        },
      }) as never,
    );
    expect(r.status).toBe(422);
    const data = await r.json();
    expect(data.code).toBe('PIPELINE_ERROR');
  });

  it('valid circular request reaches the render step', async () => {
    const r = await POST(makeReq(circularBody) as never);
    if (r.status === 200) {
      const data = await r.json();
      expect(data.ok).toBe(true);
      expect(data.scad).toContain('module nexyfab_pattern_child');
      expect(data.scad).toMatch(/rotate\(a = i/);
    } else {
      expect(r.status).toBe(503);
    }
  });
});
