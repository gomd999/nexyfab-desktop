import { describe, expect, it } from 'vitest';
import {
  SAML_REQUIRED_CONTROLS,
  SAML_VERIFIER_UNAVAILABLE,
  samlVerifierReadiness,
  verifySamlResponse,
} from './saml-sso-verifier';

const context = {
  trustedIdpCertificates: ['-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----'],
  expectedIssuer: 'https://idp.example.test',
  expectedAudience: 'https://sp.example.test',
  expectedDestination: 'https://sp.example.test/api/nexyfab/sso/callback',
  expectedInResponseTo: 'request-123',
};

describe('commercial SAML verifier boundary', () => {
  it('reports every required control while the verifier is unavailable', () => {
    const readiness = samlVerifierReadiness(context);

    expect(readiness).toMatchObject({
      ready: false,
      code: SAML_VERIFIER_UNAVAILABLE,
    });
    expect(readiness.blockers).toEqual(SAML_REQUIRED_CONTROLS);
    expect(readiness.blockers).toContain('duplicate_id_and_signature_wrapping_rejection');
    expect(readiness.blockers).toContain('in_response_to_request_correlation');
    expect(readiness.blockers).toContain('response_and_assertion_replay_cache');
  });

  it.each([
    '<samlp:Response ID="response-1"><saml:Assertion ID="assertion-1" /></samlp:Response>',
    '<!DOCTYPE r [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><r>&xxe;</r>',
    '<Response ID="same"><Assertion ID="same"/><Assertion ID="same"/></Response>',
  ])('fails closed before accepting any XML shape', async xml => {
    await expect(
      verifySamlResponse(Buffer.from(xml).toString('base64'), context),
    ).rejects.toMatchObject({
      code: SAML_VERIFIER_UNAVAILABLE,
      status: 503,
    });
  });
});
