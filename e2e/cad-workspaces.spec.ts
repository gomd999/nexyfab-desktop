import { test, expect } from '@playwright/test';

/**
 * CAD workspace switcher — drives the Fusion-style workspace dropdown across the
 * main workspaces and asserts each switches and re-renders without crashing.
 * Complements the per-workspace specs (m3 assembly, m4 drawing, m5 buckling) by
 * exercising the switcher itself. The <select> is visually custom-styled, so we
 * set its value + fire a native change (React onChange) rather than selectOption.
 */
test.describe('CAD workspace switcher', () => {
  test('switches across workspaces without crashing', async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|401|403|gtag|cookie|hydrat|418|requestStorage|ResizeObserver/i.test(m.text())) errors.push(m.text());
    });

    await page.goto('/en/shape-generator?mode=expert', { waitUntil: 'domcontentloaded' });
    // The modeler boots its WASM/scene asynchronously; wait for the workspace select.
    const sel = page.locator('select').filter({ has: page.locator('option[value="drawing"]') }).first();
    await expect(sel).toHaveCount(1, { timeout: 60_000 });

    for (const ws of ['drawing', 'manufacture', 'simulation', 'design']) {
      await sel.evaluate((el, v) => {
        const set = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
        set.call(el, v);
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, ws);
      await page.waitForTimeout(2500);
      await expect(sel).toHaveJSProperty('value', ws);
      await expect(page.locator('canvas').first()).toBeVisible();
    }

    expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
