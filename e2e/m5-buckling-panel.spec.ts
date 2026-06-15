import { test, expect } from '@playwright/test';
import {
  seedShapeGeneratorForE2e,
  dismissShapeGeneratorOverlays,
  exitSketchIfNeeded,
  pickBoxEvaluateWaitForAutoDrawing,
} from './helpers/shapeGeneratorEnv';

/**
 * M5: FEA buckling panel — open via the Evaluate ribbon (🏛️ Buckling), Run, and
 * assert a critical-load-factor result renders. This is the browser-QA the
 * headless smoke (`BucklingAnalysisPanel.smoke.test.tsx`) can't cover: real
 * ribbon routing + dock mount + the solver run loop in a live page.
 *
 * Local: needs a server at E2E_BASE_URL (prod server recommended — Turbopack dev
 * can 500). CI: playwright.config `webServer`.
 */
test.describe('M5 buckling analysis panel', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name === 'mobile-chrome', 'Evaluate ribbon is desktop-oriented');
  });

  test('Evaluate → open Buckling → Run shows a critical load factor', async ({ page }) => {
    test.setTimeout(180_000);
    await seedShapeGeneratorForE2e(page);
    const res = await page.goto('/en/shape-generator/', { waitUntil: 'domcontentloaded' });
    if (res && res.status() >= 400) {
      throw new Error(`shape-generator returned HTTP ${res.status()} — use a production server if dev (Turbopack) fails`);
    }
    await expect(page).toHaveURL(/\/en\/shape-generator/);
    await dismissShapeGeneratorOverlays(page);
    await expect(page.getByTestId('shape-generator-workspace')).toBeVisible({ timeout: 60_000 });
    await exitSketchIfNeeded(page);
    await expect(page.getByRole('button', { name: 'Evaluate' })).toBeVisible({ timeout: 30_000 });

    // Evaluate a box (also gates the analysis buttons on hasResult).
    await pickBoxEvaluateWaitForAutoDrawing(page);

    // The 🏛️ Buckling analysis button is enabled once a result exists.
    const bucklingBtn = page.getByRole('button', { name: 'Buckling' });
    await expect(bucklingBtn).toBeEnabled({ timeout: 30_000 });
    await bucklingBtn.click();

    const panel = page.getByTestId('buckling-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // Run the (heavy) eigen-solve and wait for the result.
    await panel.getByTestId('buckling-run').click();
    await expect(panel.getByTestId('buckling-result')).toBeVisible({ timeout: 120_000 });

    // λcr is a positive finite number.
    const ktText = (await panel.getByTestId('buckling-kt').textContent())?.trim() ?? '';
    const kt = Number(ktText);
    expect(Number.isFinite(kt)).toBe(true);
    expect(kt).toBeGreaterThan(0);
  });
});

/**
 * D2 (constraint-driven dimension) + A1 (conflict overlay) e2e — written ahead of
 * the host wiring. The components + their parametric/solver logic are built and
 * unit/jsdom-tested (DrivingDimensionField.test.tsx, ConflictResolutionOverlay.test.tsx),
 * but they are NOT yet mounted in a reachable production flow. These are marked
 * `fixme` so they document the acceptance criteria without failing CI; remove the
 * `.fixme` once the components are placed in the drawing / assembly UI.
 */
test.describe('M5 pending host-wiring (fixme until mounted)', () => {
  test.fixme('D2: editing a driven dimension rebuilds the model', async () => {
    // PRECONDITION: DrivingDimensionField placed on a driven drawing dimension.
    // 1) open the drawing, focus a driven dimension field
    // 2) type a new value + Enter
    // 3) assert the 3D model rebuilds (bbox / param reflects scale·var+offset)
  });

  test.fixme('A1: an over-constrained assembly shows the conflict overlay + accept resolves it', async () => {
    // PRECONDITION: ConflictResolutionOverlay mounted in the assembly view, fed by
    // proposeConflictResolutions, with onAccept wired to drop the mate + re-solve.
    // 1) build an over-constrained assembly
    // 2) assert [data-testid="conflict-overlay"] is visible with a recommended chip
    // 3) click the recommended option → assert the overlay clears (resolved)
  });
});
