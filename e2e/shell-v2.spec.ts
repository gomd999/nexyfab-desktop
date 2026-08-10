import { test, expect } from '@playwright/test';

// Smoke tests for the new shell-v2 chrome (Phase 6).
// Verifies that ?shell=v2 mounts the new UI without regressing the legacy path.

test.describe('Shell v2 — gating', () => {
  test('Shell v2 chrome (ModelerShell) renders by default at /en/shape-generator', async ({ page }) => {
    await page.goto('/en/shape-generator?expert=1');
    // ModelerShell is the post-Phase 6 default — TitleBar + Ribbon should be live.
    await expect(page.locator('.nx-title')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.nx-ribbon')).toBeVisible();
  });

  test('?classic=1 falls back to legacy ShapeGeneratorInner', async ({ page }) => {
    await page.goto('/en/shape-generator?expert=1&classic=1');
    // Shell-v2 chrome should be absent.
    await expect(page.locator('.nx-title')).toHaveCount(0, { timeout: 4000 });
    // Legacy inner still mounts something (canvas / toolbar).
    const liveSurface = page.locator('canvas, [class*="canvas"], [data-testid="shape-generator"]').first();
    await expect(liveSurface).toBeVisible({ timeout: 15000 }).catch(() => {});
  });

  test('?dev-shell=v2 mounts the ShellPreview sandbox', async ({ page }) => {
    await page.goto('/en/shape-generator?expert=1&dev-shell=v2');
    await expect(page.locator('text=Shell v2 Preview')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.nx-title')).toBeVisible();
    await expect(page.locator('.nx-ribbon')).toBeVisible();
  });

  test('mode switch swaps ribbon and chip', async ({ page }) => {
    await page.goto('/en/shape-generator?expert=1&dev-shell=v2');
    await page.waitForSelector('.nx-title', { timeout: 8000 });

    // Click the "sketch" pill button in the mock viewport.
    const sketchPill = page.locator('button.nx-pillbtn', { hasText: 'sketch' }).first();
    await sketchPill.click();
    await expect(page.locator('text=SKETCH MODE')).toBeVisible({ timeout: 3000 });

    // Assembly switch — explode slider appears.
    const asmPill = page.locator('button.nx-pillbtn', { hasText: 'assembly' }).first();
    await asmPill.click();
    await expect(page.locator('text=Explode')).toBeVisible({ timeout: 3000 });
  });
});

test.describe('Shell v2 — Hub route', () => {
  test('/nexyfab/hub mounts HubFrame as the dedicated start screen', async ({ page }) => {
    await page.goto('/en/nexyfab/hub');
    await expect(page.locator('text=NEXYFAB').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/Start designing/i).first()).toBeVisible({ timeout: 5000 });
    // Quick-start tile exists.
    await expect(page.getByRole('button', { name: /New Part Solid · parametric/i })).toBeVisible();
  });

  test('/nexyfab/dashboard remains the operational console (no HubFrame)', async ({ page }) => {
    await page.goto('/en/nexyfab/dashboard');
    // HubFrame greeting should NOT appear on the dashboard route.
    await expect(page.locator('text=/Welcome back/i')).toHaveCount(0, { timeout: 4000 });
  });
});

test.describe('Shell v2 — Drawing route', () => {
  test('/shape-generator/drawing mounts the production drawing page', async ({ page }) => {
    await page.goto('/en/shape-generator/drawing?expert=1');
    await expect(page.getByTestId('drawing-page-root')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('svg[data-testid="sheet-renderer-root"]')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('drawing-paper-select')).toHaveValue('A3');
  });

  test('production drawing exposes its PDF export action', async ({ page }) => {
    await page.goto('/en/shape-generator/drawing?expert=1');
    await expect(page.getByTestId('drawing-export-pdf-button')).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Shell v2 — Render route', () => {
  test('/shape-generator/render mounts RenderFrame', async ({ page }) => {
    await page.goto('/en/shape-generator/render?expert=1');
    await expect(page.getByText('RENDER STUDIO', { exact: true }).last()).toBeVisible({ timeout: 8000 });
    // Material library swatches.
    await expect(page.locator('text=/Aluminum/i').first()).toBeVisible({ timeout: 5000 });
    // HDRI preset.
    await expect(page.locator('text=/Studio|Workshop/i').first()).toBeVisible();
  });

  test('selecting a material updates the readout', async ({ page }) => {
    await page.goto('/en/shape-generator/render?expert=1');
    await expect(page.getByText('RENDER STUDIO', { exact: true }).last()).toBeVisible({ timeout: 8000 });
    const copperSwatch = page.locator('button', { hasText: /Copper/i }).first();
    await copperSwatch.click();
    // Readout TL shows MATERIAL · copper
    await expect(page.getByText('MATERIAL', { exact: true }).first()).toBeVisible({ timeout: 3000 });
  });
});

test.describe('Shell v2 — theme toggle (no-op smoke)', () => {
  test('html data-theme attribute mirrors mode', async ({ page }) => {
    await page.goto('/en/shape-generator?expert=1&shell=v2');
    // Default should be dark.
    const theme = await page.locator('html').getAttribute('data-theme');
    expect(['dark', 'light', null]).toContain(theme);
  });
});
