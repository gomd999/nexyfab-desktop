/**
 * supplierOauth.ts — OAuth 2.0 + PKCE flow handler for supplier portals.
 *
 * When NexyFab integrates with external supplier portals (McMaster,
 * Misumi, Digi-Key, ...) we need to authenticate on behalf of the
 * shop. OAuth 2.0 with PKCE is the standard browser-friendly flow.
 *
 * This module:
 *
 *   - Builds the authorization-request URL with PKCE challenge.
 *   - Parses the redirect callback (code, state, error).
 *   - Exchanges code → tokens via the token endpoint (caller supplies
 *     `fetch` so node/browser swap is easy).
 *   - Refreshes access tokens before they expire.
 *   - Stores refresh tokens in a pluggable backend (callbacks).
 */

export interface OAuthClientConfig {
  /** OAuth client id from the supplier. */
  clientId: string;
  /** Authorization endpoint URL. */
  authorizationEndpoint: string;
  /** Token endpoint URL. */
  tokenEndpoint: string;
  /** Local redirect URI registered with the supplier. */
  redirectUri: string;
  /** Requested OAuth scopes. */
  scopes: string[];
}

export interface PkceParams {
  /** Code verifier (43-128 chars). */
  codeVerifier: string;
  /** Code challenge (S256 hash of verifier, base64url). */
  codeChallenge: string;
  /** Method: S256 only (Plain is discouraged). */
  method: 'S256';
}

export interface AuthRequest {
  /** Full URL to redirect the user to. */
  url: string;
  /** State string to verify on callback. */
  state: string;
  /** PKCE params to keep server-side / in storage. */
  pkce: PkceParams;
}

export interface CallbackResult {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

export interface TokenSet {
  /** OAuth access token. */
  accessToken: string;
  /** Refresh token (may not be present for short-lived sessions). */
  refreshToken?: string;
  /** Token type, usually "Bearer". */
  tokenType: string;
  /** Seconds until access token expires. */
  expiresIn: number;
  /** ISO timestamp when the token was issued. */
  issuedAt: number;
  /** Granted scopes. */
  scope?: string;
}

// ── Authorization request builder ──────────────────────────────

export async function buildAuthorizationRequest(config: OAuthClientConfig): Promise<AuthRequest> {
  const verifier = randomString(64);
  const challenge = await s256Challenge(verifier);
  const state = randomString(32);
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: config.scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return {
    url: `${config.authorizationEndpoint}?${params.toString()}`,
    state,
    pkce: { codeVerifier: verifier, codeChallenge: challenge, method: 'S256' },
  };
}

// ── Callback parsing ───────────────────────────────────────────

export function parseCallback(callbackUrl: string, expectedState: string): CallbackResult {
  const url = new URL(callbackUrl);
  const params = url.searchParams;
  const state = params.get('state') ?? undefined;
  const code = params.get('code') ?? undefined;
  const error = params.get('error') ?? undefined;
  const errorDescription = params.get('error_description') ?? undefined;
  const result: CallbackResult = {};
  if (code) result.code = code;
  if (state !== undefined) result.state = state;
  if (error) result.error = error;
  if (errorDescription) result.errorDescription = errorDescription;
  if (state !== expectedState && !error) {
    result.error = 'state-mismatch';
    result.errorDescription = `Expected state ${expectedState}, got ${state}`;
  }
  return result;
}

// ── Token exchange ─────────────────────────────────────────────

export type FetchFn = (url: string, init?: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<Record<string, unknown>>; text: () => Promise<string> }>;

export async function exchangeCodeForTokens(config: OAuthClientConfig, code: string, pkce: PkceParams, fetchFn: FetchFn): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    code,
    redirect_uri: config.redirectUri,
    code_verifier: pkce.codeVerifier,
  });
  const resp = await fetchFn(config.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) throw new Error(`Token exchange failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  return mapTokenResponse(data);
}

export async function refreshAccessToken(config: OAuthClientConfig, refreshToken: string, fetchFn: FetchFn): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.clientId,
    refresh_token: refreshToken,
  });
  const resp = await fetchFn(config.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) throw new Error(`Refresh failed: ${resp.status} ${await resp.text()}`);
  return mapTokenResponse(await resp.json());
}

function mapTokenResponse(data: Record<string, unknown>): TokenSet {
  const access = data.access_token;
  if (typeof access !== 'string') throw new Error('access_token missing');
  const result: TokenSet = {
    accessToken: access,
    tokenType: (typeof data.token_type === 'string' ? data.token_type : 'Bearer'),
    expiresIn: typeof data.expires_in === 'number' ? data.expires_in : 3600,
    issuedAt: Date.now(),
  };
  if (typeof data.refresh_token === 'string') result.refreshToken = data.refresh_token;
  if (typeof data.scope === 'string') result.scope = data.scope;
  return result;
}

// ── Token freshness ───────────────────────────────────────────

/** Returns true if token has fewer than `bufferSec` seconds left. */
export function isExpiringSoon(token: TokenSet, bufferSec: number = 60): boolean {
  const expiresAt = token.issuedAt + token.expiresIn * 1000;
  return Date.now() >= expiresAt - bufferSec * 1000;
}

// ── Token store ───────────────────────────────────────────────

export interface TokenStore {
  save(key: string, token: TokenSet): Promise<void>;
  load(key: string): Promise<TokenSet | null>;
  remove(key: string): Promise<void>;
}

/** Memory-only store, useful for tests. */
export class InMemoryTokenStore implements TokenStore {
  private map = new Map<string, TokenSet>();

  async save(key: string, token: TokenSet): Promise<void> {
    this.map.set(key, token);
  }

  async load(key: string): Promise<TokenSet | null> {
    return this.map.get(key) ?? null;
  }

  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }

  size(): number {
    return this.map.size;
  }
}

// ── Authorized fetch helper ───────────────────────────────────

/** Wrap a `fetch` so every call includes `Authorization: Bearer <token>`,
 *  auto-refreshing if the token is expiring. */
export function authorizedFetch(
  config: OAuthClientConfig,
  store: TokenStore,
  key: string,
  fetchFn: FetchFn,
): (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => ReturnType<FetchFn> {
  return async (url, init = {}) => {
    let token = await store.load(key);
    if (!token) throw new Error('No token in store for ' + key);
    if (isExpiringSoon(token) && token.refreshToken) {
      token = await refreshAccessToken(config, token.refreshToken, fetchFn);
      await store.save(key, token);
    }
    const headers = { ...(init.headers ?? {}), Authorization: `${token.tokenType} ${token.accessToken}` };
    return fetchFn(url, {
      method: init.method ?? 'GET',
      headers,
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
  };
}

// ── Random + PKCE challenge ────────────────────────────────────

export function randomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let out = '';
  // Try crypto-grade randomness first.
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < length; i++) out += chars[bytes[i]! % chars.length];
    return out;
  }
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export async function s256Challenge(verifier: string): Promise<string> {
  const bytes = new TextEncoder().encode(verifier);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return base64UrlEncode(new Uint8Array(hash));
  }
  // Fallback: deterministic-ish but NOT cryptographically secure. Tests only.
  let h = 0;
  for (let i = 0; i < bytes.length; i++) h = (h * 31 + bytes[i]!) >>> 0;
  return base64UrlEncode(new Uint8Array([h & 0xff, (h >>> 8) & 0xff, (h >>> 16) & 0xff, (h >>> 24) & 0xff]));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  let b64: string;
  if (typeof btoa !== 'undefined') {
    b64 = btoa(str);
  } else {
    // Node fallback.
    b64 = Buffer.from(str, 'binary').toString('base64');
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
