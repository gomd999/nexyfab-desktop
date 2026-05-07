import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * M3: 브라우저에서 골든 .nfab 열기 → 어셈블리 파트 수 확인 → 새로고침 후 재열기; 웹에서는 Ctrl+S로 다운로드한 .nfab을 재열어 round-trip 검증.
 *
 * 로컬: `E2E_BASE_URL`을 띄운 서버에 맞춤. 기본 `npm run dev`(Turbopack)는 일부 환경에서 shape-generator 500 가능 → `npm run build && npx next start -p 3334` 권장.
 * CI: `playwright.config`의 webServer(build+start)로 동작.
 */
const GOLDEN_REL = join('tests', 'golden', 'm3-assembly-minimal.nfab.json');

async function loadGoldenNfab(page: import('@playwright/test').Page) {
  await page.keyboard.press('Control+O');
  const input = page.locator('input[type="file"]');
  await input.last().waitFor({ state: 'attached', timeout: 15000 });
  await input.last().setInputFiles(join(process.cwd(), GOLDEN_REL));
}

test.describe('M3 assembly — golden nfab', () => {
  test.beforeEach(({ }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile-chrome', 'desktop file upload');
  });

  test('Ctrl+O loads two-part assembly; reload + reopen keeps BOM count', async ({ page }) => {
    test.setTimeout(120_000);
    const res = await page.goto('/en/shape-generator/', { waitUntil: 'domcontentloaded' });
    if (res && res.status() >= 400) {
      throw new Error(`shape-generator returned HTTP ${res.status()} — use production server if dev (Turbopack) fails`);
    }
    await expect(page).toHaveURL(/\/en\/shape-generator/);
    await page.waitForTimeout(2000);

    await loadGoldenNfab(page);
    await expect(page.getByTestId('assembly-bom-count')).toHaveText('(2)', { timeout: 40000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/en\/shape-generator/);
    await page.waitForTimeout(2000);

    await loadGoldenNfab(page);
    await expect(page.getByTestId('assembly-bom-count')).toHaveText('(2)', { timeout: 40000 });
  });

  /**
   * 웹: Ctrl+S는 `downloadBlob`로 .nfab 다운로드(Tauri가 아닐 때). 저장 파일을 다시 열어 BOM이 유지되는지 검증.
   */
  test('Ctrl+S saves .nfab download; reload + reopen saved file keeps BOM (2)', async ({ page }) => {
    test.setTimeout(180_000);
    const res = await page.goto('/en/shape-generator/', { waitUntil: 'domcontentloaded' });
    if (res && res.status() >= 400) {
      throw new Error(`shape-generator returned HTTP ${res.status()} — use production server if dev (Turbopack) fails`);
    }
    await expect(page).toHaveURL(/\/en\/shape-generator/);
    await page.waitForTimeout(2000);

    await loadGoldenNfab(page);
    await expect(page.getByTestId('assembly-bom-count')).toHaveText('(2)', { timeout: 40000 });

    const dir = await mkdtemp(join(tmpdir(), 'm3-e2e-save-'));
    const outPath = join(dir, 'roundtrip.nfab');
    try {
      const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
      await page.keyboard.press('Control+S');
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/\.nfab$/i);
      await download.saveAs(outPath);

      const raw = await readFile(outPath, 'utf-8');
      const proj = JSON.parse(raw) as { assembly?: { placedParts?: unknown[] } };
      expect(proj.assembly?.placedParts?.length).toBe(2);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/en\/shape-generator/);
      await page.waitForTimeout(2000);

      await page.keyboard.press('Control+O');
      const input = page.locator('input[type="file"]');
      await input.last().waitFor({ state: 'attached', timeout: 15000 });
      await input.last().setInputFiles(outPath);
      await expect(page.getByTestId('assembly-bom-count')).toHaveText('(2)', { timeout: 40000 });
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
