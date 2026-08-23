import { expect, test, type Page, type Response } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const SESSION_PATH = '/api/auth/session';
const REFRESH_PATH = '/api/auth/refresh';

function pathname(url: string): string {
  const path = new URL(url).pathname;
  return path.length > 1 ? path.replace(/\/$/, '') : path;
}

function isNotificationPath(path: string): boolean {
  return path === '/api/nexyfab/notifications'
    || path === '/api/notifications'
    || path.startsWith('/api/notifications/');
}

interface Surface {
  name: string;
  href: string;
  ready(page: Page): Promise<void>;
}

const surfaces: Surface[] = [
  {
    name: 'landing',
    href: '/en/',
    async ready(page) {
      await expect(page).toHaveTitle(/NexyFab/i);
      await expect(page.locator('textarea').first()).toBeVisible({ timeout: 30_000 });
    },
  },
  {
    name: 'AI design',
    href: '/en/nexyfab/ai/',
    async ready(page) {
      await expect(page).toHaveURL(/\/en\/nexyfab\/ai\/?$/);
      await expect(page.locator('textarea').first()).toBeVisible({ timeout: 30_000 });
    },
  },
  {
    name: 'precision CAD',
    href: '/en/shape-generator/?expert=1&mode=expert',
    async ready(page) {
      await expect(page.getByTestId('shape-generator-workspace')).toBeVisible({ timeout: 90_000 });
    },
  },
];

async function assertGuestNetworkContract(page: Page, surface: Surface): Promise<void> {
  await page.context().clearCookies();
  await page.addInitScript(() => {
    try { window.localStorage.clear(); } catch { /* storage can be unavailable */ }
    try { window.sessionStorage.clear(); } catch { /* storage can be unavailable */ }
  });

  const sessionRequests: string[] = [];
  const notificationRequests: string[] = [];
  const refreshRequests: string[] = [];

  page.on('request', request => {
    const path = pathname(request.url());
    if (path === SESSION_PATH) sessionRequests.push(`${request.method()} ${request.url()}`);
    if (isNotificationPath(path)) notificationRequests.push(`${request.method()} ${request.url()}`);
    if (path === REFRESH_PATH) refreshRequests.push(`${request.method()} ${request.url()}`);
  });

  const sessionResponsePromise = page.waitForResponse(
    response => pathname(response.url()) === SESSION_PATH,
    { timeout: 60_000 },
  );

  const navigation = await page.goto(surface.href, { waitUntil: 'domcontentloaded' });
  expect(navigation, `${surface.name} must return a document response`).not.toBeNull();
  expect(navigation!.status(), `${surface.name} document status`).toBeLessThan(400);

  const sessionResponse: Response = await sessionResponsePromise;
  expect(sessionResponse.status(), `${surface.name} anonymous session status`).toBe(200);
  await expect(sessionResponse.json(), `${surface.name} anonymous session payload`).resolves.toMatchObject({
    authenticated: false,
    user: null,
    refreshable: false,
  });

  await surface.ready(page);
  // Allow queued effects and immediate retry logic to settle before asserting
  // exact counts. Any notification 401 -> refresh chain would appear here.
  await page.waitForTimeout(1_000);

  expect(sessionRequests, `${surface.name} must use exactly one central session probe`).toHaveLength(1);
  expect(sessionRequests[0]).toMatch(/^GET /);
  expect(notificationRequests, `${surface.name} guest must not call protected notifications`).toEqual([]);
  expect(refreshRequests, `${surface.name} guest must not probe refresh`).toEqual([]);
}

test.describe('guest network contract', () => {
  // A Next dev server recompiles these three large entrypoints independently.
  // Parallel first-load compilation can trigger an HMR remount and create a
  // development-only second session probe, so keep this network-count contract
  // serial. Every test still receives a fresh Playwright browser context.
  test.describe.configure({ mode: 'serial' });

  for (const surface of surfaces) {
    test(`${surface.name}: one anonymous session, no notification or refresh requests`, async ({ page }) => {
      test.setTimeout(120_000);
      await assertGuestNetworkContract(page, surface);
    });
  }
});
