/**
 * Current service identity — used for service tagging, JWT claims, and cookie config.
 * Each product (NexyFab, NexyFlow, NexyWise) sets its own SERVICE_NAME env var.
 * Defaults to 'nexyfab' for this codebase.
 */
export const SERVICE_NAME = process.env.SERVICE_NAME || 'nexyfab';

/**
 * Cookie domain for cross-subdomain SSO.
 * Set COOKIE_DOMAIN=.nexysys.com to share cookies across subdomains.
 * When unset, cookies are scoped to the issuing domain only.
 */
export const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;

/**
 * CORS allowed origins (parsed from env).
 * Used for dynamic origin matching in middleware.
 */
export const CORS_ORIGINS: string[] = (process.env.CORS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);
