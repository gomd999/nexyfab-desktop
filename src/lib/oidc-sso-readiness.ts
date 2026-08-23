/**
 * Commercial OIDC authorization-code flow boundary.
 *
 * `jose` is available for token verification, but token verification alone is
 * not a login flow. Until the transaction and session controls below are
 * implemented as one unit, OIDC activation and callbacks must fail closed.
 */

export const OIDC_FLOW_UNAVAILABLE = 'OIDC_COMMERCIAL_FLOW_UNAVAILABLE' as const;

export const OIDC_REQUIRED_CONTROLS = [
  'authorization_start_endpoint_with_pinned_https_issuer',
  'one_use_server_side_transaction_store',
  'constant_time_state_correlation',
  'nonce_generation_and_id_token_binding',
  'pkce_s256_verifier_and_challenge_binding',
  'discovery_issuer_and_endpoint_pinning',
  'authorization_code_exchange_with_exact_redirect_uri',
  'id_token_jwks_signature_and_algorithm_allowlist',
  'id_token_issuer_audience_azp_exp_iat_nonce_validation',
  'userinfo_subject_binding_after_id_token_validation',
  'allowlisted_post_login_redirect',
  'verified_principal_provisioning_and_http_only_session',
] as const;

export class OidcFlowUnavailableError extends Error {
  readonly code = OIDC_FLOW_UNAVAILABLE;
  readonly status = 503 as const;
  readonly blockers = [...OIDC_REQUIRED_CONTROLS];

  constructor() {
    super('OIDC is disabled until the complete authorization-code, token-validation, and session flow is available.');
    this.name = 'OidcFlowUnavailableError';
  }
}

export function oidcSsoReadiness() {
  return {
    ready: false as const,
    code: OIDC_FLOW_UNAVAILABLE,
    blockers: [...OIDC_REQUIRED_CONTROLS],
  };
}

export function assertOidcSsoReady(): never {
  throw new OidcFlowUnavailableError();
}
