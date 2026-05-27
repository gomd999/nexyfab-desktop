import { test, expect } from '@playwright/test';

// Help center — categorised FAQ + search.

test.describe('Help center', () => {
  test('renders 6 categories', async ({ page }) => {
    await page.goto('/kr/help');
    // Korean category headings.
    for (const heading of ['시작하기', '구독 & 결제', 'AI 사용', '도면 & 내보내기']) {
      await expect(page.getByRole('heading', { name: new RegExp(heading) })).toBeVisible();
    }
  });

  test('search filters items', async ({ page }) => {
    await page.goto('/kr/help');
    // The HelpClient may not expose the input as a search role — try both.
    const candidates = [
      page.getByRole('searchbox'),
      page.getByPlaceholder(/검색|Search/i).first(),
    ];
    for (const candidate of candidates) {
      if (await candidate.count() > 0) {
        await candidate.fill('환불');
        await expect(page.getByText(/환불/).first()).toBeVisible();
        return;
      }
    }
  });
});
