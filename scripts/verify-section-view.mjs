#!/usr/bin/env node
/**
 * Browser-verify the Drawing "Add section view" control on production.
 * Navigates to the standalone drawing route, clicks the button, and asserts
 * a real cross-section outline (data-testid section-outline-*) is rendered.
 */
import { chromium } from 'playwright';

const URL = process.env.URL || 'https://nexyfab.com/kr/shape-generator/drawing';

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

try {
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('[data-testid="drawing-page-canvas"]', { timeout: 30000 });

  const btn = page.locator('[data-testid="drawing-add-section"]');
  await btn.waitFor({ state: 'visible', timeout: 15000 });
  const disabled = await btn.isDisabled();
  console.log(`Button visible. disabled=${disabled}`);

  await btn.click();
  // Section viewport renders <SectionGeometry> with section-outline-* paths.
  await page.waitForSelector('[data-testid^="section-outline"]', { timeout: 15000 });
  const outlines = await page.locator('[data-testid^="section-outline"]').count();
  const countLabel = await page.locator('[data-testid="drawing-section-count"]').textContent();
  const dAttr = await page.locator('[data-testid^="section-outline"]').first().getAttribute('d');

  console.log(`✓ Section outlines rendered: ${outlines}`);
  console.log(`✓ Count label: ${countLabel}`);
  console.log(`✓ First outline path starts: ${(dAttr || '').slice(0, 40)}…`);

  await page.screenshot({ path: 'scripts/section-view-verify.png' });
  console.log('Screenshot: scripts/section-view-verify.png');

  if (outlines < 1 || !(dAttr || '').startsWith('M')) {
    console.error('FAIL: no real cross-section path produced.');
    process.exit(1);
  }
  if (errors.length) console.log(`(console errors: ${errors.length})`, errors.slice(0, 3));
  console.log('\nPASS: Add section view produces a visible cross-section on production.');
} finally {
  await browser.close();
}
