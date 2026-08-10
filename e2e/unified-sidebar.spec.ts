import { test, expect } from '@playwright/test';

// Unified sidebar — verifies the current domain-first IA and the integrated AI
// chat entry point. Manufacturing lives on the dashboard and account actions
// live in the avatar menu, so the retired three-section layout is not expected.

test.describe('NexyfabUnifiedSidebar', () => {
  test('renders domain-first design navigation on Hub', async ({ page }) => {
    await page.goto('/kr/nexyfab/hub');
    const nav = page.getByRole('navigation', { name: '주요 메뉴' });
    await expect(nav.getByRole('link', { name: '기계', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: '건축', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: '토목', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: '내 프로젝트', exact: true })).toBeVisible();
  });

  test('shows the integrated New chat entry', async ({ page }) => {
    await page.goto('/kr/nexyfab/hub');
    const aiLink = page.getByRole('link', { name: '새 채팅', exact: true });
    await expect(aiLink).toBeVisible();
    await expect(aiLink).toHaveAttribute('href', '/kr/nexyfab/ai/');
  });

  test('navigates to integrated AI chat when clicked', async ({ page }) => {
    await page.goto('/kr/nexyfab/hub');
    await page.getByRole('link', { name: '새 채팅', exact: true }).click();
    await expect(page).toHaveURL(/\/nexyfab\/ai\/?$/);
  });
});
