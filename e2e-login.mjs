// Reusable Playwright login helper for the E2E test account.
// Usage: import { loginContext } from './e2e-login.mjs'; await loginContext(context);
import fs from 'fs';
const CREDS = JSON.parse(fs.readFileSync(new URL('./.e2e-credentials.json', import.meta.url)));
const BASE = process.env.E2E_BASE || 'https://nexyfab.com';

/** Logs the test account in via the API and injects the auth cookies into a
 *  Playwright BrowserContext, so subsequent pages are authenticated (enterprise
 *  plan → no guest limit, no quota). Returns the user object. */
export async function loginContext(context, base = BASE) {
  const res = await context.request.post(`${base}/api/auth/login/`, {
    data: { email: CREDS.email, password: CREDS.password },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok()) throw new Error(`E2E login failed: ${res.status()} ${await res.text()}`);
  // Playwright's APIRequestContext shares the context cookie jar, so the
  // Set-Cookie from login is already applied to `context`.
  return (await res.json()).user;
}
export { CREDS };
