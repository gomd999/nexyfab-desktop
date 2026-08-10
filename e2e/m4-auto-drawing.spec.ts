import { expect, test, type Page } from '@playwright/test';
import {
  dismissShapeGeneratorOverlays,
  exitSketchIfNeeded,
  pickBoxWaitForGeometry,
  seedShapeGeneratorForE2e,
} from './helpers/shapeGeneratorEnv';

async function openDrawingWorkspace(page: Page): Promise<void> {
  await seedShapeGeneratorForE2e(page);
  const response = await page.goto('/en/shape-generator/?expert=1', { waitUntil: 'domcontentloaded' });
  expect(response?.status() ?? 500).toBeLessThan(400);
  await dismissShapeGeneratorOverlays(page);
  await expect(page.getByTestId('shape-generator-workspace')).toBeVisible({ timeout: 60_000 });
  await exitSketchIfNeeded(page);
  await pickBoxWaitForGeometry(page);
  await page.locator('button.tab').filter({ hasText: /^Drawing$/ }).click();
  await expect(page).toHaveURL(
    url => url.pathname === '/en/shape-generator/drawing/' && url.searchParams.get('expert') === '1',
    { timeout: 30_000 },
  );
}

test.describe('M4 production drawing workspace', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name === 'mobile-chrome', 'desktop drawing workspace');
  });

  test('modeler Drawing tab opens the production sheet with export controls', async ({ page }) => {
    test.setTimeout(150_000);
    await openDrawingWorkspace(page);
    await expect(page.getByTestId('drawing-page-root')).toBeVisible();
    await expect(page.getByTestId('drawing-export-pdf-button')).toBeVisible();
    await expect(page.getByTestId('drawing-export-dxf-button')).toBeVisible();
    const sheet = page.locator('svg[data-testid="sheet-renderer-root"]');
    await expect(sheet).toHaveCount(1);
    await expect(sheet.locator('line, polyline, path').first()).toBeAttached();
  });

  test('part and paper controls keep the production sheet live', async ({ page }) => {
    test.setTimeout(150_000);
    await openDrawingWorkspace(page);
    await page.getByTestId('drawing-part-select').selectOption('sample-cylinder');
    await page.getByTestId('drawing-paper-select').selectOption('A4');
    await expect(page.getByTestId('drawing-part-select')).toHaveValue('sample-cylinder');
    await expect(page.getByTestId('drawing-paper-select')).toHaveValue('A4');
    await expect(page.locator('svg[data-testid="sheet-renderer-root"] line, svg[data-testid="sheet-renderer-root"] polyline, svg[data-testid="sheet-renderer-root"] path').first()).toBeAttached();
  });
});
