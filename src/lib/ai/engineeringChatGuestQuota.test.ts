import { describe, expect, it } from 'vitest';
import { engineeringChatGuestQuotaKey, guestEngineeringQuotaMustFailClosed } from './engineeringChatGuestQuota';

describe('engineering chat guest quota identity', () => {
  it('uses one key across chat routes and does not include a client thread id', () => {
    expect(engineeringChatGuestQuotaKey('demo-1', '203.0.113.4'))
      .toBe('eng-chat-guest-day:demo-1:203.0.113.4');
    expect(engineeringChatGuestQuotaKey(null, '203.0.113.4'))
      .toBe('eng-chat-guest-day:ip:203.0.113.4');
  });

  it('requires distributed quota storage in production and commercial CAD mode', () => {
    expect(guestEngineeringQuotaMustFailClosed({ NODE_ENV: 'production' })).toBe(true);
    expect(guestEngineeringQuotaMustFailClosed({ NODE_ENV: 'development', NEXYFAB_CAD_INDEPENDENT_MODE: '1' })).toBe(true);
    expect(guestEngineeringQuotaMustFailClosed({ NODE_ENV: 'development' })).toBe(false);
  });
});
