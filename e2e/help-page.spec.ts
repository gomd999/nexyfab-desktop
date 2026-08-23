import { expect, test } from '@playwright/test';

test.describe('Help center', () => {
  test('renders the current guide accordion', async ({ page }) => {
    await page.goto('/kr/help');
    await expect(page.getByRole('heading', { name: '사용 가이드' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '현재 권장 설계 흐름' })).toBeVisible();
    await expect(page.getByRole('link', { name: /AI 설계 시작/ })).toHaveAttribute('href', '/kr/nexyfab/ai/');
    for (const guide of ['RFQ (견적 요청) 보내기', '견적 비교 + 수락']) {
      await expect(page.getByRole('button', { name: guide, exact: false })).toBeVisible();
    }
  });

  test('search filters items when the search control is present', async ({ page }) => {
    await page.goto('/kr/help');
    const search = page.getByRole('searchbox').or(page.getByPlaceholder(/검색|Search/i).first());
    if (await search.count()) {
      await search.first().fill('환불');
      await expect(page.getByText(/환불/).first()).toBeVisible();
    }
  });
});
