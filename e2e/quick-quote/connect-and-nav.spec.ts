/**
 * Verifies the two follow-up changes:
 *  ① The desktop-app "다운로드/Download" nav tab is hidden.
 *  ② 빠른견적 → 완제품평가 file handoff: a STEP stashed under
 *     `nexyfab:evaluate-file` is auto-imported + measured on the evaluate page.
 * Requires a server on the Playwright baseURL.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const STEP_NAME = 'nexyfab-c4-box-assembly.step';
const STEP_PATH = path.resolve(
  process.cwd(),
  'docs/evidence/cad-independent/local/mechanical-step-c4-260814/source.step',
);

test('① download nav tab is hidden', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/kr', { waitUntil: 'domcontentloaded' });
  // Header nav should not link to /kr/download anymore.
  await expect(page.locator('header a[href$="/download/"], header a[href$="/download"]')).toHaveCount(0);
  // But the page itself is still reachable directly.
  const resp = await page.goto('/kr/download', { waitUntil: 'domcontentloaded' });
  expect(resp?.status()).toBeLessThan(400);
});

test('② evaluate auto-imports a handed-off STEP file', async ({ page }) => {
  test.setTimeout(180_000);
  const b64 = fs.readFileSync(STEP_PATH).toString('base64');

  // Seed the handoff payload before the evaluate page mounts (mirrors what
  // quick-quote's handoff button writes), then load evaluate.
  await page.addInitScript(([name, data]) => {
    sessionStorage.setItem('nexyfab:evaluate-file', JSON.stringify({ name, b64: data }));
  }, [STEP_NAME, b64]);

  await page.goto('/kr/nexyfab/evaluate', { waitUntil: 'load' });

  // The file name should appear (import kicked off) …
  await expect(page.getByText(STEP_NAME)).toBeVisible({ timeout: 120_000 });
  // … and the measured metrics (evidence fixture bbox longest dim 100 mm) should render.
  await expect(page.getByText(/100/)).toBeVisible({ timeout: 120_000 });
});
