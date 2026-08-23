import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('legacy persistent cookies are cleared and the account menu becomes guest-only', async ({ context, page, baseURL }) => {
  test.setTimeout(120_000);
  const origin = new URL(baseURL ?? 'http://127.0.0.1:3000');

  await context.addCookies([
    { name: 'nf_access_token', value: 'legacy-access', domain: origin.hostname, path: '/' },
    { name: 'nf_refresh_token', value: 'legacy-refresh', domain: origin.hostname, path: '/api/auth' },
  ]);

  const sessionResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname.replace(/\/$/, '') === '/api/auth/session',
  );
  await page.goto('/en/nexyfab/', { waitUntil: 'domcontentloaded' });

  const response = await sessionResponse;
  await expect(response.json()).resolves.toMatchObject({
    authenticated: false,
    user: null,
    refreshable: false,
  });

  const cookies = await context.cookies();
  expect(cookies.some(cookie => cookie.name === 'nf_access_token')).toBe(false);
  expect(cookies.some(cookie => cookie.name === 'nf_refresh_token')).toBe(false);

  const cookieDialog = page.getByRole('dialog', { name: 'Cookie consent' });
  if (await cookieDialog.isVisible()) {
    await cookieDialog.getByRole('button', { name: 'Essential only' }).click();
  }

  const accountButton = page.getByRole('button', { name: /Guest/i });
  await expect(accountButton).toBeVisible();
  await accountButton.click();
  await expect(page.getByRole('menuitem', { name: 'Log in' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Create account' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Log out' })).toHaveCount(0);
});
