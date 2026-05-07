import { test, expect } from '@playwright/test';

test.describe('API Health', () => {
  test('health endpoint returns ok', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.db).toBeDefined();
    expect(body.memory).toBeDefined();
  });

  test('protected endpoints return 401 without auth', async ({ request }) => {
    const endpoints = [
      '/api/nexyfab/projects',
      '/api/nexyfab/rfq',
      '/api/auth/account',
    ];

    for (const endpoint of endpoints) {
      const response = await request.get(endpoint);
      expect([401, 403, 405]).toContain(response.status()); // 405 = method not allowed (GET on POST-only)
    }
  });

  test('rate limiting returns 429 after many requests', async ({ request }) => {
    // Hit login endpoint many times
    const promises = Array.from({ length: 15 }, () =>
      request.post('/api/auth/login', {
        data: { email: 'test@test.com', password: 'wrongpass' },
      })
    );
    const responses = await Promise.all(promises);
    const statuses = responses.map(r => r.status());
    // At least one should be rate limited
    expect(statuses.some(s => s === 429)).toBe(true);
  });
});
