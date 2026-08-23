import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadExternalCommercialVerifierRegistry, normalizedExternalFingerprint } from './externalCommercialVerifierRegistry';

function identity(keyId = 'external-1') {
  const { publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return { keyId, role: 'external_verifier', publicKeyPem, fingerprintSha256: normalizedExternalFingerprint(publicKeyPem)! };
}

describe('external verifier registry', () => {
  it('accepts only normalized Ed25519 public identities with unique key/fingerprint', () => {
    const one = identity();
    expect(loadExternalCommercialVerifierRegistry({ NEXYFAB_EXTERNAL_VERIFIER_REGISTRY_JSON: JSON.stringify([one]) })?.identities).toHaveLength(1);
    expect(loadExternalCommercialVerifierRegistry({ NEXYFAB_EXTERNAL_VERIFIER_REGISTRY_JSON: JSON.stringify([{ ...one, fingerprintSha256: 'a'.repeat(64) }]) })).toBeUndefined();
    expect(loadExternalCommercialVerifierRegistry({ NEXYFAB_EXTERNAL_VERIFIER_REGISTRY_JSON: JSON.stringify([{ ...one, role: 'architect' }]) })).toBeUndefined();
  });

  it('rejects empty, singleton malformed, duplicate aliases, and non-Ed25519 keys', () => {
    expect(loadExternalCommercialVerifierRegistry({ NEXYFAB_EXTERNAL_VERIFIER_REGISTRY_JSON: '[]' })).toBeUndefined();
    const one = identity();
    expect(loadExternalCommercialVerifierRegistry({ NEXYFAB_EXTERNAL_VERIFIER_REGISTRY_JSON: JSON.stringify([one, { ...one, keyId: 'external-2' }]) })).toBeUndefined();
    expect(loadExternalCommercialVerifierRegistry({ NEXYFAB_EXTERNAL_VERIFIER_REGISTRY_JSON: 'not-json' })).toBeUndefined();
  });

  it('does not accept a private verifier key in web/server public registry', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    expect(loadExternalCommercialVerifierRegistry({ NEXYFAB_EXTERNAL_VERIFIER_REGISTRY_JSON: JSON.stringify([{ keyId: 'external-private', role: 'external_verifier', publicKeyPem: privateKeyPem, fingerprintSha256: 'a'.repeat(64) }]) })).toBeUndefined();
  });
});
