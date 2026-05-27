import { test, expect } from '@playwright/test';

// PWA manifest — confirms the webmanifest is served, parseable, and lists
// the shortcuts the user can pin from the install prompt.

test.describe('PWA manifest', () => {
  test('manifest.webmanifest is reachable', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json.name).toMatch(/NexyFab/);
    expect(json.start_url).toBeDefined();
    expect(Array.isArray(json.icons)).toBe(true);
    expect(json.icons.length).toBeGreaterThanOrEqual(3);
  });

  test('declares NexyFab shortcuts', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    const json = await res.json();
    expect(Array.isArray(json.shortcuts)).toBe(true);
    const urls = (json.shortcuts as { url: string }[]).map(s => s.url);
    expect(urls.some(u => /shape-generator/.test(u))).toBe(true);
    expect(urls.some(u => /ai-studio/.test(u))).toBe(true);
  });

  test('page links to the webmanifest', async ({ page }) => {
    await page.goto('/kr/');
    const href = await page.locator('link[rel="manifest"]').first().getAttribute('href');
    expect(href).toContain('manifest.webmanifest');
  });
});
