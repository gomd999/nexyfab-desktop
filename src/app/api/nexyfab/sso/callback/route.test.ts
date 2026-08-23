import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from './route';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('NexyFab SAML callback', () => {
  it('fails closed with an explicit verifier code for every assertion', async () => {
    vi.stubEnv('SAML_ENTITY_ID', 'https://sp.example.test');
    vi.stubEnv('SAML_IDP_ISSUER', 'https://idp.example.test');
    vi.stubEnv('SAML_IDP_CERTIFICATES', 'cert-a||cert-b');
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://sp.example.test');
    const unsigned = Buffer.from('<Response><Assertion /></Response>').toString('base64');
    const request = new NextRequest('http://localhost/api/nexyfab/sso/callback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ SAMLResponse: unsigned }),
    });

    const response = await POST(request);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: 'SAML_SIGNATURE_VERIFIER_UNAVAILABLE',
      blockers: expect.arrayContaining([
        'trusted_idp_certificate_allowlist_with_rollover',
        'duplicate_id_and_signature_wrapping_rejection',
      ]),
    });
  });
});

describe('NexyFab OIDC callback', () => {
  it('rejects before discovery, token exchange, userinfo, or claim consumption', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.stubEnv('OIDC_CLIENT_ID', 'client');
    vi.stubEnv('OIDC_CLIENT_SECRET', 'secret');
    vi.stubEnv('OIDC_ISSUER', 'https://idp.example.test');
    const request = new NextRequest(
      'http://localhost/api/nexyfab/sso/callback?code=untrusted-code&state=unbound-state',
    );

    const response = await GET(request);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: 'OIDC_COMMERCIAL_FLOW_UNAVAILABLE',
      blockers: expect.arrayContaining([
        'constant_time_state_correlation',
        'nonce_generation_and_id_token_binding',
        'pkce_s256_verifier_and_challenge_binding',
      ]),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
