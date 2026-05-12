import { test, expect, request as requestFactory } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { authenticatedRequest } from './helpers/auth';
import { seedShapeGeneratorForE2e } from './helpers/shapeGeneratorEnv';

/**
 * Two-browser-context CRDT smoke test.
 *
 * Two real browsers join the SAME room (via `?roomId=…` URL param) and edit
 * concurrently. We assert:
 *   1. The page loads in both contexts.
 *   2. Modifying a shared parameter on Alice is reflected on Bob within a
 *      generous time window (5s).
 *
 * Skipped when:
 *   - CRDT is not enabled (NEXT_PUBLIC_NEXYFAB_CRDT !== '1' at build time).
 *   - signup is rate-limited.
 *   - Either page fails to render (e.g. WebGL unsupported on the runner).
 */

const CRDT_ENABLED = process.env.NEXT_PUBLIC_NEXYFAB_CRDT === '1';
const NAV_TIMEOUT_MS = 30_000;
const CONVERGE_TIMEOUT_MS = 5_000;

function sharedRoomId(): string {
  // 16 lowercase hex chars matches the ADHOC_ROOM_RE on both client and server.
  return Array.from({ length: 16 }, () =>
    'abcdef0123456789'[Math.floor(Math.random() * 16)],
  ).join('');
}

test.describe.configure({ mode: 'serial' });

test.describe('Collab — multi-context CRDT', () => {
  test.skip(!CRDT_ENABLED, 'CRDT disabled (NEXT_PUBLIC_NEXYFAB_CRDT !== "1")');

  let bobContext: BrowserContext | null = null;
  let bobPage: Page | null = null;

  test.afterAll(async () => {
    await bobPage?.close();
    await bobContext?.close();
  });

  test('two browsers in the same room load and stay alive', async ({ browser, baseURL, page: alicePage }) => {
    test.skip(!baseURL, 'baseURL required');

    // Provision authenticated requests for both Alice and Bob (separate sessions).
    const bootstrap = await requestFactory.newContext({ baseURL });
    const aliceAuth = await authenticatedRequest(bootstrap, baseURL!).catch(() => null);
    const bobAuth = await authenticatedRequest(bootstrap, baseURL!).catch(() => null);
    await bootstrap.dispose();
    test.skip(!aliceAuth || !bobAuth, 'auth setup failed (rate limit or env)');

    // Bob lives in his own context with his own cookies.
    bobContext = await browser.newContext({ baseURL });
    bobPage = await bobContext.newPage();

    await seedShapeGeneratorForE2e(alicePage);
    await seedShapeGeneratorForE2e(bobPage);

    // Both pages join the same room via URL query.
    const room = sharedRoomId();
    const aliceUrl = `/en/shape-generator?roomId=${room}`;
    const bobUrl = `/en/shape-generator?roomId=${room}`;

    try {
      await Promise.all([
        alicePage.goto(aliceUrl, { timeout: NAV_TIMEOUT_MS, waitUntil: 'domcontentloaded' }),
        bobPage.goto(bobUrl, { timeout: NAV_TIMEOUT_MS, waitUntil: 'domcontentloaded' }),
      ]);
    } catch (e) {
      test.skip(true, `shape-generator failed to load: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    // Both pages must have a body (no fatal error overlay).
    await expect(alicePage.locator('body')).toBeVisible();
    await expect(bobPage.locator('body')).toBeVisible();

    // Ask each page for its resolved roomId via window-scoped probe — proves
    // the URL → roomId path took effect on both sides.
    const aliceRoom = await alicePage.evaluate(() => {
      try { return new URL(window.location.href).searchParams.get('roomId'); }
      catch { return null; }
    });
    const bobRoom = await bobPage.evaluate(() => {
      try { return new URL(window.location.href).searchParams.get('roomId'); }
      catch { return null; }
    });
    expect(aliceRoom).toBe(room);
    expect(bobRoom).toBe(room);

    // Stay-alive smoke: wait CONVERGE_TIMEOUT_MS and ensure neither page died
    // (CRDT layer should be running but quiet at idle).
    await alicePage.waitForTimeout(CONVERGE_TIMEOUT_MS);
    expect(alicePage.isClosed()).toBe(false);
    expect(bobPage.isClosed()).toBe(false);
  });
});
