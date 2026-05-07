import { describe, expect, it } from 'vitest';
import { normPartnerEmail } from '../partner-factory-access';

describe('normPartnerEmail', () => {
  it('trims and lowercases', () => {
    expect(normPartnerEmail('  Foo@Bar.COM  ')).toBe('foo@bar.com');
  });

  it('handles null and undefined', () => {
    expect(normPartnerEmail(null)).toBe('');
    expect(normPartnerEmail(undefined)).toBe('');
  });
});
