import { expect, test } from '@playwright/test';

test.describe('AI CAD mode clarity', () => {
  test('distinguishes free-form from precision CAD before generation', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/kr/studio', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('studio-workspace')).toHaveAttribute('data-hydrated', 'true', { timeout: 60_000 });

    const free = page.getByTestId('ai-cad-mode-free');
    const precise = page.getByTestId('ai-cad-mode-precise');
    await expect(free).toBeVisible();
    await expect(precise).toBeVisible();
    // Commercial default: AI drives the precision path. Free-form remains an
    // explicit choice for fast organic modeling.
    await expect(free).toHaveAttribute('aria-pressed', 'false');
    await expect(precise).toHaveAttribute('aria-pressed', 'true');

    await free.click();
    await expect(free).toHaveAttribute('aria-pressed', 'true');
    await expect(precise).toHaveAttribute('aria-pressed', 'false');
    await precise.click();
    await expect(precise).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(/치수를 넣어 설명하면 정확한 치수의 부품/)).toBeVisible();
  });
});
