import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseTrustedReviewerKeys, summarizeTrustedReviewerRegistry } from './nativeCadExpertReview';

describe('native CAD reviewer registry readiness', () => {
  const key = () => generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
  it('requires a distinct identity combination across the two roles', () => {
    const shared = key();
    expect(summarizeTrustedReviewerRegistry({ one: { publicKey: shared, roles: ['domain-reviewer', 'independent-reviewer'] } })).toEqual({ reviewerKeyCount: 1, domainEligibleCount: 1, independentEligibleCount: 1, distinctPairAvailable: false });
    expect(summarizeTrustedReviewerRegistry({ domain: { publicKey: shared, roles: ['domain-reviewer'] }, independent: { publicKey: shared, roles: ['independent-reviewer'] } }).distinctPairAvailable).toBe(false);
    expect(summarizeTrustedReviewerRegistry({ domain: { publicKey: key(), roles: ['domain-reviewer'] }, independent: { publicKey: key(), roles: ['independent-reviewer'] } }).distinctPairAvailable).toBe(true);
  });
  it('rejects legacy unscoped keys and invalid roles from environment JSON', () => {
    const publicKey = key();
    expect(parseTrustedReviewerKeys(JSON.stringify({ legacy: publicKey, invalid: { publicKey, roles: ['owner'] } }))).toEqual({});
  });
});
