import { expect, test } from '@playwright/test';
import {
  dismissShapeGeneratorOverlays,
  exitSketchIfNeeded,
  pickBoxWaitForGeometry,
  seedShapeGeneratorForE2e,
} from './helpers/shapeGeneratorEnv';

test.describe('M5 buckling analysis panel', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name === 'mobile-chrome', 'desktop analysis drawer');
  });

  test('FEA drawer → Buckling → Run shows a critical load factor', async ({ page }) => {
    test.setTimeout(180_000);
    await seedShapeGeneratorForE2e(page);
    const response = await page.goto('/en/shape-generator/?expert=1', { waitUntil: 'domcontentloaded' });
    expect(response?.status() ?? 500).toBeLessThan(400);
    await dismissShapeGeneratorOverlays(page);
    await expect(page.getByTestId('shape-generator-workspace')).toBeVisible({ timeout: 60_000 });
    await exitSketchIfNeeded(page);
    await pickBoxWaitForGeometry(page);

    await page.getByTestId('shell-open-verify').click();
    await page.getByRole('button', { name: 'FEA', exact: true }).click();
    await page.getByRole('button', { name: 'Buckling', exact: true }).click();
    await page.getByRole('button', { name: /^Run/ }).click();

    const panel = page.getByTestId('buckling-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await panel.getByTestId('buckling-run').click();
    await expect(panel.getByTestId('buckling-result')).toBeVisible({ timeout: 120_000 });

    const factorText = (await panel.getByTestId('buckling-kt').textContent())?.trim() ?? '';
    const factor = Number(factorText);
    expect(Number.isFinite(factor)).toBe(true);
    expect(factor).toBeGreaterThan(0);
  });
});

test.describe('M5 pending host-wiring (fixme until mounted)', () => {
  test.fixme('D2: editing a driven dimension rebuilds the model', async () => {});
  test.fixme('A1: an over-constrained assembly shows the conflict overlay + accept resolves it', async () => {});
});
