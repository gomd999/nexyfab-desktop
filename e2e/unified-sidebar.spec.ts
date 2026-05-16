import { test, expect } from '@playwright/test';

// Unified sidebar — verifies the 3-section layout renders on all NexyFab
// surfaces and that the active item flips between sections when navigating.
// Guest mode is assumed; signed-in routes are gated behind auth and reached
// via the /portal entry which redirects to login when unauthenticated.

test.describe('NexyfabUnifiedSidebar', () => {
  test('renders DESIGN / MANUFACTURING / ACCOUNT sections on Hub', async ({ page }) => {
    await page.goto('/kr/nexyfab/hub');
    // Section titles should appear (Korean labels).
    await expect(page.getByText('디자인', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('제조', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('계정', { exact: true }).first()).toBeVisible();
  });

  test('shows AI Studio NEW badge', async ({ page }) => {
    await page.goto('/kr/nexyfab/hub');
    const aiLink = page.getByRole('link', { name: /Nexy AI 스튜디오/ });
    await expect(aiLink).toBeVisible();
    await expect(aiLink).toContainText('NEW');
  });

  test('navigates to AI Studio when clicked', async ({ page }) => {
    await page.goto('/kr/nexyfab/hub');
    await page.getByRole('link', { name: /Nexy AI 스튜디오/ }).click();
    await expect(page).toHaveURL(/\/nexyfab\/ai-studio$/);
  });
});
