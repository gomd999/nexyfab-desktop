import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  execute: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock('@/lib/auth-middleware', () => ({
  getAuthUser: vi.fn(async () => ({ userId: 'user-1', plan: 'team' })),
}));
vi.mock('@/lib/plan-guard', () => ({ meetsPlan: vi.fn(() => true) }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: vi.fn(() => true) }));
vi.mock('@/lib/db-adapter', () => ({
  getDbAdapter: vi.fn(() => ({
    queryOne: state.queryOne,
    execute: state.execute,
  })),
}));

import { POST } from './route';

beforeEach(() => {
  state.execute.mockReset().mockResolvedValue({ changes: 1 });
  state.queryOne.mockReset().mockResolvedValue({
    provider: 'oidc',
    entity_id: null,
    sso_url: null,
    certificate: null,
    client_id: 'client',
    client_secret: 'secret',
    issuer: 'https://issuer.example.test',
    enabled: 0,
  });
});

describe('NexyFab SSO configuration', () => {
  it('refuses to activate SAML before any database mutation', async () => {
    const request = new NextRequest('http://localhost/api/nexyfab/sso', {
      method: 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'saml',
        enabled: true,
        entityId: 'https://sp.example.test',
        certificate: 'untrusted-placeholder',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: 'SAML_SIGNATURE_VERIFIER_UNAVAILABLE',
      blockers: expect.arrayContaining([
        'response_or_assertion_signature_required',
        'response_and_assertion_replay_cache',
      ]),
    });
    expect(state.execute).not.toHaveBeenCalled();
  });

  it('allows administrators to stage disabled SAML metadata', async () => {
    const request = new NextRequest('http://localhost/api/nexyfab/sso', {
      method: 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'saml', enabled: false, entityId: 'https://sp.example.test' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(state.execute).toHaveBeenCalledOnce();
  });

  it('refuses to activate OIDC before any database mutation', async () => {
    const request = new NextRequest('http://localhost/api/nexyfab/sso', {
      method: 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'oidc',
        enabled: true,
        clientId: 'client',
        clientSecret: 'secret',
        issuer: 'https://idp.example.test',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: 'OIDC_COMMERCIAL_FLOW_UNAVAILABLE',
      blockers: expect.arrayContaining([
        'one_use_server_side_transaction_store',
        'id_token_jwks_signature_and_algorithm_allowlist',
      ]),
    });
    expect(state.execute).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON without mutating the database', async () => {
    const request = new NextRequest('http://localhost/api/nexyfab/sso', {
      method: 'POST',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      body: '{"provider":',
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Invalid request body' });
    expect(state.execute).not.toHaveBeenCalled();
  });
});
