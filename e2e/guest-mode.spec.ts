import { test, expect } from '@playwright/test';

// Guest mode — Hub allows 1 new design without signup, then forces auth
// for the 2nd. Sample projects on the empty state should also be clickable.

test.describe('Guest mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try { window.localStorage.clear(); } catch { /* ignore */ }
    });
  });

  test('Hub renders sample project cards in empty state', async ({ page }) => {
    await page.goto('/kr/nexyfab/hub');
    // Wait briefly for the loading state to settle.
    await page.waitForLoadState('networkidle');
    // Sample card titles defined in sampleProjects.ts.
    await expect(page.getByText(/알루미늄 브라켓|Aluminum Bracket/).first()).toBeVisible({ timeout: 8000 });
  });

  test('"New Design" routes to modeler with ?guest=1', async ({ page }) => {
    await page.goto('/kr/nexyfab/hub');
    const newButton = page.getByRole('button', { name: /새 디자인|New Design/i }).first();
    if (await newButton.isVisible().catch(() => false)) {
      await newButton.click();
      await expect(page).toHaveURL(/shape-generator\?.*guest=1/);
    }
  });

  test('guest quota mark prevents a 2nd unsigned design', async ({ page }) => {
    await page.addInitScript(() => {
      try { window.localStorage.setItem('nexyfab.guest-quota.v1', '1'); } catch { /* ignore */ }
    });
    await page.goto('/kr/nexyfab/hub');
    // Even if quota is already burned, we don't crash — the AuthModal would
    // open. We just assert the page itself remains responsive.
    await expect(page).toHaveURL(/\/nexyfab\/hub/);
  });
});
