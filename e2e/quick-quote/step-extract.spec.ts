/**
 * e2e/quick-quote/step-extract.spec.ts
 *
 * Regression for the "빠른 견적 STEP 업로드 → 치수 자동 추출" fix.
 * Uploads the repository-owned independent STEP evidence fixture and asserts
 * the BROWSER OCCT/mesh pipeline extracts geometry (no server parser dependency),
 * so the "Could not extract geometry. Please provide dimensions." dead-end is gone.
 *
 * Requires a dev server on the Playwright baseURL (npm run dev).
 * Not gated behind NEXYFAB_OCCT_REAL — this uses occt-import-js (public WASM),
 * which ships in public/ via `npm run prebuild`.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const STEP_NAME = 'nexyfab-c4-box-assembly.step';
const STEP_PATH = path.resolve(
  process.cwd(),
  'docs/evidence/cad-independent/local/mechanical-step-c4-260814/source.step',
);

test('quick-quote: STEP upload auto-extracts dimensions in the browser', async ({ page }) => {
  test.setTimeout(180_000); // first dev compile of shape-generator (three+replicad) is heavy

  // Surface page errors in the test output.
  page.on('console', m => { if (m.type() === 'error') console.log('[browser error]', m.text()); });

  await page.goto('/kr/quick-quote', { waitUntil: 'domcontentloaded' });

  // The dropzone's hidden multi-file input (accept=".step,.stp,.stl,.obj,.blend").
  const input = page.locator('input[type="file"][accept*=".step"]').first();
  await input.waitFor({ state: 'attached', timeout: 60_000 });

  const buffer = fs.readFileSync(STEP_PATH);
  await input.setInputFiles({
    name: STEP_NAME,
    mimeType: 'application/step',
    buffer,
  });

  // The green "자동 추출 완료" preview card appears once the browser pipeline
  // measures the part. Generous timeout: WASM init + tessellation.
  const preview = page.getByText('치수·부피 자동 추출 완료');
  await expect(preview).toBeVisible({ timeout: 120_000 });

  // The dead-end error must NOT be shown.
  await expect(page.getByText('Could not extract geometry')).toHaveCount(0);

  // Extracted bbox should be the evidence fixture size (100×60×20 mm). Assert the
  // longest dimension shows up so we know it's real geometry, not a fallback box.
  await expect(page.getByText('100×60×20 mm')).toBeVisible({ timeout: 5_000 });
});
