import { createHash, timingSafeEqual } from 'crypto';

const HASH_PREFIX = 'sha256:';

export function hashPartnerInviteToken(token: string): string {
  return `${HASH_PREFIX}${createHash('sha256').update(token, 'utf8').digest('hex')}`;
}

/**
 * New invites are stored as hashes. The raw candidate is also returned for
 * database lookup so pre-migration Closed Beta invites continue to work.
 */
export function partnerInviteTokenLookupCandidates(token: string): [string, string] {
  return [hashPartnerInviteToken(token), token];
}

export function verifyPartnerInviteToken(stored: string, candidate: string): boolean {
  const expected = stored.startsWith(HASH_PREFIX) ? hashPartnerInviteToken(candidate) : candidate;
  const left = Buffer.from(stored, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
