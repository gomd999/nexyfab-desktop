/**
 * Resolve the auth server base URL for client-side fetches.
 *
 * Replaces the previous `... || 'http://localhost:4000'` pattern that
 * silently routed production traffic to localhost when the env var
 * was missing at build time. Production now falls back to the canonical
 * auth.nexysys.com endpoint, and local dev still gets localhost via the
 * env var.
 *
 * Detection: a hostname of `localhost` or `127.0.0.1` (or any *.local)
 * means we're in dev — fall back to localhost. Otherwise, fall back to
 * the production auth server. Either way, the env var wins when set.
 */

const PRODUCTION_AUTH_URL = 'https://auth.nexysys.com';
const PRODUCTION_NEXYSYS_URL = 'https://nexysys.com';
const DEV_AUTH_URL = 'http://localhost:4000';
const DEV_NEXYSYS_URL = 'http://localhost:5173';

function isDevHost(): boolean {
  if (typeof window === 'undefined') return process.env.NODE_ENV !== 'production';
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
}

export function authBaseUrl(): string {
  const env = process.env.NEXT_PUBLIC_AUTH_URL;
  if (env) return env;
  return isDevHost() ? DEV_AUTH_URL : PRODUCTION_AUTH_URL;
}

export function nexysysBaseUrl(): string {
  const env = process.env.NEXT_PUBLIC_NEXYSYS_URL;
  if (env) return env;
  return isDevHost() ? DEV_NEXYSYS_URL : PRODUCTION_NEXYSYS_URL;
}
