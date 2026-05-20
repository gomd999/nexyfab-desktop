import { describe, it, expect, vi } from 'vitest';
import {
  buildAuthorizationRequest,
  parseCallback,
  exchangeCodeForTokens,
  refreshAccessToken,
  isExpiringSoon,
  InMemoryTokenStore,
  authorizedFetch,
  randomString,
  s256Challenge,
  type OAuthClientConfig,
  type FetchFn,
  type TokenSet,
} from './supplierOauth';

const config: OAuthClientConfig = {
  clientId: 'test-client',
  authorizationEndpoint: 'https://supplier.example.com/oauth/authorize',
  tokenEndpoint: 'https://supplier.example.com/oauth/token',
  redirectUri: 'https://app.example.com/callback',
  scopes: ['orders', 'inventory'],
};

describe('randomString + s256Challenge', () => {
  it('randomString produces requested length', () => {
    expect(randomString(43)).toHaveLength(43);
  });

  it('s256Challenge returns base64-url string', async () => {
    const c = await s256Challenge('test-verifier');
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('buildAuthorizationRequest', () => {
  it('includes all required params', async () => {
    const r = await buildAuthorizationRequest(config);
    const url = new URL(r.url);
    expect(url.searchParams.get('client_id')).toBe('test-client');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe(r.state);
  });

  it('encodes scopes as space-separated', async () => {
    const r = await buildAuthorizationRequest(config);
    const url = new URL(r.url);
    expect(url.searchParams.get('scope')).toContain('orders');
    expect(url.searchParams.get('scope')).toContain('inventory');
  });

  it('PKCE verifier matches challenge', async () => {
    const r = await buildAuthorizationRequest(config);
    const expected = await s256Challenge(r.pkce.codeVerifier);
    expect(r.pkce.codeChallenge).toBe(expected);
  });
});

describe('parseCallback', () => {
  it('returns code + state', () => {
    const r = parseCallback('https://app/callback?code=abc&state=xyz', 'xyz');
    expect(r.code).toBe('abc');
    expect(r.state).toBe('xyz');
    expect(r.error).toBeUndefined();
  });

  it('flags state mismatch', () => {
    const r = parseCallback('https://app/callback?code=abc&state=xyz', 'wrong');
    expect(r.error).toBe('state-mismatch');
  });

  it('returns OAuth error params', () => {
    const r = parseCallback('https://app/callback?error=access_denied&error_description=User+declined', 'xyz');
    expect(r.error).toBe('access_denied');
    expect(r.errorDescription).toBe('User declined');
  });
});

describe('exchangeCodeForTokens', () => {
  it('parses token response', async () => {
    const mockFetch: FetchFn = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ access_token: 'tok-a', refresh_token: 'rt-a', token_type: 'Bearer', expires_in: 3600, scope: 'orders' }),
      text: async () => '',
    }));
    const tokens = await exchangeCodeForTokens(config, 'code-123', { codeVerifier: 'v', codeChallenge: 'c', method: 'S256' }, mockFetch);
    expect(tokens.accessToken).toBe('tok-a');
    expect(tokens.refreshToken).toBe('rt-a');
    expect(tokens.expiresIn).toBe(3600);
  });

  it('throws on non-OK response', async () => {
    const mockFetch: FetchFn = vi.fn(async () => ({
      ok: false, status: 400, json: async () => ({}), text: async () => 'bad',
    }));
    await expect(exchangeCodeForTokens(config, 'bad-code', { codeVerifier: 'v', codeChallenge: 'c', method: 'S256' }, mockFetch)).rejects.toThrow();
  });
});

describe('refreshAccessToken', () => {
  it('parses refresh response', async () => {
    const mockFetch: FetchFn = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ access_token: 'new-tok', token_type: 'Bearer', expires_in: 7200 }),
      text: async () => '',
    }));
    const tokens = await refreshAccessToken(config, 'refresh-1', mockFetch);
    expect(tokens.accessToken).toBe('new-tok');
    expect(tokens.expiresIn).toBe(7200);
  });
});

describe('isExpiringSoon', () => {
  it('fresh token not expiring', () => {
    const t: TokenSet = { accessToken: 'a', tokenType: 'Bearer', expiresIn: 3600, issuedAt: Date.now() };
    expect(isExpiringSoon(t)).toBe(false);
  });

  it('expired token flagged', () => {
    const t: TokenSet = { accessToken: 'a', tokenType: 'Bearer', expiresIn: 60, issuedAt: Date.now() - 60_000 };
    expect(isExpiringSoon(t)).toBe(true);
  });
});

describe('InMemoryTokenStore', () => {
  it('save + load round-trip', async () => {
    const store = new InMemoryTokenStore();
    const t: TokenSet = { accessToken: 'a', tokenType: 'Bearer', expiresIn: 3600, issuedAt: Date.now() };
    await store.save('user-1', t);
    expect((await store.load('user-1'))?.accessToken).toBe('a');
  });

  it('remove drops entry', async () => {
    const store = new InMemoryTokenStore();
    await store.save('user-1', { accessToken: 'a', tokenType: 'Bearer', expiresIn: 3600, issuedAt: Date.now() });
    await store.remove('user-1');
    expect(await store.load('user-1')).toBeNull();
  });
});

describe('authorizedFetch', () => {
  it('attaches Authorization header', async () => {
    const store = new InMemoryTokenStore();
    await store.save('k', { accessToken: 'tok', tokenType: 'Bearer', expiresIn: 3600, issuedAt: Date.now() });
    let captured: Record<string, string> = {};
    const mockFetch: FetchFn = vi.fn(async (_url, init) => {
      captured = init?.headers ?? {};
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    });
    const fetcher = authorizedFetch(config, store, 'k', mockFetch);
    await fetcher('https://api/test');
    expect(captured.Authorization).toBe('Bearer tok');
  });

  it('refreshes when token expiring', async () => {
    const store = new InMemoryTokenStore();
    await store.save('k', { accessToken: 'old', refreshToken: 'rt', tokenType: 'Bearer', expiresIn: 10, issuedAt: Date.now() - 100_000 });
    const mockFetch: FetchFn = vi.fn(async (url) => {
      if (url === config.tokenEndpoint) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'new', expires_in: 3600 }), text: async () => '' };
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    });
    const fetcher = authorizedFetch(config, store, 'k', mockFetch);
    await fetcher('https://api/test');
    expect((await store.load('k'))!.accessToken).toBe('new');
  });

  it('throws when no token in store', async () => {
    const store = new InMemoryTokenStore();
    const mockFetch: FetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' }));
    const fetcher = authorizedFetch(config, store, 'missing', mockFetch);
    await expect(fetcher('https://api/test')).rejects.toThrow();
  });
});
