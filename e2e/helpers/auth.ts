import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';

/**
 * E2E auth helper: signs up a fresh test user and returns the cookies that
 * downstream API calls need. Uses /api/auth/signup which is idempotent for
 * test contexts (rate-limited 5/min/IP — keep test files small enough).
 *
 * Why a fresh user per test:
 *   - Avoids cross-test data leaks.
 *   - Each test owns its quota slots, projects, etc.
 *   - Failed signup leaves no dangling state we'd need to clean up.
 */

export interface TestUser {
  email: string;
  password: string;
}

export function makeTestUser(): TestUser {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    email: `e2e-${id}@test.nexyfab.com`,
    password: 'TestPass123!',
  };
}

/**
 * Sign up via the API (no UI). Returns the test user and a Set-Cookie header
 * value for callers that want to forward it onto a fresh APIRequestContext.
 *
 * Some test environments configure auth to be optional/permissive; in that
 * case the e2e test should still run but treat the result as "authenticated"
 * via the cookies that the dev/test pipeline expects (typically `nf_session`).
 */
/**
 * Sign up with automatic backoff on 429. The signup endpoint is rate-limited
 * 5/min/IP — a packed CI run with multiple e2e files easily blows past that.
 * Up to 3 attempts with exponential 8s/16s/32s waits; total 56s worst case.
 */
export async function signupViaApi(
  request: APIRequestContext,
  user: TestUser = makeTestUser(),
): Promise<{ user: TestUser; ok: boolean; status: number; cookieHeader?: string }> {
  const delays = [8_000, 16_000, 32_000];
  let lastStatus = 0;
  let lastCookie: string | undefined;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const res = await request.post('/api/auth/signup', {
      data: {
        email: user.email,
        password: user.password,
        name: `E2E ${user.email.slice(4, 12)}`,
        consentMarketing: false,
      },
    });
    lastStatus = res.status();
    lastCookie = res.headers()['set-cookie'];
    if (res.ok()) return { user, ok: true, status: lastStatus, cookieHeader: lastCookie };
    if (lastStatus !== 429) {
      // Non-rate-limit failure (validation, server error) — bail; caller decides.
      return { user, ok: false, status: lastStatus, cookieHeader: lastCookie };
    }
    if (attempt < delays.length) {
      await new Promise(r => setTimeout(r, delays[attempt]));
    }
  }
  return { user, ok: false, status: lastStatus, cookieHeader: lastCookie };
}

export async function loginViaApi(
  request: APIRequestContext,
  user: TestUser,
): Promise<{ ok: boolean; status: number; cookieHeader?: string }> {
  const res = await request.post('/api/auth/login', {
    data: { email: user.email, password: user.password },
  });
  const headers = res.headers();
  return { ok: res.ok(), status: res.status(), cookieHeader: headers['set-cookie'] };
}

/**
 * Convenience: produce a fresh authenticated APIRequestContext that carries
 * cookies from a successful signup. The new context inherits the base URL
 * from the parent and adds the session cookie via storage state.
 */
export async function authenticatedRequest(
  request: APIRequestContext,
  baseURL: string,
): Promise<{ context: APIRequestContext; user: TestUser } | null> {
  const { user, ok, cookieHeader } = await signupViaApi(request);
  if (!ok || !cookieHeader) return null;

  // Build storage state from the Set-Cookie header so the new context
  // carries the session forward.
  const cookies = parseSetCookies(cookieHeader, baseURL);
  if (cookies.length === 0) return null;

  const { request: newRequestFactory } = await import('@playwright/test');
  const context = await newRequestFactory.newContext({
    baseURL,
    storageState: { cookies, origins: [] },
  });
  return { context, user };
}

interface ParsedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

/**
 * Parse a `Set-Cookie` header (possibly multiple values joined by newlines)
 * into Playwright Cookie objects bound to the host derived from baseURL.
 */
function parseSetCookies(header: string, baseURL: string): ParsedCookie[] {
  const out: ParsedCookie[] = [];
  const url = new URL(baseURL);
  const lines = header.split('\n');
  for (const line of lines) {
    const segments = line.split(';').map(s => s.trim()).filter(Boolean);
    if (segments.length === 0) continue;
    const [first, ...attrs] = segments;
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    const cookie: ParsedCookie = {
      name,
      value,
      domain: url.hostname,
      path: '/',
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    };
    for (const a of attrs) {
      const lower = a.toLowerCase();
      if (lower === 'httponly') cookie.httpOnly = true;
      else if (lower === 'secure') cookie.secure = true;
      else if (lower.startsWith('path=')) cookie.path = a.slice(5);
      else if (lower.startsWith('domain=')) cookie.domain = a.slice(7);
      else if (lower.startsWith('samesite=')) {
        const v = a.slice(9).toLowerCase();
        cookie.sameSite = v === 'strict' ? 'Strict' : v === 'none' ? 'None' : 'Lax';
      }
    }
    out.push(cookie);
  }
  return out;
}

/** UI helper: signup via the page, optionally seeding tutorial state first. */
export async function signupViaUi(page: Page, user: TestUser = makeTestUser()): Promise<TestUser> {
  await page.goto('/en/?auth=signup');
  const emailInput = page.locator('input[type="email"]').first();
  const passwordInput = page.locator('input[type="password"]').first();
  if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await emailInput.fill(user.email);
    await passwordInput.fill(user.password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(1500);
  }
  return user;
}

/** Returns true if the browser context appears to have a session cookie set. */
export async function hasSession(context: BrowserContext): Promise<boolean> {
  const cookies = await context.cookies();
  return cookies.some(c => /session|token|auth/i.test(c.name));
}
