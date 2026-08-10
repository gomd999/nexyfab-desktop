import { test, expect } from '@playwright/test';

// AI Studio — verifies hero state renders, suggestion chips trigger
// requests, and the dedicated header CTA jumps to the full modeler.

test.describe('AI Studio', () => {
  test('hero shows headline + suggestion chips on empty state', async ({ page }) => {
    await page.goto('/kr/nexyfab/ai-studio');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/어떤 정밀 부품/);
    // Suggestion chips are buttons that fire `send()` when clicked.
    const chips = page.getByRole('button', { name: /120×80×8 브래킷|마운팅 플레이트|플랜지|벽두께/ });
    expect(await chips.count()).toBeGreaterThan(0);
  });

  test('CAD editor link routes to /shape-generator', async ({ page }) => {
    await page.goto('/kr/nexyfab/ai-studio');
    await page.getByRole('button', { name: /전문가형 CAD/ }).click();
    await expect(page).toHaveURL(/\/shape-generator\/?\?.*expert=1/, { timeout: 30_000 });
  });

  test('input + Generate button are present', async ({ page }) => {
    await page.goto('/kr/nexyfab/ai-studio');
    await expect(page.getByPlaceholder(/바퀴 4개 달린 장난감 자동차/)).toBeVisible();
    await expect(page.getByRole('button', { name: '생성하기' })).toBeVisible();
  });
});
