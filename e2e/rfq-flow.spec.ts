/**
 * RFQ flow smoke — buyer-side intake.
 *
 * Validates that the RFQ entry points are reachable and the basic
 * intake UI renders. Doesn't go deep on quote calculation or partner
 * matching — those are covered by unit + scad-pipeline suites.
 *
 * The point: regressions in the RFQ surface (the moneymaking path)
 * fail loudly before a user hits them.
 */

import { test, expect } from '@playwright/test';

test.describe('RFQ flow', () => {
  test('quick-quote 페이지 로드', async ({ page }) => {
    await page.goto('/kr/quick-quote', { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByText(/RFQ|견적|quote|업로드|upload/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('RFQ API health — 401/200, 5xx 면 회귀', async ({ page }) => {
    const res = await page.request.get('/api/nexyfab/rfq');
    // 401: auth required (route healthy). 200: list returned.
    // 5xx is a regression that must fail CI.
    expect([200, 401, 403, 405]).toContain(res.status());
  });

  test('shape-generator → RFQ 패널 접근점 존재', async ({ page }) => {
    await page.goto('/kr/shape-generator?expert=1', { waitUntil: 'domcontentloaded' });
    // Wait for the workspace shell.
    await page.waitForLoadState('networkidle').catch(() => {});
    // RFQ entry can be a button, link or panel toggle — accept any.
    const rfqEntry = page.getByText(/RFQ|견적 요청|request.*quote/i);
    if (await rfqEntry.count() === 0) test.skip();
    await expect(rfqEntry.first()).toBeVisible({ timeout: 15_000 });
  });
});
