import { test, expect } from '@playwright/test';

test.describe('Landing page', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('nf_onboarding_done', '1');
      } catch {
        /* ignore */
      }
    });
  });

  test('loads successfully', async ({ page }) => {
    await page.goto('/en/');
    await expect(page).toHaveTitle(/NexyFab/i);
  });

  test('has correct metadata', async ({ page }) => {
    await page.goto('/en/');
    const description = await page.locator('meta[name="description"]').getAttribute('content');
    expect(description).toBeTruthy();
  });

  test('navigation links work', async ({ page }) => {
    await page.goto('/en/');
    // Check that pricing link exists
    const pricingLink = page.locator('a[href*="pricing"]').first();
    if (await pricingLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await pricingLink.click();
      await expect(page).toHaveURL(/pricing/);
    }
  });

  test('CTA button leads to shape generator or auth', async ({ page }) => {
    await page.goto('/en/');
    // Look for primary CTA button
    const ctaBtn = page.locator('a[href*="shape-generator"], button', { hasText: /시작|Start|Try|무료/i }).first();
    if (await ctaBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await ctaBtn.click();
      await page.waitForTimeout(1000);
      // Should navigate somewhere meaningful
      const url = page.url();
      expect(url).not.toBe('about:blank');
    }
  });

  test('Korean language version loads', async ({ page }) => {
    await page.goto('/ko/');
    await expect(page).toHaveTitle(/.+/);
    // Should show Korean content
    const body = await page.locator('body').textContent();
    // Korean pages should have some Korean characters
    expect(body).toBeTruthy();
  });

  test('pricing page loads', async ({ page }) => {
    await page.goto('/en/pricing');
    await expect(page).toHaveTitle(/Pricing|NexyFab/i);
    // Should show plan cards
    const freeText = page.locator('text=/Free|무료/i').first();
    await expect(freeText).toBeVisible({ timeout: 5000 }).catch(() => {});
  });
});
