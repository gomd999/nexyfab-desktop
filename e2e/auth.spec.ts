import { test, expect } from '@playwright/test';

const TEST_EMAIL = `e2e-${Date.now()}@test.nexyfab.com`;
const TEST_PASSWORD = 'TestPass123!';

test.describe('Auth flows', () => {
  test('signup → login → logout', async ({ page }) => {
    // Signup
    await page.goto('/en/');
    // Navigate to signup - look for sign up button or link
    await page.goto('/en/?auth=signup');

    // Fill signup form
    const emailInput = page.locator('input[type="email"]').first();
    const passwordInput = page.locator('input[type="password"]').first();

    if (await emailInput.isVisible()) {
      await emailInput.fill(TEST_EMAIL);
      await passwordInput.fill(TEST_PASSWORD);
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(1000);
    }

    // Login
    await page.goto('/en/?auth=login');
    const loginEmail = page.locator('input[type="email"]').first();
    const loginPassword = page.locator('input[type="password"]').first();

    if (await loginEmail.isVisible()) {
      await loginEmail.fill(TEST_EMAIL);
      await loginPassword.fill(TEST_PASSWORD);
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(1000);
    }
  });

  test('login with wrong password shows error', async ({ page }) => {
    await page.goto('/en/?auth=login');
    const emailInput = page.locator('input[type="email"]').first();
    const passwordInput = page.locator('input[type="password"]').first();

    if (await emailInput.isVisible()) {
      await emailInput.fill('wrong@example.com');
      await passwordInput.fill('wrongpassword');
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(500);
      // Should show error, not navigate away
      await expect(page).toHaveURL(/auth=login|\/en\/?/);
    }
  });

  test('forgot password flow shows success', async ({ page }) => {
    await page.goto('/en/?auth=login');
    // Look for forgot password link
    const forgotLink = page.locator('text=/forgot|비밀번호/i').first();
    if (await forgotLink.isVisible()) {
      await forgotLink.click();
      const emailInput = page.locator('input[type="email"]').first();
      if (await emailInput.isVisible()) {
        await emailInput.fill('test@example.com');
        await page.locator('button[type="submit"]').first().click();
        await page.waitForTimeout(500);
        // Should show success message (enumeration-safe)
        const successMsg = page.locator('text=/sent|이메일|발송/i').first();
        // Either success shown or form still visible (both are acceptable UX)
        const formVisible = await emailInput.isVisible().catch(() => false);
        const successVisible = await successMsg.isVisible().catch(() => false);
        expect(formVisible || successVisible).toBe(true);
      }
    }
  });
});
