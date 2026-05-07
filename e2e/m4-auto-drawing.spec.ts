import { test, expect } from '@playwright/test';
import {
  seedShapeGeneratorForE2e,
  dismissShapeGeneratorOverlays,
  exitSketchIfNeeded,
  pickBoxEvaluateWaitForAutoDrawing,
  openAutoDrawingPanel,
} from './helpers/shapeGeneratorEnv';

/**
 * M4: 스케치 모드 종료 → Evaluate → 자동 도면 패널 → 생성 → SVG 프리뷰 표시.
 *
 * 로컬: `E2E_BASE_URL`에 맞춤. Turbopack dev가 500이면 `npm run build && npx next start -p 3334` 등 프로덕션 서버 권장.
 * CI: playwright.config `webServer`(build+start).
 */
test.describe('M4 auto drawing panel', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name === 'mobile-chrome', 'ribbon Evaluate tab is desktop-oriented');
  });

  test('Exit sketch, open Auto Drawing, generate shows SVG preview', async ({ page }) => {
    test.setTimeout(120_000);
    await seedShapeGeneratorForE2e(page);
    const res = await page.goto('/en/shape-generator/', { waitUntil: 'domcontentloaded' });
    if (res && res.status() >= 400) {
      throw new Error(`shape-generator returned HTTP ${res.status()} — use production server if dev (Turbopack) fails`);
    }
    await expect(page).toHaveURL(/\/en\/shape-generator/);
    await dismissShapeGeneratorOverlays(page);
    await expect(page.getByTestId('shape-generator-workspace')).toBeVisible({ timeout: 60000 });
    await exitSketchIfNeeded(page);
    await expect(page.getByRole('button', { name: 'Evaluate' })).toBeVisible({ timeout: 30000 });
    await pickBoxEvaluateWaitForAutoDrawing(page);
    await openAutoDrawingPanel(page);

    const panel = page.getByTestId('auto-drawing-panel');
    await expect(panel.getByTestId('auto-drawing-empty')).toHaveCount(0);

    await panel.getByTestId('auto-drawing-generate').click();

    await expect(panel.locator('[data-testid="auto-drawing-preview-svg"]')).toBeVisible({ timeout: 20000 });
    const svg = panel.locator('[data-testid="auto-drawing-preview-svg"]');
    await expect(svg.locator('line,path,polyline,rect').first()).toBeAttached();
  });

  test('after generate, box width change shows stale banner; regenerate clears it', async ({ page }) => {
    test.setTimeout(120_000);
    await seedShapeGeneratorForE2e(page);
    const res = await page.goto('/en/shape-generator/', { waitUntil: 'domcontentloaded' });
    if (res && res.status() >= 400) {
      throw new Error(`shape-generator returned HTTP ${res.status()} — use production server if dev (Turbopack) fails`);
    }
    await expect(page).toHaveURL(/\/en\/shape-generator/);
    await dismissShapeGeneratorOverlays(page);
    await expect(page.getByTestId('shape-generator-workspace')).toBeVisible({ timeout: 60000 });
    await exitSketchIfNeeded(page);
    await expect(page.getByRole('button', { name: 'Evaluate' })).toBeVisible({ timeout: 30000 });
    await pickBoxEvaluateWaitForAutoDrawing(page);
    await openAutoDrawingPanel(page);

    const panel = page.getByTestId('auto-drawing-panel');
    await expect(panel.getByTestId('auto-drawing-empty')).toHaveCount(0);
    await panel.getByTestId('auto-drawing-generate').click();
    await expect(panel.locator('[data-testid="auto-drawing-preview-svg"]')).toBeVisible({ timeout: 20000 });

    const widthNum = page.getByTestId('m4-box-width-number');
    await expect(widthNum).toBeVisible({ timeout: 10000 });
    await widthNum.clear();
    await widthNum.fill('120');
    await widthNum.blur();
    await expect(panel.getByTestId('auto-drawing-stale-banner')).toBeVisible({ timeout: 15000 });

    await panel.getByTestId('auto-drawing-generate').click();
    await expect(panel.getByTestId('auto-drawing-stale-banner')).toHaveCount(0);
  });
});
