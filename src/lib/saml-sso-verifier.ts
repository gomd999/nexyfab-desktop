/**
 * Commercial SAML verification boundary.
 *
 * XMLDSig must not be approximated with regexes or a generic XML parser. Until
 * a maintained SAML/XMLDSig implementation is installed and wired to every
 * control below, this module deliberately refuses every assertion.
 */

export const SAML_VERIFIER_UNAVAILABLE = 'SAML_SIGNATURE_VERIFIER_UNAVAILABLE' as const;

export const SAML_REQUIRED_CONTROLS = [
  'trusted_idp_certificate_allowlist_with_rollover',
  'response_or_assertion_signature_required',
  'exclusive_xml_canonicalization_and_reference_digest_validation',
  'signature_reference_must_resolve_to_the_consumed_unique_id',
  'duplicate_id_and_signature_wrapping_rejection',
  'issuer_audience_destination_validation',
  'in_response_to_request_correlation',
  'not_before_and_not_on_or_after_validation_with_bounded_clock_skew',
  'doctype_entity_xinclude_and_external_resource_rejection',
  'response_and_assertion_replay_cache',
] as const;

export interface SamlVerificationContext {
  trustedIdpCertificates: readonly string[];
  expectedIssuer: string;
  expectedAudience: string;
  expectedDestination: string;
  expectedInResponseTo: string | null;
}

export interface VerifiedSamlPrincipal {
  responseId: string;
  assertionId: string;
  nameId: string;
  email: string;
  displayName?: string;
}

export class SamlVerifierUnavailableError extends Error {
  readonly code = SAML_VERIFIER_UNAVAILABLE;
  readonly status = 503 as const;
  readonly blockers = [...SAML_REQUIRED_CONTROLS];

  constructor() {
    super('SAML is disabled until standards-compliant XML signature validation and replay protection are available.');
    this.name = 'SamlVerifierUnavailableError';
  }
}

export function isSamlVerifierUnavailable(error: unknown): error is SamlVerifierUnavailableError {
  return error instanceof SamlVerifierUnavailableError;
}

export function samlVerifierReadiness(_context?: Partial<SamlVerificationContext>) {
  return {
    ready: false as const,
    code: SAML_VERIFIER_UNAVAILABLE,
    blockers: [...SAML_REQUIRED_CONTROLS],
  };
}

export async function verifySamlResponse(
  _encodedResponse: string,
  _context: SamlVerificationContext,
): Promise<VerifiedSamlPrincipal> {
  // Fail before base64/XML decoding: no unsigned or partially validated claims
  // can ever cross this trust boundary while the verifier is unavailable.
  throw new SamlVerifierUnavailableError();
}
