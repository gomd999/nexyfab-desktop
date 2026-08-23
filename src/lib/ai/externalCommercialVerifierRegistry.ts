import { createHash, createPublicKey } from 'node:crypto';

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export interface ExternalCommercialVerifierIdentity { keyId: string; role: 'external_verifier'; publicKeyPem: string; fingerprintSha256: string; }
export interface ExternalCommercialVerifierRegistry { identities: readonly ExternalCommercialVerifierIdentity[]; }
export function normalizedExternalFingerprint(publicKeyPem: string): string | undefined { try { if (typeof publicKeyPem !== 'string' || /PRIVATE KEY/i.test(publicKeyPem)) return undefined; const key = createPublicKey(publicKeyPem); return key.asymmetricKeyType === 'ed25519' ? createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex') : undefined; } catch { return undefined; } }
export function loadExternalCommercialVerifierRegistry(env: Record<string, string | undefined> = process.env): ExternalCommercialVerifierRegistry | undefined {
  let parsed: unknown; try { parsed = JSON.parse(env.NEXYFAB_EXTERNAL_VERIFIER_REGISTRY_JSON ?? ''); } catch { return undefined; }
  if (!Array.isArray(parsed)) return undefined;
  const identities = parsed.map(item => item as ExternalCommercialVerifierIdentity);
  if (identities.length < 1 || identities.length > 3 || new Set(identities.map(item => item.keyId)).size !== identities.length || new Set(identities.map(item => item.fingerprintSha256)).size !== identities.length) return undefined;
  if (identities.some(item => !item || typeof item !== 'object' || !ID.test(item.keyId) || item.role !== 'external_verifier' || !SHA256.test(item.fingerprintSha256) || normalizedExternalFingerprint(item.publicKeyPem) !== item.fingerprintSha256 || Object.keys(item).sort().join(',') !== 'fingerprintSha256,keyId,publicKeyPem,role')) return undefined;
  return { identities };
}
export function findExternalVerifier(registry: ExternalCommercialVerifierRegistry | undefined, keyId: string, fingerprintSha256: string): ExternalCommercialVerifierIdentity | undefined { return registry?.identities.find(item => item.keyId === keyId && item.fingerprintSha256 === fingerprintSha256); }
