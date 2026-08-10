import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyRecaptchaV3 } from './recaptcha';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('verifyRecaptchaV3', () => {
  it('fails closed when the server secret is missing', async () => {
    vi.stubEnv('RECAPTCHA_SECRET_KEY', '');
    expect(await verifyRecaptchaV3('token', { action: 'partner_register' })).toBe(false);
  });

  it('requires matching action, score, and configured hostname', async () => {
    vi.stubEnv('RECAPTCHA_SECRET_KEY', 'secret');
    vi.stubEnv('RECAPTCHA_ALLOWED_HOSTNAMES', 'nexyfab.com');
    vi.stubEnv('RECAPTCHA_MIN_SCORE', '0.7');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true, action: 'partner_register', score: 0.9, hostname: 'nexyfab.com',
    }), { status: 200 })));
    expect(await verifyRecaptchaV3('token', { action: 'partner_register' })).toBe(true);
  });

  it('rejects a valid token replayed for another action', async () => {
    vi.stubEnv('RECAPTCHA_SECRET_KEY', 'secret');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true, action: 'send_mail', score: 0.9, hostname: 'nexyfab.com',
    }), { status: 200 })));
    expect(await verifyRecaptchaV3('token', { action: 'partner_register' })).toBe(false);
  });
});
