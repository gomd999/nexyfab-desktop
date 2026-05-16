import { test, expect } from '@playwright/test';

// Billing API surface — unauthenticated 401 / forbidden / 405 etc. We
// don't auth here; the goal is to ensure routes exist and produce the
// expected error shape rather than 500 / Not Found.

test.describe('Billing API surface', () => {
  test('GET /api/billing/subscription returns 401 when unauthenticated', async ({ request }) => {
    const res = await request.get('/api/billing/subscription');
    expect([401, 403]).toContain(res.status());
  });

  test('POST /api/billing/subscription/seats requires auth', async ({ request }) => {
    const res = await request.post('/api/billing/subscription/seats', {
      data: { quantity: 5 },
      headers: { Origin: 'http://localhost' },
    });
    expect([401, 403]).toContain(res.status());
  });

  test('POST /api/billing/subscription/pause requires auth', async ({ request }) => {
    const res = await request.post('/api/billing/subscription/pause', {
      data: { months: 3 },
      headers: { Origin: 'http://localhost' },
    });
    expect([401, 403]).toContain(res.status());
  });

  test('POST /api/billing/cancel-survey rate-limits + auth-gates', async ({ request }) => {
    const res = await request.post('/api/billing/cancel-survey', {
      data: { reason: 'too_expensive' },
      headers: { Origin: 'http://localhost' },
    });
    expect([401, 403, 429]).toContain(res.status());
  });

  test('POST /api/cron/fx-rates rejects without cron-secret', async ({ request }) => {
    const res = await request.post('/api/cron/fx-rates');
    expect(res.status()).toBe(403);
  });

  test('POST /api/cron/trial-reminders rejects without cron-secret', async ({ request }) => {
    const res = await request.post('/api/cron/trial-reminders');
    expect(res.status()).toBe(403);
  });

  test('POST /api/cron/metered-billing rejects without cron-secret', async ({ request }) => {
    const res = await request.post('/api/cron/metered-billing');
    expect(res.status()).toBe(403);
  });

  test('POST /api/cron/cancel-winback rejects without cron-secret', async ({ request }) => {
    const res = await request.post('/api/cron/cancel-winback');
    expect(res.status()).toBe(403);
  });

  test('GET /api/docs/openapi serves a valid OpenAPI 3.1 document', async ({ request }) => {
    const res = await request.get('/api/docs/openapi');
    expect(res.status()).toBe(200);
    const spec = await res.json();
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info?.title).toBe('NexyFab Public API');
    expect(spec.paths?.['/api/public/v1/projects']).toBeDefined();
  });
});
