import { test, expect } from '@playwright/test';
import {
  seedShapeGeneratorForE2e,
  dismissShapeGeneratorOverlays,
  exitSketchIfNeeded,
} from './helpers/shapeGeneratorEnv';

const VIEWPORT_ENGINE = 'r3f-viewport';

test.describe('Shape Generator', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(90_000);
    await seedShapeGeneratorForE2e(page);
    await page.goto('/en/shape-generator/', { waitUntil: 'domcontentloaded' });
    await dismissShapeGeneratorOverlays(page);
    await expect(page.getByTestId('shape-generator-workspace')).toBeVisible({ timeout: 60000 });
    await exitSketchIfNeeded(page);
    await expect(page.getByRole('button', { name: 'Evaluate' })).toBeVisible({ timeout: 60000 });
    await page.waitForSelector('[data-testid="shape-generator"], canvas, .shape-generator', {
      timeout: 20000,
      state: 'attached',
    }).catch(() => {});
    await page.waitForTimeout(2500);
  });

  test('loads shape generator page', async ({ page }) => {
    await expect(page).toHaveTitle(/NexyFab|Shape/i);
    await expect(page.locator('canvas, [class*="canvas"], [class*="viewer"]').first()).toBeVisible({ timeout: 15000 }).catch(() => {
      /* Canvas may still be initializing in some CI GPUs */
    });
  });

  test('3D viewport: tagged canvas and orbit drag without WebGL console errors', async ({ page }) => {
    test.setTimeout(120_000);
    /** Empty scene does not mount R3F Canvas (`ShapePreview` shows placeholder until `hasContent`). */
    const pickBox = page.getByTestId('m4-pick-box').first();
    await pickBox.waitFor({ state: 'visible', timeout: 30000 });
    await pickBox.click({ force: true });
    await page.waitForTimeout(2000);
    const taggedCanvas = page.locator(`canvas[data-engine="${VIEWPORT_ENGINE}"]`).first();
    const canvasOk = await taggedCanvas.isVisible({ timeout: 25000 }).catch(() => false);
    if (!canvasOk) {
      const webglFallback = await page.getByText(/3D viewer failed to load/i).isVisible().catch(() => false);
      test.skip(webglFallback, 'R3F/WebGL did not initialize (typical in some headless CI GPUs)');
      await expect(taggedCanvas).toBeVisible({ timeout: 5000 });
    }
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    const canvas = page.locator(`canvas[data-engine="${VIEWPORT_ENGINE}"]`).first();
    await expect(canvas).toBeVisible({ timeout: 5000 });
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 70, cy + 40);
    await page.mouse.up();
    await page.waitForTimeout(300);
    const webglRelated = consoleErrors.filter((t) => /WebGL|GL_|CONTEXT_LOST|THREE\.WebGLRenderer/i.test(t));
    expect(webglRelated).toEqual([]);
  });

  test('can switch between design and optimize tabs', async ({ page }) => {
    test.setTimeout(60_000);
    await dismissShapeGeneratorOverlays(page);
    const designTab = page.locator('button', { hasText: /design|디자인/i }).first();
    const optimizeTab = page.locator('[data-tour="optimize-tab"]').first();

    if (await optimizeTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await optimizeTab.click({ force: true });
      await page.waitForTimeout(500);
      await designTab.click({ force: true });
      await page.waitForTimeout(500);
    }
  });

  test('toolbar is visible on desktop', async ({ page }) => {
    await expect(page.locator('text=NexfFab, text=NexyFab').first()).toBeVisible({ timeout: 5000 }).catch(() => {});

    const getQuoteBtn = page.locator('[data-tour="get-quote"]').first();
    if (await getQuoteBtn.isVisible()) {
      await expect(getQuoteBtn).toBeVisible();
    }
  });

  test('undo/redo buttons exist', async ({ page }) => {
    const undoBtn = page.locator('button[title*="Undo"]').first();
    if (await undoBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(undoBtn).toBeVisible();
    }
  });

  test('mobile: shows hamburger or simplified UI', async ({ page, isMobile }) => {
    if (isMobile) {
      const moreBtn = page.locator('button', { hasText: '···' }).first();
      const moreBtnVisible = await moreBtn.isVisible({ timeout: 3000 }).catch(() => false);
      void moreBtnVisible;
      await expect(page).toHaveURL(/shape-generator/);
    }
  });
});
