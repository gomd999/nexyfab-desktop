import { expect, test } from '@playwright/test';

const CAD_URL =
  '/en/shape-generator/?expert=1&mode=expert&domain=mechanical&experience=expert&workMode=precision_cad';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const metrics = { lcp: 0, cls: 0 };
    Object.defineProperty(window, '__nexyfabVitals', { value: metrics, configurable: true });
    new PerformanceObserver(list => {
      const entries = list.getEntries();
      const last = entries.at(-1);
      if (last) metrics.lcp = last.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (!shift.hadRecentInput) metrics.cls += shift.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
});

test('desktop precision CAD controls remain separate and accessible', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chrome', 'desktop precision workspace');
  test.setTimeout(120_000);

  const response = await page.goto(CAD_URL, { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBeLessThan(400);
  await expect(page).toHaveURL(/\/en\/shape-generator\/\?expert=1/);
  await expect(page.getByTestId('shape-generator-workspace')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => page.locator('canvas').count(), { timeout: 60_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(4_000);

  const result = await page.evaluate(() => {
    const isVisible = (element: Element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const fields = [...document.querySelectorAll('input, select, textarea')].filter(isVisible);
    const missingFieldIdentity = fields.filter(element => {
      const id = element.id;
      const label =
        element.getAttribute('aria-label') ||
        element.getAttribute('aria-labelledby') ||
        (id && document.querySelector(`label[for="${CSS.escape(id)}"]`));
      return !element.getAttribute('name') || !label;
    }).length;

    const rect = (element: Element | null) => element?.getBoundingClientRect() ?? null;
    const overlaps = (a: DOMRect | null, b: DOMRect | null) =>
      !!a && !!b && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
    const drawing = rect(document.querySelector('[data-testid="drawing-view-toggle"]'));
    const rightView = rect(document.querySelector('button[title^="Right [6]"]'));
    const circle = rect(document.querySelector('.nx-ribbon button[title="Circle"]'));
    const leftTabs = rect(document.querySelector('.nx-panel:not(.right) .nx-panel-tabs'));
    const collapseTargets = [...document.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="Collapse left panel"], button[aria-label="Collapse right panel"]',
    )].map(button => {
      const bounds = button.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    });
    const wireIcon = document.querySelector('button[aria-label="Wire"] span[aria-hidden="true"]');

    const vitals = (window as Window & {
      __nexyfabVitals?: { lcp: number; cls: number };
    }).__nexyfabVitals ?? { lcp: 0, cls: 0 };

    return {
      overflowX: document.documentElement.scrollWidth - innerWidth,
      missingFieldIdentity,
      drawingOverlapsRightView: overlaps(drawing, rightView),
      circleOverlapsLeftTabs: overlaps(circle, leftTabs),
      collapseTargets,
      wireIconHiddenFromAccessibilityTree: !!wireIcon,
      canvasCount: document.querySelectorAll('canvas').length,
      vitals,
    };
  });

  expect(result.overflowX).toBe(0);
  expect(result.missingFieldIdentity).toBe(0);
  expect(result.drawingOverlapsRightView).toBe(false);
  expect(result.circleOverlapsLeftTabs).toBe(false);
  expect(result.collapseTargets).toHaveLength(2);
  expect(result.collapseTargets.every(target => target.width >= 24 && target.height >= 24)).toBe(true);
  expect(result.wireIconHiddenFromAccessibilityTree).toBe(true);
  expect(result.canvasCount).toBeGreaterThan(0);
  expect(result.vitals.cls).toBeLessThanOrEqual(0.1);

  const llms = await page.request.get('/llms.txt');
  expect(llms.ok()).toBe(true);
  expect(await llms.text()).toMatch(/https:\/\//);
  testInfo.annotations.push({
    type: 'web-vitals',
    description: `LCP=${Math.round(result.vitals.lcp)}ms CLS=${result.vitals.cls.toFixed(4)}`,
  });
  console.log(`[precision-ui] LCP=${Math.round(result.vitals.lcp)}ms CLS=${result.vitals.cls.toFixed(4)}`);
});

test('mobile uses the view-only surface without horizontal escape', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome', 'mobile view-only workspace');
  test.setTimeout(120_000);

  const response = await page.goto(CAD_URL, { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBeLessThan(400);
  // Mobile intentionally returns before the desktop workspace wrapper and
  // exposes the dedicated view-only surface instead.
  await expect(page.getByText('View only', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Open this design on a desktop|PC/)).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2_000);

  const result = await page.evaluate(() => {
    const visibleButtons = [...document.querySelectorAll<HTMLButtonElement>('button')].filter(button => {
      const style = getComputedStyle(button);
      const rect = button.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    });
    return {
      overflowX: document.documentElement.scrollWidth - innerWidth,
      escapedButtons: visibleButtons.filter(button => {
        const rect = button.getBoundingClientRect();
        return rect.left < 0 || rect.right > innerWidth;
      }).map(button => (button.textContent ?? '').trim().slice(0, 40)),
      guestBannerVisible: document.body.innerText.includes('Guest mode'),
    };
  });

  expect(result.overflowX).toBe(0);
  expect(result.escapedButtons).toEqual([]);
  expect(result.guestBannerVisible).toBe(false);
});
