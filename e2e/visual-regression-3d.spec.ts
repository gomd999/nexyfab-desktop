/**
 * Visual regression PoC — Wave 0 Day 6.
 *
 * Goal: prove the pipeline can catch a 3D viewport pixel-level regression.
 *
 * The 3D canvas has known sources of non-determinism (SwiftShader vs real GPU,
 * AA dithering, frame timing). We absorb those with:
 *   - `maxDiffPixelRatio: 0.005` — 0.5% of pixels allowed to differ
 *   - `threshold: 0.2` — anti-aliasing tolerance per pixel
 *   - explicit settle delay (1500ms) so multiple render-on-update passes
 *     complete before snapshot
 *
 * To run locally:
 *   npm run dev       # in one terminal
 *   npx playwright test e2e/visual-regression-3d.spec.ts --update-snapshots
 *
 * First run creates the baseline png next to this file. Subsequent runs
 * compare. In CI, run without `--update-snapshots` to enforce.
 *
 * This is intentionally one scenario. The catalog will grow per Wave —
 * e.g. Wave 1 adds STEP-export-of-cylinder, Wave 3 adds drawing-PDF preview.
 */

import { test, expect } from '@playwright/test';

test.describe('3D viewport visual regression', () => {
  test('shape-generator default cube renders deterministically', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('nf_onboarding_done', '1');
      } catch { /* ignore */ }
    });

    await page.goto('/en/shape-generator/');

    // Wait for the 3D viewport to mount. .nx-viewport is the canvas wrapper
    // (per useTouchGestures hook) — exists once shape-generator hydrates.
    await page.locator('.nx-viewport, canvas').first().waitFor({ state: 'visible', timeout: 30_000 });

    // Settle: give 3D renderer time to finish all post-mount update passes
    // (env map prep, OCCT init detection, default cube generation).
    await page.waitForTimeout(1500);

    // Hide chrome that animates (toasts, blinking selection cursor) so the
    // diff is stable across runs.
    await page.addStyleTag({
      content: `
        [data-toast], [aria-live], .blink, .pulse { display: none !important; }
        * { caret-color: transparent !important; }
      `,
    });

    await expect(page).toHaveScreenshot('shape-generator-default-cube.png', {
      // 0.5% of pixels may differ — absorbs AA/swiftshader noise.
      maxDiffPixelRatio: 0.005,
      // Per-pixel color tolerance — 0.2 absorbs subtle gamma/AA shifts.
      threshold: 0.2,
      // Full page is too noisy (header/nav animate). Just the viewport.
      clip: { x: 0, y: 100, width: 1024, height: 600 },
      animations: 'disabled',
    });
  });
});
