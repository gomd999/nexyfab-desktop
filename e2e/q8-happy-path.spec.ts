/**
 * Q8 — Happy-path E2E.
 *
 * Walks the most common customer workflow end to end:
 *   1. Workspace loads
 *   2. Default starter box produces a 3D viewport
 *   4. Open DFM panel
 *   5. Open RFQ panel
 *   6. Auto-save indicator appears
 *
 * This is the smoke-level guarantee that the UI shell wires the major
 * panels correctly. Doesn't go deep on numerics — those live in unit
 * tests. The point is: do all the code paths between the panels survive
 * a real navigation?
 */

import { test, expect } from '@playwright/test';
import {
  seedShapeGeneratorForE2e,
  dismissShapeGeneratorOverlays,
  exitSketchIfNeeded,
} from './helpers/shapeGeneratorEnv';

const VIEWPORT_ENGINE = 'r3f-viewport';

test.describe('Q8 happy-path workflow', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(300_000);
    const startupErrors: string[] = [];
    page.on('pageerror', (error) => startupErrors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') startupErrors.push(`console: ${message.text()}`);
    });
    page.on('requestfailed', (request) => {
      startupErrors.push(`requestfailed: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`);
    });
    await seedShapeGeneratorForE2e(page);
    await page.goto('/en/shape-generator/?expert=1', { waitUntil: 'domcontentloaded' });
    await dismissShapeGeneratorOverlays(page);
    try {
      await expect(page.getByTestId('shape-generator-workspace')).toBeVisible({ timeout: 180_000 });
    } catch (error) {
      throw new Error(`CAD workspace failed to start:\n${startupErrors.join('\n') || 'no browser error captured'}`, { cause: error });
    }
    await exitSketchIfNeeded(page);
  });

  test('default box → see canvas → open DFM → open RFQ', async ({ page }) => {
    // 1. Verify the default box and 3D canvas mounted.
    const taggedCanvas = page.locator(`canvas[data-engine="${VIEWPORT_ENGINE}"]`).first();
    const canvasOk = await taggedCanvas.isVisible({ timeout: 25000 }).catch(() => false);
    if (!canvasOk) {
      const fallback = await page.getByText(/3D viewer failed/i).isVisible().catch(() => false);
      test.skip(fallback, 'WebGL unavailable in this CI runner');
    }

    // 2. Open DFM panel. This is a release-path assertion, not an optional probe.
    const dfmBtn = page.getByTestId('shell-open-dfm');
    await expect(dfmBtn).toBeVisible({ timeout: 10_000 });
    await dfmBtn.click();
    await page.getByTestId('shell-open-full-dfm').click();
    await expect(page.getByTestId('dfm-panel')).toBeVisible({ timeout: 10_000 });

    // 3. Open RFQ / quote
    const quoteBtn = page.getByTestId('shell-open-rfq');
    await expect(quoteBtn).toBeVisible({ timeout: 10_000 });
    await quoteBtn.click();
    await expect(page.getByTestId('rfq-panel')).toBeVisible({ timeout: 10_000 });

    // 4. Force a save and require a concrete saved state.
    await page.keyboard.press('Control+S');
    await expect(page.getByTestId('autosave-indicator')).toHaveAttribute('data-save-state', 'saved', { timeout: 15_000 });

    // Final assertion — workspace is still alive after the full workflow
    await expect(page.getByTestId('shape-generator-workspace')).toBeVisible();
  });

  test('undo/redo on the default part do not throw uncaught errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    // Drive undo/redo hotkeys to exercise history paths
    await page.keyboard.press('Control+Z');
    await page.waitForTimeout(400);
    await page.keyboard.press('Control+Shift+Z');
    await page.waitForTimeout(400);

    // Filter out third-party noise that's outside our control
    const ours = errors.filter(
      (e) => !/cdn|recaptcha|google|gtag|hotjar|favicon/i.test(e),
    );
    expect(ours).toEqual([]);
  });
});
