import { test, expect } from '@playwright/test';

/**
 * Smoke tests for the deterministic NL→intent→SCAD pipeline.
 *
 * Covers two endpoints introduced in 2026-05-07:
 *   POST /api/nexyfab/scad-from-intent      — pure conversion, no AI
 *   POST /api/nexyfab/scad-intent-from-nl   — AI-backed (skipped if no key)
 *
 * Both are gated behind checkPlan; we test the unauthenticated paths
 * (validation + 401 / 400 / 422 surfaces) plus a public happy path on
 * scad-from-intent which is the critical regression target.
 */

test.describe('SCAD pipeline — scad-from-intent (deterministic, no AI)', () => {
  test('rejects payloads without shapeId', async ({ request }) => {
    const r = await request.post('/api/nexyfab/scad-from-intent', {
      data: { params: { width: 10 } },
    });
    // Endpoint requires auth in some plan configs; either is acceptable.
    expect([400, 401, 403]).toContain(r.status());
  });

  test('rejects payloads without params object', async ({ request }) => {
    const r = await request.post('/api/nexyfab/scad-from-intent', {
      data: { shapeId: 'box' },
    });
    expect([400, 401, 403]).toContain(r.status());
  });

  test('returns 422 with code UNSUPPORTED for unknown shape', async ({ request }) => {
    const r = await request.post('/api/nexyfab/scad-from-intent', {
      data: { shapeId: 'helicalPropeller', params: { width: 10 } },
    });
    // 401/403 if auth gate fires first; 422 for the converter rejection path.
    if (r.status() === 422) {
      const body = await r.json();
      expect(body.code).toBe('UNSUPPORTED');
      expect(typeof body.error).toBe('string');
    } else {
      expect([401, 403]).toContain(r.status());
    }
  });

  test('happy path: box → SCAD', async ({ request }) => {
    const r = await request.post('/api/nexyfab/scad-from-intent', {
      data: {
        shapeId: 'box',
        params: { width: 30, height: 20, depth: 10 },
      },
    });
    if (r.status() === 200) {
      const body = await r.json();
      expect(typeof body.scad).toBe('string');
      expect(body.scad).toContain('cube([30, 20, 10]');
      expect(body.scad).toContain('$fn = ');
      expect(Array.isArray(body.warnings)).toBe(true);
      expect(typeof body.bytes).toBe('number');
      expect(body.bytes).toBeGreaterThan(0);
    } else {
      // Some plan configs require auth; in that case we accept the gate.
      expect([401, 403]).toContain(r.status());
    }
  });

  test('happy path: BOSL2 gear includes BOSL2 header', async ({ request }) => {
    const r = await request.post('/api/nexyfab/scad-from-intent', {
      data: {
        shapeId: 'gear',
        params: { teeth: 24, module: 2, thickness: 8 },
      },
    });
    if (r.status() === 200) {
      const body = await r.json();
      expect(body.scad).toContain('include <BOSL2/std.scad>');
      expect(body.scad).toContain('spur_gear(');
    } else {
      expect([401, 403]).toContain(r.status());
    }
  });

  test('happy path: feature pipeline applies hole', async ({ request }) => {
    const r = await request.post('/api/nexyfab/scad-from-intent', {
      data: {
        shapeId: 'box',
        params: { width: 50, height: 50, depth: 10 },
        features: [{ type: 'hole', params: { diameter: 6 } }],
      },
    });
    if (r.status() === 200) {
      const body = await r.json();
      expect(body.scad).toContain('difference()');
      expect(body.scad).toMatch(/r=3/);
    } else {
      expect([401, 403]).toContain(r.status());
    }
  });

  test('determinism: two identical requests return identical SCAD', async ({ request }) => {
    const payload = {
      shapeId: 'cylinder',
      params: { diameter: 30, height: 50 },
      features: [{ type: 'fillet', params: { radius: 2 } }],
    };
    const a = await request.post('/api/nexyfab/scad-from-intent', { data: payload });
    const b = await request.post('/api/nexyfab/scad-from-intent', { data: payload });
    if (a.status() === 200 && b.status() === 200) {
      expect((await a.json()).scad).toBe((await b.json()).scad);
    } else {
      // Either both gated identically or skip.
      expect(a.status()).toBe(b.status());
    }
  });
});

test.describe('SCAD pipeline — scad-intent-from-nl (AI-backed)', () => {
  test('rejects empty prompt with 400', async ({ request }) => {
    const r = await request.post('/api/nexyfab/scad-intent-from-nl', {
      data: { prompt: '' },
    });
    expect([400, 401, 403]).toContain(r.status());
  });

  test('rejects oversized prompt with 413', async ({ request }) => {
    const r = await request.post('/api/nexyfab/scad-intent-from-nl', {
      data: { prompt: 'a'.repeat(4001) },
    });
    expect([401, 403, 413]).toContain(r.status());
  });
});

