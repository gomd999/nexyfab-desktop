import { test, expect } from '@playwright/test';
import {
  seedShapeGeneratorForE2e,
  dismissShapeGeneratorOverlays,
  exitSketchIfNeeded,
} from './helpers/shapeGeneratorEnv';

/**
 * 상용 릴리스 스모크: 핵심 공개 페이지가 로드되는지 확인.
 * CI에서는 E2E_BASE_URL 또는 webServer로 스테이징/프로덕션에도 동일하게 실행 가능.
 *
 * Shape Generator는 `next/dynamic` + 대형 청크라 제목만으로는 “로딩 스피너”에 걸린 상태를
 * 놓칠 수 있음 — 워크스페이스 루트(`shape-generator-workspace`) + (스케치 모드면 탭이 Sketch만 보이므로 종료 후) 리본 Evaluate 탭까지 본다.
 */
test.describe('Commercial release smoke', () => {
  test('third-party notices page renders', async ({ page }) => {
    const res = await page.goto('/en/third-party-notices/');
    expect(res?.ok()).toBeTruthy();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Next\.js|React|Tauri/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('shape generator workspace and ribbon load', async ({ page }) => {
    test.setTimeout(90_000);
    await seedShapeGeneratorForE2e(page);
    const res = await page.goto('/en/shape-generator/', { waitUntil: 'domcontentloaded' });
    expect(res?.ok() ?? false).toBeTruthy();
    await expect(page).toHaveURL(/\/en\/shape-generator/);
    await dismissShapeGeneratorOverlays(page);
    await expect(page.getByTestId('shape-generator-workspace')).toBeVisible({ timeout: 60000 });
    await exitSketchIfNeeded(page);
    await expect(page.getByRole('button', { name: 'Evaluate' })).toBeVisible({ timeout: 30000 });
    await expect(page).toHaveTitle(/NexyFab|Shape/i);
  });
});
