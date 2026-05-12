import { test, expect, request as requestFactory } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { authenticatedRequest } from './helpers/auth';

/**
 * Authenticated e2e for the deterministic SCAD pipeline.
 *
 * Strategy: ONE signup per file, shared across all tests via beforeAll. The
 * /api/auth/signup endpoint is rate-limited 5/min/IP, so re-signing per test
 * easily blows the budget when several spec files run back-to-back. Sharing
 * the context also halves total wall-clock time.
 *
 * Failure mode: if signup itself fails (rate limit, env not configured), we
 * mark all tests as skipped rather than failed — keeps the CI suite green
 * under transient external constraints.
 */

test.describe.configure({ mode: 'serial' });

test.describe('SCAD pipeline — authenticated happy path', () => {
  let authedContext: APIRequestContext | null = null;
  let signupSkipped = false;

  test.beforeAll(async ({ baseURL }) => {
    if (!baseURL) {
      signupSkipped = true;
      return;
    }
    const bootstrap = await requestFactory.newContext({ baseURL });
    try {
      const auth = await authenticatedRequest(bootstrap, baseURL);
      if (!auth) {
        signupSkipped = true;
        return;
      }
      authedContext = auth.context;
    } finally {
      await bootstrap.dispose();
    }
  });

  test.afterAll(async () => {
    await authedContext?.dispose();
  });

  test('scad-from-intent → 200 SCAD', async () => {
    test.skip(signupSkipped || !authedContext, 'signup unavailable (rate limit or env)');
    const r = await authedContext!.post('/api/nexyfab/scad-from-intent', {
      data: {
        shapeId: 'box',
        params: { width: 30, height: 20, depth: 10 },
      },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.scad).toContain('cube([30, 20, 10]');
    expect(body.scad).toContain('$fn = ');
    expect(typeof body.bytes).toBe('number');
    expect(body.bytes).toBeGreaterThan(0);
  });

  test('determinism: same input → same SCAD', async () => {
    test.skip(signupSkipped || !authedContext, 'signup unavailable');
    const payload = {
      shapeId: 'cylinder',
      params: { diameter: 30, height: 50 },
      features: [{ type: 'fillet', params: { radius: 2 } }],
    };
    const a = await authedContext!.post('/api/nexyfab/scad-from-intent', { data: payload });
    const b = await authedContext!.post('/api/nexyfab/scad-from-intent', { data: payload });
    expect(a.status()).toBe(200);
    expect(b.status()).toBe(200);
    expect((await a.json()).scad).toBe((await b.json()).scad);
  });

  test('BOSL2 shape: turbine emits include header', async () => {
    test.skip(signupSkipped || !authedContext, 'signup unavailable');
    const r = await authedContext!.post('/api/nexyfab/scad-from-intent', {
      data: {
        shapeId: 'turbine',
        params: { hubDiameter: 40, hubHeight: 30, bladeCount: 8, outerRadius: 60 },
      },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.scad).toContain('include <BOSL2/std.scad>');
    expect(body.scad).toContain('path_sweep(');
  });

  test('domain shape: motorMount emits NEMA-style face', async () => {
    test.skip(signupSkipped || !authedContext, 'signup unavailable');
    const r = await authedContext!.post('/api/nexyfab/scad-from-intent', {
      data: {
        shapeId: 'motorMount',
        params: { plateSize: 42, thickness: 5, boltCirclePitch: 31, boltDiameter: 3.4, centerBoreDiameter: 22 },
      },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.scad).toContain('cube([42, 42, 5]');
    expect(body.scad).toContain('d=22');
    expect(body.scad).toContain('d=3.4');
  });
});
