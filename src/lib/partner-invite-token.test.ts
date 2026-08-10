import { describe, expect, it } from 'vitest';
import {
  hashPartnerInviteToken,
  partnerInviteTokenLookupCandidates,
  verifyPartnerInviteToken,
} from './partner-invite-token';

describe('partner invite token storage compatibility', () => {
  it('stores new tokens as deterministic hashes without retaining the secret', () => {
    const raw = 'closed-beta-magic-link-secret';
    const stored = hashPartnerInviteToken(raw);
    expect(stored).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(stored).not.toContain(raw);
    expect(verifyPartnerInviteToken(stored, raw)).toBe(true);
    expect(verifyPartnerInviteToken(stored, `${raw}x`)).toBe(false);
  });

  it('keeps legacy raw invites readable during migration', () => {
    const raw = 'legacy-invite-token';
    const [hashed, legacy] = partnerInviteTokenLookupCandidates(raw);
    expect(hashed).toBe(hashPartnerInviteToken(raw));
    expect(legacy).toBe(raw);
    expect(verifyPartnerInviteToken(legacy, raw)).toBe(true);
  });
});
