import { describe, expect, it } from 'vitest';
import { isPaymentCollectionEnabled, PAYMENTS_DISABLED_CODE } from './payment-gate';

describe('global payment collection gate', () => {
  it('fails closed when the flag is missing or malformed', () => {
    expect(isPaymentCollectionEnabled({ NEXYFAB_PAYMENTS_ENABLED: undefined })).toBe(false);
    expect(isPaymentCollectionEnabled({ NEXYFAB_PAYMENTS_ENABLED: '1' })).toBe(false);
    expect(isPaymentCollectionEnabled({ NEXYFAB_PAYMENTS_ENABLED: 'yes' })).toBe(false);
  });

  it('opens only for an explicit true value', () => {
    expect(isPaymentCollectionEnabled({ NEXYFAB_PAYMENTS_ENABLED: 'true' })).toBe(true);
    expect(isPaymentCollectionEnabled({ NEXYFAB_PAYMENTS_ENABLED: ' TRUE ' })).toBe(true);
  });

  it('uses a stable client-facing denial code', () => {
    expect(PAYMENTS_DISABLED_CODE).toBe('PAYMENTS_DISABLED');
  });
});
