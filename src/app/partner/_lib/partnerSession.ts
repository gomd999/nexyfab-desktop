// Partner session helper for client components.
//
// During the legacy → NexySys-OAuth cutover we have two session signals:
//   1. NexySys JWT  →  stored in the `nf_access_token` httpOnly cookie by
//      `/partner/oauth/callback`. Server routes auto-read it via
//      `getPartnerAuth`. The client cannot read it directly (httpOnly is
//      intentional, XSS-resistant).
//   2. Legacy opaque session → stored in `localStorage.partnerSession` by
//      the access-code login. Client reads it and passes it as
//      `Authorization: Bearer ${session}` to partner API routes.
//
// `getPartnerAuthHeaders()` picks the right one:
//   - If a JWT cookie is present we emit no Authorization header — the
//     server route reads the cookie. Returning the cookie value in the
//     header would defeat the httpOnly protection.
//   - Else if `localStorage.partnerSession` is present (legacy partners
//     not yet migrated), we emit `Authorization: Bearer <session>`.
//   - Else (anonymous) we emit nothing and the server route handles 401.
//
// The cookie presence check is best-effort — we can't read httpOnly
// cookies, so we rely on a sibling `nf_partner_sso` cookie set by the
// callback. (Adding that to the callback below.)

const SSO_PRESENCE_COOKIE = 'nf_partner_sso';

/**
 * Returns true if the user is authenticated via NexySys SSO (we set a
 * sibling non-httpOnly cookie so the client can see the JWT exists).
 */
export function hasSsoSession(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split('; ').some(c => c.startsWith(`${SSO_PRESENCE_COOKIE}=1`));
}

/**
 * Returns the partner-portal authentication mode for the current
 * browser. Useful for UI that should look different when the legacy
 * access-code login was used (e.g. the migration prompt).
 */
export function partnerAuthMode(): 'sso' | 'legacy' | 'anonymous' {
  if (hasSsoSession()) return 'sso';
  if (typeof window !== 'undefined' && window.localStorage.getItem('partnerSession')) {
    return 'legacy';
  }
  return 'anonymous';
}

/**
 * Returns the `Authorization` header value for fetches that hit partner
 * API routes. Returns `null` when the SSO cookie is in use (the server
 * reads it automatically) or when the user is anonymous.
 */
export function partnerAuthHeader(): string | null {
  if (typeof window === 'undefined') return null;
  // SSO cookie path — let the server route read the httpOnly cookie.
  if (hasSsoSession()) return null;
  const session = window.localStorage.getItem('partnerSession');
  if (!session) return null;
  return `Bearer ${session}`;
}

/**
 * Convenience: returns a `fetch`-style headers object with the partner
 * authorization header pre-populated when relevant. Pass-through for
 * anything else the caller already wants to send.
 */
export function partnerFetchHeaders(extra?: HeadersInit): HeadersInit {
  const auth = partnerAuthHeader();
  if (!auth) return extra ?? {};
  if (!extra) return { Authorization: auth };
  // Merge — works for HeadersInit shapes (Headers / Record / array).
  if (extra instanceof Headers) {
    const merged = new Headers(extra);
    merged.set('Authorization', auth);
    return merged;
  }
  if (Array.isArray(extra)) {
    return [...extra, ['Authorization', auth]];
  }
  return { ...extra, Authorization: auth };
}

/**
 * Clears both the legacy localStorage session and the SSO cookie, then
 * calls `/partner/oauth/logout` to clear the httpOnly cookie on the
 * server. Use from the navbar logout button.
 */
export async function partnerLogout(): Promise<void> {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem('partnerSession');
    window.localStorage.removeItem('partnerInfo');
  }
  try {
    await fetch('/partner/oauth/logout', { method: 'POST', credentials: 'include' });
  } catch { /* offline logout still clears local state */ }
}
