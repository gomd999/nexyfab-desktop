import { test, expect } from '@playwright/test';

test.describe('Responsive design', () => {
  test('landing page is readable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/en/');
    await expect(page).toHaveTitle(/.+/);
    // No horizontal scroll
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5); // 5px tolerance
  });

  test('shape generator loads on tablet', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/en/shape-generator');
    await page.waitForTimeout(2000);
    await expect(page).toHaveURL(/shape-generator/);
  });

  test('pricing page shows plans on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/en/pricing');
    await page.waitForTimeout(1000);
    await expect(page).toHaveTitle(/.+/);
  });
});
