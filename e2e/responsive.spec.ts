import { test, expect } from '@playwright/test';

test.describe('Responsive design', () => {
  test('guided design keeps progress and evidence summaries inside a phone viewport', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto('/kr/nexyfab/design');

    const journey = page.getByTestId('domain-user-journey');
    const readiness = page.getByTestId('domain-readiness-summary');
    await expect(journey).toBeVisible();
    await expect(readiness).toBeVisible();

    for (const region of [journey, readiness]) {
      const bounds = await region.evaluate((element) => {
        const container = element.getBoundingClientRect();
        const children = Array.from(element.children).map(child => child.getBoundingClientRect());
        return {
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          left: Math.min(container.left, ...children.map(child => child.left)),
          right: Math.max(container.right, ...children.map(child => child.right)),
        };
      });
      expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth + 1);
      expect(bounds.left).toBeGreaterThanOrEqual(-1);
      expect(bounds.right).toBeLessThanOrEqual(394);
    }
  });

  test('precision CAD uses its dedicated mobile surface without clipped desktop tools', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto('/kr/shape-generator?expert=1');

    const mobileShell = page.locator('.nx-app[data-viewport-only="true"]');
    await expect(mobileShell).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.nx-title')).toHaveCount(0);
    await expect(page.locator('.nx-ribbon')).toHaveCount(0);
    await expect(page.getByTestId('domain-workspace-bar')).toHaveCount(0);
    await expect(page.getByTestId('cad-workflow-rail')).toHaveCount(0);

    const width = await page.locator('.nx-app').evaluate(element => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(width.scrollWidth).toBeLessThanOrEqual(width.clientWidth + 1);
  });

  test('landing page is readable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/en/');
    await expect(page).toHaveTitle(/.+/);
    // No horizontal scroll
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5); // 5px tolerance
  });

  test('Arabic RTL chat keeps the rail and composer inside a phone viewport', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto('/ar/nexyfab/ai/');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const width = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(width.scrollWidth).toBeLessThanOrEqual(width.clientWidth + 5);
  });

  test('shape generator loads on tablet', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/en/shape-generator?expert=1');
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
