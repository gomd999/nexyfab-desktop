import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGS } from './normalize';
import {
  getSsoCommercialCopy,
  isSsoIncludedInPlan,
  SSO_ACTIVATION_AVAILABLE,
  SSO_COMMERCIAL_STATUS,
} from './ssoCommercialStatus';

describe('SSO commercial UI contract', () => {
  it('does not entitle SSO through any advertised plan', () => {
    expect(SSO_COMMERCIAL_STATUS).toBe('hold');
    expect(SSO_ACTIVATION_AVAILABLE).toBe(false);
    for (const plan of ['free', 'pro', 'team', 'enterprise'] as const) {
      expect(isSsoIncludedInPlan(plan)).toBe(false);
    }
  });

  it('ships an explicit localized HOLD disclosure for all six routes', () => {
    const copies = SUPPORTED_LANGS.map(lang => getSsoCommercialCopy(lang));
    expect(copies).toHaveLength(6);
    expect(new Set(copies.map(copy => copy.unavailableTitle))).toHaveLength(6);
    for (const copy of copies) {
      expect(copy.availabilityBadge.length).toBeGreaterThan(5);
      expect(copy.pricingDisclosure).toMatch(/SSO/i);
      expect(copy.enterpriseSsoFeature).toMatch(/SSO/);
      expect(copy.statusLabel.length).toBeGreaterThan(5);
      expect(copy.saveMetadata.length).toBeGreaterThan(5);
    }
  });
});
