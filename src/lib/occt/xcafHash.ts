import { Sha256 } from '@aws-crypto/sha256-js';
import { canonicalCadConsumerDraftJson, type CanonicalCadJsonValue } from '@/lib/cad/canonicalCadV2ConsumerDraft';

export const XCAF_HASH_ALGORITHM = 'sha256' as const;
export const XCAF_HASH_DOMAIN_PREFIX = 'nexyfab.precision-cad.xcaf-hash.v1' as const;
export const XCAF_SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type XcafHashDomain =
  | 'geometry-summary'
  | 'semantic'
  | 'canonical-projection'
  | 'revision-binding'
  | 'object-id'
  | 'relationship-id';

export function isXcafSha256(value: unknown): value is string {
  return typeof value === 'string' && XCAF_SHA256_PATTERN.test(value);
}

function digest(value: string): string {
  const hash = new Sha256();
  hash.update(value);
  return [...hash.digestSync()].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Hashes are deliberately domain-separated. Source bytes, native geometry,
 * semantic metadata, canonical projections, and revision bindings must never
 * be interchangeable merely because their serialized values happen to match.
 */
export function hashXcafDomain(domain: XcafHashDomain, value: unknown): string {
  const json = canonicalCadConsumerDraftJson(value as CanonicalCadJsonValue);
  return digest(`${XCAF_HASH_DOMAIN_PREFIX}\n${domain}\n${json}`);
}

export function hashXcafGeometrySummary(value: unknown): string {
  return hashXcafDomain('geometry-summary', value);
}

export function hashXcafSemantic(value: unknown): string {
  return hashXcafDomain('semantic', value);
}

export function hashXcafCanonicalProjection(value: unknown): string {
  return hashXcafDomain('canonical-projection', value);
}

export function hashXcafRevisionBinding(value: unknown): string {
  return hashXcafDomain('revision-binding', value);
}

export function hashXcafObjectId(value: unknown, hashCharacters = 32): string {
  if (!Number.isSafeInteger(hashCharacters) || hashCharacters < 32 || hashCharacters > 64) {
    throw new Error('xcaf_hash_characters_invalid');
  }
  return `xcaf.object.${hashXcafDomain('object-id', value).slice(0, hashCharacters)}`;
}

export function hashXcafRelationshipId(value: unknown, hashCharacters = 32): string {
  if (!Number.isSafeInteger(hashCharacters) || hashCharacters < 32 || hashCharacters > 64) {
    throw new Error('xcaf_hash_characters_invalid');
  }
  return `xcaf.relationship.${hashXcafDomain('relationship-id', value).slice(0, hashCharacters)}`;
}
