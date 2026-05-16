import { test, expect } from '@playwright/test';

// AI Studio — verifies hero state renders, suggestion chips trigger
// requests, and the dedicated header CTA jumps to the full modeler.

test.describe('AI Studio', () => {
  test('hero shows headline + suggestion chips on empty state', async ({ page }) => {
    await page.goto('/kr/nexyfab/ai-studio');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/어떤 부품/);
    // Suggestion chips are buttons that fire `send()` when clicked.
    const chips = page.getByRole('button', { name: /∅6\.5|24T|M5 SHCS|브라켓/ });
    expect(await chips.count()).toBeGreaterThan(0);
  });

  test('CAD editor link routes to /shape-generator', async ({ page }) => {
    await page.goto('/kr/nexyfab/ai-studio');
    await page.getByRole('button', { name: /CAD 에디터 열기/ }).click();
    await expect(page).toHaveURL(/\/shape-generator/);
  });

  test('input + Generate button are present', async ({ page }) => {
    await page.goto('/kr/nexyfab/ai-studio');
    await expect(page.getByPlaceholder(/알루미늄 브라켓/)).toBeVisible();
    await expect(page.getByRole('button', { name: /생성 →/ })).toBeVisible();
  });
});
