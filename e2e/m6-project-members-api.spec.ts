import { test, expect } from '@playwright/test';

/**
 * M6: project members API is auth-gated (no cookie → 401).
 * Full owner/member flows require two accounts — see docs/strategy/M6_TEAM_MANUAL.md.
 */
test.describe('M6 project members API', () => {
  test('GET /api/nexyfab/projects/:id/members without session returns 401', async ({ request }) => {
    const res = await request.get('/api/nexyfab/projects/nonexistent-project-id/members');
    expect(res.status()).toBe(401);
  });
});
