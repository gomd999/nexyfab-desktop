import { describe, expect, it } from 'vitest';
import {
  assertOidcSsoReady,
  OIDC_REQUIRED_CONTROLS,
  OIDC_FLOW_UNAVAILABLE,
  oidcSsoReadiness,
} from './oidc-sso-readiness';

describe('commercial OIDC readiness boundary', () => {
  it('reports the complete transaction, token, and session controls', () => {
    const readiness = oidcSsoReadiness();

    expect(readiness).toMatchObject({ ready: false, code: OIDC_FLOW_UNAVAILABLE });
    expect(readiness.blockers).toEqual(OIDC_REQUIRED_CONTROLS);
    expect(readiness.blockers).toEqual(expect.arrayContaining([
      'one_use_server_side_transaction_store',
      'pkce_s256_verifier_and_challenge_binding',
      'id_token_issuer_audience_azp_exp_iat_nonce_validation',
      'verified_principal_provisioning_and_http_only_session',
    ]));
  });

  it('throws a typed fail-closed error', () => {
    expect(assertOidcSsoReady).toThrow(expect.objectContaining({
      code: OIDC_FLOW_UNAVAILABLE,
      status: 503,
    }));
  });
});
