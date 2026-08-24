import { test, expect } from '@playwright/test';

// Unified sidebar — verifies the commercial mechanical IA and the integrated
// AI design entry point. Spatial disciplines are subordinate Labs routes.

test.describe('NexyfabUnifiedSidebar', () => {
  test('renders commercial mechanical navigation on Hub', async ({ page }) => {
    await page.goto('/kr/nexyfab/hub');
    const nav = page.getByRole('navigation', { name: '주요 메뉴' });
    await expect(nav.getByRole('link', { name: 'AI 기계 CAD', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: '정밀 CAD', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: '설계 검토·제조', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: '내 프로젝트', exact: true })).toBeVisible();
  });

  test('shows the integrated New mechanical design entry', async ({ page }) => {
    await page.goto('/kr/nexyfab/hub');
    const aiLink = page.getByRole('link', { name: '새 기계 설계', exact: true });
    await expect(aiLink).toBeVisible();
    await expect(aiLink).toHaveAttribute('href', '/kr/nexyfab/ai/?new=1');
  });

  test('navigates to integrated AI chat when clicked', async ({ page }) => {
    await page.goto('/kr/nexyfab/hub');
    await page.getByRole('link', { name: '새 기계 설계', exact: true }).click();
    await expect(page).toHaveURL(/\/nexyfab\/ai\/?\?new=1$/);
  });
});