// ─── Domain shapes (heatsink/manifold/turbine) ─────────────────────────────

test.describe('SCAD pipeline — domain shapes', () => {
  test('heatsink emits pin grid (no BOSL2)', async ({ request }) => {
    const r = await request.post('/api/nexyfab/scad-from-intent', {
      data: {
        shapeId: 'heatsink',
        params: { baseWidth: 60, baseDepth: 60, baseHeight: 4, pinDiameter: 3, pinHeight: 25, pinRows: 8, pinCols: 8 },
      },
    });
    if (r.status() === 200) {
      const body = await r.json();
      expect(body.scad).toContain('cylinder(h=25, d=3');
      expect(body.scad).toContain('for (i = [0 : 7]) for (j = [0 : 7])');
      expect(body.scad).not.toContain('BOSL2');
    } else {
      expect([401, 403]).toContain(r.status());
    }
  });

  test('manifold emits ports + central bore', async ({ request }) => {
    const r = await request.post('/api/nexyfab/scad-from-intent', {
      data: {
        shapeId: 'manifold',
        params: { width: 80, height: 30, depth: 30, portCount: 4, portDiameter: 6, boreDiameter: 8 },
      },
    });
    if (r.status() === 200) {
      const body = await r.json();
      expect(body.scad).toContain('difference()');
      expect(body.scad).toContain('for (i = [0 : 3])');
    } else {
      expect([401, 403]).toContain(r.status());
    }
  });

  test('turbine triggers BOSL2 path_sweep', async ({ request }) => {
    const r = await request.post('/api/nexyfab/scad-from-intent', {
      data: {
        shapeId: 'turbine',
        params: { hubDiameter: 40, hubHeight: 30, bladeCount: 8, outerRadius: 60 },
      },
    });
    if (r.status() === 200) {
      const body = await r.json();
      expect(body.scad).toContain('include <BOSL2/std.scad>');
      expect(body.scad).toContain('path_sweep(');
    } else {
      expect([401, 403]).toContain(r.status());
    }
  });
});

// ─── Feature chains ────────────────────────────────────────────────────────

test.describe('SCAD pipeline — feature chains', () => {
  test('mirror + linearPattern + fillet on box', async ({ request }) => {
    const r = await request.post('/api/nexyfab/scad-from-intent', {
      data: {
        shapeId: 'box',
        params: { width: 60, height: 30, depth: 40 },
        features: [
          { type: 'mirror', params: { axisZ: 1 } },
          { type: 'linearPattern', params: { count: 3, spacingX: 70 } },
          { type: 'fillet', params: { radius: 2 } },
        ],
      },
    });
    if (r.status() === 200) {
      const body = await r.json();
      expect(body.scad).toContain('mirror(');
      expect(body.scad).toContain('for (i = [0 : 2])');
      expect(body.scad).toContain('minkowski()');  // fillet approximation
    } else {
      expect([401, 403]).toContain(r.status());
    }
  });

  test('thread feature on plain shape pulls in BOSL2', async ({ request }) => {
    const r = await request.post('/api/nexyfab/scad-from-intent', {
      data: {
        shapeId: 'box',
        params: { width: 30, height: 30, depth: 30 },
        features: [{ type: 'thread', params: { diameter: 8, length: 30, pitch: 1.25 } }],
      },
    });
    if (r.status() === 200) {
      const body = await r.json();
      expect(body.scad).toContain('include <BOSL2/std.scad>');
      expect(body.scad).toContain('threaded_rod(d=8');
      expect(body.scad).toContain('internal=true');
    } else {
      expect([401, 403]).toContain(r.status());
    }
  });
});

// ─── Collab security surface ───────────────────────────────────────────────

test.describe('Collab security', () => {
  test('GET /api/collab requires auth', async ({ request }) => {
    const r = await request.get('/api/collab?roomId=abcdef1234567890');
    expect(r.status()).toBe(401);
  });

  test('POST /api/collab requires auth', async ({ request }) => {
    const r = await request.post('/api/collab', {
      data: { roomId: 'abcdef1234567890', event: { type: 'cursor_move', payload: {} } },
    });
    expect(r.status()).toBe(401);
  });

  test('POST /api/collab rejects invalid event type once authenticated path is shaped', async ({ request }) => {
    // Even without auth this must NOT 200; we accept 401/400 here.
    const r = await request.post('/api/collab', {
      data: { roomId: 'abcdef1234567890', event: { type: 'evil_event', payload: {} } },
    });
    expect(r.status()).not.toBe(200);
  });
});
