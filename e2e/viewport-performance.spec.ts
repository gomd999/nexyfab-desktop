import { expect, test, type Page } from '@playwright/test';
import type { ViewportPerformanceSnapshot, ViewportPerformanceVerdict } from '../src/lib/viewportPerformance';
import { dismissShapeGeneratorOverlays, seedShapeGeneratorForE2e } from './helpers/shapeGeneratorEnv';

type Measurement = { snapshot: ViewportPerformanceSnapshot; verdict: ViewportPerformanceVerdict };

async function installCollector(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const measurements: unknown[] = [];
    Object.defineProperty(window, '__nexyfabViewportMeasurements', { value: measurements, configurable: true });
    window.addEventListener('nexyfab:viewport-performance', ((event: CustomEvent) => {
      measurements.push(event.detail);
    }) as EventListener);
  });
}

test.describe('viewport performance release budgets', () => {
  const enforceHardwareBudget = process.env.PW_ENFORCE_GPU_BUDGET === '1';
  for (const tier of ['S', 'M', 'L', 'XL'] as const) {
    test(`${tier} fixture is measured and stays in budget`, async ({ page }, testInfo) => {
      test.setTimeout(300_000);
      await installCollector(page);
      await seedShapeGeneratorForE2e(page);
      await page.goto(`/en/shape-generator/?expert=1&viewportBenchmark=${tier}`, { waitUntil: 'domcontentloaded' });
      await dismissShapeGeneratorOverlays(page);

      const hud = page.getByTestId('viewport-performance');
      await expect(hud).toBeVisible({ timeout: 180_000 });
      await expect(hud).toHaveAttribute('data-complexity-tier', tier, { timeout: 120_000 });
      await expect.poll(() => page.evaluate((wantedTier) => {
        const values = (window as typeof window & { __nexyfabViewportMeasurements?: Measurement[] })
          .__nexyfabViewportMeasurements ?? [];
        return values.some(item => item.verdict.tier === wantedTier);
      }, tier), { timeout: 120_000 }).toBe(true);

      const measurement = await page.evaluate((wantedTier) => {
        const values = (window as typeof window & { __nexyfabViewportMeasurements?: Measurement[] })
          .__nexyfabViewportMeasurements ?? [];
        return values.findLast(item => item.verdict.tier === wantedTier) ?? null;
      }, tier);
      expect(measurement).not.toBeNull();
      await testInfo.attach(`viewport-${tier}.json`, {
        body: JSON.stringify(measurement, null, 2), contentType: 'application/json',
      });
      expect(measurement!.snapshot.triangles).toBeGreaterThan(
        tier === 'S' ? 20_000 : tier === 'M' ? 50_000 : tier === 'L' ? 250_000 : 1_000_000,
      );
      if (enforceHardwareBudget) {
        expect(measurement!.verdict.violations).toEqual([]);
        expect(measurement!.verdict.passed).toBe(true);
      }
    });
  }
});
